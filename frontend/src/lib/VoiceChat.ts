// Voice/Video chat functionality with WebRTC for React
export class VoiceChat {
  private ws: any
  private username: string
  private peerConnections: Map<string, RTCPeerConnection>
  private localStream: MediaStream | null
  private localVideoStream: MediaStream | null
  private localScreenStream: MediaStream | null
  private currentVoiceChannel: string | null
  private currentVoiceServer: string | null
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

  constructor(ws: any, username: string) {
    this.ws = ws
    this.username = username
    this.peerConnections = new Map()
    this.localStream = null
    this.localVideoStream = null
    this.localScreenStream = null
    this.currentVoiceChannel = null
    this.currentVoiceServer = null
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

    // Load device preferences
    this.loadDevicePreferences()

    // ICE servers configuration
    this.iceServers = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
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

      const constraints: MediaStreamConstraints = {
        audio: this.selectedMicrophoneId
          ? { deviceId: { exact: this.selectedMicrophoneId }, echoCancellation: true, noiseSuppression: true }
          : { echoCancellation: true, noiseSuppression: true },
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

      this.peerConnections.forEach((pc) => {
        const senders = pc.getSenders()
        const screenSender = senders.find((s) => s.track?.kind === 'video' && s.track?.label.includes('screen'))
        if (screenSender) {
          screenSender.replaceTrack(screenTrack)
        } else if (this.localScreenStream) {
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

    // Remove screen track from all peer connections
    this.peerConnections.forEach((pc) => {
      const senders = pc.getSenders()
      senders.forEach((sender) => {
        if (sender.track?.label.includes('screen')) {
          pc.removeTrack(sender)
        }
      })
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
    if (!await this.initLocalStream()) {
      console.error('Failed to initialize local stream')
      return false
    }

    this.currentVoiceServer = serverId
    this.currentVoiceChannel = channelId
    this.inDirectCall = false
    this.shouldInitiateOffers = true

    console.log('Sending join_voice_channel message to server')
    this.ws.send({
      type: 'join_voice_channel',
      server_id: serverId,
      channel_id: channelId,
    })

    this.notifyStateChange()
    return true
  }

  async startDirectCall(targetUsername: string): Promise<boolean> {
    if (!await this.initLocalStream()) {
      return false
    }

    this.inDirectCall = true
    this.directCallPeer = targetUsername
    this.shouldInitiateOffers = true

    this.ws.send({
      type: 'start_direct_call',
      target_username: targetUsername,
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

    // Reset state
    this.currentVoiceChannel = null
    this.currentVoiceServer = null
    this.inDirectCall = false
    this.directCallPeer = null
    this.isMuted = false
    this.isVideoEnabled = false
    this.isScreenSharing = false
    this.shouldInitiateOffers = false

    // Notify server
    if (this.inDirectCall) {
      this.ws.send({ type: 'leave_direct_call' })
    } else {
      this.ws.send({ type: 'leave_voice_channel' })
    }

    this.notifyStateChange()
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

    this.peerConnections.set(peer, pc)
    return pc
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

  getCurrentChannel() {
    return { server: this.currentVoiceServer, channel: this.currentVoiceChannel }
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
