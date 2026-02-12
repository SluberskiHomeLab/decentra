import { Link, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { wsClient } from './api/wsClient'
import { clearStoredAuth, getStoredAuth, setStoredAuth } from './auth/storage'
import { contextKey, useAppStore } from './store/appStore'
import { useToastStore } from './store/toastStore'
import { VoiceChat } from './lib/VoiceChat'
import type { ChatContext } from './store/appStore'
import type { Attachment, CustomEmoji, Reaction, Server, ServerInviteUsageLog, ServerMember, WsChatMessage, WsMessage } from './types/protocol'
import { LicensePanel } from './components/admin/LicensePanel'
import { useLicenseStore } from './store/licenseStore'
import { notificationManager } from './utils/notifications'
import './App.css'

// URL processing utilities
const URL_REGEX = /(https?:\/\/[^\s]+|\/api\/download-attachment\/[^\s]+)/gi
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?[^\s]*)?$/i
const VIDEO_EXTENSIONS = /\.(mp4|webm|ogg|mov)(\?[^\s]*)?$/i
const YOUTUBE_REGEX = /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/i

function isImageUrl(url: string): boolean {
  return IMAGE_EXTENSIONS.test(url)
}

function isVideoUrl(url: string): boolean {
  return VIDEO_EXTENSIONS.test(url)
}

function getYouTubeVideoId(url: string): string | null {
  const match = url.match(YOUTUBE_REGEX)
  return match ? match[1] : null
}

function sanitizeUrl(url: string): string | null {
  try {
    // Allow relative URLs (like /api/download-attachment/...)
    if (url.startsWith('/')) {
      return url
    }
    // For absolute URLs, validate protocol
    const urlObj = new URL(url)
    if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
      return urlObj.toString()
    }
    return null
  } catch {
    return null
  }
}

function linkifyText(text: string, mentionRenderer?: (content: string) => React.ReactNode): React.ReactNode[] {
  // First, handle mentions if a renderer is provided
  if (mentionRenderer) {
    const mentionParts = text.split(/(@\w+)/g)
    const processedParts: React.ReactNode[] = []
    
    mentionParts.forEach((part, mentionIndex) => {
      if (part.match(/^@\w+$/)) {
        // This is a mention - render it with the mention renderer
        processedParts.push(
          <span key={`mention-${mentionIndex}`}>
            {mentionRenderer(part)}
          </span>
        )
      } else if (part) {
        // This is regular text - apply custom renderer to it (for emojis) then linkify URLs
        const linkified = linkifyTextPartWithRenderer(part, `part-${mentionIndex}`, mentionRenderer)
        processedParts.push(...linkified)
      }
    })
    
    return processedParts.length > 0 ? processedParts : [<span key="text-0">{text}</span>]
  }
  
  // No mention renderer - just linkify normally
  return linkifyTextPart(text, 'text')
}

function linkifyTextPart(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  const regex = new RegExp(URL_REGEX)
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // Add text before the URL
    if (match.index > lastIndex) {
      parts.push(<span key={`${keyPrefix}-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>)
    }

    const url = match[0]
    const safeUrl = sanitizeUrl(url)
    
    if (safeUrl) {
      parts.push(
        <a
          key={`${keyPrefix}-link-${match.index}`}
          href={safeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 hover:text-sky-300 underline"
        >
          {url}
        </a>
      )
    } else {
      parts.push(<span key={`${keyPrefix}-unsafe-${match.index}`}>{url}</span>)
    }

    lastIndex = regex.lastIndex
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(<span key={`${keyPrefix}-${lastIndex}`}>{text.slice(lastIndex)}</span>)
  }

  return parts.length > 0 ? parts : [<span key={`${keyPrefix}-0`}>{text}</span>]
}

function linkifyTextPartWithRenderer(text: string, keyPrefix: string, renderer: (content: string) => React.ReactNode): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  const regex = new RegExp(URL_REGEX)
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // Add text before the URL (with emoji rendering)
    if (match.index > lastIndex) {
      const textBeforeUrl = text.slice(lastIndex, match.index)
      parts.push(<span key={`${keyPrefix}-${lastIndex}`}>{renderer(textBeforeUrl)}</span>)
    }

    const url = match[0]
    const safeUrl = sanitizeUrl(url)
    
    if (safeUrl) {
      parts.push(
        <a
          key={`${keyPrefix}-link-${match.index}`}
          href={safeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 hover:text-sky-300 underline"
        >
          {url}
        </a>
      )
    } else {
      parts.push(<span key={`${keyPrefix}-unsafe-${match.index}`}>{url}</span>)
    }

    lastIndex = regex.lastIndex
  }

  // Add remaining text (with emoji rendering)
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex)
    parts.push(<span key={`${keyPrefix}-${lastIndex}`}>{renderer(remainingText)}</span>)
  }

  return parts.length > 0 ? parts : [<span key={`${keyPrefix}-0`}>{renderer(text)}</span>]
}

// Message formatting utilities
interface FormatToken {
  type: 'text' | 'bold' | 'italic' | 'boldItalic' | 'code' | 'codeBlock' | 'strikethrough' | 'spoiler' | 'quote'
  content: string
  language?: string
}

function parseMessageFormat(text: string): FormatToken[] {
  const tokens: FormatToken[] = []
  let i = 0
  
  while (i < text.length) {
    // Check for code block (```)
    if (text.slice(i, i + 3) === '```') {
      let end = text.indexOf('```', i + 3)
      if (end === -1) {
        // No closing ```, treat as regular text
        tokens.push({ type: 'text', content: text.slice(i) })
        break
      }
      const codeContent = text.slice(i + 3, end)
      // Check for language specification (e.g., ```javascript)
      const lines = codeContent.split('\n')
      const firstLine = lines[0].trim()
      let language = ''
      let code = codeContent
      if (firstLine && !firstLine.includes(' ') && lines.length > 1) {
        language = firstLine
        code = lines.slice(1).join('\n')
      }
      tokens.push({ type: 'codeBlock', content: code, language })
      i = end + 3
      continue
    }
    
    // Check for inline code (`)
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1)
      if (end === -1) {
        tokens.push({ type: 'text', content: text.slice(i) })
        break
      }
      tokens.push({ type: 'code', content: text.slice(i + 1, end) })
      i = end + 1
      continue
    }
    
    // Check for spoiler (||)
    if (text.slice(i, i + 2) === '||') {
      const end = text.indexOf('||', i + 2)
      if (end === -1) {
        tokens.push({ type: 'text', content: text.slice(i) })
        break
      }
      tokens.push({ type: 'spoiler', content: text.slice(i + 2, end) })
      i = end + 2
      continue
    }
    
    // Check for strikethrough (~~)
    if (text.slice(i, i + 2) === '~~') {
      const end = text.indexOf('~~', i + 2)
      if (end === -1) {
        tokens.push({ type: 'text', content: text.slice(i) })
        break
      }
      tokens.push({ type: 'strikethrough', content: text.slice(i + 2, end) })
      i = end + 2
      continue
    }
    
    // Check for bold italic (***)
    if (text.slice(i, i + 3) === '***') {
      const end = text.indexOf('***', i + 3)
      if (end === -1) {
        tokens.push({ type: 'text', content: text.slice(i) })
        break
      }
      tokens.push({ type: 'boldItalic', content: text.slice(i + 3, end) })
      i = end + 3
      continue
    }
    
    // Check for italic (**)
    if (text.slice(i, i + 2) === '**') {
      const end = text.indexOf('**', i + 2)
      if (end === -1) {
        tokens.push({ type: 'text', content: text.slice(i) })
        break
      }
      tokens.push({ type: 'italic', content: text.slice(i + 2, end) })
      i = end + 2
      continue
    }
    
    // Check for bold (*)
    if (text[i] === '*') {
      const end = text.indexOf('*', i + 1)
      if (end === -1) {
        tokens.push({ type: 'text', content: text.slice(i) })
        break
      }
      tokens.push({ type: 'bold', content: text.slice(i + 1, end) })
      i = end + 1
      continue
    }
    
    // Check for quote (> at start of line)
    if ((i === 0 || text[i - 1] === '\n') && text[i] === '>') {
      // Find end of line
      let end = text.indexOf('\n', i)
      if (end === -1) end = text.length
      const quoteContent = text.slice(i + 1, end).trim()
      tokens.push({ type: 'quote', content: quoteContent })
      i = end
      continue
    }
    
    // Regular text - collect until next special character
    let textEnd = i + 1
    while (textEnd < text.length) {
      const char = text[textEnd]
      const twoChar = text.slice(textEnd, textEnd + 2)
      const threeChar = text.slice(textEnd, textEnd + 3)
      
      if (char === '`' || char === '*' || twoChar === '~~' || twoChar === '||' || threeChar === '```') {
        break
      }
      if ((textEnd === 0 || text[textEnd - 1] === '\n') && char === '>') {
        break
      }
      textEnd++
    }
    
    tokens.push({ type: 'text', content: text.slice(i, textEnd) })
    i = textEnd
  }
  
  return tokens
}

