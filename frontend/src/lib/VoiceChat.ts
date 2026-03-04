// Voice/Video chat functionality with WebRTC for React
import {
  type VoiceQualityPreset,
  VOICE_QUALITY_CONFIGS,
  loadVoiceQualityPreset,
  saveVoiceQualityPreset,
} from './voiceQuality'

export class VoiceChat {
  private ws: any
  private username: string
  private peerConnections: Map<string, RTCPeerConnection>
  private localStream: MediaStream | null
  private localVideoStream: MediaStream | null
  private localScreenStream: MediaStream | null
  private currentVoiceChannel: string | null
  private currentVoiceServer: string | null
  private pendingVoiceChannel: string | null
  private pendingVoiceServer: string | null
  private inDirectCall: boolean
  private directCallPeer: string | null
  private isMuted: boolean
  private isVideoEnabled: boolean
  private isScreenSharing: boolean
  private selectedMicrophoneId: string | null
  private selectedSpeakerId: string | null
  private selectedCameraId: string | null
  private screenShareResolution: number
  private screenShareFramerate: number
  private iceServers: RTCConfiguration
  private shouldInitiateOffers: boolean
  private onStateChange: (() => void) | null
  private onRemoteStreamChange: ((peer: string, stream: MediaStream | null) => void) | null
  private onParticipantsChange: ((participants: string[]) => void) | null
  private qualityPreset: VoiceQualityPreset

  constructor(ws: any, username: string) {
    this.ws = ws
    this.username = username
    this.peerConnections = new Map()
    this.localStream = null
    this.localVideoStream = null
    this.localScreenStream = null
    this.currentVoiceChannel = null
    this.currentVoiceServer = null
    this.pendingVoiceChannel = null
    this.pendingVoiceServer = null
    this.inDirectCall = false
    this.directCallPeer = null
    this.isMuted = false
    this.isVideoEnabled = false
    this.isScreenSharing = false
    this.selectedMicrophoneId = null
    this.selectedSpeakerId = null
    this.selectedCameraId = null
    this.screenShareResolution = 1080
    this.screenShareFramerate = 60
    this.onStateChange = null
    this.onRemoteStreamChange = null
    this.onParticipantsChange = null
    this.shouldInitiateOffers = false
    this.qualityPreset = loadVoiceQualityPreset()

    // Load device preferences
    this.loadDevicePreferences()

    // ICE servers — no third-party STUN; fetched from backend before each join.
    // With iceTransportPolicy:'relay', all media goes through our self-hosted
    // Coturn TURN server, preventing IP address leakage between peers.
    this.iceServers = {
      iceServers: [],
      iceTransportPolicy: 'relay' as RTCIceTransportPolicy,
      bundlePolicy: 'max-bundle' as RTCBundlePolicy,
    }
  }

  /** Fetch ICE server list from the backend (authenticated, returns Coturn TURN credentials). */
  private async fetchIceServers(): Promise<void> {
    const token = localStorage.getItem('token')
    if (!token) {
      throw new Error('No auth token available — cannot fetch ICE servers')
    }
    const res = await fetch('/api/voice/ice-servers', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const reason: string = (data as any).error ?? `HTTP ${res.status}`
      throw new Error(`Voice relay unavailable: ${reason}`)
    }
    if (!Array.isArray((data as any).ice_servers) || (data as any).ice_servers.length === 0) {
      throw new Error('Server returned no TURN credentials — voice relay is not configured')
    }
    this.iceServers = {
      iceServers: (data as any).ice_servers,
      iceTransportPolicy: 'relay' as RTCIceTransportPolicy,
      bundlePolicy: 'max-bundle' as RTCBundlePolicy,
    }
  }

  /** Wrapper that logs and returns false on failure so call-site code stays clean. */
  private async ensureIceServers(): Promise<boolean> {
    try {
      await this.fetchIceServers()
      return true
    } catch (err) {
      console.error('Failed to fetch ICE servers:', err)
      return false
    }
  }

