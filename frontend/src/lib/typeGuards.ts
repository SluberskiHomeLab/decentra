// WsMessage type guards — no React dependency
import type { Server, WsChatMessage, WsMessage } from '../types/protocol'

export function isWsChatMessage(msg: WsMessage): msg is WsChatMessage {
  return (
    msg.type === 'message' &&
    typeof (msg as any).username === 'string' &&
    typeof (msg as any).content === 'string' &&
    typeof (msg as any).timestamp === 'string'
  )
}

export function isWsServerJoined(msg: WsMessage): msg is { type: 'server_joined'; server: Server } {
  if (msg.type !== 'server_joined') return false
  const server = (msg as any).server
  return (
    !!server &&
    typeof server.id === 'string' &&
    typeof server.name === 'string' &&
    typeof server.owner === 'string' &&
    Array.isArray(server.channels)
  )
}
