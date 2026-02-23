import { create } from 'zustand'

import type { Dm, Friend, Server, Thread, WsChatMessage } from '../types/protocol'

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
  user_status?: 'online' | 'away' | 'busy' | 'offline'
  email?: string
  email_verified?: boolean
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
  | { kind: 'thread'; serverId: string; channelId?: string; threadId: string; threadName: string }

export function contextKey(ctx: ChatContext): string {
  if (ctx.kind === 'global') return 'global'
  if (ctx.kind === 'dm') return `dm:${ctx.dmId}`
  if (ctx.kind === 'thread') return `thread:${ctx.serverId}/${ctx.threadId}`
  return `server:${ctx.serverId}/${ctx.channelId}`
}

export type TypingUser = {
  username: string
  avatar?: string
  avatar_type?: string
  avatar_data?: string | null
}

type AppState = {
  connectionStatus: ConnectionStatus
  authToken: string | null
  authUsername: string | null
  init: InitData | null
  lastAuthError: string | null

  selectedContext: ChatContext
  messagesByContext: Record<string, WsChatMessage[]>

  // Pinned messages keyed by contextKey
  pinnedByContext: Record<string, WsChatMessage[]>
  // Typing users keyed by contextKey -> list of typing users
  typingUsers: Record<string, TypingUser[]>
  // Threads keyed by serverId -> Thread[]
  threadsByServer: Record<string, Thread[]>

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

  // Pinned messages actions
  setPinnedMessages: (ctxKey: string, messages: WsChatMessage[]) => void
  addPinnedMessage: (ctxKey: string, messageId: number, pinnedBy: string, pinnedAt: string) => void
  removePinnedMessage: (ctxKey: string, messageId: number) => void

  // Typing indicator actions
  addTypingUser: (ctxKey: string, user: TypingUser) => void
  removeTypingUser: (ctxKey: string, username: string) => void

  // Thread actions
  addThread: (serverId: string, thread: Thread) => void
  closeThread: (serverId: string, threadId: string) => void
  setThreadsForServer: (serverId: string, threads: Thread[]) => void
}

export const useAppStore = create<AppState>((set) => ({
  connectionStatus: 'disconnected',
  authToken: null,
  authUsername: null,
  init: null,
  lastAuthError: null,

  selectedContext: { kind: 'global' },
  messagesByContext: {},
  pinnedByContext: {},
  typingUsers: {},
  threadsByServer: {},

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setAuth: ({ token, username }) => set({ authToken: token, authUsername: username, lastAuthError: null }),
  clearAuth: () =>
    set({
      authToken: null,
      authUsername: null,
      init: null,
      selectedContext: { kind: 'global' },
      messagesByContext: {},
      pinnedByContext: {},
      typingUsers: {},
      threadsByServer: {},
    }),
  setInit: (init) => set({ init }),
  setLastAuthError: (message) => set({ lastAuthError: message }),

  selectContext: (ctx) => set({ selectedContext: ctx }),
  setMessagesForContext: (ctx, messages) =>
    set((state) => ({ messagesByContext: { ...state.messagesByContext, [contextKey(ctx)]: messages } })),
  appendMessage: (message) =>
    set((state) => {
      let ctx: ChatContext
      if (message.context === 'thread' && typeof message.context_id === 'string') {
        // context_id for thread messages is the thread_id itself
        // server_id is encoded in thread_id prefix or not needed for key
        ctx = { kind: 'thread', serverId: message.thread_id?.split('_')[0] ?? '', threadId: message.context_id, threadName: '' }
      } else if (message.context === 'server' && typeof message.context_id === 'string' && message.context_id.includes('/')) {
        const [serverId, channelId] = message.context_id.split('/', 2)
        ctx = { kind: 'server', serverId, channelId }
      } else if (message.context === 'dm' && typeof message.context_id === 'string') {
        ctx = { kind: 'dm', dmId: message.context_id }
      } else {
        ctx = { kind: 'global' }
      }

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

  setPinnedMessages: (ctxKey, messages) =>
    set((state) => ({ pinnedByContext: { ...state.pinnedByContext, [ctxKey]: messages } })),
  addPinnedMessage: (ctxKey, messageId, pinnedBy, pinnedAt) =>
    set((state) => {
      const msgs = state.messagesByContext
      // Find the message across all contexts and mark it pinned
      const updatedMessages: Record<string, WsChatMessage[]> = {}
      for (const [key, messages] of Object.entries(msgs)) {
        updatedMessages[key] = messages.map((msg) =>
          msg.id === messageId ? { ...msg, pinned: true, pinned_by: pinnedBy, pinned_at: pinnedAt } : msg
        )
      }
      // Also update pinned list for ctxKey
      const allMessages = Object.values(updatedMessages).flat()
      const pinned = allMessages.find((m) => m.id === messageId)
      const prevPinned = state.pinnedByContext[ctxKey] ?? []
      const alreadyInList = prevPinned.some((m) => m.id === messageId)
      const newPinned = alreadyInList
        ? prevPinned
        : pinned
          ? [...prevPinned, { ...pinned, pinned: true, pinned_by: pinnedBy, pinned_at: pinnedAt }]
          : prevPinned
      return {
        messagesByContext: updatedMessages,
        pinnedByContext: { ...state.pinnedByContext, [ctxKey]: newPinned },
      }
    }),
  removePinnedMessage: (ctxKey, messageId) =>
    set((state) => {
      const updatedMessages: Record<string, WsChatMessage[]> = {}
      for (const [key, messages] of Object.entries(state.messagesByContext)) {
        updatedMessages[key] = messages.map((msg) =>
          msg.id === messageId ? { ...msg, pinned: false, pinned_by: null, pinned_at: null } : msg
        )
      }
      const prevPinned = state.pinnedByContext[ctxKey] ?? []
      return {
        messagesByContext: updatedMessages,
        pinnedByContext: { ...state.pinnedByContext, [ctxKey]: prevPinned.filter((m) => m.id !== messageId) },
      }
    }),

  addTypingUser: (ctxKey, user) =>
    set((state) => {
      const prev = state.typingUsers[ctxKey] ?? []
      const filtered = prev.filter((u) => u.username !== user.username)
      return { typingUsers: { ...state.typingUsers, [ctxKey]: [...filtered, user] } }
    }),
  removeTypingUser: (ctxKey, username) =>
    set((state) => {
      const prev = state.typingUsers[ctxKey] ?? []
      return { typingUsers: { ...state.typingUsers, [ctxKey]: prev.filter((u) => u.username !== username) } }
    }),

  addThread: (serverId, thread) =>
    set((state) => {
      const prev = state.threadsByServer[serverId] ?? []
      const filtered = prev.filter((t) => t.thread_id !== thread.thread_id)
      return { threadsByServer: { ...state.threadsByServer, [serverId]: [...filtered, thread] } }
    }),
  closeThread: (serverId, threadId) =>
    set((state) => {
      const prev = state.threadsByServer[serverId] ?? []
      return {
        threadsByServer: {
          ...state.threadsByServer,
          [serverId]: prev.map((t) => (t.thread_id === threadId ? { ...t, is_closed: true } : t)),
        },
      }
    }),
  setThreadsForServer: (serverId, threads) =>
    set((state) => ({ threadsByServer: { ...state.threadsByServer, [serverId]: threads } })),
}))