  setOnStateChange(callback: () => void) {
    this.onStateChange = callback
  }

  setOnRemoteStreamChange(callback: (peer: string, stream: MediaStream | null) => void) {
    this.onRemoteStreamChange = callback
  }

  setOnParticipantsChange(callback: (participants: string[]) => void) {
    this.onParticipantsChange = callback
  }

  private notifyStateChange() {
    if (this.onStateChange) {
      this.onStateChange()
    }
  }

  private loadDevicePreferences() {
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
    } catch (error) {
      console.error('Error loading device preferences:', error)
    }
  }

  private saveDevicePreferences() {
    try {
      if (this.selectedMicrophoneId) {
        localStorage.setItem('voicechat_microphone_id', this.selectedMicrophoneId)
      }
      if (this.selectedSpeakerId) {
        localStorage.setItem('voicechat_speaker_id', this.selectedSpeakerId)
      }
      if (this.selectedCameraId) {
        localStorage.setItem('voicechat_camera_id', this.selectedCameraId)
      }
      localStorage.setItem('voicechat_screenshare_resolution', this.screenShareResolution.toString())
      localStorage.setItem('voicechat_screenshare_framerate', this.screenShareFramerate.toString())
    } catch (error) {
      console.error('Error saving device preferences:', error)
    }
  }

  async initLocalStream(): Promise<boolean> {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('Browser does not support audio/video')
        alert('Your browser does not support audio/video calls.')
        return false
      }

      const config = VOICE_QUALITY_CONFIGS[this.qualityPreset]
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: config.stereo ? 2 : 1,
        ...(this.selectedMicrophoneId ? { deviceId: { exact: this.selectedMicrophoneId } } : {}),
      }

      const constraints: MediaStreamConstraints = {
        audio: audioConstraints,
        video: false,
      }

      console.log('Requesting microphone access...')
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints)
      console.log('Microphone access granted')
      this.notifyStateChange()
      return true
    } catch (error: any) {
      console.error('Error accessing microphone:', error)
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        alert('Microphone access denied. Please allow microphone access in your browser settings.')
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        alert('No microphone found. Please connect a microphone and try again.')
      } else {
        alert(`Error accessing microphone: ${error.message || error.name}`)
      }
      return false
    }
  }

  async enableVideo(): Promise<boolean> {
    try {
      if (!navigator.mediaDevices) return false

      const constraints: MediaStreamConstraints = {
        video: this.selectedCameraId
          ? { deviceId: { exact: this.selectedCameraId }, width: 640, height: 480 }
          : { width: 640, height: 480 },
      }

      this.localVideoStream = await navigator.mediaDevices.getUserMedia(constraints)
      this.isVideoEnabled = true

      // Add video track to all peer connections
      const videoTrack = this.localVideoStream.getVideoTracks()[0]
      this.peerConnections.forEach((pc) => {
        const senders = pc.getSenders()
        const videoSender = senders.find((s) => s.track?.kind === 'video')
        if (videoSender) {
          videoSender.replaceTrack(videoTrack)
        } else if (this.localVideoStream) {
          pc.addTrack(videoTrack, this.localVideoStream)
        }
      })

      this.notifyStateChange()
      this.sendVoiceState()
      return true
    } catch (error) {
      console.error('Error enabling video:', error)
      return false
    }
  }

  disableVideo() {
    if (this.localVideoStream) {
      this.localVideoStream.getTracks().forEach((track) => track.stop())
      this.localVideoStream = null
    }
    this.isVideoEnabled = false

    // Remove video track from all peer connections
    this.peerConnections.forEach((pc) => {
      const senders = pc.getSenders()
      const videoSender = senders.find((s) => s.track?.kind === 'video')
      if (videoSender) {
        pc.removeTrack(videoSender)
      }
    })

    this.notifyStateChange()
    this.sendVoiceState()
  }

  async enableScreenShare(): Promise<boolean> {
    try {
      if (!navigator.mediaDevices || !(navigator.mediaDevices as any).getDisplayMedia) {
        alert('Screen sharing is not supported in your browser.')
        return false
      }

      const constraints: DisplayMediaStreamOptions = {
        video: {
          width: this.screenShareResolution === 720 ? 1280 : 1920,
          height: this.screenShareResolution,
          frameRate: this.screenShareFramerate,
        },
        audio: false,
      }

      this.localScreenStream = await (navigator.mediaDevices as any).getDisplayMedia(constraints)
      this.isScreenSharing = true

      if (!this.localScreenStream) {
        return false
      }

      // Add screen track to all peer connections
      const screenTrack = this.localScreenStream.getVideoTracks()[0]
      
      // Handle when user stops sharing via browser UI
      screenTrack.onended = () => {
        this.disableScreenShare()
      }

      // Replace any existing video track with screen share track
      this.peerConnections.forEach((pc) => {
        const senders = pc.getSenders()
        const videoSender = senders.find((s) => s.track?.kind === 'video')
        if (videoSender) {
          // Replace existing video track (camera or previous screen share) with new screen track
          videoSender.replaceTrack(screenTrack).catch((err) => {
            console.error('Error replacing video track with screen share:', err)
          })
        } else if (this.localScreenStream) {
          // No existing video sender, add the screen track
          pc.addTrack(screenTrack, this.localScreenStream)
        }
      })

      this.notifyStateChange()
      this.sendVoiceState()
      return true
    } catch (error) {
      console.error('Error enabling screen share:', error)
      return false
    }
  }

  disableScreenShare() {
    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach((track) => track.stop())
      this.localScreenStream = null
    }
    this.isScreenSharing = false

    // If camera video was enabled before screen share, restore it
    this.peerConnections.forEach((pc) => {
      const senders = pc.getSenders()
      const videoSender = senders.find((s) => s.track?.kind === 'video')
      
      if (videoSender) {
        if (this.isVideoEnabled && this.localVideoStream) {
          // Restore camera feed
          const cameraTrack = this.localVideoStream.getVideoTracks()[0]
          if (cameraTrack) {
            videoSender.replaceTrack(cameraTrack).catch((err) => {
              console.error('Error restoring camera track:', err)
            })
          }
        } else {
          // No camera to restore, remove video track
          videoSender.replaceTrack(null).catch((err) => {
            console.error('Error removing video track:', err)
          })
        }
      }
    })

    this.notifyStateChange()
    this.sendVoiceState()
  }

  toggleMute() {
    if (!this.localStream) return

    this.isMuted = !this.isMuted
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !this.isMuted
    })

    this.notifyStateChange()
    this.sendVoiceState()
  }

  toggleVideo() {
    if (this.isVideoEnabled) {
      this.disableVideo()
    } else {
      this.enableVideo()
    }
  }

  toggleScreenShare() {
    if (this.isScreenSharing) {
      this.disableScreenShare()
    } else {
      this.enableScreenShare()
    }
  }

  private sendVoiceState() {
    this.ws.send({
      type: 'voice_state_update',
      muted: this.isMuted,
      video: this.isVideoEnabled,
      screen_sharing: this.isScreenSharing,
    })
  }

  async joinVoiceChannel(serverId: string, channelId: string): Promise<boolean> {
    console.log(`Attempting to join voice channel: ${serverId}/${channelId}`)

    // Refresh ICE servers (picks up TURN config from backend) before each join
    if (!await this.ensureIceServers()) return false

    if (!await this.initLocalStream()) {
      console.error('Failed to initialize local stream')
      return false
    }

    // Set pending state - will be confirmed when server responds
    this.pendingVoiceServer = serverId
    this.pendingVoiceChannel = channelId
    this.inDirectCall = false
    this.shouldInitiateOffers = true

    console.log('Sending join_voice_channel message to server')
    this.ws.send({
      type: 'join_voice_channel',
      server_id: serverId,
      channel_id: channelId,
    })

    // Don't call notifyStateChange here - wait for server confirmation
    return true
  }

  /**
   * Cancel a pending server-channel join without sending any WebRTC handshake.
   * Called by ChatPage when the SFU path takes over for this channel join.
   */
  cancelPendingJoin(): void {
    // Release mic — SFU will acquire its own tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop())
      this.localStream = null
    }
    this.shouldInitiateOffers = false
    this.pendingVoiceServer = null
    this.pendingVoiceChannel = null
  }

  async startDirectCall(targetUsername: string): Promise<boolean> {
    if (!await this.ensureIceServers()) return false
    if (!await this.initLocalStream()) {
      return false
    }

    this.inDirectCall = true
    this.directCallPeer = targetUsername
    this.shouldInitiateOffers = true

    // Send 'start_voice_call' — matches the server-side handler (data.get('username'))
    this.ws.send({
      type: 'start_voice_call',
      username: targetUsername,
    })

    this.notifyStateChange()
    return true
  }

  /**
   * Accept an incoming direct call from callerUsername.
   * The caller already has shouldInitiateOffers=true so they will send the WebRTC offer;
   * we just need to set up our local stream and send accept_voice_call to the server.
   */
  async acceptDirectCall(callerUsername: string): Promise<boolean> {
    if (!await this.ensureIceServers()) return false
    if (!await this.initLocalStream()) {
      return false
    }

    this.inDirectCall = true
    this.directCallPeer = callerUsername
    this.shouldInitiateOffers = false // caller is the WebRTC offerer

    this.ws.send({
      type: 'accept_voice_call',
      from: callerUsername,
    })

    this.notifyStateChange()
    return true
  }

  leaveVoice() {
    // Stop all local streams
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop())
      this.localStream = null
    }
    if (this.localVideoStream) {
      this.localVideoStream.getTracks().forEach((track) => track.stop())
      this.localVideoStream = null
    }
    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach((track) => track.stop())
      this.localScreenStream = null
    }

    // Close all peer connections
    this.peerConnections.forEach((pc) => pc.close())
    this.peerConnections.clear()

    // Determine if we were in direct call before resetting state
    const wasInDirectCall = this.inDirectCall

    // Reset state
    this.currentVoiceChannel = null
    this.currentVoiceServer = null
    this.pendingVoiceChannel = null
    this.pendingVoiceServer = null
    this.inDirectCall = false
    this.directCallPeer = null
    this.isMuted = false
    this.isVideoEnabled = false
    this.isScreenSharing = false
    this.shouldInitiateOffers = false

    // Notify server
    if (wasInDirectCall) {
      this.ws.send({ type: 'leave_direct_call' })
    } else {
      this.ws.send({ type: 'leave_voice_channel' })
    }

    this.notifyStateChange()
  }

  /** Apply the current quality preset's bitrate cap to an audio RTCRtpSender. */
  private async applyAudioEncoding(sender: RTCRtpSender): Promise<void> {
    const config = VOICE_QUALITY_CONFIGS[this.qualityPreset]
    try {
      const params = sender.getParameters()
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}]
      }
      params.encodings[0].maxBitrate = config.bitrate
      await sender.setParameters(params)
    } catch (e) {
      console.warn('[VoiceChat] Could not set audio encoding parameters:', e)
    }
  }

  /** Prefer Opus codec on a peer connection's audio transceiver. */
  private preferOpus(pc: RTCPeerConnection): void {
    try {
      const caps = (RTCRtpSender as any).getCapabilities?.('audio')
      if (!caps) return
      const config = VOICE_QUALITY_CONFIGS[this.qualityPreset]
      // Prefer Opus entries that match our stereo preference first
      const opus = (caps.codecs as any[]).filter(
        (c) => c.mimeType.toLowerCase() === 'audio/opus',
      )
      const others = (caps.codecs as any[]).filter(
        (c) => c.mimeType.toLowerCase() !== 'audio/opus',
      )
      // Separate stereo-capable Opus entries
      const stereoOpus = opus.filter((c: any) =>
        config.stereo ? c.sdpFmtpLine?.includes('stereo=1') : !c.sdpFmtpLine?.includes('stereo=1'),
      )
      const otherOpus = opus.filter((c: any) => !stereoOpus.includes(c))
      const preferred = [...stereoOpus, ...otherOpus, ...others]

      for (const transceiver of pc.getTransceivers()) {
        if (transceiver.sender.track?.kind === 'audio' || transceiver.receiver.track?.kind === 'audio') {
          try {
            transceiver.setCodecPreferences(preferred)
          } catch {
            // Browser may not support setCodecPreferences — non-fatal
          }
          break
        }
      }
    } catch (e) {
      console.warn('[VoiceChat] preferOpus failed:', e)
    }
  }

  async createPeerConnection(peer: string): Promise<RTCPeerConnection> {
    const pc = new RTCPeerConnection(this.iceServers)

    // Add local audio track
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!)
      })
    }

    // Add local video track if enabled
    if (this.isVideoEnabled && this.localVideoStream) {
      this.localVideoStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localVideoStream!)
      })
    }

    // Add local screen share track if enabled
    if (this.isScreenSharing && this.localScreenStream) {
      this.localScreenStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localScreenStream!)
      })
    }

    // Handle incoming tracks
    pc.ontrack = (event) => {
      console.log('Received remote track from', peer, event.track.kind)
      if (this.onRemoteStreamChange) {
        this.onRemoteStreamChange(peer, event.streams[0])
      }
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.ws.send({
          type: 'webrtc_ice_candidate',
          target_username: peer,
          candidate: event.candidate.toJSON(),
        })
      }
    }

    // Apply Opus codec preference and bitrate constraints once negotiation completes
    pc.onnegotiationneeded = () => {
      this.preferOpus(pc)
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        // Apply bitrate cap to the audio sender after connection is established
        const audioSender = pc.getSenders().find((s) => s.track?.kind === 'audio')
        if (audioSender) this.applyAudioEncoding(audioSender)
      }
    }

    this.peerConnections.set(peer, pc)
    return pc
  }

  /** Change the quality preset and apply it to all active peer connections. */
  setQualityPreset(preset: VoiceQualityPreset): void {
    this.qualityPreset = preset
    saveVoiceQualityPreset(preset)

    // Apply to existing peer connections immediately
    this.peerConnections.forEach((pc) => {
      const audioSender = pc.getSenders().find((s) => s.track?.kind === 'audio')
      if (audioSender) this.applyAudioEncoding(audioSender)
      this.preferOpus(pc)
    })
  }

  getQualityPreset(): VoiceQualityPreset {
    return this.qualityPreset
  }

  async handleWebRTCOffer(from: string, offer: RTCSessionDescriptionInit) {
    let pc = this.peerConnections.get(from)
    if (!pc) {
      pc = await this.createPeerConnection(from)
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    this.ws.send({
      type: 'webrtc_answer',
      target_username: from,
      answer: answer,
    })
  }

  async handleWebRTCAnswer(from: string, answer: RTCSessionDescriptionInit) {
    const pc = this.peerConnections.get(from)
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer))
    }
  }

  async handleICECandidate(from: string, candidate: RTCIceCandidateInit) {
    const pc = this.peerConnections.get(from)
    if (pc) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    }
  }

  async handleVoiceJoined(participants: string[]) {
    const participantSet = new Set(participants)
    const inVoice = participantSet.has(this.username)

    // Close peer connections that are no longer in the voice member list.
    for (const [peer, pc] of this.peerConnections) {
      if (!participantSet.has(peer)) {
        pc.close()
        this.peerConnections.delete(peer)
        if (this.onRemoteStreamChange) {
          this.onRemoteStreamChange(peer, null)
        }
      }
    }

    if (inVoice) {
      // Create peer connections for any new participants.
      for (const peer of participants) {
        if (this.shouldInitiateOffers && peer !== this.username && !this.peerConnections.has(peer)) {
          const pc = await this.createPeerConnection(peer)
          const offer = await pc.createOffer()
          await pc.setLocalDescription(offer)

          this.ws.send({
            type: 'webrtc_offer',
            target_username: peer,
            offer: offer,
          })
        }
      }
      this.shouldInitiateOffers = false
    }

    // If we just joined (pending -> confirmed), update current channel
    // This is done AFTER shouldInitiateOffers is reset so getIsConnecting() returns false
    if (inVoice && this.pendingVoiceServer && this.pendingVoiceChannel) {
      if (this.currentVoiceServer !== this.pendingVoiceServer || 
          this.currentVoiceChannel !== this.pendingVoiceChannel) {
        this.currentVoiceServer = this.pendingVoiceServer
        this.currentVoiceChannel = this.pendingVoiceChannel
        console.log('Voice channel join confirmed:', this.currentVoiceServer, this.currentVoiceChannel)
      }
      this.pendingVoiceServer = null
      this.pendingVoiceChannel = null
      this.notifyStateChange() // Notify AFTER all state is properly updated
    }

    if (this.onParticipantsChange) {
      this.onParticipantsChange(participants)
    }
  }

  handleUserJoinedVoice(username: string) {
    if (this.onParticipantsChange) {
      const participants = Array.from(this.peerConnections.keys())
      participants.push(username)
      this.onParticipantsChange(participants)
    }
  }

  handleUserLeftVoice(username: string) {
    const pc = this.peerConnections.get(username)
    if (pc) {
      pc.close()
      this.peerConnections.delete(username)
    }

    if (this.onRemoteStreamChange) {
      this.onRemoteStreamChange(username, null)
    }

    if (this.onParticipantsChange) {
      const participants = Array.from(this.peerConnections.keys())
      this.onParticipantsChange(participants)
    }
  }

  // Device management
  async getAudioDevices(): Promise<MediaDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      return devices.filter((d) => d.kind === 'audioinput')
    } catch (error) {
      console.error('Error enumerating audio devices:', error)
      return []
    }
  }

  async getVideoDevices(): Promise<MediaDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      return devices.filter((d) => d.kind === 'videoinput')
    } catch (error) {
      console.error('Error enumerating video devices:', error)
      return []
    }
  }

  async getSpeakerDevices(): Promise<MediaDeviceInfo[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      return devices.filter((d) => d.kind === 'audiooutput')
    } catch (error) {
      console.error('Error enumerating speaker devices:', error)
      return []
    }
  }

  setMicrophone(deviceId: string) {
    this.selectedMicrophoneId = deviceId
    this.saveDevicePreferences()
  }

  setSpeaker(deviceId: string) {
    this.selectedSpeakerId = deviceId
    this.saveDevicePreferences()
  }

  setCamera(deviceId: string) {
    this.selectedCameraId = deviceId
    this.saveDevicePreferences()
  }

  setScreenShareSettings(resolution: number, framerate: number) {
    this.screenShareResolution = resolution
    this.screenShareFramerate = framerate
    this.saveDevicePreferences()
  }

  // Soundboard functionality
  async playSoundboard(soundId: string): Promise<void> {
    try {
      if (!this.localStream) {
        console.error('No local audio stream available')
        return
      }

      // Fetch the audio file
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/download-soundboard-sound/${soundId}?token=${token}`)
      if (!response.ok) {
        console.error('Failed to fetch soundboard sound')
        return
      }

      const audioBlob = await response.blob()
      const audioUrl = URL.createObjectURL(audioBlob)

      // Create Audio Context
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      
      // Fetch and decode audio data
      const arrayBuffer = await audioBlob.arrayBuffer()
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

      // Create a buffer source
      const soundSource = audioContext.createBufferSource()
      soundSource.buffer = audioBuffer

      // Create a destination for the mixed audio
      const destination = audioContext.createMediaStreamDestination()

      // Create a gain node for the soundboard audio (to control volume)
      const soundGain = audioContext.createGain()
      soundGain.gain.value = 0.8 // 80% volume for soundboard

      // Connect soundboard audio: source -> gain -> destination
      soundSource.connect(soundGain)
      soundGain.connect(destination)

      // Also add microphone to the mix
      if (this.localStream) {
        const micSource = audioContext.createMediaStreamSource(this.localStream)
        const micGain = audioContext.createGain()
        micGain.gain.value = 1.0 // Keep mic at full volume
        
        micSource.connect(micGain)
        micGain.connect(destination)
      }

      // Get the mixed audio track
      const mixedTrack = destination.stream.getAudioTracks()[0]

      // Replace audio track in all peer connections temporarily
      const originalTracks: Map<RTCPeerConnection, MediaStreamTrack> = new Map()
      
      this.peerConnections.forEach((pc) => {
        const senders = pc.getSenders()
        const audioSender = senders.find((s) => s.track?.kind === 'audio')
        if (audioSender && audioSender.track) {
          originalTracks.set(pc, audioSender.track)
          audioSender.replaceTrack(mixedTrack).catch((err) => {
            console.error('Error replacing audio track:', err)
          })
        }
      })

      // Play the sound
      soundSource.start(0)

      // Restore original microphone track after sound ends
      soundSource.onended = () => {
        // Restore original tracks
        this.peerConnections.forEach((pc) => {
          const originalTrack = originalTracks.get(pc)
          if (originalTrack) {
            const senders = pc.getSenders()
            const audioSender = senders.find((s) => s.track?.kind === 'audio')
            if (audioSender) {
              audioSender.replaceTrack(originalTrack).catch((err) => {
                console.error('Error restoring audio track:', err)
              })
            }
          }
        })

        // Clean up
        URL.revokeObjectURL(audioUrl)
        audioContext.close()
      }

    } catch (error) {
      console.error('Error playing soundboard sound:', error)
    }
  }

  async playRemoteSoundboard(soundId: string): Promise<void> {
    try {
      // Fetch the audio file
      const token = localStorage.getItem('token')
      const response = await fetch(`/api/download-soundboard-sound/${soundId}?token=${token}`)
      if (!response.ok) {
        console.error('Failed to fetch soundboard sound')
        return
      }

      const audioBlob = await response.blob()
      const audioUrl = URL.createObjectURL(audioBlob)

      // Play the audio through default output
      const audio = new Audio(audioUrl)
      audio.volume = 0.8
      
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl)
      }

      await audio.play()
    } catch (error) {
      console.error('Error playing remote soundboard sound:', error)
    }
  }

  // Getters
  getIsMuted() {
    return this.isMuted
  }

  getIsVideoEnabled() {
    return this.isVideoEnabled
  }

  getIsScreenSharing() {
    return this.isScreenSharing
  }

  getIsInVoice() {
    return this.inDirectCall || (this.currentVoiceChannel !== null)
  }

  getIsConnecting() {
    return (this.pendingVoiceChannel !== null && this.currentVoiceChannel === null) || 
           (this.shouldInitiateOffers && this.peerConnections.size === 0)
  }

  getCurrentChannel() {
    return { server: this.currentVoiceServer, channel: this.currentVoiceChannel }
  }

  getPendingChannel() {
    return { server: this.pendingVoiceServer, channel: this.pendingVoiceChannel }
  }

  getDirectCallPeer() {
    return this.directCallPeer
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
}
