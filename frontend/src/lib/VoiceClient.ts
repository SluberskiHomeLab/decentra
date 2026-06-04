/**
 * VoiceClient — WebSocket-based voice/video/screen-share.
 *
 * All media travels as AES-256-GCM encrypted binary WebSocket frames over the
 * same connection used for chat.  No WebRTC, no TURN, no ICE — works through
 * any standard reverse proxy (nginx, Caddy, Nginx Proxy Manager, Traefik…).
 *
 * Media encoding uses the browser-native MediaRecorder API (Opus audio,
 * VP8/VP9 video) and playback uses the MediaSource Extensions (MSE) API.
 *
 * Binary frame layout
 * ───────────────────
 * Client → Server:
 *   [0]       frame_type  (1 byte)
 *   [1..12]   AES-GCM IV  (12 bytes)
 *   [13..]    ciphertext
 *
 * Server → Client (server prepends sender identity):
 *   [0]          frame_type
 *   [1]          sender_name_length  (uint8)
 *   [2..2+N]     sender_name  (UTF-8)
 *   [2+N..14+N]  AES-GCM IV
 *   [14+N..]     ciphertext
 *
 * Frame types:
 *   0x01  audio init   (first MediaRecorder chunk — WebM/Opus header)
 *   0x02  audio chunk
 *   0x03  video init   (camera — first chunk, WebM/VP8 header)
 *   0x04  video chunk  (camera)
 *   0x05  screen init  (screen share — first chunk)
 *   0x06  screen chunk (screen share)
 */

import type { WsClient } from '../api/wsClient'

// ── Frame type constants ───────────────────────────────────────────────────
const FT_AUDIO_INIT   = 0x01
const FT_AUDIO_CHUNK  = 0x02
const FT_VIDEO_INIT   = 0x03
const FT_VIDEO_CHUNK  = 0x04
const FT_SCREEN_INIT  = 0x05
const FT_SCREEN_CHUNK = 0x06

// ── MIME-type helpers ──────────────────────────────────────────────────────
function bestAudioMime(): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