function MessageEmbeds({ content }: { content: string }): React.ReactElement | null {
  const urls = content.match(URL_REGEX)
  if (!urls) return null

  const processedUrls = new Set<string>()
  const embeds: React.ReactElement[] = []

  urls.forEach((url, index) => {
    if (processedUrls.has(url)) return
    processedUrls.add(url)

    const safeUrl = sanitizeUrl(url)
    if (!safeUrl) return

    // YouTube embed
    const youtubeId = getYouTubeVideoId(safeUrl)
    if (youtubeId) {
      embeds.push(
        <div key={`embed-${index}`} className="mt-2 overflow-hidden rounded-lg border border-white/10 bg-slate-900/40">
          <iframe
            src={`https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title="YouTube video"
            className="w-full aspect-video"
          />
        </div>
      )
    }
    // Image embed
    else if (isImageUrl(safeUrl)) {
      embeds.push(
        <div key={`embed-${index}`} className="mt-2">
          <a href={safeUrl} target="_blank" rel="noopener noreferrer">
            <img
              src={safeUrl}
              alt="Embedded image"
              loading="lazy"
              className="max-w-md rounded-lg border border-white/10"
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
            />
          </a>
        </div>
      )
    }
    // Video embed
    else if (isVideoUrl(safeUrl)) {
      embeds.push(
        <div key={`embed-${index}`} className="mt-2 overflow-hidden rounded-lg border border-white/10 bg-slate-900/40">
          <video
            src={safeUrl}
            controls
            preload="metadata"
            className="w-full max-w-md"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        </div>
      )
    }
  })

  return <>{embeds}</>
}

// Standard emoji list for reaction picker
const REACTION_EMOJIS = [
  '😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘',
  '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒',
  '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡',
  '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👏', '🙌', '👐', '🤝', '🙏',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💕', '💞', '💓', '💗', '💖', '💘', '💝',
  '✅', '❌', '⭕', '🔥', '💯', '💢', '💬', '💭', '🗨️', '🗯️', '💤', '💨'
]



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

// Avatar component with status indicator
function AvatarWithStatus({
  avatar,
  avatar_type,
  avatar_data,
  user_status,
  size = 'md',
  showStatus = true,
}: {
  avatar?: string
  avatar_type?: string
  avatar_data?: string | null
  user_status?: 'online' | 'away' | 'busy' | 'offline'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showStatus?: boolean
}) {
  const sizeClasses = {
    sm: 'h-6 w-6 text-sm',
    md: 'h-8 w-8 text-lg',
    lg: 'h-12 w-12 text-2xl',
    xl: 'h-20 w-20 text-4xl',
  }

  const statusSizeClasses = {
    sm: 'h-2 w-2',
    md: 'h-2.5 w-2.5',
    lg: 'h-3 w-3',
    xl: 'h-4 w-4',
  }

  const statusColorClasses = {
    online: 'bg-green-500',
    away: 'bg-yellow-500',
    busy: 'bg-red-500',
    offline: 'bg-gray-500',
  }

  console.log('AvatarWithStatus render:', { user_status, showStatus, hasRing: showStatus && user_status })

  return (
    <div className="relative inline-block">
      <span className={`flex ${sizeClasses[size]} items-center justify-center overflow-hidden rounded-full bg-slate-700`}>
        {avatar_type === 'image' && avatar_data ? (
          <img src={avatar_data} alt="Avatar" className="h-full w-full object-cover" />
        ) : (
          <>{avatar ?? '👤'}</>
        )}
      </span>
      {showStatus && user_status && (
        <span
          className={`absolute bottom-0 right-0 ${statusSizeClasses[size]} ${statusColorClasses[user_status]} rounded-full border-2 border-slate-950`}
          title={user_status}
        />
      )}
    </div>
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
  const authToken = useAppStore((s) => s.authToken)
  const setAuth = useAppStore((s) => s.setAuth)
  const setInit = useAppStore((s) => s.setInit)
  const setLastAuthError = useAppStore((s) => s.setLastAuthError)
  const lastAuthError = useAppStore((s) => s.lastAuthError)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [needs2fa, setNeeds2fa] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [resetUsername, setResetUsername] = useState('')
  const [resetSuccess, setResetSuccess] = useState(false)

  // If already authenticated, redirect to chat
  useEffect(() => {
    if (authToken) {
      navigate('/chat')
    }
  }, [authToken, navigate])

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
      if (msg.type === 'password_reset_requested') {
        setResetSuccess(true)
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

  function handlePasswordReset(e: React.FormEvent) {
    e.preventDefault()
    if (!resetUsername.trim()) {
      return
    }
    const ws = wsClient.connect()
    const sendReset = () => {
      wsClient.requestPasswordReset({
        type: 'request_password_reset',
        identifier: resetUsername.trim(),
      })
    }

    if (ws.readyState === WebSocket.OPEN) {
      sendReset()
      return
    }

    ws.onopen = () => {
      sendReset()
    }
  }

  return (
    <div className="relative min-h-screen bg-slate-950">
      <div className="absolute inset-0 bg-cover bg-center bg-no-repeat blur-sm" style={{ backgroundImage: 'url(/login-background.png)' }} />
      <div className="relative mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-10">
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
              <Link className="text-sky-300 hover:text-sky-200" to="/signup">
                Create Account
              </Link>
              <button
                type="button"
                className="text-sky-300 hover:text-sky-200"
                onClick={() => setShowForgotPassword(true)}
              >
                Forgot Password?
              </button>
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

      {/* Forgot Password Modal */}
      {showForgotPassword && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => {
            setShowForgotPassword(false)
            setResetSuccess(false)
            setResetUsername('')
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-xl font-semibold text-slate-100">Reset Password</h2>
            
            {resetSuccess ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-50">
                  Password reset link has been sent to your email address.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotPassword(false)
                    setResetSuccess(false)
                    setResetUsername('')
                  }}
                  className="w-full rounded-xl bg-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-100 hover:bg-slate-600"
                >
                  Close
                </button>
              </div>
            ) : (
              <form onSubmit={handlePasswordReset} className="space-y-4">
                <p className="text-sm text-slate-300">
                  Enter your username to receive a password reset link at your registered email address.
                </p>
                
                <label className="block text-sm">
                  <div className="mb-1 text-slate-200">Username</div>
                  <input
                    type="text"
                    value={resetUsername}
                    onChange={(e) => setResetUsername(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    placeholder="Your username"
                    required
                  />
                </label>

                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={!resetUsername.trim()}
                    className="flex-1 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Send Reset Link
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForgotPassword(false)
                      setResetSuccess(false)
                      setResetUsername('')
                    }}
                    className="rounded-xl bg-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-100 hover:bg-slate-600"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SignUpPage() {
  const navigate = useNavigate()
  const setAuth = useAppStore((s) => s.setAuth)
  const setInit = useAppStore((s) => s.setInit)
  const setLastAuthError = useAppStore((s) => s.setLastAuthError)
  const lastAuthError = useAppStore((s) => s.lastAuthError)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [needsVerification, setNeedsVerification] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const unsubscribe = wsClient.onMessage((msg: WsMessage) => {
      if (msg.type === 'auth_error') {
        setIsSubmitting(false)
        setNeedsVerification(false)
        const message = typeof msg.message === 'string' ? msg.message : 'Authentication failed'
        setLastAuthError(message)
      }
      if (msg.type === 'verification_required') {
        setIsSubmitting(false)
        setNeedsVerification(true)
        setLastAuthError(null)
      }
      if (msg.type === 'auth_success') {
        setIsSubmitting(false)
        const u = username.trim()
        if (!u) return
        const token = typeof msg.token === 'string' ? msg.token : ''
        if (!token) {
          setLastAuthError('Signup succeeded but no token was returned')
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

    if (needsVerification) {
      // Verification step
      const code = verificationCode.trim()
      if (!u || !code) {
        setIsSubmitting(false)
        setLastAuthError('Username and verification code are required')
        return
      }

      const ws = wsClient.connect()
      const sendVerify = () => {
        wsClient.verifyEmail({
          type: 'verify_email',
          username: u,
          code,
        })
      }

      if (ws.readyState === WebSocket.OPEN) {
        sendVerify()
        return
      }

      ws.onopen = () => {
        sendVerify()
      }
    } else {
      // Signup step
      if (!u || !password || !email) {
        setIsSubmitting(false)
        setLastAuthError('Username, password, and email are required')
        return
      }

      const ws = wsClient.connect()
      const sendSignup = () => {
        wsClient.signup({
          type: 'signup',
          username: u,
          password,
          email,
          invite_code: inviteCode.trim() || undefined,
        })
      }

      if (ws.readyState === WebSocket.OPEN) {
        sendSignup()
        return
      }

      ws.onopen = () => {
        sendSignup()
      }
    }
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6">
            <div className="text-xs font-medium text-sky-200/70">Decentra</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
              {needsVerification ? 'Verify Email' : 'Sign Up'}
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              {needsVerification
                ? 'Enter the verification code sent to your email.'
                : 'Create a new account to get started.'}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-5 shadow-xl">
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              {needsVerification ? (
                <>
                  <label className="text-sm">
                    <div className="mb-1 text-slate-200">Username</div>
                    <input
                      value={username}
                      readOnly
                      className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-slate-400"
                    />
                  </label>
                  <label className="text-sm">
                    <div className="mb-1 text-slate-200">Verification Code</div>
                    <input
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                      placeholder="123456"
                      maxLength={6}
                    />
                  </label>
                </>
              ) : (
                <>
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
                  <label className="text-sm">
                    <div className="mb-1 text-slate-200">Email</div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                      placeholder="alice@example.com"
                    />
                  </label>
                  <label className="text-sm">
                    <div className="mb-1 text-slate-200">
                      Invite Code <span className="text-xs text-slate-400">(optional, empty for first user)</span>
                    </div>
                    <input
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                      placeholder="ABC123"
                    />
                  </label>
                </>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-1 inline-flex items-center justify-center rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Processing…' : needsVerification ? 'Verify Email' : 'Create Account'}
              </button>
            </form>

            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <Link className="text-sky-300 hover:text-sky-200" to="/login">
                Already have an account? Sign In
              </Link>
              {needsVerification && (
                <button
                  type="button"
                  className="text-slate-300 hover:text-slate-200"
                  onClick={() => {
                    setNeedsVerification(false)
                    setVerificationCode('')
                    setLastAuthError(null)
                  }}
                >
                  Change Username/Email
                </button>
              )}
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

function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setErrorMessage('Invalid or missing reset token')
    }
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    setSuccessMessage(null)

    if (!token) {
      setErrorMessage('Invalid or missing reset token')
      return
    }

    if (newPassword.length < 8) {
      setErrorMessage('Password must be at least 8 characters long')
      return
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match')
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch('/api/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          new_password: newPassword,
        }),
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setSuccessMessage('Password reset successful! Redirecting to login...')
        setTimeout(() => {
          navigate('/login')
        }, 2000)
      } else {
        setErrorMessage(data.message || 'Failed to reset password')
        setIsSubmitting(false)
      }
    } catch (error) {
      setErrorMessage('An error occurred. Please try again.')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
      <div className="w-full max-w-md">
        <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-8 text-center">
            <h1 className="mb-2 text-4xl font-bold text-slate-100">Reset Password</h1>
            <p className="text-sm text-slate-400">Enter your new password below</p>
          </div>

          <div className="space-y-6">
            {!token ? (
              <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-50">
                Invalid or missing reset token
              </div>
            ) : successMessage ? (
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-50">
                {successMessage}
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <label className="text-sm">
                  <div className="mb-1 text-slate-200">New Password</div>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    placeholder="At least 8 characters"
                    required
                    disabled={isSubmitting}
                  />
                </label>

                <label className="text-sm">
                  <div className="mb-1 text-slate-200">Confirm Password</div>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    placeholder="Re-enter your password"
                    required
                    disabled={isSubmitting}
                  />
                </label>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-1 w-full inline-flex items-center justify-center rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950 shadow hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? 'Resetting Password...' : 'Reset Password'}
                </button>
              </form>
            )}

            {errorMessage && (
              <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-50">
                {errorMessage}
              </div>
            )}

            <div className="mt-4 text-center">
              <Link className="text-sm text-sky-300 hover:text-sky-200" to="/login">
                Back to Sign In
              </Link>
            </div>
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
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('')
  const [categoryName, setCategoryName] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [editingCategoryName, setEditingCategoryName] = useState('')
  const [dmUsername, setDmUsername] = useState('')
  const [joinInviteCode, setJoinInviteCode] = useState('')
  const [lastInviteCode, setLastInviteCode] = useState<string | null>(null)
  const [inviteUsageServerId, setInviteUsageServerId] = useState<string | null>(null)
  const [inviteUsageLogs, setInviteUsageLogs] = useState<ServerInviteUsageLog[] | null>(null)
  const [isLoadingInviteUsage, setIsLoadingInviteUsage] = useState(false)
  
  // File upload state
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // New UI state
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isDmSidebarOpen, setIsDmSidebarOpen] = useState(false)
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
  const [isServerSettingsOpen, setIsServerSettingsOpen] = useState(false)
  const [isMembersSidebarOpen, setIsMembersSidebarOpen] = useState(true)
  const [serverMembers, setServerMembers] = useState<Record<string, ServerMember[]>>({})
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false)
  const [isAdminMode, setIsAdminMode] = useState(false)
  const [adminSettings, setAdminSettings] = useState<Record<string, any>>({})
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [isTestingSMTP, setIsTestingSMTP] = useState(false)
  const [testEmailAddress, setTestEmailAddress] = useState('')
  
  // Server emoji and icon state
  const [serverEmojis, setServerEmojis] = useState<Record<string, any[]>>({})
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false)
  const [emojiFile, setEmojiFile] = useState<File | null>(null)
  const [emojiName, setEmojiName] = useState('')
  const [announcement, setAnnouncement] = useState<{
    enabled: boolean
    message: string
    duration_minutes: number
    set_at: string | null
  } | null>(null)

  // Message editing/deleting/reactions state
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [deletingMessageId, setDeletingMessageId] = useState<number | null>(null)
  const [reactionPickerMessageId, setReactionPickerMessageId] = useState<number | null>(null)

  // Voice/Video chat state
  const [voiceChat, setVoiceChat] = useState<any>(null)
  const [isInVoice, setIsInVoice] = useState(false)
  const [voiceParticipants, setVoiceParticipants] = useState<string[]>([])
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map())
  const [isVoiceMuted, setIsVoiceMuted] = useState(false)
  const [isVideoEnabled, setIsVideoEnabled] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)

  // Mention autocomplete state
  const [showMentionAutocomplete, setShowMentionAutocomplete] = useState(false)
  const [mentionSearch, setMentionSearch] = useState('')
  const [mentionStartPos, _setMentionStartPos] = useState<number>(0)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  // const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  // const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  // const [speakerDevices, setSpeakerDevices] = useState<MediaDeviceInfo[]>([])
  const [, setSelectedMicrophone] = useState<string | null>(null)
  const [, setSelectedSpeaker] = useState<string | null>(null)
  const [, setSelectedCamera] = useState<string | null>(null)
  const [, setScreenShareResolution] = useState(1080)
  const [, setScreenShareFramerate] = useState(60)

  // Account settings state
  const [profileBio, setProfileBio] = useState('')
  const [profileStatus, setProfileStatus] = useState('')
  const [userStatus, setUserStatus] = useState<'online' | 'away' | 'busy' | 'offline'>('online')
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [twoFASetup, setTwoFASetup] = useState<{ secret: string; qr_code: string; backup_codes: string[] } | null>(null)
  const [twoFACode, setTwoFACode] = useState('')
  
  // Role management state
  const [serverRoles, setServerRoles] = useState<Record<string, any[]>>({})
  const [selectedRole, setSelectedRole] = useState<any | null>(null)
  const [isCreateRoleOpen, setIsCreateRoleOpen] = useState(false)
  const [roleName, setRoleName] = useState('')
  const [roleColor, setRoleColor] = useState('#99AAB5')
  const [rolePermissions, setRolePermissions] = useState<string[]>([])
  const [memberRoles, setMemberRoles] = useState<Record<string, any[]>>({})
  const [isViewingMemberRoles, setIsViewingMemberRoles] = useState(false)
  const [selectedMemberForRole, setSelectedMemberForRole] = useState<string | null>(null)
  
  // Ban management state
  const [serverBans, setServerBans] = useState<Record<string, any[]>>({})
  const [isViewingBans, setIsViewingBans] = useState(false)
  const [banUsername, setBanUsername] = useState('')
  const [banReason, setBanReason] = useState('')
  const [disable2FAPassword, setDisable2FAPassword] = useState('')
  const [disable2FACode, setDisable2FACode] = useState('')
  const [notificationMode, setNotificationMode] = useState<'all' | 'mentions' | 'none'>('all')
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default')
  const [newEmail, setNewEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [emailChangeStatus, setEmailChangeStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null)
  const [newUsername, setNewUsername] = useState('')
  const [usernamePassword, setUsernamePassword] = useState('')
  const [usernameChangeStatus, setUsernameChangeStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null)
  
  // Reply state
  const [replyingTo, setReplyingTo] = useState<WsChatMessage | null>(null)

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
      // Load both history and emojis at the same time
      wsClient.getChannelHistory({ type: 'get_channel_history', server_id: ctx.serverId, channel_id: ctx.channelId })
      loadServerEmojis(ctx.serverId)
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

  // Check notification permission on mount
  useEffect(() => {
    if (notificationManager.isSupported()) {
      setNotificationPermission(notificationManager.getPermission())
    }
  }, [])

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

        // Request admin settings (includes announcement info for all users)
        try {
          wsClient.send({ type: 'get_admin_settings' })
        } catch {
          // ignore
        }

        // Request license info
        try {
          wsClient.getLicenseInfo()
        } catch {
          // ignore
        }

        // Re-request history for the currently selected context after re-auth.
        requestHistoryFor(useAppStore.getState().selectedContext)
      }
      if (msg.type === 'init') {
        const initUsername = typeof msg.username === 'string' ? msg.username : authUsername ?? ''
        if (!initUsername) return
        console.log('Init message full:', JSON.stringify(msg, null, 2))
        setInit({
          username: initUsername,
          is_admin: msg.is_admin,
          notification_mode: msg.notification_mode,
          avatar: msg.avatar,
          avatar_type: msg.avatar_type,
          avatar_data: msg.avatar_data,
          bio: msg.bio,
          status_message: msg.status_message,
          user_status: msg.user_status,
          servers: msg.servers,
          dms: msg.dms,
          friends: msg.friends,
          friend_requests_sent: msg.friend_requests_sent,
          friend_requests_received: msg.friend_requests_received,
        })

        // Sync user status
        console.log('Init message received, user_status:', msg.user_status)
        if (msg.user_status) {
          setUserStatus(msg.user_status)
          console.log('Set userStatus to:', msg.user_status)
        }

        // If the user hasn't selected a context yet, default to first channel.
        if (useAppStore.getState().selectedContext.kind === 'global') {
          setDefaultContextFromServers(msg.servers)
        } else {
          // On reconnect, ensure current context has history.
          requestHistoryFor(useAppStore.getState().selectedContext)
        }

        // Initialize VoiceChat
        if (!voiceChat && initUsername) {
          const vc = new VoiceChat(wsClient, initUsername)
          vc.setOnStateChange(() => {
            setIsVoiceMuted(vc.getIsMuted())
            setIsVideoEnabled(vc.getIsVideoEnabled())
            setIsScreenSharing(vc.getIsScreenSharing())
            setIsInVoice(vc.getIsInVoice())
          })
          vc.setOnRemoteStreamChange((peer, stream) => {
            setRemoteStreams((prev) => {
              const newMap = new Map(prev)
              if (stream) {
                newMap.set(peer, stream)
              } else {
                newMap.delete(peer)
              }
              return newMap
            })
          })
          vc.setOnParticipantsChange((participants) => {
            setVoiceParticipants(participants)
          })
          setVoiceChat(vc)

          // Load devices (commented out to avoid unused variable warnings)
          // vc.getAudioDevices().then(setAudioDevices)
          // vc.getVideoDevices().then(setVideoDevices)
          // vc.getSpeakerDevices().then(setSpeakerDevices)

          const devices = vc.getSelectedDevices()
          setSelectedMicrophone(devices.microphone)
          setSelectedSpeaker(devices.speaker)
          setSelectedCamera(devices.camera)
          setScreenShareResolution(devices.screenShareResolution)
          setScreenShareFramerate(devices.screenShareFramerate)
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
        
        // Clear authentication and redirect to login
        clearStoredAuth()
        useAppStore.getState().clearAuth()
      }

      if (msg.type === 'error') {
        const message = typeof msg.message === 'string' ? msg.message : 'Request failed'
        setLastAuthError(message)
        pushToast({ kind: 'error', message })
        setIsLoadingInviteUsage(false)
        // Set error status for email/username change forms if applicable
        const lowerMsg = message.toLowerCase()
        if (lowerMsg.includes('email')) {
          setEmailChangeStatus({ type: 'error', message })
        }
        if (lowerMsg.includes('username')) {
          setUsernameChangeStatus({ type: 'error', message })
        }
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

      if (msg.type === 'category_created') {
        const prev = useAppStore.getState().init
        if (prev?.servers) {
          const nextServers = prev.servers.map((s) =>
            s.id === msg.server_id ? { ...s, categories: [...(s.categories ?? []), msg.category] } : s,
          )
          setInit({ ...prev, servers: nextServers })
        }
      }

      if (msg.type === 'category_updated') {
        const prev = useAppStore.getState().init
        if (prev?.servers) {
          const nextServers = prev.servers.map((s) =>
            s.id === msg.server_id
              ? { ...s, categories: (s.categories ?? []).map((cat) => (cat.id === msg.category_id ? { ...cat, name: msg.name } : cat)) }
              : s,
          )
          setInit({ ...prev, servers: nextServers })
        }
      }

      if (msg.type === 'category_deleted') {
        const prev = useAppStore.getState().init
        if (prev?.servers) {
          const nextServers = prev.servers.map((s) =>
            s.id === msg.server_id
              ? {
                  ...s,
                  categories: (s.categories ?? []).filter((cat) => cat.id !== msg.category_id),
                  channels: (s.channels ?? []).map((ch) => (ch.category_id === msg.category_id ? { ...ch, category_id: null } : ch))
                }
              : s,
          )
          setInit({ ...prev, servers: nextServers })
        }
      }

      if (msg.type === 'category_positions_updated') {
        const prev = useAppStore.getState().init
        if (prev?.servers) {
          const nextServers = prev.servers.map((s) => {
            if (s.id === msg.server_id) {
              const positionMap = new Map<string, number>(
                msg.positions.map((p: { category_id: string; position: number }) => [p.category_id, p.position])
              )
              return {
                ...s,
                categories: (s.categories ?? [])
                  .map((cat) => {
                    const newPos = positionMap.get(cat.id)
                    return newPos !== undefined ? { ...cat, position: newPos } : cat
                  })
                  .sort((a, b) => {
                    const aPos = typeof a.position === 'number' ? a.position : 0
                    const bPos = typeof b.position === 'number' ? b.position : 0
                    return aPos - bPos
                  })
              }
            }
            return s
          })
          setInit({ ...prev, servers: nextServers })
        }
      }

      if (msg.type === 'channel_positions_updated') {
        const prev = useAppStore.getState().init
        if (prev?.servers) {
          const nextServers = prev.servers.map((s) => {
            if (s.id === msg.server_id) {
              const positionMap = new Map<string, { position: number; category_id?: string | null }>(
                msg.positions.map((p: { channel_id: string; position: number; category_id?: string | null }) => [
                  p.channel_id,
                  { position: p.position, category_id: p.category_id }
                ])
              )
              return {
                ...s,
                channels: (s.channels ?? [])
                  .map((ch) => {
                    const update = positionMap.get(ch.id)
                    if (update) {
                      return {
                        ...ch,
                        position: update.position,
                        category_id: update.category_id !== undefined ? update.category_id : ch.category_id
                      }
                    }
                    return ch
                  })
                  .sort((a, b) => {
                    const aPos = typeof a.position === 'number' ? a.position : 0
                    const bPos = typeof b.position === 'number' ? b.position : 0
                    return aPos - bPos
                  })
              }
            }
            return s
          })
          setInit({ ...prev, servers: nextServers })
        }
      }

      if (msg.type === 'channel_category_updated') {
        const prev = useAppStore.getState().init
        if (prev?.servers) {
          const nextServers = prev.servers.map((s) =>
            s.id === msg.server_id
              ? {
                  ...s,
                  channels: (s.channels ?? []).map((ch) =>
                    ch.id === msg.channel_id ? { ...ch, category_id: msg.category_id } : ch
                  )
                }
              : s
          )
          setInit({ ...prev, servers: nextServers })
        }
      }

      if (msg.type === 'channel_deleted') {
        const prev = useAppStore.getState().init
        if (prev?.servers) {
          const nextServers = prev.servers.map((s) =>
            s.id === msg.server_id
              ? { ...s, channels: (s.channels ?? []).filter((ch) => ch.id !== msg.channel_id) }
              : s
          )
          setInit({ ...prev, servers: nextServers })
          
          // If the current channel was deleted, switch to the first available channel
          const currentCtx = useAppStore.getState().selectedContext
          if (currentCtx.kind === 'server' && currentCtx.serverId === msg.server_id && currentCtx.channelId === msg.channel_id) {
            const updatedServer = nextServers.find(s => s.id === msg.server_id)
            if (updatedServer && updatedServer.channels && updatedServer.channels.length > 0) {
              const firstChannel = updatedServer.channels[0]
              const next: ChatContext = { kind: 'server', serverId: msg.server_id, channelId: firstChannel.id }
              selectContext(next)
              requestHistoryFor(next)
            }
          }
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

      if (msg.type === 'server_members') {
        setServerMembers((prev) => ({
          ...prev,
          [msg.server_id]: msg.members ?? [],
        }))
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
        
        // Load emojis for the server this message is from
        if (msg.context === 'server' && msg.context_id) {
          const serverId = msg.context_id.split('/')[0]
          if (!serverEmojis[serverId] && wsClient.readyState === WebSocket.OPEN) {
            loadServerEmojis(serverId)
          }
        }
        
        // Show browser notification for new messages based on notification mode
        const currentUsername = useAppStore.getState().init?.username
        const shouldNotify = currentUsername && msg.username !== currentUsername
        
        if (shouldNotify && notificationMode === 'all') {
          console.log('[App] Showing message notification for:', msg.username, 'mode:', notificationMode)
          const contextType = msg.context === 'global' ? 'global' : msg.context === 'server' ? 'server' : 'dm'
          notificationManager.showMessageNotification(
            msg.username || 'Someone',
            msg.content || '',
            contextType
          )
        } else if (shouldNotify) {
          console.log('[App] Skipping message notification, mode:', notificationMode, 'shouldNotify:', shouldNotify)
        }
      }

      if (msg.type === 'admin_settings') {
        setAdminSettings(msg.settings || {})
      }

      if (msg.type === 'license_info') {
        useLicenseStore.getState().setLicenseInfo(msg.data)
      }
      if (msg.type === 'license_updated') {
        // The broadcast may contain partial license data (e.g., missing is_admin/customer/expires_at).
        // Instead of overwriting the store with a partial payload, request a full license_info refresh.
        wsClient.send({ type: 'get_license_info' })
      }

      if (msg.type === 'settings_saved') {
        setIsSavingSettings(false)
        pushToast({ kind: 'success', message: 'Admin settings saved successfully' })
      }

      if (msg.type === 'smtp_test_result') {
        setIsTestingSMTP(false)
        if (msg.success) {
          pushToast({ kind: 'success', message: msg.message || 'SMTP test successful' })
        } else {
          pushToast({ kind: 'error', message: msg.message || 'SMTP test failed' })
        }
      }
      
      // Role management messages
      if (msg.type === 'server_roles') {
        setServerRoles((prev) => ({
          ...prev,
          [msg.server_id]: msg.roles ?? [],
        }))
      }
      
      if (msg.type === 'role_created') {
        pushToast({ kind: 'success', message: 'Role created successfully' })
        if (selectedServerId) {
          wsClient.send({ type: 'get_server_roles', server_id: selectedServerId })
        }
      }
      
      if (msg.type === 'role_updated') {
        pushToast({ kind: 'success', message: 'Role updated successfully' })
        if (selectedServerId) {
          wsClient.send({ type: 'get_server_roles', server_id: selectedServerId })
        }
      }
      
      if (msg.type === 'role_deleted') {
        pushToast({ kind: 'success', message: 'Role deleted successfully' })
        if (selectedServerId) {
          wsClient.send({ type: 'get_server_roles', server_id: selectedServerId })
        }
      }
      
      if (msg.type === 'role_assigned') {
        pushToast({ kind: 'success', message: 'Role assigned successfully' })
      }
      
      if (msg.type === 'role_removed') {
        pushToast({ kind: 'success', message: 'Role removed successfully' })
      }
      
      if (msg.type === 'user_roles') {
        setMemberRoles((prev) => ({
          ...prev,
          [`${msg.server_id}:${msg.username}`]: msg.roles ?? [],
        }))
      }
      
      // Ban management messages
      if (msg.type === 'server_bans') {
        setServerBans((prev) => ({
          ...prev,
          [msg.server_id]: msg.bans ?? [],
        }))
      }
      
      if (msg.type === 'member_banned') {
        pushToast({ kind: 'info', message: `${msg.username} has been banned` })
        if (msg.server_id && selectedServerId === msg.server_id) {
          // Refresh bans list if viewing
          wsClient.send({ type: 'get_server_bans', server_id: msg.server_id })
          // Refresh members list
          wsClient.send({ type: 'get_server_members', server_id: msg.server_id })
        }
      }
      
      if (msg.type === 'member_unbanned') {
        pushToast({ kind: 'success', message: `${msg.username} has been unbanned` })
        if (msg.server_id && selectedServerId === msg.server_id) {
          wsClient.send({ type: 'get_server_bans', server_id: msg.server_id })
        }
      }
      
      if (msg.type === 'banned_from_server') {
        pushToast({ kind: 'error', message: `You have been banned from the server. Reason: ${msg.reason || 'No reason provided'}` })
        // Remove server from list
        const prev = useAppStore.getState().init
        if (prev && msg.server_id) {
          const servers = (prev.servers ?? []).filter((s) => s.id !== msg.server_id)
          setInit({ ...prev, servers })
        }
      }
      
      if (msg.type === 'mention_notification') {
        console.log('[App] Received mention_notification:', msg)
        const mentionedBy = msg.mentioned_by || 'Someone'
        const content = msg.content || ''
        const preview = content.length > 50 ? content.substring(0, 50) + '...' : content
        pushToast({ kind: 'info', message: `${mentionedBy} mentioned you: "${preview}"` })
        
        // Show browser notification if permission granted and mode allows
        if (notificationMode !== 'none') {
          console.log('[App] Showing mention notification, mode:', notificationMode)
          notificationManager.showMentionNotification(mentionedBy, content, msg.context_type || 'global')
        }
      }
      
      if (msg.type === 'reply_notification') {
        console.log('[App] Received reply_notification:', msg)
        const repliedBy = msg.replied_by || 'Someone'
        const content = msg.content || ''
        const preview = content.length > 50 ? content.substring(0, 50) + '...' : content
        pushToast({ kind: 'info', message: `${repliedBy} replied to your message: "${preview}"` })
        
        // Show browser notification if permission granted and mode allows
        if (notificationMode !== 'none') {
          console.log('[App] Showing reply notification, mode:', notificationMode)
          notificationManager.showReplyNotification(repliedBy, content)
        }
      }

      if (msg.type === 'announcement_update') {
        const enabled = msg.enabled === true
        const message = typeof msg.message === 'string' ? msg.message : ''
        const duration_minutes = typeof msg.duration_minutes === 'number' ? msg.duration_minutes : 60
        const set_at = typeof msg.set_at === 'string' ? msg.set_at : null
        
        if (enabled && message && set_at) {
          // Check if announcement is still valid (within duration)
          const setTime = new Date(set_at).getTime()
          const now = Date.now()
          const durationMs = duration_minutes * 60 * 1000
          
          if (now - setTime < durationMs) {
            setAnnouncement({ enabled, message, duration_minutes, set_at })
          } else {
            setAnnouncement(null)
          }
        } else {
          setAnnouncement(null)
        }
      }

      if (msg.type === '2fa_setup') {
        setTwoFASetup({
          secret: msg.secret,
          qr_code: msg.qr_code,
          backup_codes: msg.backup_codes,
        })
        pushToast({ kind: 'success', message: '2FA setup started. Scan the QR code with your authenticator app.' })
      }

      if (msg.type === '2fa_enabled') {
        setTwoFASetup(null)
        setTwoFACode('')
        pushToast({ kind: 'success', message: msg.message || '2FA enabled successfully' })
        wsClient.requestSync()
      }

      if (msg.type === '2fa_disabled') {
        setDisable2FAPassword('')
        setDisable2FACode('')
        pushToast({ kind: 'success', message: msg.message || '2FA disabled successfully' })
        wsClient.requestSync()
      }

      if (msg.type === 'profile_updated') {
        pushToast({ kind: 'success', message: 'Profile updated successfully' })
        wsClient.requestSync()
      }

      if (msg.type === 'avatar_updated') {
        pushToast({ kind: 'success', message: 'Avatar updated successfully' })
        wsClient.requestSync()
      }

      if (msg.type === 'notification_mode_updated') {
        pushToast({ kind: 'success', message: 'Notification settings updated' })
        wsClient.requestSync()
      }

      if (msg.type === 'user_status_changed') {
        const { username, user_status } = msg
        // Update status in init if it's the current user
        const prev = useAppStore.getState().init
        if (prev && prev.username === username) {
          setInit({ ...prev, user_status })
          setUserStatus(user_status)
        }
        // Update status in friends list
        if (prev?.friends) {
          const updatedFriends = prev.friends.map((f) =>
            f.username === username ? { ...f, user_status } : f
          )
          setInit({ ...prev, friends: updatedFriends })
        }
        // Update status in DMs list
        if (prev?.dms) {
          const updatedDms = prev.dms.map((dm) =>
            dm.username === username ? { ...dm, user_status } : dm
          )
          setInit({ ...prev, dms: updatedDms })
        }
      }

      if (msg.type === 'email_changed') {
        const prev = useAppStore.getState().init
        if (prev) {
          setInit({ ...prev, email: msg.email, email_verified: msg.email_verified })
        }
        setNewEmail('')
        setEmailPassword('')
        setEmailChangeStatus({ type: 'success', message: 'Email updated successfully' })
      }

      if (msg.type === 'username_changed') {
        // Update auth token and username
        const newToken = msg.token
        const renamedUsername = msg.new_username
        setStoredAuth({ token: newToken, username: renamedUsername })
        setAuth({ token: newToken, username: renamedUsername })
        const prev = useAppStore.getState().init
        if (prev) {
          setInit({ ...prev, username: renamedUsername })
        }
        setNewUsername('')
        setUsernamePassword('')
        setUsernameChangeStatus({ type: 'success', message: 'Username changed successfully' })
      }

      if (msg.type === 'user_renamed') {
        const { old_username, new_username } = msg
        const prev = useAppStore.getState().init
        if (!prev) return
        // Update friends list and DMs
        const updateUsername = (list?: any[]) =>
          list?.map((item: any) => {
            const updated = { ...item }
            if (updated.username === old_username) updated.username = new_username
            if (updated.friend_username === old_username) updated.friend_username = new_username
            return updated
          }) || []

        setInit({
          ...prev,
          friends: updateUsername(prev.friends),
          friend_requests_sent: updateUsername(prev.friend_requests_sent),
          friend_requests_received: updateUsername(prev.friend_requests_received),
          dms: prev.dms?.map((dm: any) => {
            const updated = { ...dm }
            if (updated.username === old_username) {
              updated.username = new_username
            }
            return updated
          }) || [],
        })
      }

      if (msg.type === 'password_reset_requested') {
        pushToast({ kind: 'success', message: msg.message || 'Password reset email sent' })
      }

      if (msg.type === 'server_icon_update') {
        const prev = useAppStore.getState().init
        if (!prev || !prev.servers) return
        const updatedServers = prev.servers.map((s) =>
          s.id === msg.server_id
            ? { ...s, icon: msg.icon, icon_type: msg.icon_type, icon_data: msg.icon_data }
            : s
        )
        setInit({ ...prev, servers: updatedServers })
      }

      if (msg.type === 'custom_emoji_added') {
        setServerEmojis((prev) => ({
          ...prev,
          [msg.server_id]: [...(prev[msg.server_id] || []), msg.emoji],
        }))
        pushToast({ kind: 'success', message: `Emoji :${msg.emoji.name}: added` })
      }

      if (msg.type === 'custom_emoji_deleted') {
        setServerEmojis((prev) => ({
          ...prev,
          [msg.server_id]: (prev[msg.server_id] || []).filter((e) => e.emoji_id !== msg.emoji_id),
        }))
      }

      if (msg.type === 'server_emojis') {
        console.log('📦 Received server_emojis:', { server_id: msg.server_id, emoji_count: msg.emojis.length })
        setServerEmojis((prev) => ({
          ...prev,
          [msg.server_id]: msg.emojis,
        }))
        
        // Force re-render of all messages in this server by triggering messages refresh
        // This ensures emojis render correctly when data arrives after messages
        setTimeout(() => {
          const store = useAppStore.getState()
          Object.keys(store.messagesByContext).forEach((key) => {
            // Only update contexts that belong to this server
            if (key.startsWith(`server:${msg.server_id}/`)) {
              const messages = store.messagesByContext[key]
              if (messages && messages.length > 0) {
                console.log(`🔄 Forcing re-render for context ${key} after emojis arrived`)
                // Extract the context from the key and trigger a re-render
                const [, contextId] = key.split(':', 2)
                if (contextId && contextId.includes('/')) {
                  const [serverId, channelId] = contextId.split('/', 2)
                  setMessagesForContext(
                    { kind: 'server', serverId, channelId },
                    [...messages]
                  )
                }
              }
            }
          })
        }, 0)
      }

      if (msg.type === 'message_edited') {
        const { message_id, content, edited_at } = msg
        // Update the message in all contexts
        const store = useAppStore.getState()
        Object.keys(store.messagesByContext).forEach((key) => {
          const messages = store.messagesByContext[key]
          const msgIndex = messages.findIndex((m) => m.id === message_id)
          if (msgIndex !== -1) {
            const updatedMessages = [...messages]
            updatedMessages[msgIndex] = {
              ...updatedMessages[msgIndex],
              content,
              edited_at,
            }
            useAppStore.setState({
              messagesByContext: {
                ...store.messagesByContext,
                [key]: updatedMessages,
              },
            })
          }
        })
      }

      if (msg.type === 'message_deleted') {
        const { message_id } = msg
        // Remove the message from all contexts
        const store = useAppStore.getState()
        Object.keys(store.messagesByContext).forEach((key) => {
          const messages = store.messagesByContext[key]
          const filteredMessages = messages.filter((m) => m.id !== message_id)
          if (filteredMessages.length !== messages.length) {
            useAppStore.setState({
              messagesByContext: {
                ...store.messagesByContext,
                [key]: filteredMessages,
              },
            })
          }
        })
      }

      if (msg.type === 'reaction_added' || msg.type === 'reaction_removed') {
        const { message_id, reactions } = msg
        // Update reactions for the message in all contexts
        const store = useAppStore.getState()
        Object.keys(store.messagesByContext).forEach((key) => {
          const messages = store.messagesByContext[key]
          const msgIndex = messages.findIndex((m) => m.id === message_id)
          if (msgIndex !== -1) {
            const updatedMessages = [...messages]
            updatedMessages[msgIndex] = {
              ...updatedMessages[msgIndex],
              reactions,
            }
            useAppStore.setState({
              messagesByContext: {
                ...store.messagesByContext,
                [key]: updatedMessages,
              },
            })
          }
        })
      }

      // Voice/Video chat handlers
      if (msg.type === 'voice_channel_joined' && voiceChat) {
        voiceChat.handleVoiceJoined(msg.participants)
      }

      if (msg.type === 'voice_state_update') {
        console.log('Received voice_state_update:', msg)
        // Update voice participants when someone joins/leaves
        if (msg.voice_members && Array.isArray(msg.voice_members)) {
          const participantUsernames = msg.voice_members.map((m: any) => m.username)
          const currentChannel = voiceChat?.getCurrentChannel()
          const matchesCurrentChannel =
            !!currentChannel?.server &&
            !!currentChannel?.channel &&
            msg.server_id === currentChannel.server &&
            msg.channel_id === currentChannel.channel

          if (matchesCurrentChannel) {
            setVoiceParticipants(participantUsernames)
            const isUserInVoice = participantUsernames.includes(init?.username)
            setIsInVoice(isUserInVoice)
            if (voiceChat) {
              voiceChat.handleVoiceJoined(participantUsernames)
            }
            console.log('Updated voice participants:', participantUsernames)
          }
        }
      }

      if (msg.type === 'direct_call_started' && voiceChat) {
        voiceChat.handleVoiceJoined([msg.caller])
      }

      if (msg.type === 'user_joined_voice' && voiceChat) {
        voiceChat.handleUserJoinedVoice(msg.username)
      }

      if (msg.type === 'user_left_voice' && voiceChat) {
        voiceChat.handleUserLeftVoice(msg.username)
      }

      if (msg.type === 'webrtc_offer' && voiceChat) {
        const fromUsername = (msg as any).from_username ?? (msg as any).from
        if (fromUsername) {
          voiceChat.handleWebRTCOffer(fromUsername, msg.offer)
        }
      }

      if (msg.type === 'webrtc_answer' && voiceChat) {
        const fromUsername = (msg as any).from_username ?? (msg as any).from
        if (fromUsername) {
          voiceChat.handleWebRTCAnswer(fromUsername, msg.answer)
        }
      }

      if (msg.type === 'webrtc_ice_candidate' && voiceChat) {
        const fromUsername = (msg as any).from_username ?? (msg as any).from
        if (fromUsername) {
          voiceChat.handleICECandidate(fromUsername, msg.candidate)
        }
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

  // Populate account settings when init data is available
  useEffect(() => {
    if (init) {
      setProfileBio(init.bio || '')
      setProfileStatus(init.status_message || '')
      setNotificationMode(init.notification_mode as 'all' | 'mentions' | 'none' || 'all')
    }
  }, [init])

  // Load server emojis when selected server changes and when component mounts
  useEffect(() => {
    if (selectedContext.kind === 'server' && wsClient.readyState === WebSocket.OPEN) {
      // Always load emojis when context changes to ensure we have fresh data
      console.log('🎯 Loading emojis for server:', selectedContext.serverId)
      loadServerEmojis(selectedContext.serverId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContext, wsClient.readyState])

  // Debug: Log whenever serverEmojis changes
  useEffect(() => {
    console.log('🔄 serverEmojis state updated:', Object.keys(serverEmojis).map(sid => ({ serverId: sid, count: serverEmojis[sid].length })))
  }, [serverEmojis])

  // Keep emojis for all visible servers in sync
  useEffect(() => {
    if (wsClient.readyState === WebSocket.OPEN && init?.servers) {
      // Periodically ensure all server emojis are loaded
      const serverIds = init.servers.map(s => s.id)
      serverIds.forEach(serverId => {
        // Only load if we don't have emojis for this server yet
        if (!serverEmojis[serverId]) {
          loadServerEmojis(serverId)
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [init?.servers, wsClient.readyState])

  // Debug logging for emoji state changes
  useEffect(() => {
    console.log('serverEmojis updated:', Object.keys(serverEmojis).map(key => ({ [key]: serverEmojis[key]?.length || 0 })))
  }, [serverEmojis])

  // Load server roles when server settings modal is opened
  useEffect(() => {
    if (isServerSettingsOpen && selectedServerId && wsClient.readyState === WebSocket.OPEN) {
      loadServerRoles(selectedServerId)
      loadServerBans(selectedServerId)
      loadServerMembers(selectedServerId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isServerSettingsOpen, selectedServerId])

  // Load member roles for the selected server
  useEffect(() => {
    if (selectedContext.kind === 'server' && wsClient.readyState === WebSocket.OPEN) {
      const serverId = selectedContext.serverId
      const members = serverMembers[serverId]
      
      if (members && members.length > 0) {
        // Load roles for all members
        members.forEach((member: any) => {
          loadUserRoles(serverId, member.username)
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContext, serverMembers])

  // Helper function to get username style based on role color
  const getUsernameStyle = (message: any) => {
    if (message.role_color) {
      return { color: message.role_color }
    }
    return {}
  }

  // Helper function to get the highest role color for a member
  const getMemberRoleColor = (serverId: string, username: string) => {
    const memberKey = `${serverId}:${username}`
    const userRoles = memberRoles[memberKey] || []
    
    // Return the color of the first role (highest priority)
    if (userRoles.length > 0 && userRoles[0].color) {
      return userRoles[0].color
    }
    
    return null
  }

  // Helper function to organize members by role
  const organizeMembersByRole = (serverId: string, members: any[]) => {
    const roleGroups: Record<string, { role: any | null; members: any[] }> = {}
    
    members.forEach((member) => {
      const memberKey = `${serverId}:${member.username}`
      const userRoles = memberRoles[memberKey] || []
      
      // Get the highest role (first in the array)
      const highestRole = userRoles.length > 0 ? userRoles[0] : null
      const roleName = highestRole?.name || 'No Role'
      
      if (!roleGroups[roleName]) {
        roleGroups[roleName] = {
          role: highestRole,
          members: []
        }
      }
      
      roleGroups[roleName].members.push(member)
    })
    
    // Sort members within each role group alphabetically
    Object.values(roleGroups).forEach((group) => {
      group.members.sort((a, b) => a.username.localeCompare(b.username))
    })
    
    // Convert to array and sort by role name
    const sortedGroups = Object.entries(roleGroups)
      .map(([roleName, group]) => ({
        roleName,
        ...group
      }))
      .sort((a, b) => {
        // "No Role" should be at the bottom
        if (a.roleName === 'No Role') return 1
        if (b.roleName === 'No Role') return -1
        return a.roleName.localeCompare(b.roleName)
      })
    
    return sortedGroups
  }

  const selectedTitle =
    selectedContext.kind === 'global'
      ? 'Global'
      : selectedContext.kind === 'dm'
        ? selectedContext.username
        : (() => {
            const server = init?.servers?.find((s) => s.id === selectedContext.serverId)
            const channel = server?.channels?.find((c) => c.id === selectedContext.channelId)
            return server && channel ? `${server.name} / ${channel.name}` : 'Channel'
          })()

  const canSend = wsClient.readyState === WebSocket.OPEN && (draft.trim().length > 0 || selectedFiles.length > 0)

  const send = async () => {
    const content = draft.trim()
    if (!content && selectedFiles.length === 0) return

    // Extract mentions from the message
    const mentions = extractMentions(content)
    
    // Get reply_to ID if replying
    const reply_to = replyingTo?.id || undefined

    // If there are files, send message first, then upload files
    if (selectedFiles.length > 0) {
      await sendMessageWithFiles(content || '', mentions, reply_to)
    } else {
      // Just send text message
      if (selectedContext.kind === 'server') {
        wsClient.sendMessage({ type: 'message', content, context: 'server', context_id: `${selectedContext.serverId}/${selectedContext.channelId}`, mentions, reply_to })
      } else if (selectedContext.kind === 'dm') {
        wsClient.sendMessage({ type: 'message', content, context: 'dm', context_id: selectedContext.dmId, mentions, reply_to })
      } else {
        wsClient.sendMessage({ type: 'message', content, context: 'global', context_id: null, mentions, reply_to })
      }
      setDraft('')
      setReplyingTo(null)
    }
  }

  const sendMessageWithFiles = async (content: string, mentions: string[] = [], reply_to?: number) => {
    setIsUploading(true)
    try {
      // Create a one-time listener for the message response
      let messageId: number | null = null
      
      const handleMessageResponse = (msg: WsMessage) => {
        if (msg.type === 'message' && msg.id) {
          messageId = msg.id
        }
      }
      
      const unsubscribe = wsClient.onMessage(handleMessageResponse)
      
      // Send the message first
      if (selectedContext.kind === 'server') {
        wsClient.sendMessage({ 
          type: 'message', 
          content, 
          context: 'server', 
          context_id: `${selectedContext.serverId}/${selectedContext.channelId}`,
          mentions,
          reply_to
        })
      } else if (selectedContext.kind === 'dm') {
        wsClient.sendMessage({ 
          type: 'message', 
          content, 
          context: 'dm', 
          context_id: selectedContext.dmId,
          mentions,
          reply_to
        })
      } else {
        wsClient.sendMessage({ 
          type: 'message', 
          content, 
          context: 'global', 
          context_id: null,
          mentions,
          reply_to
        })
      }

      // Wait for message ID to be assigned
      let attempts = 0
      while (messageId === null && attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 100))
        attempts++
      }
      
      unsubscribe()
      
      if (messageId === null) {
        pushToast({ kind: 'error', message: 'Failed to send message' })
        setIsUploading(false)
        return
      }

      // Upload each file
      const token = authToken || getStoredAuth().token
      if (!token) {
        pushToast({ kind: 'error', message: 'Authentication required' })
        setIsUploading(false)
        return
      }

      const uploadedAttachments: Attachment[] = []

      for (const file of selectedFiles) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('token', token)
        formData.append('message_id', String(messageId))

        const response = await fetch('/api/upload-attachment', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const data = await response.json()
          pushToast({ kind: 'error', message: data.error || `Failed to upload ${file.name}` })
        } else {
          const data = await response.json()
          if (data.success && data.attachment) {
            uploadedAttachments.push(data.attachment)
          }
        }
      }

      // Update the message in local state with the attachments
      if (uploadedAttachments.length > 0) {
        useAppStore.getState().updateMessage(messageId, { attachments: uploadedAttachments })
      }

      // Clear files, draft, and reply
      setSelectedFiles([])
      setDraft('')
      setReplyingTo(null)
      pushToast({ kind: 'success', message: 'Message and files sent successfully' })
    } catch (error) {
      pushToast({ kind: 'error', message: 'Failed to upload files' })
    } finally {
      setIsUploading(false)
    }
  }

  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return

    const executableExtensions = ['.exe', '.sh', '.bat', '.ps1', '.cmd', '.com', '.msi', '.scr', '.vbs', '.js', '.jar']
    const maxSize = (adminSettings.max_attachment_size_mb || 10) * 1024 * 1024
    const validFiles: File[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'))

      // Check if executable
      if (executableExtensions.includes(ext)) {
        pushToast({ kind: 'error', message: `${file.name}: Executable files are not allowed` })
        continue
      }

      // Check file size
      if (file.size > maxSize) {
        pushToast({ kind: 'error', message: `${file.name}: File exceeds maximum size of ${adminSettings.max_attachment_size_mb || 10}MB` })
        continue
      }

      validFiles.push(file)
    }

    setSelectedFiles(prev => [...prev, ...validFiles])
  }

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    
    if (e.dataTransfer.files) {
      await handleDroppedFiles(e.dataTransfer.files)
    }
  }

  const handleDroppedFiles = async (files: FileList) => {
    if (!files || files.length === 0) return

    const executableExtensions = ['.exe', '.sh', '.bat', '.ps1', '.cmd', '.com', '.msi', '.scr', '.vbs', '.js', '.jar']
    const maxSize = (adminSettings.max_attachment_size_mb || 10) * 1024 * 1024
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg']
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov']
    
    const filesToEmbed: File[] = []
    const filesToAttach: File[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'))

      // Check if executable
      if (executableExtensions.includes(ext)) {
        pushToast({ kind: 'error', message: `${file.name}: Executable files are not allowed` })
        continue
      }

      // Check file size
      if (file.size > maxSize) {
        pushToast({ kind: 'error', message: `${file.name}: File exceeds maximum size of ${adminSettings.max_attachment_size_mb || 10}MB` })
        continue
      }

      // Categorize file for embedding or attaching
      if (imageExtensions.includes(ext) || videoExtensions.includes(ext)) {
        filesToEmbed.push(file)
      } else {
        filesToAttach.push(file)
      }
    }

    // Add non-media files as attachments
    if (filesToAttach.length > 0) {
      setSelectedFiles(prev => [...prev, ...filesToAttach])
    }

    // Upload and embed media files
    if (filesToEmbed.length > 0) {
      await uploadAndEmbedFiles(filesToEmbed)
    }
  }

  const uploadAndEmbedFiles = async (files: File[]) => {
    const token = authToken || getStoredAuth().token
    if (!token) {
      pushToast({ kind: 'error', message: 'Authentication required' })
      return
    }

    setIsUploading(true)

    try {
      // Use a placeholder message_id of 0 for these uploads
      // The files will be uploaded and we'll get URLs back
      const uploadedUrls: string[] = []

      for (const file of files) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('token', token)
        formData.append('message_id', '0') // Placeholder ID

        try {
          const response = await fetch('/api/upload-attachment', {
            method: 'POST',
            body: formData,
          })

          if (!response.ok) {
            const data = await response.json()
            pushToast({ kind: 'error', message: data.error || `Failed to upload ${file.name}` })
          } else {
            const data = await response.json()
            if (data.success && data.attachment) {
              // Create a URL that can be embedded - include filename for extension detection
              const url = `/api/download-attachment/${data.attachment.attachment_id}/${encodeURIComponent(data.attachment.filename)}`
              uploadedUrls.push(url)
            }
          }
        } catch (error) {
          pushToast({ kind: 'error', message: `Failed to upload ${file.name}` })
        }
      }

      // Add URLs to draft
      if (uploadedUrls.length > 0) {
        const urlText = uploadedUrls.join('\n')
        setDraft(prev => prev ? `${prev}\n${urlText}` : urlText)
        pushToast({ kind: 'success', message: `${uploadedUrls.length} file(s) ready to embed` })
      }
    } finally {
      setIsUploading(false)
    }
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
      wsClient.createChannel({
        type: 'create_channel',
        server_id: contextServerId,
        name,
        channel_type: 'text',
        category_id: selectedCategoryId || undefined,
      })
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

  const loadInviteUsage = (serverId: string) => {
    setIsLoadingInviteUsage(true)
    setInviteUsageServerId(serverId)
    wsClient.getServerInviteUsage({ type: 'get_server_invite_usage', server_id: serverId })
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

  const loadAdminSettings = () => {
    if (wsClient.readyState !== WebSocket.OPEN) return
    wsClient.send({ type: 'get_admin_settings' })
  }

  const saveAdminSettings = () => {
    if (wsClient.readyState !== WebSocket.OPEN) return
    setIsSavingSettings(true)
    wsClient.send({ type: 'save_admin_settings', settings: adminSettings })
  }

  const uploadServerIcon = async (serverId: string, file: File) => {
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const iconData = e.target?.result as string
      wsClient.send({
        type: 'set_server_icon',
        server_id: serverId,
        icon_type: 'image',
        icon_data: iconData,
      })
      pushToast({ kind: 'success', message: 'Server icon updating...' })
    }
    reader.onerror = () => {
      pushToast({ kind: 'error', message: 'Failed to read image file' })
    }
    reader.readAsDataURL(file)
  }

  const setServerIconEmoji = (serverId: string, emoji: string) => {
    wsClient.send({
      type: 'set_server_icon',
      server_id: serverId,
      icon_type: 'emoji',
      icon: emoji,
    })
    pushToast({ kind: 'success', message: 'Server icon updated' })
  }

  const uploadServerEmoji = async (serverId: string, name: string, file: File) => {
    if (!file || !name) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const imageData = e.target?.result as string
      wsClient.send({
        type: 'upload_custom_emoji',
        server_id: serverId,
        name: name.trim(),
        image_data: imageData,
      })
      setEmojiFile(null)
      setEmojiName('')
      pushToast({ kind: 'success', message: 'Uploading emoji...' })
    }
    reader.onerror = () => {
      pushToast({ kind: 'error', message: 'Failed to read emoji file' })
    }
    reader.readAsDataURL(file)
  }

  const deleteServerEmoji = (emojiId: string) => {
    wsClient.send({
      type: 'delete_custom_emoji',
      emoji_id: emojiId,
    })
  }

  const loadServerEmojis = (serverId: string) => {
    console.log('🎨 loadServerEmojis requested:', { serverId, wsReady: wsClient.readyState === WebSocket.OPEN })
    if (wsClient.readyState === WebSocket.OPEN) {
      wsClient.send({
        type: 'get_server_emojis',
        server_id: serverId,
      })
      console.log('🎨 loadServerEmojis request sent to server')
    } else {
      console.warn('🎨 loadServerEmojis skipped: WebSocket not ready', wsClient.readyState)
    }
  }

  const insertEmoji = (emoji: string) => {
    setDraft((prev) => prev + emoji)
    setIsEmojiPickerOpen(false)
  }

  // Role management functions
  const loadServerRoles = (serverId: string) => {
    wsClient.send({
      type: 'get_server_roles',
      server_id: serverId,
    })
  }

  const createRole = () => {
    if (!selectedServerId || !roleName.trim()) return
    wsClient.send({
      type: 'create_role',
      server_id: selectedServerId,
      name: roleName.trim(),
      color: roleColor,
      permissions: rolePermissions,
    })
    setIsCreateRoleOpen(false)
    setRoleName('')
    setRoleColor('#3B82F6')
    setRolePermissions([])
  }

  const updateRole = () => {
    if (!selectedServerId || !selectedRole || !roleName.trim()) return
    wsClient.send({
      type: 'update_role',
      server_id: selectedServerId,
      role_id: selectedRole,
      name: roleName.trim(),
      color: roleColor,
      permissions: rolePermissions,
    })
    setIsCreateRoleOpen(false)
    setSelectedRole(null)
    setRoleName('')
    setRoleColor('#3B82F6')
    setRolePermissions([])
  }

  const deleteRole = (roleId: string) => {
    if (!selectedServerId || !confirm('Are you sure you want to delete this role?')) return
    wsClient.send({
      type: 'delete_role',
      server_id: selectedServerId,
      role_id: roleId,
    })
  }

  const openEditRole = (role: any) => {
    setSelectedRole(role.id)
    setRoleName(role.name)
    setRoleColor(role.color || '#3B82F6')
    setRolePermissions(role.permissions || [])
    setIsCreateRoleOpen(true)
  }

  const togglePermission = (permission: string) => {
    setRolePermissions((prev) =>
      prev.includes(permission)
        ? prev.filter((p) => p !== permission)
        : [...prev, permission]
    )
  }

  const assignRoleToMember = (username: string, roleId: string) => {
    if (!selectedServerId) return
    wsClient.send({
      type: 'assign_role',
      server_id: selectedServerId,
      username,
      role_id: roleId,
    })
    // Refresh user roles
    loadUserRoles(selectedServerId, username)
  }

  const removeRoleFromMember = (username: string, roleId: string) => {
    if (!selectedServerId) return
    wsClient.send({
      type: 'remove_role_from_user',
      server_id: selectedServerId,
      username,
      role_id: roleId,
    })
    // Refresh user roles
    loadUserRoles(selectedServerId, username)
  }

  const loadUserRoles = (serverId: string, username: string) => {
    wsClient.send({
      type: 'get_user_roles',
      server_id: serverId,
      username,
    })
  }

  const loadServerMembers = (serverId: string) => {
    wsClient.send({
      type: 'get_server_members',
      server_id: serverId,
    })
  }

  // Ban management functions
  const loadServerBans = (serverId: string) => {
    wsClient.send({
      type: 'get_server_bans',
      server_id: serverId,
    })
  }

  const banMember = () => {
    if (!selectedServerId || !banUsername.trim()) return
    wsClient.send({
      type: 'ban_member',
      server_id: selectedServerId,
      username: banUsername.trim(),
      reason: banReason.trim() || undefined,
    })
    setBanUsername('')
    setBanReason('')
  }

  const unbanMember = (username: string) => {
    if (!selectedServerId) return
    wsClient.send({
      type: 'unban_member',
      server_id: selectedServerId,
      username,
    })
  }

  // Mention handling functions
  const extractMentions = (text: string): string[] => {
    const mentionRegex = /@(\w+)/g
    const mentions: string[] = []
    let match
    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[1])
    }
    return mentions
  }

  const handleDraftChange = (newDraft: string) => {
    setDraft(newDraft)
  }

  const insertMention = (username: string) => {
    const before = draft.slice(0, mentionStartPos)
    const after = draft.slice(mentionStartPos + mentionSearch.length + 1)
    setDraft(`${before}@${username} ${after}`)
    setShowMentionAutocomplete(false)
    setMentionSearch('')
  }

  const getFilteredMentionUsers = () => {
    if (!selectedContext || selectedContext.kind !== 'server') return []
    const members = serverMembers[selectedContext.serverId] || []
    if (!mentionSearch) return members.slice(0, 10)
    return members.filter((m: ServerMember) => 
      m.username.toLowerCase().startsWith(mentionSearch.toLowerCase())
    ).slice(0, 10)
  }

  const renderMessageContent = (content: string, messageContext?: string, messageContextId?: string | null): React.ReactNode => {
    // Determine which server's emojis to use based on message context
    let availableEmojis: CustomEmoji[] = []
    let serverId: string | null = null
    
    console.log('🎬 renderMessageContent START:', { content: content.substring(0, 50), messageContext, messageContextId, serverEmojisKeys: Object.keys(serverEmojis) })
    
    // Infer context if not provided but contextId exists
    let actualContext = messageContext
    if (!actualContext && messageContextId) {
      if (messageContextId.includes('/')) {
        actualContext = 'server'
        console.log('✨ Inferred context as "server" from context_id:', messageContextId)
      } else if (messageContextId.startsWith('dm_')) {
        actualContext = 'dm'
      }
    }
    
    if (actualContext === 'server' && messageContextId) {
      serverId = messageContextId.split('/')[0]
      availableEmojis = serverEmojis[serverId] || []
      console.log('renderMessageContent called:', { serverId, emojiCount: availableEmojis.length, hasEmojisInState: !!serverEmojis[serverId], contentPreview: content.substring(0, 50), actualEmojis: serverEmojis[serverId] })
    } else {
      console.log('⚠️ renderMessageContent: NO CONTEXT!', { messageContext, actualContext, messageContextId })
    }

    // Helper function to process mentions and custom emojis within text
    const processTextWithEmojisAndMentions = (text: string, keyPrefix: string): React.ReactNode[] => {
      const parts = text.split(/(@\w+|:\w+:)/g)
      console.log('🔍 processTextWithEmojisAndMentions:', { text: text.substring(0, 50), partsCount: parts.length, parts: parts.slice(0, 10), availableEmojiCount: availableEmojis.length })
      return parts.map((part, index) => {
        const key = `${keyPrefix}-${index}`
        
        // Handle mentions
        if (part.match(/^@\w+$/)) {
          const mentionedUser = part.slice(1)
          const isCurrentUser = mentionedUser === init?.username
          return (
            <span
              key={key}
              className={`font-semibold ${
                isCurrentUser 
                  ? 'bg-sky-500/30 text-sky-300 px-1 rounded' 
                  : 'text-sky-400'
              }`}
            >
              {part}
            </span>
          )
        }
        
        // Handle custom emojis
        if (part.match(/^:\w+:$/)) {
          const emojiName = part.slice(1, -1)
          const emoji = availableEmojis.find(e => e.name === emojiName)
          console.log('🎨 Emoji lookup:', { emojiName, found: !!emoji, availableNames: availableEmojis.map(e => e.name) })
          if (!emoji && availableEmojis.length > 0) {
            console.log('❌ Emoji not found:', { emojiName, availableCount: availableEmojis.length, available: availableEmojis.map(e => e.name) })
          }
          if (emoji) {
            console.log('✅ Rendering emoji image:', emojiName)
            return (
              <img
                key={key}
                src={emoji.image_data}
                alt={`:${emojiName}:`}
                title={`:${emojiName}:`}
                className="inline-block w-5 h-5 object-contain align-text-bottom mx-0.5"
              />
            )
          }
          return <span key={key}>{part}</span>
        }
        
        return <span key={key}>{part}</span>
      })
    }

    // Parse message formatting
    const tokens = parseMessageFormat(content)
    console.log('📝 After parseMessageFormat:', { tokenCount: tokens.length, availableEmojiCount: availableEmojis.length, tokens: tokens.map(t => ({ type: t.type, content: t.content?.substring(0, 20) })) })
    
    // Render formatted tokens with mention and emoji support
    return tokens.map((token, index) => {
      const key = `fmt-${index}`
      console.log('🔧 Processing token:', { index, type: token.type, content: token.content?.substring(0, 30), availableEmojiCountNow: availableEmojis.length })
      
      switch (token.type) {
        case 'bold':
          return (
            <strong key={key} className="font-bold">
              {processTextWithEmojisAndMentions(token.content, `${key}-content`)}
            </strong>
          )
        
        case 'italic':
          return (
            <em key={key} className="italic">
              {processTextWithEmojisAndMentions(token.content, `${key}-content`)}
            </em>
          )
        
        case 'boldItalic':
          return (
            <strong key={key} className="font-bold italic">
              {processTextWithEmojisAndMentions(token.content, `${key}-content`)}
            </strong>
          )
        
        case 'code':
          return (
            <code key={key} className="bg-slate-800/60 text-sky-300 px-1.5 py-0.5 rounded text-sm font-mono">
              {token.content}
            </code>
          )
        
        case 'codeBlock':
          return (
            <pre key={key} className="bg-slate-800/60 text-slate-200 p-3 rounded-lg overflow-x-auto my-1 border border-white/5">
              <code className="text-sm font-mono block">
                {token.language && (
                  <div className="text-xs text-slate-400 mb-1">{token.language}</div>
                )}
                {token.content}
              </code>
            </pre>
          )
        
        case 'strikethrough':
          return (
            <s key={key} className="line-through opacity-75">
              {processTextWithEmojisAndMentions(token.content, `${key}-content`)}
            </s>
          )
        
        case 'spoiler':
          return (
            <span
              key={key}
              className="bg-slate-800 text-slate-800 hover:text-slate-200 cursor-pointer px-1 rounded transition-colors select-none"
              title="Click to reveal spoiler"
              onClick={(e) => {
                const target = e.currentTarget
                target.classList.toggle('text-slate-800')
                target.classList.toggle('text-slate-200')
              }}
            >
              {processTextWithEmojisAndMentions(token.content, `${key}-content`)}
            </span>
          )
        
        case 'quote':
          return (
            <div key={key} className="border-l-2 border-slate-600 pl-3 py-0.5 italic text-slate-300 my-1">
              {processTextWithEmojisAndMentions(token.content, `${key}-content`)}
            </div>
          )
        
        case 'text':
        default:
          return (
            <span key={key}>
              {processTextWithEmojisAndMentions(token.content, `${key}-content`)}
            </span>
          )
      }
    })
  }

  const handleMentionKeyDown = (e: React.KeyboardEvent) => {
    if (!showMentionAutocomplete) return false
    
    const filteredUsers = getFilteredMentionUsers()
    if (filteredUsers.length === 0) return false
    
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedMentionIndex((prev) => 
        prev < filteredUsers.length - 1 ? prev + 1 : 0
      )
      return true
    }
    
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedMentionIndex((prev) => 
        prev > 0 ? prev - 1 : filteredUsers.length - 1
      )
      return true
    }
    
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      insertMention(filteredUsers[selectedMentionIndex].username)
      return true
    }
    
    if (e.key === 'Escape') {
      e.preventDefault()
      setShowMentionAutocomplete(false)
      return true
    }
    
    return false
  }

  // Message edit/delete/reaction functions
  const canEditMessage = (msg: WsChatMessage): boolean => {
    if (!init) return false
    // Users can edit their own messages
    if (msg.username === init.username) return true
    // Server admins can edit any message in their servers
    if (selectedServerId) {
      const server = init.servers?.find(s => s.id === selectedServerId)
      if (server?.owner === init.username) return true
      if (server?.permissions?.can_edit_messages) return true
    }
    return false
  }

  const canDeleteMessage = (msg: WsChatMessage): boolean => {
    if (!init) return false
    // Users can delete their own messages
    if (msg.username === init.username) return true
    // Server admins can delete any message in their servers
    if (selectedServerId) {
      const server = init.servers?.find(s => s.id === selectedServerId)
      if (server?.owner === init.username) return true
      if (server?.permissions?.can_delete_messages) return true
    }
    return false
  }

  const startEditMessage = (msg: WsChatMessage) => {
    if (!msg.id || !canEditMessage(msg)) return
    setEditingMessageId(msg.id)
    setEditDraft(msg.content)
  }

  const cancelEditMessage = () => {
    setEditingMessageId(null)
    setEditDraft('')
  }

  const saveEditMessage = () => {
    if (!editingMessageId || !editDraft.trim()) return
    wsClient.send({
      type: 'edit_message',
      message_id: editingMessageId,
      content: editDraft.trim(),
    })
    setEditingMessageId(null)
    setEditDraft('')
  }

  const confirmDeleteMessage = (msg: WsChatMessage) => {
    if (!msg.id || !canDeleteMessage(msg)) return
    setDeletingMessageId(msg.id)
  }

  const cancelDeleteMessage = () => {
    setDeletingMessageId(null)
  }

  const deleteMessage = () => {
    if (!deletingMessageId) return
    wsClient.send({
      type: 'delete_message',
      message_id: deletingMessageId,
    })
    setDeletingMessageId(null)
  }

  const toggleReactionPicker = (msgId: number | undefined) => {
    if (!msgId) return
    setReactionPickerMessageId(reactionPickerMessageId === msgId ? null : msgId)
  }

  const addReaction = (msgId: number | undefined, emoji: string, emojiType: 'standard' | 'custom' = 'standard') => {
    if (!msgId) return
    wsClient.send({
      type: 'add_reaction',
      message_id: msgId,
      emoji: emoji,
      emoji_type: emojiType,
    })
    setReactionPickerMessageId(null)
  }

  const removeReaction = (msgId: number | undefined, emoji: string) => {
    if (!msgId) return
    wsClient.send({
      type: 'remove_reaction',
      message_id: msgId,
      emoji: emoji,
    })
  }

  // Voice/Video control functions
  const joinVoiceChannel = async (serverId: string, channelId: string) => {
    if (!voiceChat) {
      pushToast({ kind: 'error', message: 'Voice chat not initialized' })
      return
    }
    try {
      const success = await voiceChat.joinVoiceChannel(serverId, channelId)
      if (!success) {
        pushToast({ kind: 'error', message: 'Failed to join voice channel. Please check microphone permissions.' })
      } else {
        pushToast({ kind: 'success', message: 'Joining voice channel...' })
      }
    } catch (error) {
      console.error('Error joining voice channel:', error)
      pushToast({ kind: 'error', message: 'Failed to join voice channel' })
    }
  }

  /* const startDirectCall = async (targetUsername: string) => {
    if (!voiceChat) return
    await voiceChat.startDirectCall(targetUsername)
  } */

  const leaveVoice = () => {
    if (!voiceChat) return
    voiceChat.leaveVoice()
  }

  const toggleVoiceMute = () => {
    if (!voiceChat) return
    voiceChat.toggleMute()
  }

  const toggleVoiceVideo = () => {
    if (!voiceChat) return
    voiceChat.toggleVideo()
  }

  const toggleVoiceScreenShare = () => {
    if (!voiceChat) return
    voiceChat.toggleScreenShare()
  }

  /* const updateVoiceDevices = () => {
    if (!voiceChat) return
    if (selectedMicrophone) voiceChat.setMicrophone(selectedMicrophone)
    if (selectedSpeaker) voiceChat.setSpeaker(selectedSpeaker)
    if (selectedCamera) voiceChat.setCamera(selectedCamera)
    voiceChat.setScreenShareSettings(screenShareResolution, screenShareFramerate)
  }

  const loadVoiceDevices = async () => {
    if (!voiceChat) return
    const audio = await voiceChat.getAudioDevices()
    const video = await voiceChat.getVideoDevices()
    const speakers = await voiceChat.getSpeakerDevices()
    setAudioDevices(audio)
    setVideoDevices(video)
    setSpeakerDevices(speakers)
  } */

  const testSMTP = () => {
    if (wsClient.readyState !== WebSocket.OPEN) return
    if (!testEmailAddress.trim()) {
      pushToast({ kind: 'error', message: 'Please enter a test email address' })
      return
    }
    setIsTestingSMTP(true)
    wsClient.send({ type: 'test_smtp', settings: adminSettings, test_email: testEmailAddress.trim() })
  }

  // Account settings handlers
  const handleUpdateProfile = () => {
    wsClient.updateProfile({
      type: 'update_profile',
      bio: profileBio,
      status_message: profileStatus,
    })
  }

  const handleChangeStatus = (newStatus: 'online' | 'away' | 'busy' | 'offline') => {
    setUserStatus(newStatus)
    // Update init object so the ring changes immediately
    if (init) {
      setInit({ ...init, user_status: newStatus })
    }
    wsClient.send({
      type: 'change_user_status',
      user_status: newStatus,
    })
  }

  const handleChangeEmail = () => {
    if (!newEmail.trim() || !emailPassword) return
    setEmailChangeStatus(null)
    wsClient.changeEmail({
      type: 'change_email',
      new_email: newEmail.trim(),
      password: emailPassword,
    })
  }

  const handleChangeUsername = () => {
    if (!newUsername.trim() || !usernamePassword) return
    setUsernameChangeStatus(null)
    wsClient.changeUsername({
      type: 'change_username',
      new_username: newUsername.trim(),
      password: usernamePassword,
    })
  }

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    const validTypes = ['image/png', 'image/jpeg', 'image/gif']
    if (!validTypes.includes(file.type)) {
      pushToast({ kind: 'error', message: 'Please upload a PNG, JPG, or GIF file' })
      return
    }

    // Validate file size (2MB max)
    if (file.size > 2 * 1024 * 1024) {
      pushToast({ kind: 'error', message: 'Image too large. Maximum size is 2MB.' })
      return
    }

    // Create preview
    const reader = new FileReader()
    reader.onloadend = () => {
      setAvatarPreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleUploadAvatar = () => {
    if (!avatarPreview) return
    wsClient.setAvatar({
      type: 'set_avatar',
      avatar_type: 'image',
      avatar_data: avatarPreview,
    })
    setAvatarPreview(null)
  }

  const handleSetEmojiAvatar = (emoji: string) => {
    wsClient.setAvatar({
      type: 'set_avatar',
      avatar_type: 'emoji',
      avatar: emoji,
    })
  }

  const handleSetup2FA = () => {
    wsClient.setup2FA()
  }

  const handleVerify2FASetup = () => {
    if (!twoFACode.trim()) return
    wsClient.verify2FASetup({
      type: 'verify_2fa_setup',
      code: twoFACode,
    })
  }

  const handleDisable2FA = () => {
    if (!disable2FAPassword || !disable2FACode) return
    wsClient.disable2FA({
      type: 'disable_2fa',
      password: disable2FAPassword,
      code: disable2FACode,
    })
  }

  const handleSetNotificationMode = () => {
    wsClient.setNotificationMode({
      type: 'set_notification_mode',
      notification_mode: notificationMode,
    })
  }

  const handleRequestPasswordReset = () => {
    if (!init?.username) {
      pushToast({ kind: 'error', message: 'User not found' })
      return
    }
    wsClient.requestPasswordReset({
      type: 'request_password_reset',
      identifier: init.username,
    })
    pushToast({ kind: 'success', message: 'Password reset link sent to your registered email' })
  }

  // Load admin settings when entering admin mode
  useEffect(() => {
    if (isAdminMode && init?.is_admin) {
      loadAdminSettings()
    }
  }, [isAdminMode, init?.is_admin])

  // Get selected server object
  const selectedServerObj = selectedServerId ? init?.servers?.find((s) => s.id === selectedServerId) : null

  // Check if current channel is a voice channel
  const isVoiceChannel = selectedContext.kind === 'server' && selectedServerObj
    ? selectedServerObj.channels?.find((ch) => ch.id === selectedContext.channelId)?.type === 'voice'
    : false

  const dismissAnnouncement = () => {
    setAnnouncement(null)
  }

  return (
    <div className="h-screen bg-slate-950 flex flex-col">
      {/* Announcement Banner */}
      {announcement && announcement.enabled && announcement.message && (
        <div className="relative border-b border-amber-500/30 bg-gradient-to-r from-amber-500/20 to-orange-500/20 px-4 py-2.5">
          <div className="flex items-center justify-between gap-4 mx-auto max-w-7xl">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-xl shrink-0">📢</span>
              <span className="text-sm text-amber-50 font-medium truncate">{announcement.message}</span>
            </div>
            <button
              type="button"
              onClick={dismissAnnouncement}
              className="shrink-0 text-amber-200 hover:text-amber-50 text-lg font-bold leading-none"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-1 min-h-0">
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
          <div className="flex-1 overflow-auto p-3 space-y-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
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
                    // Request server members
                    wsClient.getServerMembers({ type: 'get_server_members', server_id: server.id })
                  }
                }}
                className={`flex h-12 w-12 items-center justify-center rounded-2xl text-xl transition overflow-hidden ${
                  selectedServerId === server.id ? 'bg-sky-500 text-white' : 'bg-slate-800/50 text-slate-300 hover:bg-slate-700/50 hover:rounded-xl'
                }`}
                title={server.name}
              >
                {server.icon_type === 'image' && server.icon_data ? (
                  <img src={server.icon_data} alt={server.name} className="h-full w-full object-cover" />
                ) : (
                  <>{server.icon ?? '🏠'}</>
                )}
              </button>
            ))}
          </div>

          {/* Profile section at bottom */}
          <div className="border-t border-white/10 bg-slate-900 p-3">
            <button
              type="button"
              onClick={() => setIsUserMenuOpen(true)}
              className="rounded-2xl bg-slate-800/50 hover:bg-slate-700/50 hover:rounded-xl transition"
              title={init?.username ?? 'User'}
            >
              <AvatarWithStatus
                avatar={init?.avatar}
                avatar_type={init?.avatar_type}
                avatar_data={init?.avatar_data}
                user_status={init?.user_status}
                size="lg"
              />
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
              
              <div className="flex-1 overflow-auto p-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
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
                          <AvatarWithStatus
                            avatar={dm.avatar}
                            avatar_type={dm.avatar_type}
                            avatar_data={dm.avatar_data}
                            user_status={dm.user_status}
                            size="md"
                          />
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
                    onClick={() => setIsServerSettingsOpen(true)}
                    className="shrink-0 text-slate-400 hover:text-slate-200 text-lg"
                    title="Server Settings"
                  >
                    ⚙️
                  </button>
                </div>
              </div>

              {/* Channels list */}
              <div className="flex-1 overflow-auto p-2">
                {/* Render categories with their channels */}
                {(selectedServerObj.categories ?? [])
                  .sort((a, b) => a.position - b.position)
                  .map((category) => {
                    const categoryChannels = (selectedServerObj.channels ?? [])
                      .filter((ch) => ch.category_id === category.id)
                      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

                    return (
                      <div key={category.id} className="mb-3">
                        <div className="px-2 text-xs font-medium text-slate-400 uppercase mb-1">{category.name}</div>
                        <div className="space-y-1">
                          {categoryChannels.map((ch) => {
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
                                  if (ch.type === 'voice') {
                                    // Join voice channel instead of loading chat
                                    selectContext(next)
                                    joinVoiceChannel(selectedServerId, ch.id)
                                  } else {
                                    selectContext(next)
                                    requestHistoryFor(next)
                                  }
                                }}
                                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                                  isSelected ? 'bg-sky-500/15 text-sky-100' : 'text-slate-200 hover:bg-white/5'
                                }`}
                              >
                                <span className="text-slate-400">{ch.type === 'voice' ? '🔊' : '#'}</span>
                                <span className="text-sm font-medium">{ch.name}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}

                {/* Render channels without a category */}
                {(() => {
                  const uncategorizedChannels = (selectedServerObj.channels ?? [])
                    .filter((ch) => !ch.category_id)
                    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

                  if (uncategorizedChannels.length === 0) return null

                  return (
                    <div className="mb-3">
                      <div className="px-2 text-xs font-medium text-slate-400 uppercase mb-1">Uncategorized</div>
                      <div className="space-y-1">
                        {uncategorizedChannels.map((ch) => {
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
                                if (ch.type === 'voice') {
                                  selectContext(next)
                                  joinVoiceChannel(selectedServerId, ch.id)
                                } else {
                                  selectContext(next)
                                  requestHistoryFor(next)
                                }
                              }}
                              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                                isSelected ? 'bg-sky-500/15 text-sky-100' : 'text-slate-200 hover:bg-white/5'
                              }`}
                            >
                              <span className="text-slate-400">{ch.type === 'voice' ? '🔊' : '#'}</span>
                              <span className="text-sm font-medium">{ch.name}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}
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
                      : isVoiceChannel
                        ? 'Voice Channel'
                        : 'Channel'}
                </div>
                <div className="mt-1 text-lg font-semibold text-white">{selectedTitle}</div>
              </div>
              <div className="flex items-center gap-3">
                {selectedServerId && !isVoiceChannel && (
                  <button
                    type="button"
                    onClick={() => setIsMembersSidebarOpen(!isMembersSidebarOpen)}
                    className="rounded-xl border border-white/10 bg-slate-950/30 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-900/50 transition"
                    title={isMembersSidebarOpen ? 'Hide Members' : 'Show Members'}
                  >
                    {isMembersSidebarOpen ? '👥 Hide' : '👥 Show'}
                  </button>
                )}
                <div className="rounded-xl border border-white/10 bg-slate-950/30 px-2 py-1 text-[11px] text-slate-300">
                  {connectionStatus}
                </div>
                <img
                  src={adminSettings.server_logo || '/decentra-blurple.png'}
                  alt="Server Logo"
                  className="h-10 w-10 object-contain"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement
                    target.src = '/decentra-blurple.png'
                  }}
                />
              </div>
            </div>
          </header>

          {/* Voice Channel UI */}
          {isVoiceChannel ? (
            <section className="flex-1 flex flex-col overflow-hidden">
              {/* Voice controls panel */}
              {isInVoice && (
                <div className="border-b border-white/10 bg-slate-950/60 px-6 py-3">
                  <div className="flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={toggleVoiceMute}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                        isVoiceMuted
                          ? 'bg-rose-500/20 border border-rose-500/40 text-rose-300 hover:bg-rose-500/30'
                          : 'bg-slate-800/50 border border-white/10 text-slate-200 hover:bg-slate-700/50'
                      }`}
                      title={isVoiceMuted ? 'Unmute' : 'Mute'}
                    >
                      {isVoiceMuted ? '🔇' : '🎤'} {isVoiceMuted ? 'Muted' : 'Unmute'}
                    </button>
                    <button
                      type="button"
                      onClick={toggleVoiceVideo}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                        isVideoEnabled
                          ? 'bg-sky-500/20 border border-sky-500/40 text-sky-300 hover:bg-sky-500/30'
                          : 'bg-slate-800/50 border border-white/10 text-slate-200 hover:bg-slate-700/50'
                      }`}
                      title={isVideoEnabled ? 'Stop Video' : 'Start Video'}
                    >
                      📹 {isVideoEnabled ? 'Stop Video' : 'Video'}
                    </button>
                    <button
                      type="button"
                      onClick={toggleVoiceScreenShare}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                        isScreenSharing
                          ? 'bg-purple-500/20 border border-purple-500/40 text-purple-300 hover:bg-purple-500/30'
                          : 'bg-slate-800/50 border border-white/10 text-slate-200 hover:bg-slate-700/50'
                      }`}
                      title={isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
                    >
                      🖥️ {isScreenSharing ? 'Stop Share' : 'Screen Share'}
                    </button>
                    <button
                      type="button"
                      onClick={leaveVoice}
                      className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-600 transition"
                      title="Leave Voice"
                    >
                      ❌ Leave
                    </button>
                  </div>
                </div>
              )}

              {/* Participant grid */}
              <div className="flex-1 overflow-auto p-6">
                <div className="mx-auto max-w-7xl h-full">
                  {!isInVoice ? (
                    <div className="flex h-full items-center justify-center">
                      <div className="text-center">
                        <div className="text-6xl mb-4">🔊</div>
                        <h2 className="text-2xl font-semibold text-white mb-2">{selectedTitle}</h2>
                        <p className="text-slate-400 mb-6">Click join to enter this voice channel</p>
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedContext.kind === 'server' && selectedServerId) {
                              joinVoiceChannel(selectedServerId, selectedContext.channelId)
                            }
                          }}
                          className="rounded-xl bg-emerald-500 px-6 py-3 text-lg font-semibold text-white hover:bg-emerald-600 transition"
                        >
                          Join Voice Channel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={`grid gap-4 h-full ${
                      voiceParticipants.length === 1 ? 'grid-cols-1' :
                      voiceParticipants.length === 2 ? 'grid-cols-2' :
                      voiceParticipants.length <= 4 ? 'grid-cols-2' :
                      voiceParticipants.length <= 6 ? 'grid-cols-3' :
                      'grid-cols-4'
                    }`}>
                      {voiceParticipants.map((participantUsername) => {
                        const stream = remoteStreams.get(participantUsername)
                        const participant = serverMembers[selectedServerId ?? '']?.find(
                          (m) => m.username === participantUsername
                        )
                        const isCurrentUser = participantUsername === init?.username

                        return (
                          <div
                            key={participantUsername}
                            className="relative rounded-2xl border border-white/10 bg-slate-900/40 overflow-hidden flex items-center justify-center min-h-[200px]"
                          >
                            {stream ? (
                              <video
                                ref={(video) => {
                                  if (video && stream) {
                                    video.srcObject = stream
                                    video.play().catch(console.error)
                                  }
                                }}
                                autoPlay
                                playsInline
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="flex flex-col items-center justify-center p-8">
                                <AvatarWithStatus
                                  avatar={participant?.avatar ?? init?.avatar}
                                  avatar_type={participant?.avatar_type ?? init?.avatar_type}
                                  avatar_data={participant?.avatar_data ?? init?.avatar_data}
                                  user_status={participant?.user_status}
                                  size="xl"
                                />
                                <div className="text-xl font-semibold text-white mt-4">{participantUsername}</div>
                              </div>
                            )}
                            {/* Participant name overlay */}
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                              <div className="flex items-center justify-between">
                                <span className="text-white font-semibold text-sm">
                                  {participantUsername} {isCurrentUser && '(You)'}
                                </span>
                                <div className="flex items-center gap-1">
                                  {isCurrentUser && isVoiceMuted && <span className="text-rose-400">🔇</span>}
                                  {isCurrentUser && isVideoEnabled && <span className="text-sky-400">📹</span>}
                                  {isCurrentUser && isScreenSharing && <span className="text-purple-400">🖥️</span>}
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </section>
          ) : (
            <>
              {/* Regular chat UI */}
              <section className="flex-1 overflow-auto px-6 py-5">
            <div className="mx-auto max-w-5xl">
              <div className="rounded-2xl border border-white/10 bg-slate-900/20 p-4">
                {messages.length === 0 ? (
                  <div className="text-sm text-slate-400">No messages yet.</div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {messages.map((m: WsChatMessage, idx: number) => (
                      <div key={(m.id ?? idx).toString()} id={m.id ? `message-${m.id}` : undefined} className="group flex gap-3 transition rounded-lg px-2 py-1">
                        <div className="mt-0.5 shrink-0">
                          <AvatarWithStatus
                            avatar={m.avatar}
                            avatar_type={m.avatar_type}
                            avatar_data={m.avatar_data}
                            user_status={m.user_status}
                            size="md"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <div 
                              className="font-semibold text-slate-100" 
                              style={getUsernameStyle(m)}
                            >
                              {m.username}
                            </div>
                            <div className="text-xs text-slate-500">
                              {new Date(m.timestamp).toLocaleString()}
                              {m.edited_at && <span className="ml-1.5 text-slate-600">(edited)</span>}
                            </div>
                            {/* Action buttons - show on hover */}
                            <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                              {m.id && (
                                <>
                                  {/* Reply button */}
                                  <button
                                    type="button"
                                    onClick={() => setReplyingTo(m)}
                                    className="text-slate-400 hover:text-sky-400 text-sm px-1.5 py-0.5 rounded"
                                    title="Reply"
                                  >
                                    ↩️
                                  </button>
                                  {/* Reaction button */}
                                  <button
                                    type="button"
                                    onClick={() => toggleReactionPicker(m.id)}
                                    className="text-slate-400 hover:text-slate-200 text-sm px-1.5 py-0.5 rounded"
                                    title="Add reaction"
                                  >
                                    😊
                                  </button>
                                  {/* Edit button */}
                                  {canEditMessage(m) && (
                                    <button
                                      type="button"
                                      onClick={() => startEditMessage(m)}
                                      className="text-slate-400 hover:text-sky-400 text-xs px-1.5 py-0.5 rounded"
                                      title="Edit message"
                                    >
                                      ✏️
                                    </button>
                                  )}
                                  {/* Delete button */}
                                  {canDeleteMessage(m) && (
                                    <button
                                      type="button"
                                      onClick={() => confirmDeleteMessage(m)}
                                      className="text-slate-400 hover:text-rose-400 text-xs px-1.5 py-0.5 rounded"
                                      title="Delete message"
                                    >
                                      🗑️
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                          
                          {/* Reply reference - show if this message is a reply */}
                          {m.reply_data && (
                            <div className="mt-1 mb-1 pl-3 border-l-2 border-slate-600 text-xs text-slate-400">
                              <div className="flex items-center gap-1">
                                <span>↩️</span>
                                <span className="font-medium text-slate-300">{m.reply_data.username}</span>
                                <span>•</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    // Jump to message functionality
                                    if (!m.reply_data) return
                                    const element = document.getElementById(`message-${m.reply_data.id}`)
                                    if (element) {
                                      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                      element.classList.add('bg-sky-500/10')
                                      setTimeout(() => element.classList.remove('bg-sky-500/10'), 2000)
                                    }
                                  }}
                                  className="hover:underline truncate max-w-[400px]"
                                >
                                  {m.reply_data.deleted ? '[Message deleted]' : renderMessageContent(m.reply_data.content, m.context, m.context_id)}
                                </button>
                              </div>
                            </div>
                          )}
                          
                          {/* Edit mode */}
                          {editingMessageId === m.id ? (
                            <div className="mt-2">
                              <textarea
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                className="w-full rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40 resize-none"
                                rows={3}
                                autoFocus
                              />
                              <div className="mt-2 flex gap-2">
                                <button
                                  type="button"
                                  onClick={saveEditMessage}
                                  disabled={!editDraft.trim()}
                                  className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditMessage}
                                  className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-600"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {/* Normal message display */}
                              {m.content && (
                                <>
                                  <div className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{linkifyText(m.content, (content) => renderMessageContent(content, m.context, m.context_id))}</div>
                                  <MessageEmbeds content={m.content} />
                                </>
                              )}
                            </>
                          )}
                          
                          {m.attachments && m.attachments.length > 0 && (
                            <div className="mt-2 flex flex-col gap-1.5">
                              {m.attachments.map((att: Attachment) => (
                                <a
                                  key={att.attachment_id}
                                  href={`/api/download-attachment/${att.attachment_id}`}
                                  download={att.filename}
                                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/40 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800/40 hover:text-white transition w-fit"
                                >
                                  <span>📎</span>
                                  <span className="font-medium">{att.filename}</span>
                                  <span className="text-xs text-slate-500">({(att.file_size / 1024).toFixed(1)}KB)</span>
                                </a>
                              ))}
                            </div>
                          )}
                          
                          {/* Reactions display */}
                          {m.reactions && Array.isArray(m.reactions) && m.reactions.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {(() => {
                                // Group reactions by emoji
                                const reactionGroups = m.reactions.reduce((acc: any, reaction: Reaction) => {
                                  if (!acc[reaction.emoji]) {
                                    acc[reaction.emoji] = {
                                      emoji: reaction.emoji,
                                      emoji_type: reaction.emoji_type,
                                      usernames: []
                                    }
                                  }
                                  acc[reaction.emoji].usernames.push(reaction.username)
                                  return acc
                                }, {})
                                
                                return Object.values(reactionGroups).map((group: any, rIdx: number) => {
                                  const userReacted = init?.username && group.usernames.includes(init.username)
                                  return (
                                    <button
                                      key={rIdx}
                                      type="button"
                                      onClick={() => userReacted ? removeReaction(m.id, group.emoji) : addReaction(m.id, group.emoji, group.emoji_type)}
                                      className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs border transition ${
                                        userReacted
                                          ? 'bg-sky-500/20 border-sky-500/40 text-sky-300'
                                          : 'bg-slate-900/40 border-white/10 text-slate-300 hover:bg-slate-800/40'
                                      }`}
                                      title={group.usernames.join(', ')}
                                    >
                                      <span>{group.emoji}</span>
                                      <span className="font-semibold">{group.usernames.length}</span>
                                    </button>
                                  )
                                })
                              })()}
                            </div>
                          )}
                          
                          {/* Reaction picker popup */}
                          {reactionPickerMessageId === m.id && (
                            <div className="mt-2 relative">
                              <div className="absolute left-0 top-0 z-10 rounded-lg border border-white/10 bg-slate-900 p-3 shadow-xl max-w-xs">
                                <div className="mb-2 text-xs font-semibold text-slate-400">Add Reaction</div>
                                <div className="grid grid-cols-8 gap-1 max-h-32 overflow-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                                  {REACTION_EMOJIS.map(emoji => (
                                    <button
                                      key={emoji}
                                      type="button"
                                      onClick={() => addReaction(m.id, emoji)}
                                      className="text-lg hover:bg-slate-800 rounded p-1 transition"
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setReactionPickerMessageId(null)}
                                  className="mt-2 text-xs text-slate-400 hover:text-slate-200"
                                >
                                  Close
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className="border-t border-white/10 bg-slate-950/60 px-6 py-4">
            <div className="mx-auto max-w-5xl">
              {/* Selected files preview */}
              {selectedFiles.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {selectedFiles.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/40 px-3 py-2 text-sm"
                    >
                      <span className="text-slate-300 truncate max-w-[200px]">{file.name}</span>
                      <span className="text-xs text-slate-500">({(file.size / 1024).toFixed(1)}KB)</span>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="ml-1 text-slate-400 hover:text-rose-400"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Mention autocomplete */}
              {showMentionAutocomplete && selectedContext.kind === 'server' && (
                <div className="mb-2 rounded-xl border border-white/10 bg-slate-900 p-2 shadow-xl max-h-48 overflow-y-auto">
                  <div className="text-xs font-semibold text-slate-400 mb-1 px-2">Mention User</div>
                  {getFilteredMentionUsers().length > 0 ? (
                    getFilteredMentionUsers().map((member, index) => (
                      <button
                        key={member.username}
                        type="button"
                        onClick={() => insertMention(member.username)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition ${
                          index === selectedMentionIndex ? 'bg-sky-500/20' : 'hover:bg-white/5'
                        }`}
                      >
                        <AvatarWithStatus
                          avatar={member.avatar}
                          avatar_type={member.avatar_type}
                          avatar_data={member.avatar_data}
                          user_status={member.user_status}
                          size="sm"
                        />
                        <span className="text-sm text-slate-200">{member.username}</span>
                      </button>
                    ))
                  ) : (
                    <div className="text-xs text-slate-500 px-2 py-1">No matching users</div>
                  )}
                </div>
              )}
              
              {/* Replying to indicator */}
              {replyingTo && (
                <div className="mb-2 rounded-xl border border-white/10 bg-slate-900/40 p-3 flex items-start justify-between">
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-slate-400 mb-1">Replying to {replyingTo.username}</div>
                    <div className="text-sm text-slate-300 truncate">{renderMessageContent(replyingTo.content, replyingTo.context, replyingTo.context_id)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplyingTo(null)}
                    className="ml-2 text-slate-400 hover:text-slate-200 text-lg"
                    title="Cancel reply"
                  >
                    ×
                  </button>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (canSend && !isUploading) send()
                }}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`flex gap-3 rounded-2xl transition ${isDragging ? 'ring-2 ring-sky-500/40 bg-sky-500/10' : ''}`}
              >
                <input
                  value={draft}
                  onChange={(e) => handleDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (handleMentionKeyDown(e)) return
                  }}
                  placeholder={isDragging ? "Drop files here..." : selectedFiles.length > 0 ? "Add a message (optional)…" : "Type a message…"}
                  disabled={isUploading}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40 disabled:opacity-50"
                />
                
                {/* Emoji picker button */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsEmojiPickerOpen(!isEmojiPickerOpen)}
                    disabled={isUploading}
                    className="shrink-0 rounded-2xl border border-white/10 bg-slate-900/40 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-800/40 disabled:cursor-not-allowed disabled:opacity-50"
                    title="Insert emoji"
                  >
                    😊
                  </button>
                  
                  {isEmojiPickerOpen && (
                    <div className="absolute bottom-full right-0 mb-2 w-64 rounded-xl border border-white/10 bg-slate-900 p-3 shadow-xl">
                      <div className="text-xs font-semibold text-slate-300 mb-2">Basic Emojis</div>
                      <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                        {['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😗', 
                          '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳', '😏', '😒',
                          '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👏', '🙌', '👐',
                          '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖',
                          '🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉', '⭐', '🌟', '✨', '💫', '🔥', '💥', '⚡', '💯'].map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => insertEmoji(emoji)}
                            className="text-xl hover:bg-white/10 rounded p-1 transition"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                      {selectedContext.kind === 'server' && serverEmojis[selectedContext.serverId]?.length > 0 && (
                        <>
                          <div className="text-xs font-semibold text-slate-300 mt-3 mb-2">Server Emojis</div>
                          <div className="grid grid-cols-6 gap-2 max-h-32 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                            {serverEmojis[selectedContext.serverId].map((emoji: any) => (
                              <button
                                key={emoji.emoji_id}
                                type="button"
                                onClick={() => insertEmoji(`:${emoji.name}:`)}
                                className="hover:bg-white/10 rounded p-1 transition"
                                title={emoji.name}
                              >
                                <img src={emoji.image_data} alt={emoji.name} className="w-6 h-6 object-contain" />
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
                
                {/* File upload button */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={(e) => handleFileSelect(e.target.files)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading || adminSettings.allow_file_attachments === false}
                  className="shrink-0 rounded-2xl border border-white/10 bg-slate-900/40 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-800/40 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Attach file"
                >
                  📎
                </button>
                
                <button
                  type="submit"
                  disabled={!canSend || isUploading}
                  className="shrink-0 rounded-2xl bg-sky-500 px-5 py-3 text-sm font-semibold text-slate-950 shadow hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isUploading ? 'Uploading...' : 'Send'}
                </button>
              </form>
            </div>
          </div>
          </>
          )}
        </main>

        {/* Members Sidebar - shows when in a server */}
        {selectedServerId && isMembersSidebarOpen && (
          <aside className="w-[240px] shrink-0 border-l border-white/10 bg-slate-900/30">
            <div className="flex h-full flex-col">
              <div className="border-b border-white/10 px-4 py-3">
                <div className="text-sm font-semibold text-white">Members</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {serverMembers[selectedServerId]?.length ?? 0} online
                </div>
              </div>
              
              <div className="flex-1 overflow-auto p-2">
                {(!serverMembers[selectedServerId] || serverMembers[selectedServerId].length === 0) ? (
                  <div className="px-3 py-2 text-sm text-slate-400">No members</div>
                ) : (
                  <div className="space-y-1">
                    {/* Organize members by role */}
                    {organizeMembersByRole(selectedServerId, serverMembers[selectedServerId]).map((roleGroup, idx) => (
                      <div key={roleGroup.roleName}>
                        {/* Role section header */}
                        {idx > 0 && <div className="h-2"></div>}
                        <div 
                          className="px-2 py-1 text-xs font-semibold uppercase tracking-wide"
                          style={{ color: roleGroup.role?.color || '#99AAB5' }}
                        >
                          {roleGroup.roleName} — {roleGroup.members.length}
                        </div>
                        
                        {/* Members in this role */}
                        {roleGroup.members.map((member) => (
                          <div
                            key={member.username}
                            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5 transition"
                          >
                            <AvatarWithStatus
                              avatar={member.avatar}
                              avatar_type={member.avatar_type}
                              avatar_data={member.avatar_data}
                              user_status={member.user_status}
                              size="md"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span 
                                  className="text-sm font-medium truncate"
                                  style={{ color: getMemberRoleColor(selectedServerId, member.username) || '#e2e8f0' }}
                                >
                                  {member.username}
                                </span>
                                {member.is_owner && <span className="text-xs" title="Server Owner">👑</span>}
                              </div>
                              {member.status_message && (
                                <div className="text-xs text-slate-400 truncate">{member.status_message}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        )}

        {/* User menu modal - centered overlay */}
        {isUserMenuOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setIsUserMenuOpen(false)}>
            <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-white/10 bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-6 py-4">
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

              <div className="overflow-y-auto p-6">
                {!isAdminMode ? (
                  <div className="space-y-6">
                    <div className="text-center">
                      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-slate-800 text-4xl overflow-hidden">
                        {init?.avatar_type === 'image' && init?.avatar_data ? (
                          <img src={init.avatar_data} alt="Avatar" className="h-full w-full object-cover" />
                        ) : (
                          <>{init?.avatar ?? '👤'}</>
                        )}
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
                      <button
                        type="button"
                        onClick={() => {
                          setIsUserMenuOpen(false)
                          setIsAccountSettingsOpen(true)
                        }}
                        className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-left text-sm text-slate-200 hover:bg-white/5"
                      >
                        👤 Account Settings
                      </button>
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
                            onClick={() => contextServerId && loadInviteUsage(contextServerId)}
                            disabled={wsClient.readyState !== WebSocket.OPEN || isLoadingInviteUsage || !contextServerId}
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
                  <div className="space-y-4 overflow-y-auto max-h-[calc(100vh-200px)]">
                    <div className="flex items-center justify-between">
                      <div className="text-lg font-semibold text-white">Admin Configuration</div>
                      <button
                        type="button"
                        onClick={saveAdminSettings}
                        disabled={isSavingSettings || wsClient.readyState !== WebSocket.OPEN}
                        className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
                      >
                        {isSavingSettings ? 'Saving...' : 'Save Settings'}
                      </button>
                    </div>

                    {/* General Settings */}
                    <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                      <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">General</h3>
                      <div className="space-y-4">
                        <label className="block">
                          <div className="mb-1 text-sm text-slate-200">Server Name</div>
                          <input
                            type="text"
                            value={adminSettings.server_name || ''}
                            onChange={(e) => setAdminSettings({ ...adminSettings, server_name: e.target.value })}
                            className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                            placeholder="Decentra"
                          />
                        </label>

                        <label className="block">
                          <div className="mb-1 text-sm text-slate-200">Server Logo URL</div>
                          <div className="text-xs text-slate-400 mb-2">URL to an image or use data:image/png;base64,... for uploaded images</div>
                          <input
                            type="text"
                            value={adminSettings.server_logo || ''}
                            onChange={(e) => setAdminSettings({ ...adminSettings, server_logo: e.target.value })}
                            className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                            placeholder="/decentra-blurple.png"
                          />
                          {adminSettings.server_logo && (
                            <div className="mt-2">
                              <div className="text-xs text-slate-400 mb-1">Preview:</div>
                              <img
                                src={adminSettings.server_logo}
                                alt="Logo preview"
                                className="h-16 w-16 rounded-lg border border-white/10 bg-slate-950/30 object-contain p-2"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement
                                  target.src = '/decentra-blurple.png'
                                }}
                              />
                            </div>
                          )}
                        </label>

                        <label className="block">
                          <div className="mb-1 text-sm text-slate-200">Maximum Message Length</div>
                          <input
                            type="number"
                            min="100"
                            max="10000"
                            value={adminSettings.max_message_length || 2000}
                            onChange={(e) => setAdminSettings({ ...adminSettings, max_message_length: parseInt(e.target.value) || 2000 })}
                            className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                          />
                        </label>

                        <label className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={adminSettings.allow_new_registrations !== false}
                            onChange={(e) => setAdminSettings({ ...adminSettings, allow_new_registrations: e.target.checked })}
                            className="h-5 w-5 rounded border-white/10 bg-slate-950/40"
                          />
                          <div className="text-sm text-slate-200">Allow New Registrations</div>
                        </label>

                        <label className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={adminSettings.require_invite_code === true}
                            onChange={(e) => setAdminSettings({ ...adminSettings, require_invite_code: e.target.checked })}
                            className="h-5 w-5 rounded border-white/10 bg-slate-950/40"
                          />
                          <div className="text-sm text-slate-200">Require Invite Code for Registration</div>
                        </label>

                        <label className="block">
                          <div className="mb-1 text-sm text-slate-200">Maximum File Upload Size (MB)</div>
                          <input
                            type="number"
                            min="1"
                            max="100"
                            value={adminSettings.max_attachment_size_mb || 10}
                            onChange={(e) => setAdminSettings({ ...adminSettings, max_attachment_size_mb: parseInt(e.target.value) || 10 })}
                            className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                          />
                        </label>

                        <label className="block">
                          <div className="mb-1 text-sm text-slate-200">Max Servers Per User <span className="text-xs text-slate-400">(0 = unlimited)</span></div>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={adminSettings.max_servers_per_user || 0}
                            onChange={(e) => setAdminSettings({ ...adminSettings, max_servers_per_user: parseInt(e.target.value) || 0 })}
                            className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                          />
                        </label>

                        <label className="block">
                          <div className="mb-1 text-sm text-slate-200">Max Channels Per Server <span className="text-xs text-slate-400">(0 = unlimited)</span></div>
                          <input
                            type="number"
                            min="0"
                            max="500"
                            value={adminSettings.max_channels_per_server || 0}
                            onChange={(e) => setAdminSettings({ ...adminSettings, max_channels_per_server: parseInt(e.target.value) || 0 })}
                            className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                          />
                        </label>
                      </div>
                    </section>

                    {/* Email/SMTP Settings */}
                    <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                      <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">Email & SMTP Settings</h3>
                      <div className="space-y-4">
                        <label className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={adminSettings.require_email_verification === true}
                            onChange={(e) => setAdminSettings({ ...adminSettings, require_email_verification: e.target.checked })}
                            className="h-5 w-5 rounded border-white/10 bg-slate-950/40"
                          />
                          <div className="text-sm text-slate-200">Require Email Verification</div>
                        </label>

                        <label className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={adminSettings.smtp_enabled === true}
                            onChange={(e) => setAdminSettings({ ...adminSettings, smtp_enabled: e.target.checked })}
                            className="h-5 w-5 rounded border-white/10 bg-slate-950/40"
                          />
                          <div className="text-sm text-slate-200">Enable Email Notifications</div>
                        </label>

                        <label className="block">
                          <div className="mb-1 text-sm text-slate-200">SMTP Host</div>
                          <input
                            type="text"
                            value={adminSettings.smtp_host || ''}
                            onChange={(e) => setAdminSettings({ ...adminSettings, smtp_host: e.target.value })}
                            className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                            placeholder="smtp.example.com"
                          />
                        </label>

                        <label className="block">
                          <div className="mb-1 text-sm text-slate-200">SMTP Port</div>
                          <input
                            type="number"
                            min="1"
                            max="65535"
                            value={adminSettings.smtp_port || 587}
                            onChange={(e) => setAdminSettings({ ...adminSettings, smtp_port: parseInt(e.target.value) || 587 })}
                            className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                          />
                        </label>

                        <label className="block">
                          <div className="mb-1 text-sm text-slate-200">SMTP Username</div>
                          <input
                            type="text"
                            value={adminSettings.smtp_username || ''}
                            onChange={(e) => setAdminSettings({ ...adminSettings, smtp_username: e.target.value })}
                            className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                            placeholder="user@example.com"
                          />
                        </label>

                        <label className="block">
                          <div className="mb-1 text-sm text-slate-200">SMTP Password</div>
                          <input
                            type="password"
                            value={adminSettings.smtp_password || ''}
                            onChange={(e) => setAdminSettings({ ...adminSettings, smtp_password: e.target.value })}
                            className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                            placeholder="••••••••"
                          />
                        </label>

                        <label className="block">
                          <div className="mb-1 text-sm text-slate-200">From Email Address</div>
                          <input
                            type="email"
                            value={adminSettings.smtp_from_email || ''}
                            onChange={(e) => setAdminSettings({ ...adminSettings, smtp_from_email: e.target.value })}
                            className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                            placeholder="noreply@example.com"
                          />
                        </label>

                        <label className="block">
                          <div className="mb-1 text-sm text-slate-200">From Name</div>
                          <input
                            type="text"
                            value={adminSettings.smtp_from_name || ''}
                            onChange={(e) => setAdminSettings({ ...adminSettings, smtp_from_name: e.target.value })}
                            className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                            placeholder="Decentra"
                          />
                        </label>

                        <label className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={adminSettings.smtp_use_tls !== false}
                            onChange={(e) => setAdminSettings({ ...adminSettings, smtp_use_tls: e.target.checked })}
                            className="h-5 w-5 rounded border-white/10 bg-slate-950/40"
                          />
                          <div className="text-sm text-slate-200">Use TLS/STARTTLS</div>
                        </label>

                        <label className="block">
                          <div className="mb-1 text-sm text-slate-200">Test Email Address</div>
                          <input
                            type="email"
                            value={testEmailAddress}
                            onChange={(e) => setTestEmailAddress(e.target.value)}
                            placeholder="test@example.com"
                            className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                          />
                          <div className="mt-1 text-xs text-slate-400">Enter an email address to send a test email to</div>
                        </label>

                        <div>
                          <button
                            type="button"
                            onClick={testSMTP}
                            disabled={isTestingSMTP || wsClient.readyState !== WebSocket.OPEN}
                            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-60"
                          >
                            {isTestingSMTP ? 'Testing...' : 'Test SMTP Connection'}
                          </button>
                        </div>
                      </div>
                    </section>

                    {/* Announcements */}
                    <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                      <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">Announcements</h3>
                      <div className="space-y-4">
                        <label className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={adminSettings.announcement_enabled === true}
                            onChange={(e) => setAdminSettings({ ...adminSettings, announcement_enabled: e.target.checked })}
                            className="h-5 w-5 rounded border-white/10 bg-slate-950/40"
                          />
                          <div className="text-sm text-slate-200">Enable Announcement Banner</div>
                        </label>

                        <label className="block">
                          <div className="mb-1 text-sm text-slate-200">Announcement Message</div>
                          <input
                            type="text"
                            maxLength={500}
                            value={adminSettings.announcement_message || ''}
                            onChange={(e) => setAdminSettings({ ...adminSettings, announcement_message: e.target.value })}
                            className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                            placeholder="Enter announcement message"
                          />
                        </label>

                        <label className="block">
                          <div className="mb-1 text-sm text-slate-200">Display Duration (minutes)</div>
                          <input
                            type="number"
                            min="1"
                            max="10080"
                            value={adminSettings.announcement_duration_minutes || 60}
                            onChange={(e) => setAdminSettings({ ...adminSettings, announcement_duration_minutes: parseInt(e.target.value) || 60 })}
                            className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                          />
                        </label>
                      </div>
                    </section>

                    {/* License Management */}
                    <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                      <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">License Management</h3>
                      <LicensePanel />
                    </section>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Account Settings Modal */}
        {isAccountSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-auto p-4" onClick={() => setIsAccountSettingsOpen(false)}>
            <div className="w-full max-w-3xl max-h-[90vh] overflow-auto rounded-2xl border border-white/10 bg-slate-900 shadow-2xl my-8" onClick={(e) => e.stopPropagation()}>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-slate-900 px-6 py-4">
                <h2 className="text-xl font-semibold text-white">Account Settings</h2>
                <button
                  type="button"
                  onClick={() => setIsAccountSettingsOpen(false)}
                  className="text-2xl text-slate-400 hover:text-slate-200"
                >
                  ×
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Account Section */}
                <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                  <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">Account</h3>
                  <div className="space-y-4">
                    {/* Current Username */}
                    <div>
                      <div className="mb-1 text-sm text-slate-200">Username</div>
                      <div className="text-sm text-slate-400 mb-2">{init?.username}</div>
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          placeholder="New username"
                          className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                        />
                        <input
                          type="password"
                          value={usernamePassword}
                          onChange={(e) => setUsernamePassword(e.target.value)}
                          placeholder="Confirm with password"
                          className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                        />
                        <button
                          type="button"
                          onClick={handleChangeUsername}
                          disabled={!newUsername.trim() || !usernamePassword}
                          className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Change Username
                        </button>
                        {usernameChangeStatus && (
                          <div className={`text-sm ${usernameChangeStatus.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                            {usernameChangeStatus.message}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Divider */}
                    <div className="border-t border-white/5" />

                    {/* Current Email */}
                    <div>
                      <div className="mb-1 text-sm text-slate-200">Email</div>
                      <div className="text-sm text-slate-400 mb-2">{init?.email || 'No email set'}</div>
                      <div className="space-y-2">
                        <input
                          type="email"
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          placeholder="New email address"
                          className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                        />
                        <input
                          type="password"
                          value={emailPassword}
                          onChange={(e) => setEmailPassword(e.target.value)}
                          placeholder="Confirm with password"
                          className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                        />
                        <button
                          type="button"
                          onClick={handleChangeEmail}
                          disabled={!newEmail.trim() || !emailPassword}
                          className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Change Email
                        </button>
                        {emailChangeStatus && (
                          <div className={`text-sm ${emailChangeStatus.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                            {emailChangeStatus.message}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                {/* Profile Section */}
                <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                  <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">Profile</h3>
                  <div className="space-y-4">
                    <label className="block">
                      <div className="mb-1 text-sm text-slate-200">Bio</div>
                      <textarea
                        value={profileBio}
                        onChange={(e) => setProfileBio(e.target.value)}
                        maxLength={500}
                        rows={3}
                        className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                        placeholder="Tell others about yourself..."
                      />
                      <div className="mt-1 text-xs text-slate-400">{profileBio.length}/500 characters</div>
                    </label>

                    <label className="block">
                      <div className="mb-1 text-sm text-slate-200">Status Message</div>
                      <input
                        type="text"
                        value={profileStatus}
                        onChange={(e) => setProfileStatus(e.target.value)}
                        maxLength={100}
                        className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                        placeholder="What's your status?"
                      />
                      <div className="mt-1 text-xs text-slate-400">{profileStatus.length}/100 characters</div>
                    </label>

                    <div>
                      <div className="mb-2 text-sm text-slate-200">User Status</div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleChangeStatus('online')}
                          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                            userStatus === 'online'
                              ? 'border-green-500/50 bg-green-500/20 text-green-300'
                              : 'border-white/10 bg-slate-950/40 text-slate-300 hover:bg-white/5'
                          }`}
                        >
                          <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
                          Online
                        </button>
                        <button
                          type="button"
                          onClick={() => handleChangeStatus('away')}
                          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                            userStatus === 'away'
                              ? 'border-yellow-500/50 bg-yellow-500/20 text-yellow-300'
                              : 'border-white/10 bg-slate-950/40 text-slate-300 hover:bg-white/5'
                          }`}
                        >
                          <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
                          Away
                        </button>
                        <button
                          type="button"
                          onClick={() => handleChangeStatus('busy')}
                          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                            userStatus === 'busy'
                              ? 'border-red-500/50 bg-red-500/20 text-red-300'
                              : 'border-white/10 bg-slate-950/40 text-slate-300 hover:bg-white/5'
                          }`}
                        >
                          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                          Busy
                        </button>
                        <button
                          type="button"
                          onClick={() => handleChangeStatus('offline')}
                          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                            userStatus === 'offline'
                              ? 'border-gray-500/50 bg-gray-500/20 text-gray-300'
                              : 'border-white/10 bg-slate-950/40 text-slate-300 hover:bg-white/5'
                          }`}
                        >
                          <span className="h-2.5 w-2.5 rounded-full bg-gray-500" />
                          Offline
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleUpdateProfile}
                      className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
                    >
                      Update Profile
                    </button>
                  </div>
                </section>

                {/* Avatar Section */}
                <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                  <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">Avatar</h3>
                  <div className="space-y-4">
                    <div className="flex items-center gap-4">
                      <AvatarWithStatus
                        avatar={init?.avatar}
                        avatar_type={init?.avatar_type}
                        avatar_data={init?.avatar_data}
                        user_status={init?.user_status}
                        size="xl"
                      />
                      <div className="flex-1">
                        <div className="text-sm text-slate-200 mb-2">Current Avatar</div>
                        <div className="text-xs text-slate-400">
                          Type: {init?.avatar_type || 'emoji'}
                        </div>
                        <div className="text-xs text-slate-400">
                          Status: {init?.user_status}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-sm text-slate-200">Upload Image (PNG, JPG, or GIF, max 2MB)</div>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/gif"
                        onChange={handleAvatarFileChange}
                        className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 file:mr-4 file:rounded-lg file:border-0 file:bg-sky-500/20 file:px-3 file:py-1 file:text-sm file:text-sky-200 hover:file:bg-sky-500/30"
                      />
                      {avatarPreview && (
                        <div className="mt-3 flex items-center gap-4">
                          <img src={avatarPreview} alt="Preview" className="h-20 w-20 rounded-full object-cover border border-white/10" />
                          <button
                            type="button"
                            onClick={handleUploadAvatar}
                            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
                          >
                            Upload Avatar
                          </button>
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="mb-2 text-sm text-slate-200">Or choose an emoji</div>
                      <div className="flex flex-wrap gap-2">
                        {['👤', '😀', '😎', '🤖', '👾', '🐱', '🐶', '🦊', '🐼', '🦁', '🐯', '🐻'].map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => handleSetEmojiAvatar(emoji)}
                            className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-slate-950/40 text-2xl hover:bg-white/5"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                {/* 2FA Section */}
                <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                  <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">Two-Factor Authentication</h3>
                  {!twoFASetup ? (
                    <div className="space-y-4">
                      <div className="text-sm text-slate-200">
                        Add an extra layer of security to your account.
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleSetup2FA}
                          className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
                        >
                          Enable 2FA
                        </button>
                      </div>
                      
                      {/* Disable 2FA Section */}
                      <div className="border-t border-white/10 pt-4 mt-4">
                        <div className="text-sm text-slate-200 mb-3">
                          If you already have 2FA enabled and want to disable it:
                        </div>
                        <div className="space-y-3">
                          <label className="block">
                            <div className="mb-1 text-sm text-slate-200">Password</div>
                            <input
                              type="password"
                              value={disable2FAPassword}
                              onChange={(e) => setDisable2FAPassword(e.target.value)}
                              placeholder="Your password"
                              className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                            />
                          </label>
                          <label className="block">
                            <div className="mb-1 text-sm text-slate-200">2FA Code or Backup Code</div>
                            <input
                              type="text"
                              value={disable2FACode}
                              onChange={(e) => setDisable2FACode(e.target.value)}
                              placeholder="000000"
                              className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={handleDisable2FA}
                            disabled={!disable2FAPassword || !disable2FACode}
                            className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-400 disabled:opacity-60"
                          >
                            Disable 2FA
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="text-sm text-slate-200">Scan this QR code with your authenticator app:</div>
                      <div className="flex justify-center">
                        <img src={twoFASetup.qr_code} alt="2FA QR Code" className="rounded-xl border border-white/10 bg-white p-2" />
                      </div>
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                        <div className="text-xs font-medium text-amber-200 mb-2">Backup Codes (save these safely!):</div>
                        <div className="font-mono text-xs text-amber-100 space-y-1">
                          {twoFASetup.backup_codes.map((code, idx) => (
                            <div key={idx}>{code}</div>
                          ))}
                        </div>
                      </div>
                      <label className="block">
                        <div className="mb-1 text-sm text-slate-200">Enter code from authenticator app to verify:</div>
                        <input
                          type="text"
                          value={twoFACode}
                          onChange={(e) => setTwoFACode(e.target.value)}
                          placeholder="000000"
                          maxLength={6}
                          className="w-full max-w-xs rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                        />
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleVerify2FASetup}
                          disabled={!twoFACode.trim()}
                          className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
                        >
                          Verify & Enable
                        </button>
                        <button
                          type="button"
                          onClick={() => setTwoFASetup(null)}
                          className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </section>

                {/* Notifications Section */}
                <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                  <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">Notifications</h3>
                  <div className="space-y-4">
                    {/* Browser Notifications Permission */}
                    <div className="rounded-xl border border-white/10 bg-slate-950/20 p-3">
                      <label className="block mb-2">
                        <div className="text-sm font-medium text-slate-200">Browser Notifications</div>
                        <div className="text-xs text-slate-400 mt-1">
                          {notificationManager.isSupported() 
                            ? 'Get desktop notifications for mentions, replies, and messages'
                            : 'Browser notifications are not supported in your browser'}
                        </div>
                      </label>
                      {notificationManager.isSupported() && (
                        <div className="flex items-center gap-3">
                          <div className="text-xs text-slate-300">
                            Status: <span className={`font-semibold ${
                              notificationPermission === 'granted' ? 'text-emerald-400' :
                              notificationPermission === 'denied' ? 'text-red-400' :
                              'text-amber-400'
                            }`}>
                              {notificationPermission === 'granted' ? 'Enabled' :
                               notificationPermission === 'denied' ? 'Blocked' :
                               'Not requested'}
                            </span>
                          </div>
                          {notificationPermission !== 'granted' && notificationPermission !== 'denied' && (
                            <button
                              type="button"
                              onClick={async () => {
                                const permission = await notificationManager.requestPermission()
                                setNotificationPermission(permission)
                                if (permission === 'granted') {
                                  pushToast({ kind: 'success', message: 'Browser notifications enabled' })
                                  // Show test notification immediately
                                  setTimeout(() => {
                                    notificationManager.showNotification('Notifications Enabled!', {
                                      body: 'You will now receive desktop notifications for messages, mentions, and replies.',
                                      icon: '/favicon.ico',
                                    })
                                  }, 500)
                                } else {
                                  pushToast({ kind: 'error', message: 'Browser notifications permission denied' })
                                }
                              }}
                              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
                            >
                              Enable Notifications
                            </button>
                          )}
                          {notificationPermission === 'granted' && (
                            <button
                              type="button"
                              onClick={() => {
                                notificationManager.showNotification('Test Notification', {
                                  body: 'This is a test notification. If you see this, notifications are working!',
                                  icon: '/favicon.ico',
                                })
                                pushToast({ kind: 'info', message: 'Test notification sent - check your system tray!' })
                              }}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                            >
                              Test Notification
                            </button>
                          )}
                          {notificationPermission === 'denied' && (
                            <div className="text-xs text-red-400">
                              Please enable notifications in your browser settings
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    
                    {/* Notification Mode */}
                    <label className="block">
                      <div className="mb-2 text-sm text-slate-200">Notification Mode</div>
                      <div className="text-xs text-slate-400 mb-2">
                        Controls when you receive notifications (only works when browser notifications are enabled)
                      </div>
                      <select
                        value={notificationMode}
                        onChange={(e) => setNotificationMode(e.target.value as 'all' | 'mentions' | 'none')}
                        className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                      >
                        <option value="all">All messages</option>
                        <option value="mentions">Only mentions and replies</option>
                        <option value="none">None</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={handleSetNotificationMode}
                      className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
                    >
                      Save Notification Settings
                    </button>
                  </div>
                </section>

                {/* Password Reset Section */}
                <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                  <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">Password Reset</h3>
                  <div className="space-y-4">
                    <div className="text-sm text-slate-200">
                      Request a password reset link to be sent to your registered email address.
                    </div>
                    <button
                      type="button"
                      onClick={handleRequestPasswordReset}
                      className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-orange-400"
                    >
                      Request Password Reset
                    </button>
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}

        {/* Server Settings Modal */}
        {isServerSettingsOpen && selectedServerObj && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setIsServerSettingsOpen(false)}>
            <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-white/10 bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{selectedServerObj.icon ?? '🏠'}</span>
                  <h2 className="text-xl font-semibold text-white">{selectedServerObj.name} Settings</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsServerSettingsOpen(false)}
                  className="text-2xl text-slate-400 hover:text-slate-200"
                >
                  ×
                </button>
              </div>

              <div className="p-6 overflow-y-auto flex-1">
                <div className="space-y-6">
                  {/* Category Management Section */}
                  <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                    <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">Categories</h3>
                    <div className="space-y-3">
                      {/* Create Category */}
                      <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
                        <div className="mb-2 text-sm font-medium text-slate-200">Create Category</div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={categoryName}
                            onChange={(e) => setCategoryName(e.target.value)}
                            placeholder="Category name (e.g., 📚 Resources)"
                            className="flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (categoryName.trim() && selectedServerId) {
                                wsClient.send({ type: 'create_category', server_id: selectedServerId, name: categoryName.trim() })
                                setCategoryName('')
                              }
                            }}
                            disabled={!categoryName.trim() || wsClient.readyState !== WebSocket.OPEN}
                            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-60"
                          >
                            Create
                          </button>
                        </div>
                      </div>

                      {/* List Categories */}
                      <div className="space-y-2">
                        <div className="text-xs font-medium text-slate-400 mb-2">Manage Categories</div>
                        {(() => {
                          const sortedCategories = (selectedServerObj.categories ?? []).sort((a, b) => a.position - b.position)
                          
                          const moveCategoryUp = (categoryId: string, currentPosition: number) => {
                            if (currentPosition === 0) return
                            const newPositions = sortedCategories.map((cat, idx) => {
                              if (cat.id === categoryId) {
                                return { category_id: cat.id, position: currentPosition - 1 }
                              }
                              if (idx === currentPosition - 1) {
                                return { category_id: cat.id, position: currentPosition }
                              }
                              return { category_id: cat.id, position: idx }
                            })
                            wsClient.send({ type: 'update_category_positions', server_id: selectedServerId, positions: newPositions })
                          }
                          
                          const moveCategoryDown = (categoryId: string, currentPosition: number) => {
                            if (currentPosition === sortedCategories.length - 1) return
                            const newPositions = sortedCategories.map((cat, idx) => {
                              if (cat.id === categoryId) {
                                return { category_id: cat.id, position: currentPosition + 1 }
                              }
                              if (idx === currentPosition + 1) {
                                return { category_id: cat.id, position: currentPosition }
                              }
                              return { category_id: cat.id, position: idx }
                            })
                            wsClient.send({ type: 'update_category_positions', server_id: selectedServerId, positions: newPositions })
                          }
                          
                          return sortedCategories.map((category, index) => (
                            <div key={category.id} className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  {/* Reorder buttons */}
                                  <div className="flex flex-col gap-0.5">
                                    <button
                                      type="button"
                                      onClick={() => moveCategoryUp(category.id, index)}
                                      disabled={index === 0}
                                      className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                                      title="Move up"
                                    >
                                      ▲
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => moveCategoryDown(category.id, index)}
                                      disabled={index === sortedCategories.length - 1}
                                      className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                                      title="Move down"
                                    >
                                      ▼
                                    </button>
                                  </div>
                                  
                                  {/* Category name */}
                                  <div className="flex-1 min-w-0">
                                    {editingCategoryId === category.id ? (
                                      <input
                                        type="text"
                                        value={editingCategoryName}
                                        onChange={(e) => setEditingCategoryName(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            if (editingCategoryName.trim()) {
                                              wsClient.send({
                                                type: 'update_category',
                                                category_id: category.id,
                                                name: editingCategoryName.trim()
                                              })
                                            }
                                            setEditingCategoryId(null)
                                            setEditingCategoryName('')
                                          } else if (e.key === 'Escape') {
                                            setEditingCategoryId(null)
                                            setEditingCategoryName('')
                                          }
                                        }}
                                        className="w-full rounded border border-sky-500/40 bg-slate-900 px-2 py-1 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                        autoFocus
                                      />
                                    ) : (
                                      <div className="text-sm font-medium text-slate-200 truncate">{category.name}</div>
                                    )}
                                  </div>
                                </div>
                                
                                {/* Action buttons */}
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {editingCategoryId === category.id ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (editingCategoryName.trim()) {
                                            wsClient.send({
                                              type: 'update_category',
                                              category_id: category.id,
                                              name: editingCategoryName.trim()
                                            })
                                          }
                                          setEditingCategoryId(null)
                                          setEditingCategoryName('')
                                        }}
                                        className="rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-500"
                                      >
                                        ✓
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingCategoryId(null)
                                          setEditingCategoryName('')
                                        }}
                                        className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-500"
                                      >
                                        ✕
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingCategoryId(category.id)
                                          setEditingCategoryName(category.name)
                                        }}
                                        className="rounded bg-slate-700 px-2 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-600"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (confirm(`Delete category "${category.name}"? Channels will not be deleted.`)) {
                                            wsClient.send({ type: 'delete_category', category_id: category.id })
                                          }
                                        }}
                                        className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-500"
                                      >
                                        Delete
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))
                        })()}
                        {(selectedServerObj.categories ?? []).length === 0 && (
                          <div className="text-xs text-slate-500 text-center py-4">No categories yet. Create one above!</div>
                        )}
                      </div>
                    </div>
                  </section>

                  {/* Create Channel Section */}
                  <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                    <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">Create Channel</h3>
                    <div className="space-y-3">
                      <label className="block">
                        <div className="mb-1 text-sm text-slate-200">Channel Name</div>
                        <input
                          type="text"
                          value={channelName}
                          onChange={(e) => setChannelName(e.target.value)}
                          placeholder="Enter channel name"
                          className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                        />
                      </label>

                      <label className="block">
                        <div className="mb-1 text-sm text-slate-200">Channel Type</div>
                        <select
                          value={channelType}
                          onChange={(e) => setChannelType(e.target.value as 'text' | 'voice')}
                          className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                        >
                          <option value="text">Text Channel</option>
                          <option value="voice">Voice Channel</option>
                        </select>
                      </label>

                      <label className="block">
                        <div className="mb-1 text-sm text-slate-200">Category (Optional)</div>
                        <select
                          value={selectedCategoryId}
                          onChange={(e) => setSelectedCategoryId(e.target.value)}
                          className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                        >
                          <option value="">No Category</option>
                          {(selectedServerObj.categories ?? [])
                            .sort((a, b) => a.position - b.position)
                            .map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {cat.name}
                              </option>
                            ))}
                        </select>
                      </label>

                      <button
                        type="button"
                        onClick={() => {
                          createChannel()
                          setChannelName('')
                          setSelectedCategoryId('')
                        }}
                        disabled={!channelName.trim() || wsClient.readyState !== WebSocket.OPEN}
                        className="w-full rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-60"
                      >
                        Create Channel
                      </button>
                    </div>
                  </section>

                  {/* Manage Channels Section */}
                  <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                    <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">Manage Channels</h3>
                    <div className="space-y-3">
                      <div className="text-xs font-medium text-slate-400 mb-2">Existing Channels</div>
                      {(() => {
                        const sortedChannels = (selectedServerObj.channels ?? []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
                        
                        const moveChannelUp = (currentIndex: number) => {
                          if (currentIndex === 0) return
                          const currentChannel = sortedChannels[currentIndex]
                          // Find the previous channel in the same category
                          let targetIndex = -1
                          for (let i = currentIndex - 1; i >= 0; i--) {
                            if (sortedChannels[i].category_id === currentChannel.category_id) {
                              targetIndex = i
                              break
                            }
                          }
                          if (targetIndex === -1) return
                          
                          const newPositions = sortedChannels.map((ch, idx) => {
                            if (idx === currentIndex) {
                              return { channel_id: ch.id, position: targetIndex, category_id: ch.category_id }
                            }
                            if (idx === targetIndex) {
                              return { channel_id: ch.id, position: currentIndex, category_id: ch.category_id }
                            }
                            return { channel_id: ch.id, position: idx, category_id: ch.category_id }
                          })
                          wsClient.send({ type: 'update_channel_positions', server_id: selectedServerId, positions: newPositions })
                        }
                        
                        const moveChannelDown = (currentIndex: number) => {
                          if (currentIndex === sortedChannels.length - 1) return
                          const currentChannel = sortedChannels[currentIndex]
                          // Find the next channel in the same category
                          let targetIndex = -1
                          for (let i = currentIndex + 1; i < sortedChannels.length; i++) {
                            if (sortedChannels[i].category_id === currentChannel.category_id) {
                              targetIndex = i
                              break
                            }
                          }
                          if (targetIndex === -1) return
                          
                          const newPositions = sortedChannels.map((ch, idx) => {
                            if (idx === currentIndex) {
                              return { channel_id: ch.id, position: targetIndex, category_id: ch.category_id }
                            }
                            if (idx === targetIndex) {
                              return { channel_id: ch.id, position: currentIndex, category_id: ch.category_id }
                            }
                            return { channel_id: ch.id, position: idx, category_id: ch.category_id }
                          })
                          wsClient.send({ type: 'update_channel_positions', server_id: selectedServerId, positions: newPositions })
                        }
                        
                        const canMoveUp = (currentIndex: number) => {
                          if (currentIndex === 0) return false
                          const currentChannel = sortedChannels[currentIndex]
                          for (let i = currentIndex - 1; i >= 0; i--) {
                            if (sortedChannels[i].category_id === currentChannel.category_id) {
                              return true
                            }
                          }
                          return false
                        }
                        
                        const canMoveDown = (currentIndex: number) => {
                          if (currentIndex === sortedChannels.length - 1) return false
                          const currentChannel = sortedChannels[currentIndex]
                          for (let i = currentIndex + 1; i < sortedChannels.length; i++) {
                            if (sortedChannels[i].category_id === currentChannel.category_id) {
                              return true
                            }
                          }
                          return false
                        }
                        
                        return sortedChannels.map((channel, index) => (
                          <div key={channel.id} className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                {/* Reorder buttons */}
                                <div className="flex flex-col gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => moveChannelUp(index)}
                                    disabled={!canMoveUp(index)}
                                    className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                                    title="Move up"
                                  >
                                    ▲
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveChannelDown(index)}
                                    disabled={!canMoveDown(index)}
                                    className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-200 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                                    title="Move down"
                                  >
                                    ▼
                                  </button>
                                </div>
                                
                                <span className="text-slate-400">{channel.type === 'voice' ? '🔊' : '#'}</span>
                                <div className="text-sm font-medium text-slate-200 truncate">{channel.name}</div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirm(`Delete channel "${channel.name}"? This cannot be undone.`)) {
                                    wsClient.send({ type: 'delete_channel', channel_id: channel.id })
                                  }
                                }}
                                className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-500 flex-shrink-0"
                              >
                                Delete
                              </button>
                            </div>
                            <label className="block">
                              <div className="mb-1 text-xs text-slate-400">Move to Category</div>
                              <select
                                value={channel.category_id || ''}
                                onChange={(e) => {
                                  const newCategoryId = e.target.value || null
                                  wsClient.send({
                                    type: 'update_channel_category',
                                    channel_id: channel.id,
                                    category_id: newCategoryId
                                  })
                                }}
                                className="w-full rounded border border-white/10 bg-slate-900 px-2 py-1 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                              >
                                <option value="">No Category</option>
                                {(selectedServerObj.categories ?? [])
                                  .sort((a, b) => a.position - b.position)
                                  .map((cat) => (
                                    <option key={cat.id} value={cat.id}>
                                      {cat.name}
                                    </option>
                                  ))}
                              </select>
                            </label>
                          </div>
                        ))
                      })()}
                      {(selectedServerObj.channels ?? []).length === 0 && (
                        <div className="text-xs text-slate-500 text-center py-4">No channels yet. Create one above!</div>
                      )}
                    </div>
                  </section>

                  {/* Server Invite Section */}
                  <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                    <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">Server Invite</h3>
                    <div className="space-y-3">
                      {lastInviteCode && (
                        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                          <div className="text-xs font-medium text-emerald-200 mb-1">Invite Code</div>
                          <div className="font-mono text-sm text-emerald-100">{lastInviteCode}</div>
                        </div>
                      )}
                      
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedServerId) {
                            wsClient.generateServerInvite({ type: 'generate_server_invite', server_id: selectedServerId })
                          }
                        }}
                        disabled={wsClient.readyState !== WebSocket.OPEN}
                        className="w-full rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-60"
                      >
                        Generate New Invite Code
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (selectedServerId) {
                            loadInviteUsage(selectedServerId)
                          }
                        }}
                        disabled={isLoadingInviteUsage || wsClient.readyState !== WebSocket.OPEN}
                        className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-60"
                      >
                        {isLoadingInviteUsage ? 'Loading...' : 'View Invite Usage'}
                      </button>

                      {inviteUsageLogs && inviteUsageServerId === selectedServerId && (
                        <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/40 p-3 max-h-48 overflow-auto">
                          <div className="text-xs font-medium text-slate-400 mb-2">Invite Usage History</div>
                          {inviteUsageLogs.length === 0 ? (
                            <div className="text-xs text-slate-500">No invites used yet</div>
                          ) : (
                            <div className="space-y-2">
                              {inviteUsageLogs.map((log, idx) => (
                                <div key={idx} className="text-xs border-b border-white/5 pb-2 last:border-0">
                                  <div className="text-slate-200 font-medium">{log.invite_code}</div>
                                  <div className="text-slate-400">Used {log.use_count} time(s)</div>
                                  {log.last_used && (
                                    <div className="text-slate-500">{new Date(log.last_used).toLocaleString()}</div>
                                  )}
                                  {log.users && log.users.length > 0 && (
                                    <div className="text-slate-400">Users: {log.users.join(', ')}</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Server Icon Section */}
                  <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                    <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">Server Icon</h3>
                    <div className="space-y-3">
                      <div className="flex items-center gap-4">
                        <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-white/10 bg-slate-950/40 text-3xl overflow-hidden">
                          {selectedServerObj.icon_type === 'image' && selectedServerObj.icon_data ? (
                            <img src={selectedServerObj.icon_data} alt="Server icon" className="h-full w-full object-cover" />
                          ) : (
                            <>{selectedServerObj.icon ?? '🏠'}</>
                          )}
                        </div>
                        <div className="flex-1">
                          <label className="block">
                            <div className="mb-1 text-sm text-slate-200">Upload Image (.png, .jpg, .gif)</div>
                            <input
                              type="file"
                              accept=".png,.jpg,.jpeg,.gif"
                              onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file && selectedServerId) {
                                  uploadServerIcon(selectedServerId, file)
                                  e.target.value = ''
                                }
                              }}
                              className="w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-500 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-950 hover:file:bg-sky-400"
                            />
                          </label>
                        </div>
                      </div>
                      <div className="text-sm text-slate-400">
                        Or pick an emoji:
                      </div>
                      <div className="grid grid-cols-10 gap-2">
                        {['🏠', '🎮', '💬', '🎨', '🎵', '📚', '⚔️', '🌟', '🔥', '💎'].map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => selectedServerId && setServerIconEmoji(selectedServerId, emoji)}
                            className="text-2xl hover:bg-white/10 rounded-lg p-2 transition"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>

                  {/* Server Emojis Section */}
                  <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                    <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">Server Emojis</h3>
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={emojiName}
                          onChange={(e) => setEmojiName(e.target.value)}
                          placeholder="Emoji name (e.g., coolcat)"
                          className="flex-1 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                        />
                        <input
                          type="file"
                          accept=".png,.jpg,.jpeg,.gif,.webp"
                          onChange={(e) => setEmojiFile(e.target.files?.[0] || null)}
                          className="hidden"
                          id="emoji-upload"
                        />
                        <label
                          htmlFor="emoji-upload"
                          className="cursor-pointer rounded-xl border border-white/10 bg-slate-950/40 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5"
                        >
                          {emojiFile ? emojiFile.name : 'Choose File'}
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            if (emojiName && emojiFile && selectedServerId) {
                              uploadServerEmoji(selectedServerId, emojiName, emojiFile)
                            }
                          }}
                          disabled={!emojiName || !emojiFile}
                          className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-60"
                        >
                          Upload
                        </button>
                      </div>
                      {selectedServerId && serverEmojis[selectedServerId]?.length > 0 && (
                        <div className="grid grid-cols-8 gap-2 max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/40 p-3">
                          {serverEmojis[selectedServerId].map((emoji: any) => (
                            <div key={emoji.emoji_id} className="group relative">
                              <img src={emoji.image_data} alt={emoji.name} className="w-8 h-8 object-contain" title={emoji.name} />
                              <button
                                type="button"
                                onClick={() => deleteServerEmoji(emoji.emoji_id)}
                                className="absolute -top-1 -right-1 hidden group-hover:block text-xs bg-rose-500 text-white rounded-full w-4 h-4 leading-none"
                                title="Delete"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Roles & Permissions Section */}
                  <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                    <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">Roles & Permissions</h3>
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedServerId) {
                            loadServerRoles(selectedServerId)
                          }
                          setSelectedRole(null)
                          setRoleName('')
                          setRoleColor('#3B82F6')
                          setRolePermissions([])
                          setIsCreateRoleOpen(true)
                        }}
                        className="w-full rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
                      >
                        Create New Role
                      </button>

                      {selectedServerId && serverRoles[selectedServerId]?.length > 0 && (
                        <div className="space-y-2 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/40 p-3">
                          {serverRoles[selectedServerId].map((role: any) => (
                            <div
                              key={role.id}
                              className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-900/60 p-3"
                            >
                              <div className="flex items-center gap-3">
                                <div
                                  className="h-4 w-4 rounded"
                                  style={{ backgroundColor: role.color || '#3B82F6' }}
                                />
                                <div>
                                  <div className="text-sm font-semibold text-white">{role.name}</div>
                                  <div className="text-xs text-slate-400">
                                    {role.permissions?.length || 0} permission(s)
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => openEditRole(role)}
                                  className="rounded-lg bg-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-600"
                                >
                                  Edit
                                </button>
                                {role.name !== 'Admin' && (
                                  <button
                                    type="button"
                                    onClick={() => deleteRole(role.id)}
                                    className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-500"
                                  >
                                    Delete
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Member Roles Section */}
                  <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                    <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">Member Roles</h3>
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedServerId) {
                            loadServerMembers(selectedServerId)
                            // Load roles for all members
                            if (serverMembers[selectedServerId]) {
                              serverMembers[selectedServerId].forEach((member: any) => {
                                loadUserRoles(selectedServerId, member.username)
                              })
                            }
                          }
                          setIsViewingMemberRoles(!isViewingMemberRoles)
                        }}
                        className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5"
                      >
                        {isViewingMemberRoles ? 'Hide Member Roles' : 'View Member Roles'}
                      </button>

                      {isViewingMemberRoles && selectedServerId && serverMembers[selectedServerId] && (
                        <div className="space-y-2 max-h-96 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/40 p-3">
                          {serverMembers[selectedServerId].map((member: any) => {
                            const memberKey = `${selectedServerId}:${member.username}`
                            const userRoles = memberRoles[memberKey] || []
                            const availableRoles = serverRoles[selectedServerId] || []
                            
                            return (
                              <div
                                key={member.username}
                                className="rounded-lg border border-white/10 bg-slate-900/60 p-3"
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold text-white">
                                      {member.username}
                                    </span>
                                    {member.is_owner && (
                                      <span className="text-xs bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded">
                                        Owner
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedMemberForRole(
                                      selectedMemberForRole === member.username ? null : member.username
                                    )}
                                    className="text-xs rounded-lg bg-slate-700 px-3 py-1 text-slate-200 hover:bg-slate-600"
                                  >
                                    {selectedMemberForRole === member.username ? 'Close' : 'Manage Roles'}
                                  </button>
                                </div>

                                {/* Current roles */}
                                {userRoles.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5 mb-2">
                                    {userRoles.map((role: any) => (
                                      <div
                                        key={role.id}
                                        className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-800/60 px-2 py-1"
                                      >
                                        <div
                                          className="h-3 w-3 rounded"
                                          style={{ backgroundColor: role.color || '#3B82F6' }}
                                        />
                                        <span className="text-xs text-slate-200">{role.name}</span>
                                        <button
                                          type="button"
                                          onClick={() => removeRoleFromMember(member.username, role.id)}
                                          className="text-slate-400 hover:text-rose-400 text-xs"
                                          title="Remove role"
                                        >
                                          ×
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Role assignment dropdown */}
                                {selectedMemberForRole === member.username && (
                                  <div className="mt-2 space-y-1.5">
                                    <div className="text-xs text-slate-400 mb-1">Assign Role:</div>
                                    {availableRoles
                                      .filter((role: any) => !userRoles.some((ur: any) => ur.id === role.id))
                                      .map((role: any) => (
                                        <button
                                          key={role.id}
                                          type="button"
                                          onClick={() => {
                                            assignRoleToMember(member.username, role.id)
                                            setSelectedMemberForRole(null)
                                          }}
                                          className="w-full flex items-center gap-2 rounded-lg border border-white/10 bg-slate-800/40 px-3 py-2 text-left hover:bg-slate-700/40"
                                        >
                                          <div
                                            className="h-3 w-3 rounded"
                                            style={{ backgroundColor: role.color || '#3B82F6' }}
                                          />
                                          <span className="text-xs text-slate-200">{role.name}</span>
                                        </button>
                                      ))}
                                    {availableRoles.filter((role: any) => !userRoles.some((ur: any) => ur.id === role.id)).length === 0 && (
                                      <div className="text-xs text-slate-500 text-center py-2">
                                        All roles assigned
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Banned Members Section */}
                  <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                    <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">Banned Members</h3>
                    <div className="space-y-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedServerId) {
                            loadServerBans(selectedServerId)
                          }
                          setIsViewingBans(!isViewingBans)
                        }}
                        className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5"
                      >
                        {isViewingBans ? 'Hide Banned Members' : 'View Banned Members'}
                      </button>

                      {isViewingBans && (
                        <>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={banUsername}
                              onChange={(e) => setBanUsername(e.target.value)}
                              placeholder="Username to ban"
                              className="flex-1 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                            />
                            <input
                              type="text"
                              value={banReason}
                              onChange={(e) => setBanReason(e.target.value)}
                              placeholder="Reason (optional)"
                              className="flex-1 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                            />
                            <button
                              type="button"
                              onClick={banMember}
                              disabled={!banUsername.trim()}
                              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-60"
                            >
                              Ban
                            </button>
                          </div>

                          {selectedServerId && serverBans[selectedServerId]?.length > 0 ? (
                            <div className="space-y-2 max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/40 p-3">
                              {serverBans[selectedServerId].map((ban: any, idx: number) => (
                                <div
                                  key={idx}
                                  className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-900/60 p-3"
                                >
                                  <div>
                                    <div className="text-sm font-semibold text-white">{ban.username}</div>
                                    {ban.reason && (
                                      <div className="text-xs text-slate-400">Reason: {ban.reason}</div>
                                    )}
                                    <div className="text-xs text-slate-500">
                                      Banned: {new Date(ban.banned_at).toLocaleDateString()}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => unbanMember(ban.username)}
                                    className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
                                  >
                                    Unban
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            selectedServerId && serverBans[selectedServerId] && (
                              <div className="text-sm text-slate-400 text-center py-4">
                                No banned members
                              </div>
                            )
                          )}
                        </>
                      )}
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Create/Edit Role Modal */}
        {isCreateRoleOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setIsCreateRoleOpen(false)}>
            <div className="w-full max-w-md max-h-[90vh] flex flex-col rounded-2xl border border-white/10 bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 flex-shrink-0">
                <h2 className="text-xl font-semibold text-white">{selectedRole ? 'Edit Role' : 'Create Role'}</h2>
                <button
                  type="button"
                  onClick={() => setIsCreateRoleOpen(false)}
                  className="text-2xl text-slate-400 hover:text-slate-200"
                >
                  ×
                </button>
              </div>

              <div className="p-6 overflow-y-auto flex-1">
                <div className="space-y-4">
                  <label className="block">
                    <div className="mb-1 text-sm text-slate-200">Role Name</div>
                    <input
                      type="text"
                      value={roleName}
                      onChange={(e) => setRoleName(e.target.value)}
                      placeholder="Enter role name"
                      className="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    />
                  </label>

                  <label className="block">
                    <div className="mb-1 text-sm text-slate-200">Role Color</div>
                    <input
                      type="color"
                      value={roleColor}
                      onChange={(e) => setRoleColor(e.target.value)}
                      className="w-full h-10 rounded-xl border border-white/10 bg-slate-950/40 cursor-pointer"
                    />
                  </label>

                  <div>
                    <div className="mb-2 text-sm text-slate-200">Permissions</div>
                    <div className="space-y-2 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-slate-950/40 p-3">
                      {[
                        { key: 'administrator', label: 'Administrator (All Permissions)' },
                        { key: 'manage_server', label: 'Manage Server' },
                        { key: 'manage_channels', label: 'Manage Channels' },
                        { key: 'ban_members', label: 'Ban Members' },
                        { key: 'delete_messages', label: 'Delete Messages' },
                        { key: 'manage_emojis', label: 'Manage Emojis' },
                        { key: 'send_messages', label: 'Send Messages' },
                        { key: 'read_messages', label: 'Read Messages' },
                      ].map((perm) => (
                        <label key={perm.key} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={rolePermissions.includes(perm.key)}
                            onChange={() => togglePermission(perm.key)}
                            className="rounded border-white/10 bg-slate-950/40 text-sky-500 focus:ring-sky-500/40"
                          />
                          <span className="text-sm text-slate-200">{perm.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-3 justify-end pt-4">
                    <button
                      type="button"
                      onClick={() => setIsCreateRoleOpen(false)}
                      className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={selectedRole ? updateRole : createRole}
                      disabled={!roleName.trim()}
                      className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-60"
                    >
                      {selectedRole ? 'Update Role' : 'Create Role'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Delete Message Confirmation Modal */}
        {deletingMessageId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={cancelDeleteMessage}>
            <div className="rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-xl max-w-md" onClick={(e) => e.stopPropagation()}>
              <div className="text-lg font-semibold text-white mb-3">Delete Message</div>
              <div className="text-sm text-slate-300 mb-4">Are you sure you want to delete this message? This action cannot be undone.</div>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={cancelDeleteMessage}
                  className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={deleteMessage}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const authToken = useAppStore((s) => s.authToken)
  
  if (!authToken) {
    return <Navigate to="/login" replace />
  }
  
  return <>{children}</>
}

function App() {
  const setAuth = useAppStore((s) => s.setAuth)

  // Restore auth from localStorage on app mount
  useEffect(() => {
    const stored = getStoredAuth()
    if (stored.token && stored.username) {
      setAuth({ token: stored.token, username: stored.username })
    }
  }, [setAuth])

  return (
    <>
      <ToastHost />
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/chat"
          element={
            <ProtectedRoute>
              <ChatPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  )
}

export default App
