/**
 * VoiceChatSFU — LiveKit-based voice/video for all call types.
 *
 * Handles both server voice channels and DM calls; P2P WebRTC has been removed.
 *
 * Key behaviours:
 * - iceTransportPolicy: 'relay' — all media through LiveKit's built-in TURN.
 * - E2EE via insertable streams — server-provided random key per session.
 * - Camera and screen share published as independent tracks simultaneously.
 * - Remote camera/audio and remote screen share reported via separate callbacks.
 */

import {
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  createLocalVideoTrack,
  createLocalScreenTracks,
  ExternalE2EEKeyProvider,
  type RemoteParticipant,
  type RemoteTrackPublication,
  type RemoteTrack,
  type LocalAudioTrack,
  type LocalVideoTrack,
} from 'livekit-client'
import {
  type VoiceQualityPreset,
  VOICE_QUALITY_CONFIGS,
  loadVoiceQualityPreset,
  saveVoiceQualityPreset,
} from './voiceQuality'

export class VoiceChatSFU {
  private room: Room
  private username: string
  private ws: any

  private e2eeKeyProvider: ExternalE2EEKeyProvider
  private isE2EEActive = false

  // Local tracks — camera and screen share are independent (both can be active at once)
  private localAudioTrack: LocalAudioTrack | null = null
  private localCameraTrack: LocalVideoTrack | null = null
  private localScreenTrack: LocalVideoTrack | null = null

  // Per-participant streams split by source
  private participantCameraStreams: Map<string, MediaStream> = new Map()
  private participantScreenStreams: Map<string, MediaStream> = new Map()

  private isMuted = false
  private isCameraEnabled = false
  private isScreenSharing = false
  private isConnecting = false
  private isInRoom = false

  private currentVoiceServer: string | null = null
  private currentVoiceChannel: string | null = null

  private qualityPreset: VoiceQualityPreset

  private selectedMicrophoneId: string | null = null
  private selectedSpeakerId: string | null = null
  private selectedCameraId: string | null = null
  private screenShareResolution = 1080
  private screenShareFramerate = 60

  // Callbacks
  private onStateChange: (() => void) | null = null
  /** Called when a participant's camera+audio stream changes. */
  private onRemoteStreamChange: ((peer: string, stream: MediaStream | null) => void) | null = null
  /** Called when a participant's screen-share stream changes. */
  private onRemoteScreenChange: ((peer: string, stream: MediaStream | null) => void) | null = null
  private onParticipantsChange: ((participants: string[]) => void) | null = null

  constructor(ws: any, username: string) {
    this.ws = ws
    this.username = username
    this.qualityPreset = loadVoiceQualityPreset()
    this.e2eeKeyProvider = new ExternalE2EEKeyProvider({ ratchetWindowSize: 0 })
    this.room = this.buildRoom()
    this.loadDevicePreferences()
  }

  // ─── Room construction ─────────────────────────────────────────────────────

