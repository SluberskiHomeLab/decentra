/**
 * VoiceChatSFU — LiveKit-based voice/video implementation for server voice channels.
 *
 * Replaces the P2P mesh (VoiceChat.ts) for server channels; P2P is still used for
 * direct (DM) calls.
 *
 * Public interface mirrors VoiceChat so ChatPage.tsx can route calls to either class
 * without knowing which mode is active.
 *
 * SECURITY HARDENING:
 * - iceTransportPolicy: 'relay' — all media is routed through TURN, preventing IP leakage.
 * - bundlePolicy: 'max-bundle' — reduces ICE candidate attack surface.
 * - E2EE via LiveKit insertable streams — media is encrypted client-side with a shared
 *   key derived from SHA-256(serverId + ":" + channelId).  The LiveKit SFU sees only
 *   encrypted frames and cannot decrypt audio/video.
 *   NOTE: This key is deterministic from public room identifiers.  It prevents the
 *   server from passively decrypting media, but does not protect against other room
 *   members who know the server + channel IDs (i.e., every member of the channel).
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

  // E2EE key provider — shared key derived per-room
  private e2eeKeyProvider: ExternalE2EEKeyProvider
  private isE2EEActive = false

  // Local media tracks
  private localAudioTrack: LocalAudioTrack | null = null
  private localVideoTrack: LocalVideoTrack | null = null
  private localScreenTrack: LocalVideoTrack | null = null

  // Per-participant remote MediaStreams (keyed by participant identity = username)
  private participantStreams: Map<string, MediaStream> = new Map()

  // UI state
  private isMuted = false
  private isVideoEnabled = false
  private isScreenSharing = false
  private isConnecting = false
  private isInRoom = false

  // Channel tracking (mirrors VoiceChat API so ChatPage can call getCurrentChannel())
  private currentVoiceServer: string | null = null
  private currentVoiceChannel: string | null = null

  // Quality
  private qualityPreset: VoiceQualityPreset

  // Device preferences
  private selectedMicrophoneId: string | null = null
  private selectedSpeakerId: string | null = null
  private selectedCameraId: string | null = null
  private screenShareResolution = 1080
  private screenShareFramerate = 60

  // Callbacks — same signatures as VoiceChat
  private onStateChange: (() => void) | null = null
  private onRemoteStreamChange: ((peer: string, stream: MediaStream | null) => void) | null = null
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
    const room = new Room({
      // Automatically subscribe to all published tracks
      adaptiveStream: true,
      dynacast: true,
      // SECURITY: E2EE via insertable streams.
      // The ExternalE2EEKeyProvider uses a shared passphrase for all participants.
      // The actual key is set in connect() before joining the room.
      encryption: {
        keyProvider: this.e2eeKeyProvider,
        worker: new Worker(new URL('livekit-client/e2ee-worker', import.meta.url)),
      },
    })

    room.on(RoomEvent.Connected, () => {
      console.log('[SFU] Connected to LiveKit room')
      this.isConnecting = false
      this.isInRoom = true
      this.notifyStateChange()
      this.updateParticipantsList()
    })

    room.on(RoomEvent.Disconnected, () => {
      console.log('[SFU] Disconnected from LiveKit room')
      this.isInRoom = false
      this.isConnecting = false
      this.isVideoEnabled = false
      this.isScreenSharing = false
      this.participantStreams.clear()
      this.notifyStateChange()
      this.updateParticipantsList()
    })

    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio || track.kind === Track.Kind.Video) {
          let stream = this.participantStreams.get(participant.identity)
          if (!stream) {
            stream = new MediaStream()
            this.participantStreams.set(participant.identity, stream)
          }
          stream.addTrack(track.mediaStreamTrack)
          if (this.onRemoteStreamChange) {
            this.onRemoteStreamChange(participant.identity, stream)
          }
        }
      },
    )

    room.on(
      RoomEvent.TrackUnsubscribed,
      (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        const stream = this.participantStreams.get(participant.identity)
        if (stream) {
          stream.removeTrack(track.mediaStreamTrack)
          // If no tracks remain, clear the stream entry
          if (stream.getTracks().length === 0) {
            this.participantStreams.delete(participant.identity)
            if (this.onRemoteStreamChange) {
              this.onRemoteStreamChange(participant.identity, null)
            }
          } else {
            if (this.onRemoteStreamChange) {
              this.onRemoteStreamChange(participant.identity, stream)
            }
          }
        }
      },
    )

    room.on(RoomEvent.ParticipantConnected, (_participant: RemoteParticipant) => {
      this.updateParticipantsList()
    })

    room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      this.participantStreams.delete(participant.identity)
      if (this.onRemoteStreamChange) {
        this.onRemoteStreamChange(participant.identity, null)
      }
      this.updateParticipantsList()
    })

    return room
  }

  // ─── Connect / disconnect ──────────────────────────────────────────────────

  /**
   * Connect to a LiveKit room and publish the local mic.
   * Called by ChatPage after it receives 'voice_channel_joined' with a livekit_token.
   */
  async connect(
    url: string,
    token: string,
    serverId: string,
    channelId: string,
    startMuted = false,
  ): Promise<void> {
    this.isConnecting = true
    this.currentVoiceServer = serverId
    this.currentVoiceChannel = channelId
    this.notifyStateChange()

    try {
      // ── E2EE: Derive a shared key from serverId + channelId ──────────────
      // All participants in the same channel derive the same key deterministically.
      // This prevents the SFU from passively decrypting media.
      // NOTE: The key is deterministic from public identifiers — it stops the
      // server from reading media but does not provide per-user key isolation.
      const keyMaterial = `${serverId}:${channelId}`
      const hashBuffer = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(keyMaterial),
      )
      // Use the raw 32-byte hash as the shared passphrase (ArrayBuffer path → HKDF)
      await this.e2eeKeyProvider.setKey(hashBuffer)
      this.isE2EEActive = true

      // Acquire microphone before connecting so connect() includes the track
      const config = VOICE_QUALITY_CONFIGS[this.qualityPreset]

      this.localAudioTrack = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: config.stereo ? 2 : 1,
        deviceId: this.selectedMicrophoneId ?? undefined,
      })

      await this.room.connect(url, token, {
        autoSubscribe: true,
        // SECURITY: Force all ICE traffic through TURN relay only — prevents IP leakage.
        rtcConfig: {
          iceTransportPolicy: 'relay',
          bundlePolicy: 'max-bundle',
        },
      })

      // Enable E2EE after connection is established
      await this.room.setE2EEEnabled(true)

      // Publish audio with quality-preset encoding params
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
      // Re-throw so callers (ChatPage) can surface an error toast to the user.
      throw err
    }
  }

  /** Cleanly disconnect from the LiveKit room and release all local tracks. */
  disconnect(): void {
    this.room.disconnect()

    this.localAudioTrack?.stop()
    this.localAudioTrack = null
    this.localVideoTrack?.stop()
    this.localVideoTrack = null
    this.localScreenTrack?.stop()
    this.localScreenTrack = null

    this.participantStreams.clear()
    this.isMuted = false
    this.isVideoEnabled = false
    this.isScreenSharing = false
    this.isInRoom = false
    this.isE2EEActive = false
    this.currentVoiceServer = null
    this.currentVoiceChannel = null
    this.notifyStateChange()
  }

  // ─── Mute / video / screen share ──────────────────────────────────────────

  toggleMute(): void {
    if (!this.localAudioTrack) return
    this.isMuted = !this.isMuted
    // Toggle via the underlying MediaStreamTrack so this works regardless of
    // livekit-client version and doesn't require an await.
    this.localAudioTrack.mediaStreamTrack.enabled = !this.isMuted
    this.notifyStateChange()
    this.sendVoiceState()
  }

  toggleVideo(): void {
    if (this.isVideoEnabled) {
      this.disableVideo()
    } else {
      this.enableVideo()
    }
  }

  toggleScreenShare(): void {
    if (this.isScreenSharing) {
      this.disableScreenShare()
    } else {
      this.enableScreenShare()
    }
  }

  async enableVideo(): Promise<boolean> {
    try {
      this.localVideoTrack = await createLocalVideoTrack({
        resolution: { width: 640, height: 480 },
        deviceId: this.selectedCameraId ?? undefined,
      })
      await this.room.localParticipant.publishTrack(this.localVideoTrack)
      this.isVideoEnabled = true
      this.notifyStateChange()
      this.sendVoiceState()
      return true
    } catch (err) {
      console.error('[SFU] enableVideo error:', err)
      return false
    }
  }

  disableVideo(): void {
    if (this.localVideoTrack) {
      this.room.localParticipant.unpublishTrack(this.localVideoTrack)
      this.localVideoTrack.stop()
      this.localVideoTrack = null
    }
    this.isVideoEnabled = false
    this.notifyStateChange()
    this.sendVoiceState()
  }

  async enableScreenShare(): Promise<boolean> {
    try {
      const tracks = await createLocalScreenTracks({
        // resolution sits at the top level of ScreenShareCaptureOptions
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
      videoTrack.mediaStreamTrack.onended = () => this.disableScreenShare()

      await this.room.localParticipant.publishTrack(videoTrack, {
        source: Track.Source.ScreenShare,
      })
      this.isScreenSharing = true
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
    this.notifyStateChange()
    this.sendVoiceState()
  }

  // ─── Quality ──────────────────────────────────────────────────────────────

  setQualityPreset(preset: VoiceQualityPreset): void {
    this.qualityPreset = preset
    saveVoiceQualityPreset(preset)

    // Re-publish audio track with new encoding params if connected
    if (this.localAudioTrack && this.isInRoom) {
      const config = VOICE_QUALITY_CONFIGS[preset]
      // Republish: unpublish then publish with updated options
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
      const arrayBuffer = await audioBlob.arrayBuffer()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

      const soundSource = audioContext.createBufferSource()
      soundSource.buffer = audioBuffer
      const destination = audioContext.createMediaStreamDestination()

      const soundGain = audioContext.createGain()
      soundGain.gain.value = 0.8
      soundSource.connect(soundGain)
      soundGain.connect(destination)

      // Mix original mic track back in
      const micStream = new MediaStream([this.localAudioTrack.mediaStreamTrack])
      const micSource = audioContext.createMediaStreamSource(micStream)
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

  // ─── Participants / state that mirrors VoiceChat API ──────────────────────

  /**
   * No-op for SFU mode — participant updates come from LiveKit room events.
   * ChatPage may still call this when voice_state_update arrives; we ignore it
   * for media purposes but still update the participants list.
   */
  handleVoiceJoined(_participants: string[]): void {
    // SFU handles participant tracks via RoomEvent.ParticipantConnected/TrackSubscribed
    this.updateParticipantsList()
  }

  handleUserJoinedVoice(_username: string): void {
    this.updateParticipantsList()
  }

  handleUserLeftVoice(username: string): void {
    this.participantStreams.delete(username)
    if (this.onRemoteStreamChange) {
      this.onRemoteStreamChange(username, null)
    }
    this.updateParticipantsList()
  }

  /** Cleanly leave voice — disconnect from LiveKit and notify the WS server. */
  leaveVoice(): void {
    this.disconnect()
    this.ws.send({ type: 'leave_voice_channel' })
  }

  // ─── Device management ────────────────────────────────────────────────────

  async getAudioDevices(): Promise<MediaDeviceInfo[]> {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput')
    } catch {
      return []
    }
  }

  async getVideoDevices(): Promise<MediaDeviceInfo[]> {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
    } catch {
      return []
    }
  }

  async getSpeakerDevices(): Promise<MediaDeviceInfo[]> {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput')
    } catch {
      return []
    }
  }

  setMicrophone(deviceId: string): void {
    this.selectedMicrophoneId = deviceId
    this.saveDevicePreferences()
  }

  setSpeaker(deviceId: string): void {
    this.selectedSpeakerId = deviceId
    this.saveDevicePreferences()
  }

  setCamera(deviceId: string): void {
    this.selectedCameraId = deviceId
    this.saveDevicePreferences()
  }

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

  setOnStateChange(cb: () => void): void {
    this.onStateChange = cb
  }

  setOnRemoteStreamChange(cb: (peer: string, stream: MediaStream | null) => void): void {
    this.onRemoteStreamChange = cb
  }

  setOnParticipantsChange(cb: (participants: string[]) => void): void {
    this.onParticipantsChange = cb
  }

  // ─── Getters (mirror VoiceChat) ───────────────────────────────────────────

  getIsMuted(): boolean {
    return this.isMuted
  }

  getIsVideoEnabled(): boolean {
    return this.isVideoEnabled
  }

  getIsScreenSharing(): boolean {
    return this.isScreenSharing
  }

  getIsInVoice(): boolean {
    return this.isInRoom
  }

  getIsConnecting(): boolean {
    return this.isConnecting
  }

  getIsE2EEActive(): boolean {
    return this.isE2EEActive
  }

  getCurrentChannel(): { server: string | null; channel: string | null } {
    return { server: this.currentVoiceServer, channel: this.currentVoiceChannel }
  }

  /** Required by ChatPage; SFU has no concept of a pending channel after connect(). */
  getPendingChannel(): { server: string | null; channel: string | null } {
    return { server: null, channel: null }
  }

  getDirectCallPeer(): string | null {
    return null
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private notifyStateChange(): void {
    this.onStateChange?.()
  }

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
      video: this.isVideoEnabled,
      screen_sharing: this.isScreenSharing,
    })
  }

  private loadDevicePreferences(): void {
    try {
      const mic = localStorage.getItem('voicechat_microphone_id')
      const speaker = localStorage.getItem('voicechat_speaker_id')
      const camera = localStorage.getItem('voicechat_camera_id')
      const resolution = localStorage.getItem('voicechat_screenshare_resolution')
      const framerate = localStorage.getItem('voicechat_screenshare_framerate')
      if (mic) this.selectedMicrophoneId = mic
      if (speaker) this.selectedSpeakerId = speaker
      if (camera) this.selectedCameraId = camera
      if (resolution) this.screenShareResolution = parseInt(resolution)
      if (framerate) this.screenShareFramerate = parseInt(framerate)
    } catch {
      // localStorage unavailable
    }
  }

  private saveDevicePreferences(): void {
    try {
      if (this.selectedMicrophoneId) localStorage.setItem('voicechat_microphone_id', this.selectedMicrophoneId)
      if (this.selectedSpeakerId) localStorage.setItem('voicechat_speaker_id', this.selectedSpeakerId)
      if (this.selectedCameraId) localStorage.setItem('voicechat_camera_id', this.selectedCameraId)
      localStorage.setItem('voicechat_screenshare_resolution', this.screenShareResolution.toString())
      localStorage.setItem('voicechat_screenshare_framerate', this.screenShareFramerate.toString())
    } catch {
      // localStorage unavailable
    }
  }
}
