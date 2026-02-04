import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { wsClient } from './api/wsClient'
import { clearStoredAuth, getStoredAuth, setStoredAuth } from './auth/storage'
import { contextKey, useAppStore } from './store/appStore'
import { useToastStore } from './store/toastStore'
import type { ChatContext } from './store/appStore'
import type { Server, ServerInviteUsageLog, WsChatMessage, WsMessage } from './types/protocol'
import './App.css'

function isWsChatMessage(msg: WsMessage): msg is WsChatMessage {
  return (
    msg.type === 'message' &&
    typeof (msg as any).username === 'string' &&
    typeof (msg as any).content === 'string' &&
    typeof (msg as any).timestamp === 'string'
  )
}

function isWsServerJoined(msg: WsMessage): msg is { type: 'server_joined'; server: Server } {
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

function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  const remove = useToastStore((s) => s.remove)

  if (toasts.length === 0) return null

  return (
    <div className="fixed right-3 top-3 z-50 flex w-[320px] flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => remove(t.id)}
          className={
            'rounded-xl border px-3 py-2 text-left text-sm shadow-lg backdrop-blur transition hover:border-slate-500/50 ' +
            (t.kind === 'error'
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-50'
              : t.kind === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-50'
                : 'border-sky-500/25 bg-sky-500/10 text-sky-50')
          }
        >
          {t.message}
          <div className="mt-1 text-[11px] opacity-70">Click to dismiss</div>
        </button>
      ))}
    </div>
  )
}