  private buildRoom(): Room {
    // E2EE worker: wrap construction in try/catch so bundler misconfigurations
    // (wrong worker URL in some Vite setups) degrade gracefully to no-E2EE.
    let encryptionOptions: any = undefined
    try {
      const e2eeWorker = new Worker(
        new URL('livekit-client/e2ee-worker', import.meta.url),
        { type: 'module' },
      )
      encryptionOptions = {
        keyProvider: this.e2eeKeyProvider,
        worker: e2eeWorker,
      }
    } catch (err) {
      console.warn('[SFU] E2EE worker unavailable — media will not be end-to-end encrypted:', err)
    }

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      ...(encryptionOptions ? { encryption: encryptionOptions } : {}),
    })

    room.on(RoomEvent.Connected, () => {
      this.isConnecting = false
      this.isInRoom = true
      this.notifyStateChange()
      this.updateParticipantsList()
    })

    room.on(RoomEvent.Disconnected, () => {
      this.isInRoom = false
      this.isConnecting = false
      this.isCameraEnabled = false
      this.isScreenSharing = false
      this.participantCameraStreams.clear()
      this.participantScreenStreams.clear()
      this.notifyStateChange()
      this.updateParticipantsList()
    })

    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        const isScreen =
          pub.source === Track.Source.ScreenShare ||
          pub.source === Track.Source.ScreenShareAudio

        if (isScreen) {
          let stream = this.participantScreenStreams.get(participant.identity)
          if (!stream) {
            stream = new MediaStream()
            this.participantScreenStreams.set(participant.identity, stream)
          }
          stream.addTrack(track.mediaStreamTrack)
          this.onRemoteScreenChange?.(participant.identity, stream)
        } else if (track.kind === Track.Kind.Audio || track.kind === Track.Kind.Video) {
          let stream = this.participantCameraStreams.get(participant.identity)
          if (!stream) {
            stream = new MediaStream()
            this.participantCameraStreams.set(participant.identity, stream)
          }
          stream.addTrack(track.mediaStreamTrack)
          this.onRemoteStreamChange?.(participant.identity, stream)
        }
      },
    )

    room.on(
      RoomEvent.TrackUnsubscribed,
      (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        const isScreen =
          pub.source === Track.Source.ScreenShare ||
          pub.source === Track.Source.ScreenShareAudio

        const streams = isScreen
          ? this.participantScreenStreams
          : this.participantCameraStreams
        const notify = isScreen ? this.onRemoteScreenChange : this.onRemoteStreamChange

        const stream = streams.get(participant.identity)
        if (stream) {
          stream.removeTrack(track.mediaStreamTrack)
          if (stream.getTracks().length === 0) {
            streams.delete(participant.identity)
            notify?.(participant.identity, null)
          } else {
            notify?.(participant.identity, stream)
          }
        }
      },
    )

    room.on(RoomEvent.ParticipantConnected, () => this.updateParticipantsList())

    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      this.participantCameraStreams.delete(participant.identity)
      this.participantScreenStreams.delete(participant.identity)
      this.onRemoteStreamChange?.(participant.identity, null)
      this.onRemoteScreenChange?.(participant.identity, null)
      this.updateParticipantsList()
    })

    return room
  }

  // ─── Connect / disconnect ──────────────────────────────────────────────────

  /**
   * Connect to a LiveKit room.
   *
   * @param serverId  For server channels: the server ID. For DM calls: pass 'dm'.
   * @param channelId For server channels: the channel ID. For DM calls: the room name.
   * @param e2eeKey   Base64 random key provided by the Decentra server; falls back to
   *                  a deterministic SHA-256 hash when not supplied.
   */
  async connect(
    url: string,
    token: string,
    serverId: string,
    channelId: string,
    startMuted = false,
    e2eeKey: string | null = null,
  ): Promise<void> {
    this.isConnecting = true
    this.currentVoiceServer = serverId
    this.currentVoiceChannel = channelId
    this.notifyStateChange()

    try {
      // ── E2EE key setup ──────────────────────────────────────────────────────
      if (this.isE2EECapable()) {
        let e2eeKeyBuffer: ArrayBuffer
        if (e2eeKey) {
          const keyBytes = Uint8Array.from(
            atob(e2eeKey.replace(/-/g, '+').replace(/_/g, '/')),
            (c) => c.charCodeAt(0),
          )
          e2eeKeyBuffer = keyBytes.buffer
        } else {
          const keyMaterial = `${serverId}:${channelId}`
          e2eeKeyBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keyMaterial))
        }
        await this.e2eeKeyProvider.setKey(e2eeKeyBuffer)
        this.isE2EEActive = true
      }

      // ── Acquire microphone ──────────────────────────────────────────────────
      const config = VOICE_QUALITY_CONFIGS[this.qualityPreset]
      this.localAudioTrack = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: config.stereo ? 2 : 1,
        deviceId: this.selectedMicrophoneId ?? undefined,
      })

      // ── Connect to LiveKit ──────────────────────────────────────────────────
      await this.room.connect(url, token, {
        autoSubscribe: true,
        rtcConfig: {
          // Force all ICE traffic through LiveKit's built-in TURN relay.
          // Prevents direct peer-to-peer connections and IP address leakage.
          iceTransportPolicy: 'relay',
          bundlePolicy: 'max-bundle',
        },
      })

      if (this.isE2EEActive) {
        await this.room.setE2EEEnabled(true)
      }

      // Publish microphone
      await this.room.localParticipant.publishTrack(this.localAudioTrack, {
        audioPreset: { maxBitrate: config.bitrate },
        dtx: config.dtx,
        forceStereo: config.stereo,
      })

      this.isMuted = startMuted
      if (this.isMuted) {
        this.localAudioTrack.mediaStreamTrack.enabled = false
      }
    } catch (err) {
      console.error('[SFU] connect error:', err)
      this.isConnecting = false
      this.isInRoom = false
      this.isE2EEActive = false
      this.currentVoiceServer = null
      this.currentVoiceChannel = null
      this.notifyStateChange()
      throw err
    }
  }

  disconnect(): void {
    this.room.disconnect()
    this.localAudioTrack?.stop()
    this.localAudioTrack = null
    this.localCameraTrack?.stop()
    this.localCameraTrack = null
    this.localScreenTrack?.stop()
    this.localScreenTrack = null
    this.participantCameraStreams.clear()
    this.participantScreenStreams.clear()
    this.isMuted = false
    this.isCameraEnabled = false
    this.isScreenSharing = false
    this.isInRoom = false
    this.isE2EEActive = false
    this.currentVoiceServer = null
    this.currentVoiceChannel = null
    this.notifyStateChange()
  }

  // ─── Mute ─────────────────────────────────────────────────────────────────

  toggleMute(): void {
    if (!this.localAudioTrack) return
    this.isMuted = !this.isMuted
    this.localAudioTrack.mediaStreamTrack.enabled = !this.isMuted
    this.notifyStateChange()
    this.sendVoiceState()
  }

  // ─── Camera ───────────────────────────────────────────────────────────────

  toggleVideo(): void {
    if (this.isCameraEnabled) {
      this.disableCamera()
    } else {
      this.enableCamera()
    }
  }

  async enableCamera(): Promise<boolean> {
    try {
      this.localCameraTrack = await createLocalVideoTrack({
        resolution: { width: 640, height: 480 },
        deviceId: this.selectedCameraId ?? undefined,
      })
      await this.room.localParticipant.publishTrack(this.localCameraTrack, {
        source: Track.Source.Camera,
      })
      this.isCameraEnabled = true
      this.notifyStateChange()
      this.sendVoiceState()
      return true
    } catch (err) {
      console.error('[SFU] enableCamera error:', err)
      return false
    }
  }

  disableCamera(): void {
    if (this.localCameraTrack) {
      this.room.localParticipant.unpublishTrack(this.localCameraTrack)
      this.localCameraTrack.stop()
      this.localCameraTrack = null
    }
    this.isCameraEnabled = false
    this.notifyStateChange()
    this.sendVoiceState()
  }

  // ─── Screen share (independent of camera) ─────────────────────────────────

  toggleScreenShare(): void {
    if (this.isScreenSharing) {
      this.disableScreenShare()
    } else {
      this.enableScreenShare()
    }
  }

  async enableScreenShare(): Promise<boolean> {
    try {
      const tracks = await createLocalScreenTracks({
        resolution: {
          width: this.screenShareResolution === 720 ? 1280 : 1920,
          height: this.screenShareResolution,
          frameRate: this.screenShareFramerate,
        },
        audio: false,
      })
      const videoTrack = tracks.find((t) => t.kind === Track.Kind.Video) as LocalVideoTrack | undefined
      if (!videoTrack) return false

      this.localScreenTrack = videoTrack
      // Browser's "Stop Sharing" button fires onended
      videoTrack.mediaStreamTrack.onended = () => this.disableScreenShare()

      await this.room.localParticipant.publishTrack(videoTrack, {
        source: Track.Source.ScreenShare,
      })
      this.isScreenSharing = true
      // Camera stays running — both tracks are published simultaneously
      this.notifyStateChange()
      this.sendVoiceState()
      return true
    } catch (err) {
      console.error('[SFU] enableScreenShare error:', err)
      return false
    }
  }

  disableScreenShare(): void {
    if (this.localScreenTrack) {
      this.room.localParticipant.unpublishTrack(this.localScreenTrack)
      this.localScreenTrack.stop()
      this.localScreenTrack = null
    }
    this.isScreenSharing = false
    // Camera is unaffected — remains published if it was running
    this.notifyStateChange()
    this.sendVoiceState()
  }

  // ─── Quality ──────────────────────────────────────────────────────────────

  setQualityPreset(preset: VoiceQualityPreset): void {
    this.qualityPreset = preset
    saveVoiceQualityPreset(preset)
    if (this.localAudioTrack && this.isInRoom) {
      const config = VOICE_QUALITY_CONFIGS[preset]
      this.room.localParticipant.unpublishTrack(this.localAudioTrack).then(() => {
        this.room.localParticipant.publishTrack(this.localAudioTrack!, {
          audioPreset: { maxBitrate: config.bitrate },
          dtx: config.dtx,
          forceStereo: config.stereo,
        })
      })
    }
  }

  getQualityPreset(): VoiceQualityPreset {
    return this.qualityPreset
  }

  // ─── Soundboard ──────────────────────────────────────────────────────────

  async playSoundboard(soundId: string): Promise<void> {
    if (!this.localAudioTrack?.sender) return
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/download-soundboard-sound/${soundId}?token=${token}`)
      if (!response.ok) return
      const audioBlob = await response.blob()
      const audioUrl = URL.createObjectURL(audioBlob)
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      const audioBuffer = await audioContext.decodeAudioData(await audioBlob.arrayBuffer())
      const soundSource = audioContext.createBufferSource()
      soundSource.buffer = audioBuffer
      const destination = audioContext.createMediaStreamDestination()
      const soundGain = audioContext.createGain()
      soundGain.gain.value = 0.8
      soundSource.connect(soundGain)
      soundGain.connect(destination)
      const micSource = audioContext.createMediaStreamSource(
        new MediaStream([this.localAudioTrack.mediaStreamTrack]),
      )
      const micGain = audioContext.createGain()
      micGain.gain.value = 1.0
      micSource.connect(micGain)
      micGain.connect(destination)
      const mixedTrack = destination.stream.getAudioTracks()[0]
      const originalTrack = this.localAudioTrack.mediaStreamTrack
      await this.localAudioTrack.sender.replaceTrack(mixedTrack)
      soundSource.start(0)
      soundSource.onended = async () => {
        if (this.localAudioTrack?.sender) {
          await this.localAudioTrack.sender.replaceTrack(originalTrack)
        }
        URL.revokeObjectURL(audioUrl)
        audioContext.close()
      }
    } catch (err) {
      console.error('[SFU] playSoundboard error:', err)
    }
  }

  async playRemoteSoundboard(soundId: string): Promise<void> {
    try {
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/download-soundboard-sound/${soundId}?token=${token}`)
      if (!response.ok) return
      const audioBlob = await response.blob()
      const audioUrl = URL.createObjectURL(audioBlob)
      const audio = new Audio(audioUrl)
      audio.volume = 0.8
      audio.onended = () => URL.revokeObjectURL(audioUrl)
      await audio.play()
    } catch (err) {
      console.error('[SFU] playRemoteSoundboard error:', err)
    }
  }

  // ─── Participant helpers ──────────────────────────────────────────────────

  handleVoiceJoined(_participants: string[]): void {
    this.updateParticipantsList()
  }

  handleUserJoinedVoice(_username: string): void {
    this.updateParticipantsList()
  }

  handleUserLeftVoice(username: string): void {
    this.participantCameraStreams.delete(username)
    this.participantScreenStreams.delete(username)
    this.onRemoteStreamChange?.(username, null)
    this.onRemoteScreenChange?.(username, null)
    this.updateParticipantsList()
  }

  leaveVoice(): void {
    this.disconnect()
    this.ws.send({ type: 'leave_voice_channel' })
  }

  // ─── Device management ────────────────────────────────────────────────────

  async getAudioDevices(): Promise<MediaDeviceInfo[]> {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
    } catch { return [] }
  }

  async getVideoDevices(): Promise<MediaDeviceInfo[]> {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
    } catch { return [] }
  }

  async getSpeakerDevices(): Promise<MediaDeviceInfo[]> {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput')
    } catch { return [] }
  }

  setMicrophone(deviceId: string): void { this.selectedMicrophoneId = deviceId; this.saveDevicePreferences() }
  setSpeaker(deviceId: string): void    { this.selectedSpeakerId    = deviceId; this.saveDevicePreferences() }
  setCamera(deviceId: string): void     { this.selectedCameraId     = deviceId; this.saveDevicePreferences() }

  setScreenShareSettings(resolution: number, framerate: number): void {
    this.screenShareResolution = resolution
    this.screenShareFramerate = framerate
    this.saveDevicePreferences()
  }

  getSelectedDevices() {
    return {
      microphone: this.selectedMicrophoneId,
      speaker: this.selectedSpeakerId,
      camera: this.selectedCameraId,
      screenShareResolution: this.screenShareResolution,
      screenShareFramerate: this.screenShareFramerate,
    }
  }

  // ─── Callbacks ────────────────────────────────────────────────────────────

  setOnStateChange(cb: () => void): void { this.onStateChange = cb }
  setOnRemoteStreamChange(cb: (peer: string, stream: MediaStream | null) => void): void {
    this.onRemoteStreamChange = cb
  }
  setOnRemoteScreenChange(cb: (peer: string, stream: MediaStream | null) => void): void {
    this.onRemoteScreenChange = cb
  }
  setOnParticipantsChange(cb: (participants: string[]) => void): void {
    this.onParticipantsChange = cb
  }

  // ─── Getters ──────────────────────────────────────────────────────────────

  getIsMuted(): boolean          { return this.isMuted }
  getIsVideoEnabled(): boolean   { return this.isCameraEnabled }
  getIsScreenSharing(): boolean  { return this.isScreenSharing }
  getIsInVoice(): boolean        { return this.isInRoom }
  getIsConnecting(): boolean     { return this.isConnecting }
  getIsE2EEActive(): boolean     { return this.isE2EEActive }

  getCurrentChannel(): { server: string | null; channel: string | null } {
    return { server: this.currentVoiceServer, channel: this.currentVoiceChannel }
  }

  getPendingChannel(): { server: string | null; channel: string | null } {
    return { server: null, channel: null }
  }

  getDirectCallPeer(): string | null { return null }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private isE2EECapable(): boolean {
    // E2EE requires the worker to have been created successfully in buildRoom()
    return (this.room as any).options?.encryption != null
  }

  private notifyStateChange(): void { this.onStateChange?.() }

  private updateParticipantsList(): void {
    if (!this.onParticipantsChange) return
    const participants: string[] = [this.username]
    for (const p of this.room.remoteParticipants.values()) {
      participants.push(p.identity)
    }
    this.onParticipantsChange(participants)
  }

  private sendVoiceState(): void {
    this.ws.send({
      type: 'voice_state_update',
      muted: this.isMuted,
      video: this.isCameraEnabled,
      screen_sharing: this.isScreenSharing,
    })
  }

  private loadDevicePreferences(): void {
    try {
      const mic        = localStorage.getItem('voicechat_microphone_id')
      const speaker    = localStorage.getItem('voicechat_speaker_id')
      const camera     = localStorage.getItem('voicechat_camera_id')
      const resolution = localStorage.getItem('voicechat_screenshare_resolution')
      const framerate  = localStorage.getItem('voicechat_screenshare_framerate')
      if (mic)        this.selectedMicrophoneId    = mic
      if (speaker)    this.selectedSpeakerId       = speaker
      if (camera)     this.selectedCameraId        = camera
      if (resolution) this.screenShareResolution   = parseInt(resolution)
      if (framerate)  this.screenShareFramerate     = parseInt(framerate)
    } catch { /* localStorage unavailable */ }
  }

  private saveDevicePreferences(): void {
    try {
      if (this.selectedMicrophoneId) localStorage.setItem('voicechat_microphone_id', this.selectedMicrophoneId)
      if (this.selectedSpeakerId)    localStorage.setItem('voicechat_speaker_id',    this.selectedSpeakerId)
      if (this.selectedCameraId)     localStorage.setItem('voicechat_camera_id',     this.selectedCameraId)
      localStorage.setItem('voicechat_screenshare_resolution', this.screenShareResolution.toString())
      localStorage.setItem('voicechat_screenshare_framerate',  this.screenShareFramerate.toString())
    } catch { /* localStorage unavailable */ }
  }
}
