import { create } from 'zustand'

import type { Dm, Friend, Server, WsChatMessage } from '../types/protocol'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

export type InitData = {
  username: string
  is_admin?: boolean
  notification_mode?: string
  avatar?: string
  avatar_type?: 'emoji' | 'image' | string
  avatar_data?: string | null
  bio?: string
  status_message?: string
  servers?: Server[]
  dms?: Dm[]
  friends?: Friend[]
  friend_requests_sent?: Friend[]
  friend_requests_received?: Friend[]
}

export type ChatContext =
  | { kind: 'global' }
  | { kind: 'server'; serverId: string; channelId: string }
  | { kind: 'dm'; dmId: string; username?: string }

export function contextKey(ctx: ChatContext): string {
  if (ctx.kind === 'global') return 'global'
  if (ctx.kind === 'dm') return `dm:${ctx.dmId}`
  return `server:${ctx.serverId}/${ctx.channelId}`
}

type AppState = {
  connectionStatus: ConnectionStatus
  authToken: string | null
  authUsername: string | null
  init: InitData | null
  lastAuthError: string | null

  selectedContext: ChatContext
  messagesByContext: Record<string, WsChatMessage[]>

  setConnectionStatus: (status: ConnectionStatus) => void
  setAuth: (auth: { token: string; username: string }) => void
  clearAuth: () => void
  setInit: (init: InitData) => void
  setLastAuthError: (message: string | null) => void

  selectContext: (ctx: ChatContext) => void
  setMessagesForContext: (ctx: ChatContext, messages: WsChatMessage[]) => void
  appendMessage: (message: WsChatMessage) => void
  updateMessage: (messageId: number, updates: Partial<WsChatMessage>) => void
  clearMessages: () => void
}

export const useAppStore = create<AppState>((set) => ({
  connectionStatus: 'disconnected',
  authToken: null,
  authUsername: null,
  init: null,
  lastAuthError: null,

  selectedContext: { kind: 'global' },
  messagesByContext: {},

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setAuth: ({ token, username }) => set({ authToken: token, authUsername: username, lastAuthError: null }),
  clearAuth: () =>
    set({
      authToken: null,
      authUsername: null,
      init: null,
      selectedContext: { kind: 'global' },
      messagesByContext: {},
    }),
  setInit: (init) => set({ init }),
  setLastAuthError: (message) => set({ lastAuthError: message }),

  selectContext: (ctx) => set({ selectedContext: ctx }),
  setMessagesForContext: (ctx, messages) =>
    set((state) => ({ messagesByContext: { ...state.messagesByContext, [contextKey(ctx)]: messages } })),
  appendMessage: (message) =>
    set((state) => {
      const ctx =
        message.context === 'server' && typeof message.context_id === 'string' && message.context_id.includes('/')
          ? (() => {
              const [serverId, channelId] = message.context_id.split('/', 2)
              return { kind: 'server', serverId, channelId } as const
            })()
          : message.context === 'dm' && typeof message.context_id === 'string'
            ? ({ kind: 'dm', dmId: message.context_id } as const)
            : ({ kind: 'global' } as const)

      const key = contextKey(ctx)
      const prev = state.messagesByContext[key] ?? []
      return { messagesByContext: { ...state.messagesByContext, [key]: [...prev, message] } }
    }),
  updateMessage: (messageId, updates) =>
    set((state) => {
      const updatedMessages: Record<string, WsChatMessage[]> = {}
      for (const [key, messages] of Object.entries(state.messagesByContext)) {
        updatedMessages[key] = messages.map((msg) =>
          msg.id === messageId ? { ...msg, ...updates } : msg
        )
      }
      return { messagesByContext: updatedMessages }
    }),
  clearMessages: () => set({ messagesByContext: {} }),
}))