function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAppStore((s) => s.setAuth)
  const setInit = useAppStore((s) => s.setInit)
  const setLastAuthError = useAppStore((s) => s.setLastAuthError)
  const lastAuthError = useAppStore((s) => s.lastAuthError)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [needs2fa, setNeeds2fa] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    // If a token exists, you can proceed to chat; the chat page will verify it.
    const stored = getStoredAuth()
    if (stored.token && stored.username) {
      setAuth({ token: stored.token, username: stored.username })
    }
  }, [setAuth])

  useEffect(() => {
    const unsubscribe = wsClient.onMessage((msg: WsMessage) => {
      if (msg.type === 'auth_error') {
        setIsSubmitting(false)
        setNeeds2fa(false)
        const message = typeof msg.message === 'string' ? msg.message : 'Authentication failed'
        setLastAuthError(message)
      }
      if (msg.type === '2fa_required') {
        setIsSubmitting(false)
        setNeeds2fa(true)
        setLastAuthError(null)
      }
      if (msg.type === 'auth_success') {
        setIsSubmitting(false)
        const u = username.trim()
        if (!u) return
        const token = typeof msg.token === 'string' ? msg.token : ''
        if (!token) {
          setLastAuthError('Login succeeded but no token was returned')
          return
        }
        setStoredAuth({ token, username: u })
        setAuth({ token, username: u })
        setLastAuthError(null)
        navigate('/chat')
      }
      if (msg.type === 'init') {
        const initUsername = typeof msg.username === 'string' ? msg.username : username.trim()
        if (!initUsername) return
        setInit({
          username: initUsername,
          is_admin: msg.is_admin,
          notification_mode: msg.notification_mode,
          avatar: msg.avatar,
          avatar_type: msg.avatar_type,
          avatar_data: msg.avatar_data,
          bio: msg.bio,
          status_message: msg.status_message,
          servers: msg.servers,
          dms: msg.dms,
          friends: msg.friends,
          friend_requests_sent: msg.friend_requests_sent,
          friend_requests_received: msg.friend_requests_received,
        })
      }
    })

    return () => unsubscribe()
  }, [navigate, setAuth, setInit, setLastAuthError, username])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLastAuthError(null)
    setIsSubmitting(true)

    const u = username.trim()
    if (!u || !password) {
      setIsSubmitting(false)
      setLastAuthError('Username and password are required')
      return
    }

    const ws = wsClient.connect()
    const sendLogin = () => {
      wsClient.login({
        type: 'login',
        username: u,
        password,
        totp_code: needs2fa ? totpCode.trim() : undefined,
      })
    }

    if (ws.readyState === WebSocket.OPEN) {
      sendLogin()
      return
    }

    ws.onopen = () => {
      sendLogin()
    }
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6">
            <div className="text-xs font-medium text-sky-200/70">Decentra</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Sign in</h1>
            <p className="mt-2 text-sm text-slate-300">Dashboard UI (React + Tailwind) – migration in progress.</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5 shadow-xl">
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <label className="text-sm">
                <div className="mb-1 text-slate-200">Username</div>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  placeholder="alice"
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-slate-200">Password</div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  placeholder="••••••••"
                />
              </label>

              {needs2fa && (
                <label className="text-sm">
                  <div className="mb-1 text-slate-200">2FA Code</div>
                  <input
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="123456"
                    className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  />
                </label>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-1 inline-flex items-center justify-center rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Signing in…' : needs2fa ? 'Verify 2FA' : 'Sign In'}
              </button>
            </form>

            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <Link className="text-sky-300 hover:text-sky-200" to="/chat">
                Go to Chat
              </Link>
              <a className="text-slate-300 hover:text-slate-200" href="/static/login.html">
                Legacy Login
              </a>
              <button
                type="button"
                className="text-slate-300 hover:text-slate-200"
                onClick={() => {
                  clearStoredAuth()
                  useAppStore.getState().clearAuth()
                  setNeeds2fa(false)
                  setTotpCode('')
                }}
              >
                Clear saved token
              </button>
            </div>

            {lastAuthError ? (
              <div className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-50">
                {lastAuthError}
              </div>
            ) : null}
          </div>

          <div className="mt-6 text-xs text-slate-400">
            Backend via nginx proxy: <span className="text-slate-300">/api</span> and <span className="text-slate-300">/ws</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ChatPage() {
  const connectionStatus = useAppStore((s) => s.connectionStatus)
  const setConnectionStatus = useAppStore((s) => s.setConnectionStatus)
  const authToken = useAppStore((s) => s.authToken)
  const authUsername = useAppStore((s) => s.authUsername)
  const init = useAppStore((s) => s.init)
  const setInit = useAppStore((s) => s.setInit)
  const setAuth = useAppStore((s) => s.setAuth)
  const setLastAuthError = useAppStore((s) => s.setLastAuthError)
  const selectedContext = useAppStore((s) => s.selectedContext)
  const selectContext = useAppStore((s) => s.selectContext)
  const messagesByContext = useAppStore((s) => s.messagesByContext)
  const setMessagesForContext = useAppStore((s) => s.setMessagesForContext)
  const appendMessage = useAppStore((s) => s.appendMessage)

  const [draft, setDraft] = useState('')
  const [serverName, setServerName] = useState('')
  const [channelName, setChannelName] = useState('')
  const [channelType, setChannelType] = useState<'text' | 'voice'>('text')
  const [dmUsername, setDmUsername] = useState('')
  const [joinInviteCode, setJoinInviteCode] = useState('')
  const [lastInviteCode, setLastInviteCode] = useState<string | null>(null)
  const [inviteUsageServerId, setInviteUsageServerId] = useState<string | null>(null)
  const [inviteUsageLogs, setInviteUsageLogs] = useState<ServerInviteUsageLog[] | null>(null)
  const [isLoadingInviteUsage, setIsLoadingInviteUsage] = useState(false)

  // New UI state
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isDmSidebarOpen, setIsDmSidebarOpen] = useState(false)
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
  const [isAdminMode, setIsAdminMode] = useState(false)

  const pushToast = useToastStore((s) => s.push)

  const selectedKey = contextKey(selectedContext)
  const messages = messagesByContext[selectedKey] ?? []

  const reconnectRef = useRef<{ attempt: number; timer: number | null; stopped: boolean }>({
    attempt: 0,
    timer: null,
    stopped: false,
  })

  const clearReconnectTimer = () => {
    if (reconnectRef.current.timer != null) {
      window.clearTimeout(reconnectRef.current.timer)
      reconnectRef.current.timer = null
    }
  }

  const backoffMs = (attempt: number) => {
    // Exponential backoff with jitter; caps at 30s.
    const base = Math.min(30_000, 500 * Math.pow(2, attempt))
    const jitter = base * (0.2 * (Math.random() - 0.5) * 2) // +/-20%
    return Math.max(250, Math.floor(base + jitter))
  }

  const requestHistoryFor = (ctx: ChatContext) => {
    if (wsClient.readyState !== WebSocket.OPEN) return

    if (ctx.kind === 'server') {
      wsClient.getChannelHistory({ type: 'get_channel_history', server_id: ctx.serverId, channel_id: ctx.channelId })
    } else if (ctx.kind === 'dm') {
      wsClient.getDmHistory({ type: 'get_dm_history', dm_id: ctx.dmId })
    }
  }

  const setDefaultContextFromServers = (servers: Server[] | undefined) => {
    if (!servers?.length) return
    const firstServer = servers[0]
    const firstChannel = firstServer.channels?.[0]
    if (!firstChannel) return
    const next: ChatContext = { kind: 'server', serverId: firstServer.id, channelId: firstChannel.id }
    selectContext(next)
    requestHistoryFor(next)
  }

  useEffect(() => {
    const stored = getStoredAuth()
    if (stored.token && stored.username && !authToken) {
      setAuth({ token: stored.token, username: stored.username })
    }
  }, [authToken, setAuth])

  useEffect(() => {
    reconnectRef.current.stopped = false

    const scheduleReconnect = () => {
      if (reconnectRef.current.stopped) return
      clearReconnectTimer()

      const delay = backoffMs(reconnectRef.current.attempt)
      reconnectRef.current.attempt += 1
      setConnectionStatus('connecting')
      reconnectRef.current.timer = window.setTimeout(() => {
        connectAndAuth()
      }, delay)
    }

    const connectAndAuth = () => {
      if (reconnectRef.current.stopped) return

      clearReconnectTimer()
      setConnectionStatus('connecting')

      const ws = wsClient.connect()

      const doAuth = () => {
        if (reconnectRef.current.stopped) return
        setConnectionStatus('connected')
        reconnectRef.current.attempt = 0
        const token = useAppStore.getState().authToken ?? getStoredAuth().token
        if (token) {
          wsClient.authenticateWithToken({ type: 'token', token })
        }
      }

      if (ws.readyState === WebSocket.OPEN) {
        doAuth()
      } else {
        ws.onopen = () => doAuth()
      }
    }

    const unsubMsg = wsClient.onMessage((msg: WsMessage) => {
      if (msg.type === 'auth_success') {
        const token = typeof msg.token === 'string' ? msg.token : ''
        const u = authUsername ?? getStoredAuth().username
        if (token && u) {
          setStoredAuth({ token, username: u })
          setAuth({ token, username: u })
        }

        // Legacy client calls sync after auth; do the same.
        try {
          wsClient.requestSync()
        } catch {
          // ignore
        }

        // Re-request history for the currently selected context after re-auth.
        requestHistoryFor(useAppStore.getState().selectedContext)
      }
      if (msg.type === 'init') {
        const initUsername = typeof msg.username === 'string' ? msg.username : authUsername ?? ''
        if (!initUsername) return
        setInit({
          username: initUsername,
          is_admin: msg.is_admin,
          notification_mode: msg.notification_mode,
          avatar: msg.avatar,
          avatar_type: msg.avatar_type,
          avatar_data: msg.avatar_data,
          bio: msg.bio,
          status_message: msg.status_message,
          servers: msg.servers,
          dms: msg.dms,
          friends: msg.friends,
          friend_requests_sent: msg.friend_requests_sent,
          friend_requests_received: msg.friend_requests_received,
        })

        // If the user hasn't selected a context yet, default to first channel.
        if (useAppStore.getState().selectedContext.kind === 'global') {
          setDefaultContextFromServers(msg.servers)
        } else {
          // On reconnect, ensure current context has history.
          requestHistoryFor(useAppStore.getState().selectedContext)
        }
      }
      if (msg.type === 'data_synced') {
        const prev = useAppStore.getState().init
        if (!prev) return
        setInit({
          ...prev,
          servers: msg.servers ?? prev.servers,
          dms: msg.dms ?? prev.dms,
          friends: msg.friends ?? prev.friends,
          friend_requests_sent: msg.friend_requests_sent ?? prev.friend_requests_sent,
          friend_requests_received: msg.friend_requests_received ?? prev.friend_requests_received,
        })
      }
      if (msg.type === 'auth_error') {
        const message = typeof msg.message === 'string' ? msg.message : 'Authentication failed'
        setLastAuthError(message)
        pushToast({ kind: 'error', message })
        setIsLoadingInviteUsage(false)
      }

      if (msg.type === 'error') {
        const message = typeof msg.message === 'string' ? msg.message : 'Request failed'
        setLastAuthError(message)
        pushToast({ kind: 'error', message })
        setIsLoadingInviteUsage(false)
      }

      if (msg.type === 'server_created') {
        const prev = useAppStore.getState().init
        if (prev) {
          setInit({ ...prev, servers: [...(prev.servers ?? []), msg.server] })
        }
        // Select the new server's first channel if present
        const firstChannel = msg.server.channels?.[0]
        if (firstChannel) {
          const next: ChatContext = { kind: 'server', serverId: msg.server.id, channelId: firstChannel.id }
          selectContext(next)
          requestHistoryFor(next)
        }
      }

      if (msg.type === 'channel_created') {
        const prev = useAppStore.getState().init
        if (prev?.servers) {
          const nextServers = prev.servers.map((s) =>
            s.id === msg.server_id ? { ...s, channels: [...(s.channels ?? []), msg.channel] } : s,
          )
          setInit({ ...prev, servers: nextServers })
        }
      }

      if (msg.type === 'dm_started') {
        const prev = useAppStore.getState().init
        if (prev) {
          const existing = prev.dms ?? []
          const already = existing.some((d) => d.id === msg.dm.id)
          setInit({ ...prev, dms: already ? existing : [...existing, msg.dm] })
        }
        const next: ChatContext = { kind: 'dm', dmId: msg.dm.id, username: msg.dm.username }
        selectContext(next)
        requestHistoryFor(next)
      }

      if (msg.type === 'invite_code') {
        setLastInviteCode(msg.code)
        pushToast({ kind: 'success', message: msg.message ?? `Invite code: ${msg.code}` })
      }

      if (msg.type === 'server_invite_code') {
        setLastInviteCode(msg.code)
        pushToast({ kind: 'success', message: msg.message ?? `Server invite: ${msg.code}` })
      }

      if (msg.type === 'server_invite_usage') {
        setInviteUsageServerId(msg.server_id)
        setInviteUsageLogs(msg.usage_logs ?? [])
        setIsLoadingInviteUsage(false)
        pushToast({ kind: 'info', message: `Invite usage loaded (${(msg.usage_logs ?? []).length})` })
      }

      if (isWsServerJoined(msg)) {
        const prev = useAppStore.getState().init
        if (prev) {
          const servers = prev.servers ?? []
          const exists = servers.some((s) => s.id === msg.server.id)
          setInit({ ...prev, servers: exists ? servers : [...servers, msg.server] })
        }
        pushToast({ kind: 'success', message: `Joined server: ${msg.server.name}` })

        const firstChannel = msg.server.channels?.[0]
        if (firstChannel) {
          const next: ChatContext = { kind: 'server', serverId: msg.server.id, channelId: firstChannel.id }
          selectContext(next)
          requestHistoryFor(next)
        }
      }

      if (msg.type === 'history') {
        setMessagesForContext({ kind: 'global' }, msg.messages ?? [])
      }

      if (msg.type === 'channel_history') {
        setMessagesForContext({ kind: 'server', serverId: msg.server_id, channelId: msg.channel_id }, msg.messages ?? [])
      }

      if (msg.type === 'dm_history') {
        setMessagesForContext({ kind: 'dm', dmId: msg.dm_id }, msg.messages ?? [])
      }

      if (isWsChatMessage(msg)) {
        appendMessage(msg)
      }
    })

    const unsubClose = wsClient.onClose(() => {
      setConnectionStatus('disconnected')
      scheduleReconnect()
    })

    const unsubErr = wsClient.onError(() => {
      setConnectionStatus('disconnected')
      scheduleReconnect()
    })

    connectAndAuth()

    return () => {
      reconnectRef.current.stopped = true
      clearReconnectTimer()
      unsubMsg()
      unsubClose()
      unsubErr()
      wsClient.close()
    }
    // Intentionally mount-only: handlers pull latest state from the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    requestHistoryFor(selectedContext)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey])

  const selectedTitle =
    selectedContext.kind === 'global'
      ? 'Global'
      : selectedContext.kind === 'dm'
        ? `DM ${selectedContext.dmId}`
        : `${selectedContext.serverId} / ${selectedContext.channelId}`

  const canSend = wsClient.readyState === WebSocket.OPEN && draft.trim().length > 0

  const send = () => {
    const content = draft.trim()
    if (!content) return

    if (selectedContext.kind === 'server') {
      wsClient.sendMessage({ type: 'message', content, context: 'server', context_id: `${selectedContext.serverId}/${selectedContext.channelId}` })
    } else if (selectedContext.kind === 'dm') {
      wsClient.sendMessage({ type: 'message', content, context: 'dm', context_id: selectedContext.dmId })
    } else {
      wsClient.sendMessage({ type: 'message', content, context: 'global', context_id: null })
    }

    setDraft('')
  }

  const contextServerId = selectedContext.kind === 'server' ? selectedContext.serverId : null

  const createServer = () => {
    const name = serverName.trim()
    if (!name) return
    wsClient.createServer({ type: 'create_server', name })
    setServerName('')
  }

  const createChannel = () => {
    const name = channelName.trim()
    if (!name || !contextServerId) return
    if (channelType === 'voice') {
      wsClient.createVoiceChannel({ type: 'create_voice_channel', server_id: contextServerId, name })
    } else {
      wsClient.createChannel({ type: 'create_channel', server_id: contextServerId, name, channel_type: 'text' })
    }
    setChannelName('')
  }

  const startDm = () => {
    const u = dmUsername.trim()
    if (!u) return
    wsClient.startDm({ type: 'start_dm', username: u })
    setDmUsername('')
  }

  const generateServerInvite = () => {
    if (!contextServerId) return
    wsClient.generateServerInvite({ type: 'generate_server_invite', server_id: contextServerId })
  }

  const joinServerWithInvite = () => {
    const code = joinInviteCode.trim()
    if (!code) return
    wsClient.joinServerWithInvite({ type: 'join_server_with_invite', invite_code: code })
    setJoinInviteCode('')
  }

  const loadInviteUsage = () => {
    if (!contextServerId) return
    setIsLoadingInviteUsage(true)
    wsClient.getServerInviteUsage({ type: 'get_server_invite_usage', server_id: contextServerId })
  }

  const copyLastInvite = async () => {
    if (!lastInviteCode) return
    try {
      await navigator.clipboard.writeText(lastInviteCode)
      pushToast({ kind: 'info', message: 'Copied invite code to clipboard' })
    } catch {
      pushToast({ kind: 'error', message: 'Failed to copy invite code' })
    }
  }

  // Get selected server object
  const selectedServerObj = selectedServerId ? init?.servers?.find((s) => s.id === selectedServerId) : null

  return (
    <div className="h-screen bg-slate-950">
      <div className="flex h-full">
        {/* Left-side vertical icon bar */}
        <aside className="w-[72px] shrink-0 flex flex-col border-r border-white/10 bg-slate-900">
          {/* DMs button at top */}
          <div className="p-3">
            <button
              type="button"
              onClick={() => setIsDmSidebarOpen(!isDmSidebarOpen)}
              className={`flex h-12 w-12 items-center justify-center rounded-2xl text-2xl transition ${
                isDmSidebarOpen ? 'bg-sky-500 text-white' : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/50 hover:rounded-xl'
              }`}
              title="Direct Messages"
            >
              #
            </button>
          </div>

          {/* Separator */}
          <div className="mx-3 h-[2px] bg-slate-700/50" />

          {/* Server icons */}
          <div className="flex-1 overflow-auto p-3 space-y-2">
            {(init?.servers ?? []).map((server) => (
              <button
                key={server.id}
                type="button"
                onClick={() => {
                  if (selectedServerId === server.id) {
                    setSelectedServerId(null)
                    selectContext({ kind: 'global' })
                  } else {
                    setSelectedServerId(server.id)
                    setIsDmSidebarOpen(false)
                    const firstChannel = server.channels?.[0]
                    if (firstChannel) {
                      selectContext({ kind: 'server', serverId: server.id, channelId: firstChannel.id })
                      requestHistoryFor({ kind: 'server', serverId: server.id, channelId: firstChannel.id })
                    }
                  }
                }}
                className={`flex h-12 w-12 items-center justify-center rounded-2xl text-xl transition ${
                  selectedServerId === server.id ? 'bg-sky-500 text-white' : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/50 hover:rounded-xl'
                }`}
                title={server.name}
              >
                {server.icon ?? '🏠'}
              </button>
            ))}
          </div>

          {/* Profile section at bottom */}
          <div className="border-t border-white/10 bg-slate-900 p-3">
            <button
              type="button"
              onClick={() => setIsUserMenuOpen(true)}
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800/50 text-xl hover:bg-slate-700/50 hover:rounded-xl transition"
              title={init?.username ?? 'User'}
            >
              {init?.avatar ?? '👤'}
            </button>
          </div>
        </aside>

        {/* DM Sidebar - opens when DM button is clicked */}
        {isDmSidebarOpen && (
          <aside className="w-[240px] shrink-0 border-r border-white/10 bg-slate-900/30">
            <div className="flex h-full flex-col">
              <div className="border-b border-white/10 px-4 py-3">
                <div className="text-sm font-semibold text-white">Direct Messages</div>
              </div>
              
              <div className="flex-1 overflow-auto p-2">
                {(init?.dms ?? []).length === 0 ? (
                  <div className="px-3 py-2 text-sm text-slate-400">No DMs yet</div>
                ) : (
                  <div className="space-y-1">
                    {(init?.dms ?? []).map((dm) => {
                      const isSelected = selectedContext.kind === 'dm' && selectedContext.dmId === dm.id
                      return (
                        <button
                          key={dm.id}
                          type="button"
                          onClick={() => {
                            const next: ChatContext = { kind: 'dm', dmId: dm.id, username: dm.username }
                            selectContext(next)
                            requestHistoryFor(next)
                            setSelectedServerId(null)
                          }}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
                            isSelected ? 'bg-sky-500/15 text-sky-100' : 'text-slate-200 hover:bg-white/5'
                          }`}
                        >
                          <span className="text-lg">{dm.avatar ?? '👤'}</span>
                          <span className="text-sm font-medium truncate">{dm.username}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="border-t border-white/10 p-3">
                <div className="text-xs font-medium text-slate-400 mb-2">Start DM</div>
                <div className="flex gap-2">
                  <input
                    value={dmUsername}
                    onChange={(e) => setDmUsername(e.target.value)}
                    placeholder="Username"
                    className="flex-1 rounded-lg border border-white/10 bg-slate-950/40 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  />
                  <button
                    type="button"
                    onClick={startDm}
                    disabled={!dmUsername.trim() || wsClient.readyState !== WebSocket.OPEN}
                    className="shrink-0 rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-60"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </aside>
        )}

        {/* Server Sidebar - opens when a server icon is clicked */}
        {selectedServerId && selectedServerObj && (
          <aside className="w-[240px] shrink-0 border-r border-white/10 bg-slate-900/30">
            <div className="flex h-full flex-col">
              {/* Server header */}
              <div className="border-b border-white/10 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-lg">{selectedServerObj.icon ?? '🏠'}</span>
                    <span className="text-sm font-semibold text-white truncate">{selectedServerObj.name}</span>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-slate-400 hover:text-slate-200 text-lg"
                    title="Server Settings"
                  >
                    ⚙️
                  </button>
                </div>
              </div>

              {/* Channels list */}
              <div className="flex-1 overflow-auto p-2">
                <div className="mb-3">
                  <div className="px-2 text-xs font-medium text-slate-400 uppercase mb-1">Text Channels</div>
                  <div className="space-y-1">
                    {(selectedServerObj.channels ?? [])
                      .filter((ch) => ch.type !== 'voice')
                      .map((ch) => {
                        const isSelected =
                          selectedContext.kind === 'server' &&
                          selectedContext.serverId === selectedServerId &&
                          selectedContext.channelId === ch.id
                        return (
                          <button
                            key={ch.id}
                            type="button"
                            onClick={() => {
                              const next: ChatContext = { kind: 'server', serverId: selectedServerId, channelId: ch.id }
                              selectContext(next)
                              requestHistoryFor(next)
                            }}
                            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                              isSelected ? 'bg-sky-500/15 text-sky-100' : 'text-slate-200 hover:bg-white/5'
                            }`}
                          >
                            <span className="text-slate-400">#</span>
                            <span className="text-sm font-medium">{ch.name}</span>
                          </button>
                        )
                      })}
                  </div>
                </div>

                <div>
                  <div className="px-2 text-xs font-medium text-slate-400 uppercase mb-1">Voice Channels</div>
                  <div className="space-y-1">
                    {(selectedServerObj.channels ?? [])
                      .filter((ch) => ch.type === 'voice')
                      .map((ch) => {
                        const isSelected =
                          selectedContext.kind === 'server' &&
                          selectedContext.serverId === selectedServerId &&
                          selectedContext.channelId === ch.id
                        return (
                          <button
                            key={ch.id}
                            type="button"
                            onClick={() => {
                              const next: ChatContext = { kind: 'server', serverId: selectedServerId, channelId: ch.id }
                              selectContext(next)
                              requestHistoryFor(next)
                            }}
                            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                              isSelected ? 'bg-sky-500/15 text-sky-100' : 'text-slate-200 hover:bg-white/5'
                            }`}
                          >
                            <span className="text-slate-400">🔊</span>
                            <span className="text-sm font-medium">{ch.name}</span>
                          </button>
                        )
                      })}
                  </div>
                </div>
              </div>

              {/* Create channel section */}
              <div className="border-t border-white/10 p-3">
                <div className="text-xs font-medium text-slate-400 mb-2">Create Channel</div>
                <div className="space-y-2">
                  <input
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                    placeholder="Channel name"
                    className="w-full rounded-lg border border-white/10 bg-slate-950/40 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                  />
                  <div className="flex gap-2">
                    <select
                      value={channelType}
                      onChange={(e) => setChannelType(e.target.value as 'text' | 'voice')}
                      className="flex-1 rounded-lg border border-white/10 bg-slate-950/40 px-2 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    >
                      <option value="text">Text</option>
                      <option value="voice">Voice</option>
                    </select>
                    <button
                      type="button"
                      onClick={createChannel}
                      disabled={!channelName.trim() || wsClient.readyState !== WebSocket.OPEN}
                      className="shrink-0 rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-60"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        )}

        {/* Main chat area */}
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-white/10 bg-slate-950/60 px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-medium text-slate-400">
                  {selectedContext.kind === 'global'
                    ? 'Global Chat'
                    : selectedContext.kind === 'dm'
                      ? 'Direct Message'
                      : 'Channel'}
                </div>
                <div className="mt-1 text-lg font-semibold text-white">{selectedTitle}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/30 px-2 py-1 text-[11px] text-slate-300">
                {connectionStatus}
              </div>
            </div>
          </header>

          <section className="flex-1 overflow-auto px-6 py-5">
            <div className="mx-auto max-w-5xl">
              <div className="rounded-2xl border border-white/10 bg-slate-900/20 p-4">
                {messages.length === 0 ? (
                  <div className="text-sm text-slate-400">No messages yet.</div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {messages.map((m: WsChatMessage, idx: number) => (
                      <div key={(m.id ?? idx).toString()} className="flex gap-3">
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-slate-950/30 text-sm">
                          {m.avatar ?? '👤'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <div className="font-semibold text-slate-100">{m.username}</div>
                            <div className="text-xs text-slate-500">{new Date(m.timestamp).toLocaleString()}</div>
                          </div>
                          <div className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{m.content}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className="border-t border-white/10 bg-slate-950/60 px-6 py-4">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (canSend) send()
              }}
              className="mx-auto flex max-w-5xl gap-3"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Type a message…"
                className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              />
              <button
                type="submit"
                disabled={!canSend}
                className="shrink-0 rounded-2xl bg-sky-500 px-5 py-3 text-sm font-semibold text-slate-950 shadow hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Send
              </button>
            </form>
          </div>
        </main>

        {/* User menu modal - centered overlay */}
        {isUserMenuOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setIsUserMenuOpen(false)}>
            <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
                <div className="flex items-center gap-3">
                  {init?.is_admin && !isAdminMode && (
                    <button
                      type="button"
                      onClick={() => setIsAdminMode(true)}
                      className="rounded-lg bg-rose-500/20 px-3 py-1.5 text-sm font-semibold text-rose-300 hover:bg-rose-500/30"
                    >
                      👑 Admin Mode
                    </button>
                  )}
                  {isAdminMode && (
                    <button
                      type="button"
                      onClick={() => setIsAdminMode(false)}
                      className="rounded-lg bg-sky-500/20 px-3 py-1.5 text-sm font-semibold text-sky-300 hover:bg-sky-500/30"
                    >
                      ← Back to User Menu
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsUserMenuOpen(false)
                    setIsAdminMode(false)
                  }}
                  className="text-2xl text-slate-400 hover:text-slate-200"
                >
                  ×
                </button>
              </div>

              <div className="p-6">
                {!isAdminMode ? (
                  <div className="space-y-6">
                    <div className="text-center">
                      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-slate-800 text-4xl">
                        {init?.avatar ?? '👤'}
                      </div>
                      <div className="mt-3 text-xl font-semibold text-white">{init?.username ?? 'User'}</div>
                      {init?.bio && <div className="mt-1 text-sm text-slate-400">{init.bio}</div>}
                      {init?.status_message && (
                        <div className="mt-2 text-sm text-slate-300">{init.status_message}</div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIsUserMenuOpen(false)
                          selectContext({ kind: 'global' })
                        }}
                        className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-left text-sm text-slate-200 hover:bg-white/5"
                      >
                        🌐 Global Chat
                      </button>
                      <Link
                        to="/login"
                        className="block w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-left text-sm text-slate-200 hover:bg-white/5"
                      >
                        👤 Account Settings
                      </Link>
                      <button
                        type="button"
                        onClick={() => wsClient.requestSync()}
                        className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-left text-sm text-slate-200 hover:bg-white/5"
                      >
                        🔄 Refresh Data
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          clearStoredAuth()
                          useAppStore.getState().clearAuth()
                          setIsUserMenuOpen(false)
                        }}
                        className="w-full rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-left text-sm text-rose-300 hover:bg-rose-500/20"
                      >
                        🚪 Logout
                      </button>
                    </div>

                    <div className="border-t border-white/10 pt-4">
                      <div className="text-xs font-medium text-slate-400 mb-3">Create Server</div>
                      <div className="flex gap-2">
                        <input
                          value={serverName}
                          onChange={(e) => setServerName(e.target.value)}
                          placeholder="New server name"
                          className="flex-1 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            createServer()
                            setIsUserMenuOpen(false)
                          }}
                          disabled={!serverName.trim() || wsClient.readyState !== WebSocket.OPEN}
                          className="shrink-0 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-60"
                        >
                          Create
                        </button>
                      </div>
                    </div>

                    <div className="border-t border-white/10 pt-4">
                      <div className="text-xs font-medium text-slate-400 mb-3">Join Server</div>
                      <div className="flex gap-2">
                        <input
                          value={joinInviteCode}
                          onChange={(e) => setJoinInviteCode(e.target.value)}
                          placeholder="Enter invite code"
                          className="flex-1 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            joinServerWithInvite()
                            setIsUserMenuOpen(false)
                          }}
                          disabled={!joinInviteCode.trim() || wsClient.readyState !== WebSocket.OPEN}
                          className="shrink-0 rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-60"
                        >
                          Join
                        </button>
                      </div>
                    </div>

                    {contextServerId && (
                      <div className="border-t border-white/10 pt-4">
                        <div className="text-xs font-medium text-slate-400 mb-3">Server Invite</div>
                        <div className="flex flex-wrap gap-2 mb-3">
                          <button
                            type="button"
                            onClick={generateServerInvite}
                            disabled={wsClient.readyState !== WebSocket.OPEN}
                            className="rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
                          >
                            Generate
                          </button>
                          <button
                            type="button"
                            onClick={loadInviteUsage}
                            disabled={wsClient.readyState !== WebSocket.OPEN || isLoadingInviteUsage}
                            className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-white/20 disabled:opacity-60"
                          >
                            {isLoadingInviteUsage ? 'Loading…' : 'Usage'}
                          </button>
                          <button
                            type="button"
                            onClick={copyLastInvite}
                            disabled={!lastInviteCode}
                            className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-white/20 disabled:opacity-60"
                          >
                            Copy
                          </button>
                        </div>
                        {lastInviteCode && (
                          <div className="rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2 text-xs text-slate-200">
                            <div className="text-[11px] text-slate-400">Last code</div>
                            <div className="mt-1 break-all font-mono">{lastInviteCode}</div>
                          </div>
                        )}
                        {contextServerId && inviteUsageServerId === contextServerId && inviteUsageLogs && (
                          <div className="mt-3">
                            <div className="mb-2 text-[11px] font-medium text-slate-400">Invite usage</div>
                            {inviteUsageLogs.length === 0 ? (
                              <div className="text-xs text-slate-400">No invite usage yet.</div>
                            ) : (
                              <div className="space-y-2 max-h-48 overflow-auto">
                                {inviteUsageLogs.map((log) => {
                                  const firstUsed = log.first_used ? new Date(log.first_used).toLocaleString() : ''
                                  const lastUsed = log.last_used ? new Date(log.last_used).toLocaleString() : ''
                                  const users = (log.users ?? []).slice(0, 6).join(', ')
                                  return (
                                    <div key={log.invite_code} className="rounded-xl border border-white/10 bg-slate-950/30 p-2">
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="break-all font-mono text-xs text-slate-100">{log.invite_code}</div>
                                        <div className="text-xs font-semibold text-slate-200">{log.use_count} uses</div>
                                      </div>
                                      <div className="mt-1 text-[11px] text-slate-400">
                                        {lastUsed ? `Last: ${lastUsed}` : 'Last: —'}
                                        {firstUsed ? ` · First: ${firstUsed}` : ''}
                                      </div>
                                      {users && (
                                        <div className="mt-1 text-[11px] text-slate-400">
                                          Users: {users}
                                          {(log.users?.length ?? 0) > 6 ? '…' : ''}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="text-lg font-semibold text-white">Admin Configuration</div>
                    <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
                      Admin settings are under development. This section will contain server management tools.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function App() {
  return (
    <>
      <ToastHost />
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  )
}

export default App
