import type {
  WsMessage,
  WsOutboundChangeEmail,
  WsOutboundChangeUsername,
  WsOutboundCreateChannel,
  WsOutboundCreateServer,
  WsOutboundCreateVoiceChannel,
  WsOutboundDisable2FA,
  WsOutboundGenerateInvite,
  WsOutboundGenerateServerInvite,
  WsOutboundGetChannelHistory,
  WsOutboundGetDmHistory,
  WsOutboundGetInstanceInviteUsage,
  WsOutboundGetServerInfoByInvite,
  WsOutboundGetServerInviteUsage,
  WsOutboundGetServerMembers,
  WsOutboundJoinServerWithInvite,
  WsOutboundListInstanceInvites,
  WsOutboundListServerInvites,
  WsOutboundLogin,
  WsOutboundRequestPasswordReset,
  WsOutboundRevokeInvite,
  WsOutboundRevokeServerInvite,
  WsOutboundSendMessage,
  WsOutboundSetAvatar,
  WsOutboundSetNotificationMode,
  WsOutboundSetup2FA,
  WsOutboundSignup,
  WsOutboundStartDm,
  WsOutboundSyncData,
  WsOutboundTokenAuth,
  WsOutboundUpdateProfile,
  WsOutboundVerify2FASetup,
  WsOutboundVerifyEmail,
  WsOutboundTypingStart,
  WsOutboundTypingStop,
  WsOutboundCreateThread,
  WsOutboundCloseThread,
  WsOutboundGetThreadHistory,
  WsOutboundListThreads,
  WsOutboundSendThreadMessage,
  WsOutboundPinMessage,
  WsOutboundUnpinMessage,
  WsOutboundGetPinnedMessages,
  WsOutboundAcceptServerRules,
  WsOutboundGetServerAutomation,
  WsOutboundUpdateServerAutomation,
} from '../types/protocol'

type MessageHandler = (msg: WsMessage) => void

type CloseHandler = (ev: CloseEvent) => void

type ErrorHandler = (ev: Event) => void

function defaultWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/ws`
}

export class WsClient {
  private ws: WebSocket | null = null
  private handlers = new Set<MessageHandler>()
  private closeHandlers = new Set<CloseHandler>()
  private errorHandlers = new Set<ErrorHandler>()
  private pingInterval: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private lastUrl: string = defaultWsUrl()
  private intentionallyClosed = false

  connect(url: string = defaultWsUrl()): WebSocket {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return this.ws
    }

    this.lastUrl = url
    this.intentionallyClosed = false
    this.clearTimers()

    this.ws = new WebSocket(url)
    this.ws.onopen = () => {
      this.reconnectDelay = 1000
      this.startPing()
    }
    this.ws.onmessage = (event) => {
      try {
        const raw = String(event.data)
        // Ignore server pong frames
        if (raw === 'pong') return
        const data = JSON.parse(raw) as WsMessage
        for (const handler of this.handlers) handler(data)
      } catch {
        // ignore malformed messages
      }
    }
    this.ws.onerror = (ev) => {
      for (const handler of this.errorHandlers) handler(ev)
    }
    this.ws.onclose = (ev) => {
      this.stopPing()
      for (const handler of this.closeHandlers) handler(ev)
      this.scheduleReconnect()
    }

    return this.ws
  }

  private startPing() {
    this.stopPing()
    // Send a lightweight ping every 25 s to keep the connection alive
    // through nginx and any other proxies.
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 25_000)
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  private clearTimers() {
    this.stopPing()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private scheduleReconnect() {
    if (this.intentionallyClosed) return
    this.reconnectTimer = setTimeout(() => {
      this.ws = null          // allow connect() to create a new socket
      this.connect(this.lastUrl)
    }, this.reconnectDelay)
    // Exponential back-off capped at maxReconnectDelay
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  onClose(handler: CloseHandler): () => void {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler)
    return () => this.errorHandlers.delete(handler)
  }

  send(payload: object) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
    this.ws.send(JSON.stringify(payload))
  }

  login(payload: WsOutboundLogin) {
    this.send(payload)
  }

  signup(payload: WsOutboundSignup) {
    this.send(payload)
  }

  verifyEmail(payload: WsOutboundVerifyEmail) {
    this.send(payload)
  }

  authenticateWithToken(payload: WsOutboundTokenAuth) {
    this.send(payload)
  }

  requestSync(payload: WsOutboundSyncData = { type: 'sync_data' }) {
    this.send(payload)
  }

  getChannelHistory(payload: WsOutboundGetChannelHistory) {
    this.send(payload)
  }

  getDmHistory(payload: WsOutboundGetDmHistory) {
    this.send(payload)
  }

  sendMessage(payload: WsOutboundSendMessage) {
    this.send(payload)
  }

  createServer(payload: WsOutboundCreateServer) {
    this.send(payload)
  }

  createChannel(payload: WsOutboundCreateChannel) {
    this.send(payload)
  }

  createVoiceChannel(payload: WsOutboundCreateVoiceChannel) {
    this.send(payload)
  }

  startDm(payload: WsOutboundStartDm) {
    this.send(payload)
  }

  generateInvite(payload: WsOutboundGenerateInvite = { type: 'generate_invite' }) {
    this.send(payload)
  }

  generateServerInvite(payload: WsOutboundGenerateServerInvite) {
    this.send(payload)
  }

  joinServerWithInvite(payload: WsOutboundJoinServerWithInvite) {
    this.send(payload)
  }

  getServerInviteUsage(payload: WsOutboundGetServerInviteUsage) {
    this.send(payload)
  }

  listInstanceInvites(payload: WsOutboundListInstanceInvites = { type: 'list_instance_invites' }) {
    this.send(payload)
  }

  listServerInvites(payload: WsOutboundListServerInvites) {
    this.send(payload)
  }

  getInstanceInviteUsage(payload: WsOutboundGetInstanceInviteUsage = { type: 'get_instance_invite_usage' }) {
    this.send(payload)
  }

  revokeInvite(payload: WsOutboundRevokeInvite) {
    this.send(payload)
  }

  revokeServerInvite(payload: WsOutboundRevokeServerInvite) {
    this.send(payload)
  }

  getServerInfoByInvite(payload: WsOutboundGetServerInfoByInvite) {
    this.send(payload)
  }

  getServerMembers(payload: WsOutboundGetServerMembers) {
    this.send(payload)
  }

  updateProfile(payload: WsOutboundUpdateProfile) {
    this.send(payload)
  }

  changeEmail(payload: WsOutboundChangeEmail) {
    this.send(payload)
  }

  changeUsername(payload: WsOutboundChangeUsername) {
    this.send(payload)
  }

  setAvatar(payload: WsOutboundSetAvatar) {
    this.send(payload)
  }

  setup2FA(payload: WsOutboundSetup2FA = { type: 'setup_2fa' }) {
    this.send(payload)
  }

  verify2FASetup(payload: WsOutboundVerify2FASetup) {
    this.send(payload)
  }

  disable2FA(payload: WsOutboundDisable2FA) {
    this.send(payload)
  }

  setNotificationMode(payload: WsOutboundSetNotificationMode) {
    this.send(payload)
  }

  requestPasswordReset(payload: WsOutboundRequestPasswordReset) {
    this.send(payload)
  }

  getLicenseInfo() {
    this.send({ type: 'get_license_info' })
  }

  updateLicense(licenseKey: string) {
    this.send({ type: 'update_license', license_key: licenseKey })
  }

  removeLicense() {
    this.send({ type: 'remove_license' })
  }

  forceLicenseCheckin() {
    this.send({ type: 'force_license_checkin' })
  }

  // ── Typing indicators ────────────────────────────────────
  sendTypingStart(payload: WsOutboundTypingStart) {
    this.send(payload)
  }

  sendTypingStop(payload: WsOutboundTypingStop) {
    this.send(payload)
  }

  // ── Threads ───────────────────────────────────────────────
  createThread(payload: WsOutboundCreateThread) {
    this.send(payload)
  }

  closeThread(payload: WsOutboundCloseThread) {
    this.send(payload)
  }

  getThreadHistory(payload: WsOutboundGetThreadHistory) {
    this.send(payload)
  }

  listThreads(payload: WsOutboundListThreads) {
    this.send(payload)
  }

  sendThreadMessage(payload: WsOutboundSendThreadMessage) {
    this.send(payload)
  }

  // ── Pinned messages ───────────────────────────────────────
  pinMessage(payload: WsOutboundPinMessage) {
    this.send(payload)
  }

  unpinMessage(payload: WsOutboundUnpinMessage) {
    this.send(payload)
  }

  getPinnedMessages(payload: WsOutboundGetPinnedMessages) {
    this.send(payload)
  }

  // ── Server automation ─────────────────────────────────────
  acceptServerRules(payload: WsOutboundAcceptServerRules) {
    this.send(payload)
  }

  getServerAutomationSettings(payload: WsOutboundGetServerAutomation) {
    this.send(payload)
  }

  updateServerAutomationSettings(payload: WsOutboundUpdateServerAutomation) {
    this.send(payload)
  }

  // ── Slash commands ─────────────────────────────────────────
  sendSlashCommand(payload: import('../types/protocol').WsOutboundSlashCommand) {
    this.send(payload)
  }

  close() {
    this.intentionallyClosed = true
    this.clearTimers()
    this.ws?.close()
    this.ws = null
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED
  }
}

export const wsClient = new WsClient()
