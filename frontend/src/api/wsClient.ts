import type {
  WsMessage,
  WsOutboundCreateChannel,
  WsOutboundCreateServer,
  WsOutboundCreateVoiceChannel,
  WsOutboundGenerateInvite,
  WsOutboundGenerateServerInvite,
  WsOutboundGetChannelHistory,
  WsOutboundGetDmHistory,
  WsOutboundGetServerInviteUsage,
  WsOutboundJoinServerWithInvite,
  WsOutboundLogin,
  WsOutboundSendMessage,
  WsOutboundSignup,
  WsOutboundStartDm,
  WsOutboundSyncData,
  WsOutboundTokenAuth,
  WsOutboundVerifyEmail,
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

  connect(url: string = defaultWsUrl()): WebSocket {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return this.ws
    }

    this.ws = new WebSocket(url)
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data)) as WsMessage
        for (const handler of this.handlers) handler(data)
      } catch {
        // ignore malformed messages
      }
    }
    this.ws.onerror = (ev) => {
      for (const handler of this.errorHandlers) handler(ev)
    }
    this.ws.onclose = (ev) => {
      for (const handler of this.closeHandlers) handler(ev)
    }

    return this.ws
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

  close() {
    this.ws?.close()
    this.ws = null
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED
  }
}

export const wsClient = new WsClient()