function bestVideoMime(): string {
  for (const t of ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

// ── MSE video/audio player per remote participant ─────────────────────────
interface MsePlayer {
  /** Hidden element that receives the decoded media. */
  el: HTMLVideoElement | HTMLAudioElement
  ms: MediaSource
  sb: SourceBuffer | null
  /** Chunks waiting for SourceBuffer to finish updating. */
  queue: Uint8Array<ArrayBuffer>[]
  ready: boolean
  mimeType: string
  capturedStream: MediaStream | null
  objectUrl: string
}

function createMsePlayer(
  mimeType: string,
  kind: 'audio' | 'video',
): MsePlayer {
  const el = kind === 'audio'
    ? document.createElement('audio')
    : document.createElement('video')
  el.autoplay = true
  ;(el as HTMLVideoElement).playsInline = true
  el.style.display = 'none'
  document.body.appendChild(el)

  const ms = new MediaSource()
  const objectUrl = URL.createObjectURL(ms)
  el.src = objectUrl

  const player: MsePlayer = { el, ms, sb: null, queue: [], ready: false, mimeType, capturedStream: null, objectUrl }

  ms.addEventListener('sourceopen', () => {
    try {
      const sb = ms.addSourceBuffer(mimeType)
      player.sb = sb
      player.ready = true
      sb.addEventListener('updateend', () => drainQueue(player))
      drainQueue(player)
    } catch (e) {
      console.warn('[VoiceClient] MSE addSourceBuffer failed:', e)
    }
  }, { once: true })

  return player
}

function appendToPlayer(player: MsePlayer, data: Uint8Array<ArrayBuffer>): void {
  if (player.ms.readyState !== 'open') { player.queue.push(data); return }
  player.queue.push(data)
  drainQueue(player)
}

function drainQueue(player: MsePlayer): void {
  if (!player.sb || player.sb.updating || player.queue.length === 0) return
  // Trim any excess buffered data to keep memory usage bounded (keep last 10 s)
  try {
    if (player.sb.buffered.length > 0) {
      const end = player.sb.buffered.end(player.sb.buffered.length - 1)
      const start = player.sb.buffered.start(0)
      if (end - start > 12) {
        player.sb.remove(start, end - 10)
        return // will drain on next updateend
      }
    }
  } catch { /* ignore */ }
  const chunk = player.queue.shift()!
  try {
    player.sb.appendBuffer(chunk)
  } catch (e) {
    console.warn('[VoiceClient] appendBuffer error:', e)
  }
}

function destroyPlayer(player: MsePlayer): void {
  try {
    player.sb = null
    if (player.ms.readyState === 'open') player.ms.endOfStream()
  } catch { /* ignore */ }
  URL.revokeObjectURL(player.objectUrl)
  player.el.src = ''
  player.el.remove()
}

/** Capture a MediaStream from a (hidden) media element, if the browser supports it. */
function captureStream(el: HTMLVideoElement | HTMLAudioElement): MediaStream | null {
  if (typeof (el as any).captureStream === 'function') {
    return (el as any).captureStream() as MediaStream
  }
  return null
}

// ── Main class ─────────────────────────────────────────────────────────────

export class VoiceClient {
  private ws: WsClient
  private username: string

  // E2EE
  private cryptoKey: CryptoKey | null = null

  // Audio capture
  private localAudioStream: MediaStream | null = null
  private audioRecorder: MediaRecorder | null = null
  private audioMime = ''
  private audioFirstChunk = true
  // Timer that periodically restarts the recorder so new participants receive
  // a fresh init segment and can start playing within a few seconds of joining.
  private audioRestartTimer: ReturnType<typeof setInterval> | null = null

  // Video capture (camera)
  private localCameraStream: MediaStream | null = null
  private videoRecorder: MediaRecorder | null = null
  private videoMime = ''
  private videoFirstChunk = true
  private videoRestartTimer: ReturnType<typeof setInterval> | null = null

  // Screen capture
  private localScreenStream: MediaStream | null = null
  private screenRecorder: MediaRecorder | null = null
  private screenMime = ''
  private screenFirstChunk = true
  private screenRestartTimer: ReturnType<typeof setInterval> | null = null

  // Remote audio players (peer → MsePlayer for audio element)
  private audioPlayers = new Map<string, MsePlayer>()
  // Remote video players (peer → MsePlayer for hidden video element)
  private videoPlayers = new Map<string, MsePlayer>()
  // Remote screen players
  private screenPlayers = new Map<string, MsePlayer>()

  // State
  private isMuted = false
  private isCameraEnabled = false
  private isScreenSharing = false
  private isConnected = false
  private isConnecting = false

  private currentServerId: string | null = null
  private currentChannelId: string | null = null

  // Device preferences (loaded from localStorage on construct)
  private selectedMicId: string | null = null
  private selectedSpeakerId: string | null = null
  private selectedCameraId: string | null = null
  private screenResolution = 1080
  private screenFramerate = 30

  // Callbacks
  private onStateChangeCb: (() => void) | null = null
  private onRemoteStreamChangeCb: ((peer: string, stream: MediaStream | null) => void) | null = null
  private onRemoteScreenChangeCb: ((peer: string, stream: MediaStream | null) => void) | null = null
  private onParticipantsChangeCb: ((participants: string[]) => void) | null = null

  private participants = new Set<string>()
  private unsubBinary: (() => void) | null = null

  constructor(ws: WsClient, username: string) {
    this.ws = ws
    this.username = username
    this.loadDevicePrefs()
  }

  // ── Public API (mirrors VoiceChatSFU so ChatPage needs minimal changes) ───

  async connect(
    e2eeKeyBase64: string,
    serverId: string,
    channelId: string,
    startMuted = false,
  ): Promise<void> {
    this.isConnecting = true
    this.currentServerId = serverId
    this.currentChannelId = channelId
    this.isMuted = startMuted
    this.notifyState()

    // Derive AES-256-GCM key from the server-provided base64 key
    try {
      const raw = Uint8Array.from(
        atob(e2eeKeyBase64.replace(/-/g, '+').replace(/_/g, '/')),
        c => c.charCodeAt(0),
      )
      this.cryptoKey = await crypto.subtle.importKey(
        'raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
      )
    } catch (err) {
      console.error('[VoiceClient] key import failed:', err)
      throw err
    }

    // Subscribe to incoming binary frames
    this.unsubBinary = this.ws.onBinaryMessage(data => this.onBinaryFrame(data))

    // Start microphone capture
    await this.startAudioCapture()

    this.isConnecting = false
    this.isConnected = true
    this.participants.add(this.username)
    this.notifyState()
    this.notifyParticipants()
  }

  disconnect(): void {
    this.stopAudioCapture()
    this.stopCameraCapture()
    this.stopScreenCapture()

    // Tear down all remote players
    for (const p of this.audioPlayers.values())  destroyPlayer(p)
    for (const p of this.videoPlayers.values())  destroyPlayer(p)
    for (const p of this.screenPlayers.values()) destroyPlayer(p)
    this.audioPlayers.clear()
    this.videoPlayers.clear()
    this.screenPlayers.clear()

    this.unsubBinary?.()
    this.unsubBinary = null

    this.cryptoKey = null
    this.isMuted = false
    this.isCameraEnabled = false
    this.isScreenSharing = false
    this.isConnected = false
    this.isConnecting = false
    this.currentServerId = null
    this.currentChannelId = null
    this.participants.clear()

    this.notifyState()
    this.notifyParticipants()
  }

  leaveVoice(): void {
    this.disconnect()
    this.ws.send({ type: 'leave_voice_channel' })
  }

  toggleMute(): void {
    this.isMuted = !this.isMuted
    if (this.localAudioStream) {
      for (const t of this.localAudioStream.getAudioTracks()) t.enabled = !this.isMuted
    }
    this.notifyState()
    this.sendVoiceState()
  }

  toggleVideo(): void {
    if (this.isCameraEnabled) this.stopCameraCapture()
    else this.startCameraCapture()
  }

  toggleScreenShare(): void {
    if (this.isScreenSharing) this.stopScreenCapture()
    else this.startScreenCapture()
  }

  // ── Device management ─────────────────────────────────────────────────────

  setMicrophone(id: string): void  { this.selectedMicId    = id; this.saveDevicePrefs() }
  setSpeaker(id: string): void     { this.selectedSpeakerId = id; this.saveDevicePrefs() }
  setCamera(id: string): void      { this.selectedCameraId  = id; this.saveDevicePrefs() }
  setScreenShareSettings(res: number, fps: number): void {
    this.screenResolution = res; this.screenFramerate = fps; this.saveDevicePrefs()
  }

  getSelectedDevices() {
    return {
      microphone: this.selectedMicId,
      speaker: this.selectedSpeakerId,
      camera: this.selectedCameraId,
      screenShareResolution: this.screenResolution,
      screenShareFramerate: this.screenFramerate,
    }
  }

  async getAudioDevices()  { return this.enumDevices('audioinput')  }
  async getVideoDevices()  { return this.enumDevices('videoinput')  }
  async getSpeakerDevices(){ return this.enumDevices('audiooutput') }

  // ── Soundboard ────────────────────────────────────────────────────────────

  async playSoundboard(_soundId: string): Promise<void> {
    // Soundboard playback via WebSocket relay is not implemented in this
    // transport layer; the existing soundboard_play JSON message handles it.
  }

  async playRemoteSoundboard(soundId: string): Promise<void> {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/download-soundboard-sound/${soundId}?token=${token}`)
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.volume = 0.8
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
    } catch { /* ignore */ }
  }

  // ── Participant helpers ───────────────────────────────────────────────────

  handleVoiceJoined(participants: string[]): void {
    this.participants = new Set([this.username, ...participants])
    this.notifyParticipants()
  }

  handleUserJoinedVoice(un: string): void {
    this.participants.add(un)
    this.notifyParticipants()
  }

  handleUserLeftVoice(un: string): void {
    this.participants.delete(un)
    // Tear down any media players for the departed peer
    const ap = this.audioPlayers.get(un)
    if (ap) { destroyPlayer(ap); this.audioPlayers.delete(un) }
    const vp = this.videoPlayers.get(un)
    if (vp) { destroyPlayer(vp); this.videoPlayers.delete(un); this.onRemoteStreamChangeCb?.(un, null) }
    const sp = this.screenPlayers.get(un)
    if (sp) { destroyPlayer(sp); this.screenPlayers.delete(un); this.onRemoteScreenChangeCb?.(un, null) }
    this.notifyParticipants()
  }

  // ── Callbacks ─────────────────────────────────────────────────────────────

  setOnStateChange(cb: () => void): void { this.onStateChangeCb = cb }
  setOnRemoteStreamChange(cb: (p: string, s: MediaStream | null) => void): void { this.onRemoteStreamChangeCb = cb }
  setOnRemoteScreenChange(cb: (p: string, s: MediaStream | null) => void): void { this.onRemoteScreenChangeCb = cb }
  setOnParticipantsChange(cb: (ps: string[]) => void): void { this.onParticipantsChangeCb = cb }

  // ── Getters ───────────────────────────────────────────────────────────────

  getIsMuted():           boolean            { return this.isMuted }
  getIsVideoEnabled():    boolean            { return this.isCameraEnabled }
  getIsScreenSharing():   boolean            { return this.isScreenSharing }
  getIsInVoice():         boolean            { return this.isConnected }
  getIsConnecting():      boolean            { return this.isConnecting }
  getIsE2EEActive():      boolean            { return this.cryptoKey !== null }
  getLocalCameraStream(): MediaStream | null { return this.localCameraStream }
  getLocalScreenStream(): MediaStream | null { return this.localScreenStream }

  getCurrentChannel() { return { server: this.currentServerId, channel: this.currentChannelId } }
  getPendingChannel() { return { server: null, channel: null } }
  getDirectCallPeer() { return null }
  cancelPendingJoin() { /* no-op */ }

  // ── Audio capture ─────────────────────────────────────────────────────────

  private async startAudioCapture(): Promise<void> {
    try {
      this.audioMime = bestAudioMime()
      if (!this.audioMime) { console.warn('[VoiceClient] No supported audio MIME type'); return }

      this.localAudioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          deviceId: this.selectedMicId ?? undefined,
        },
        video: false,
      })

      if (this.isMuted) {
        for (const t of this.localAudioStream.getAudioTracks()) t.enabled = false
      }

      this.startAudioRecorder()

      // Restart every 5 s so late-joining peers receive a fresh init segment.
      this.audioRestartTimer = setInterval(() => this.restartAudioRecorder(), 5_000)
    } catch (err) {
      console.error('[VoiceClient] Audio capture failed:', err)
      throw err
    }
  }

  private startAudioRecorder(): void {
    if (!this.localAudioStream) return
    this.audioFirstChunk = true
    const rec = new MediaRecorder(this.localAudioStream, {
      mimeType: this.audioMime,
      audioBitsPerSecond: 32_000,
    })
    rec.ondataavailable = e => {
      if (e.data.size > 0) this.sendMediaChunk(e.data, this.audioFirstChunk ? FT_AUDIO_INIT : FT_AUDIO_CHUNK)
        .then(() => { this.audioFirstChunk = false })
    }
    rec.start(60) // 60 ms chunks ≈ ~150 ms total latency
    this.audioRecorder = rec
  }

  private restartAudioRecorder(): void {
    if (this.audioRecorder) {
      this.audioRecorder.stop()
      this.audioRecorder = null
    }
    this.startAudioRecorder()
  }

  private stopAudioCapture(): void {
    if (this.audioRestartTimer) { clearInterval(this.audioRestartTimer); this.audioRestartTimer = null }
    if (this.audioRecorder) { try { this.audioRecorder.stop() } catch { /* ignore */ }; this.audioRecorder = null }
    if (this.localAudioStream) { for (const t of this.localAudioStream.getTracks()) t.stop(); this.localAudioStream = null }
  }

  // ── Camera capture ────────────────────────────────────────────────────────

  async startCameraCapture(): Promise<boolean> {
    try {
      this.videoMime = bestVideoMime()
      if (!this.videoMime) { console.warn('[VoiceClient] No supported video MIME type'); return false }

      this.localCameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, deviceId: this.selectedCameraId ?? undefined },
        audio: false,
      })

      this.isCameraEnabled = true
      this.notifyState()
      this.sendVoiceState()
      this.startVideoRecorder()

      this.videoRestartTimer = setInterval(() => this.restartVideoRecorder(), 4_000)
      return true
    } catch (err) {
      console.error('[VoiceClient] Camera capture failed:', err)
      return false
    }
  }

  private startVideoRecorder(): void {
    if (!this.localCameraStream) return
    this.videoFirstChunk = true
    const rec = new MediaRecorder(this.localCameraStream, {
      mimeType: this.videoMime,
      videoBitsPerSecond: 500_000,
    })
    rec.ondataavailable = e => {
      if (e.data.size > 0) this.sendMediaChunk(e.data, this.videoFirstChunk ? FT_VIDEO_INIT : FT_VIDEO_CHUNK)
        .then(() => { this.videoFirstChunk = false })
    }
    rec.start(150)
    this.videoRecorder = rec
  }

  private restartVideoRecorder(): void {
    if (this.videoRecorder) { try { this.videoRecorder.stop() } catch { /* ignore */ }; this.videoRecorder = null }
    this.startVideoRecorder()
  }

  stopCameraCapture(): void {
    if (this.videoRestartTimer) { clearInterval(this.videoRestartTimer); this.videoRestartTimer = null }
    if (this.videoRecorder) { try { this.videoRecorder.stop() } catch { /* ignore */ }; this.videoRecorder = null }
    if (this.localCameraStream) { for (const t of this.localCameraStream.getTracks()) t.stop(); this.localCameraStream = null }
    this.isCameraEnabled = false
    this.notifyState()
    this.sendVoiceState()
  }

  // ── Screen capture ────────────────────────────────────────────────────────

  async startScreenCapture(): Promise<boolean> {
    try {
      this.screenMime = bestVideoMime()
      if (!this.screenMime) { console.warn('[VoiceClient] No supported screen MIME type'); return false }

      const w = this.screenResolution === 720 ? 1280 : 1920
      this.localScreenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: w, height: this.screenResolution, frameRate: this.screenFramerate },
        audio: false,
      })

      // User clicking the browser's "Stop Sharing" button ends the track
      this.localScreenStream.getVideoTracks()[0].onended = () => this.stopScreenCapture()

      this.isScreenSharing = true
      this.notifyState()
      this.sendVoiceState()
      this.startScreenRecorder()

      this.screenRestartTimer = setInterval(() => this.restartScreenRecorder(), 4_000)
      return true
    } catch (err) {
      console.error('[VoiceClient] Screen capture failed:', err)
      return false
    }
  }

  private startScreenRecorder(): void {
    if (!this.localScreenStream) return
    this.screenFirstChunk = true
    const rec = new MediaRecorder(this.localScreenStream, {
      mimeType: this.screenMime,
      videoBitsPerSecond: 1_500_000,
    })
    rec.ondataavailable = e => {
      if (e.data.size > 0) this.sendMediaChunk(e.data, this.screenFirstChunk ? FT_SCREEN_INIT : FT_SCREEN_CHUNK)
        .then(() => { this.screenFirstChunk = false })
    }
    rec.start(200)
    this.screenRecorder = rec
  }

  private restartScreenRecorder(): void {
    if (this.screenRecorder) { try { this.screenRecorder.stop() } catch { /* ignore */ }; this.screenRecorder = null }
    this.startScreenRecorder()
  }

  stopScreenCapture(): void {
    if (this.screenRestartTimer) { clearInterval(this.screenRestartTimer); this.screenRestartTimer = null }
    if (this.screenRecorder) { try { this.screenRecorder.stop() } catch { /* ignore */ }; this.screenRecorder = null }
    if (this.localScreenStream) { for (const t of this.localScreenStream.getTracks()) t.stop(); this.localScreenStream = null }
    this.isScreenSharing = false
    this.notifyState()
    this.sendVoiceState()
  }

  // ── Outbound frame encryption + send ─────────────────────────────────────

  private async sendMediaChunk(blob: Blob, frameType: number): Promise<void> {
    if (!this.cryptoKey || !this.isConnected) return
    try {
      const plaintext = await blob.arrayBuffer()
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.cryptoKey, plaintext)
      // Build frame: [frameType (1)] + [IV (12)] + [ciphertext]
      const frame = new Uint8Array(1 + 12 + ciphertext.byteLength)
      frame[0] = frameType
      frame.set(iv, 1)
      frame.set(new Uint8Array(ciphertext), 13)
      this.ws.sendBinary(frame.buffer)
    } catch (err) {
      console.warn('[VoiceClient] encrypt/send error:', err)
    }
  }

  // ── Inbound binary frame handling ─────────────────────────────────────────

  private async onBinaryFrame(data: ArrayBuffer): Promise<void> {
    if (!this.cryptoKey || data.byteLength < 15) return // too short to be valid
    const view = new Uint8Array(data)
    const frameType  = view[0]
    const senderLen  = view[1]
    if (data.byteLength < 2 + senderLen + 12 + 1) return
    const sender = new TextDecoder().decode(view.slice(2, 2 + senderLen))
    const iv         = view.slice(2 + senderLen, 2 + senderLen + 12)
    const ciphertext = view.slice(2 + senderLen + 12)

    let plaintext: ArrayBuffer
    try {
      plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.cryptoKey, ciphertext)
    } catch {
      // Decryption failure — wrong key or corrupted frame; silently drop
      return
    }

    const chunk = new Uint8Array(plaintext)

    switch (frameType) {
      case FT_AUDIO_INIT:  this.handleAudioInit(sender, chunk);  break
      case FT_AUDIO_CHUNK: this.handleAudioChunk(sender, chunk); break
      case FT_VIDEO_INIT:  this.handleVideoInit(sender, chunk, false); break
      case FT_VIDEO_CHUNK: this.handleVideoChunk(sender, chunk, false); break
      case FT_SCREEN_INIT: this.handleVideoInit(sender, chunk, true);  break
      case FT_SCREEN_CHUNK:this.handleVideoChunk(sender, chunk, true);  break
    }
  }

  // ── Audio playback ────────────────────────────────────────────────────────

  private handleAudioInit(sender: string, chunk: Uint8Array<ArrayBuffer>): void {
    // A new init segment means the sender restarted their recorder.
    // Destroy any existing player so we start fresh with the new header.
    const existing = this.audioPlayers.get(sender)
    if (existing) { destroyPlayer(existing); this.audioPlayers.delete(sender) }

    const mime = bestAudioMime()
    if (!mime) return
    const player = createMsePlayer(mime, 'audio')
    this.audioPlayers.set(sender, player)
    // Play audio through the hidden element automatically (autoplay)
    // Apply speaker selection when Web Audio routing is not used
    const audio = player.el as HTMLAudioElement
    if (this.selectedSpeakerId && typeof (audio as any).setSinkId === 'function') {
      (audio as any).setSinkId(this.selectedSpeakerId).catch(() => {/* ignore */})
    }
    appendToPlayer(player, chunk)
  }

  private handleAudioChunk(sender: string, chunk: Uint8Array<ArrayBuffer>): void {
    const player = this.audioPlayers.get(sender)
    if (player) appendToPlayer(player, chunk)
  }

  // ── Video playback ────────────────────────────────────────────────────────

  private handleVideoInit(sender: string, chunk: Uint8Array<ArrayBuffer>, isScreen: boolean): void {
    const map = isScreen ? this.screenPlayers : this.videoPlayers
    const existing = map.get(sender)
    if (existing) { destroyPlayer(existing); map.delete(sender) }

    const mime = bestVideoMime()
    if (!mime) return
    const player = createMsePlayer(mime, 'video')
    map.set(sender, player)
    appendToPlayer(player, chunk)

    // captureStream() gives us a live MediaStream from the hidden video element.
    // We fire the callback so ChatPage can render it.  The stream automatically
    // reflects new frames as the SourceBuffer is fed — no need to re-fire.
    const el = player.el as HTMLVideoElement
    el.addEventListener('playing', () => {
      if (!player.capturedStream) {
        player.capturedStream = captureStream(el)
        if (player.capturedStream) {
          if (isScreen) this.onRemoteScreenChangeCb?.(sender, player.capturedStream)
          else          this.onRemoteStreamChangeCb?.(sender, player.capturedStream)
        }
      }
    }, { once: true })
  }

  private handleVideoChunk(sender: string, chunk: Uint8Array<ArrayBuffer>, isScreen: boolean): void {
    const map = isScreen ? this.screenPlayers : this.videoPlayers
    const player = map.get(sender)
    if (player) appendToPlayer(player, chunk)
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private sendVoiceState(): void {
    this.ws.send({
      type: 'voice_state_update',
      muted: this.isMuted,
      video: this.isCameraEnabled,
      screen_sharing: this.isScreenSharing,
    })
  }

  private notifyState(): void { this.onStateChangeCb?.() }

  private notifyParticipants(): void {
    this.onParticipantsChangeCb?.(Array.from(this.participants))
  }

  private async enumDevices(kind: MediaDeviceKind): Promise<MediaDeviceInfo[]> {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === kind)
    } catch { return [] }
  }

  private loadDevicePrefs(): void {
    try {
      const mic = localStorage.getItem('voicechat_microphone_id')
      const spk = localStorage.getItem('voicechat_speaker_id')
      const cam = localStorage.getItem('voicechat_camera_id')
      const res = localStorage.getItem('voicechat_screenshare_resolution')
      const fps = localStorage.getItem('voicechat_screenshare_framerate')
      if (mic) this.selectedMicId     = mic
      if (spk) this.selectedSpeakerId = spk
      if (cam) this.selectedCameraId  = cam
      if (res) this.screenResolution  = parseInt(res)
      if (fps) this.screenFramerate   = parseInt(fps)
    } catch { /* localStorage unavailable */ }
  }

  private saveDevicePrefs(): void {
    try {
      if (this.selectedMicId)     localStorage.setItem('voicechat_microphone_id', this.selectedMicId)
      if (this.selectedSpeakerId) localStorage.setItem('voicechat_speaker_id',    this.selectedSpeakerId)
      if (this.selectedCameraId)  localStorage.setItem('voicechat_camera_id',     this.selectedCameraId)
      localStorage.setItem('voicechat_screenshare_resolution', this.screenResolution.toString())
      localStorage.setItem('voicechat_screenshare_framerate',  this.screenFramerate.toString())
    } catch { /* localStorage unavailable */ }
  }
}
