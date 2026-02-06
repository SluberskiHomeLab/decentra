import { Link, Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { wsClient } from './api/wsClient'
import { clearStoredAuth, getStoredAuth, setStoredAuth } from './auth/storage'
import { contextKey, useAppStore } from './store/appStore'
import { useToastStore } from './store/toastStore'
import type { ChatContext } from './store/appStore'
import type { Attachment, Server, ServerInviteUsageLog, ServerMember, WsChatMessage, WsMessage } from './types/protocol'
import './App.css'

// URL processing utilities
const URL_REGEX = /(https?:\/\/[^\s]+)/gi
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
    const urlObj = new URL(url)
    if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
      return urlObj.toString()
    }
    return null
  } catch {
    return null
  }
}

function linkifyText(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  const regex = new RegExp(URL_REGEX)
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // Add text before the URL
    if (match.index > lastIndex) {
      parts.push(<span key={`text-${lastIndex}`}>{text.slice(lastIndex, match.index)}</span>)
    }

    const url = match[0]
    const safeUrl = sanitizeUrl(url)
    
    if (safeUrl) {
      parts.push(
        <a
          key={`link-${match.index}`}
          href={safeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 hover:text-sky-300 underline"
        >
          {url}
        </a>
      )
    } else {
      parts.push(<span key={`unsafe-${match.index}`}>{url}</span>)
    }

    lastIndex = regex.lastIndex
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(<span key={`text-${lastIndex}`}>{text.slice(lastIndex)}</span>)
  }

  return parts.length > 0 ? parts : [<span key="text-0">{text}</span>]
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
  const [announcement, setAnnouncement] = useState<{
    enabled: boolean
    message: string
    duration_minutes: number
    set_at: string | null
  } | null>(null)

  // Account settings state
  const [profileBio, setProfileBio] = useState('')
  const [profileStatus, setProfileStatus] = useState('')
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [twoFASetup, setTwoFASetup] = useState<{ secret: string; qr_code: string; backup_codes: string[] } | null>(null)
  const [twoFACode, setTwoFACode] = useState('')
  const [disable2FAPassword, setDisable2FAPassword] = useState('')
  const [disable2FACode, setDisable2FACode] = useState('')
  const [notificationMode, setNotificationMode] = useState<'all' | 'mentions' | 'none'>('all')

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

        // Request admin settings (includes announcement info for all users)
        try {
          wsClient.send({ type: 'get_admin_settings' })
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
        
        // Clear authentication and redirect to login
        clearStoredAuth()
        useAppStore.getState().clearAuth()
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
      }

      if (msg.type === 'admin_settings') {
        setAdminSettings(msg.settings || {})
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

      if (msg.type === 'password_reset_requested') {
        pushToast({ kind: 'success', message: msg.message || 'Password reset email sent' })
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

  const selectedTitle =
    selectedContext.kind === 'global'
      ? 'Global'
      : selectedContext.kind === 'dm'
        ? `DM ${selectedContext.dmId}`
        : `${selectedContext.serverId} / ${selectedContext.channelId}`

  const canSend = wsClient.readyState === WebSocket.OPEN && (draft.trim().length > 0 || selectedFiles.length > 0)

  const send = async () => {
    const content = draft.trim()
    if (!content && selectedFiles.length === 0) return

    // If there are files, send message first, then upload files
    if (selectedFiles.length > 0) {
      await sendMessageWithFiles(content || '')
    } else {
      // Just send text message
      if (selectedContext.kind === 'server') {
        wsClient.sendMessage({ type: 'message', content, context: 'server', context_id: `${selectedContext.serverId}/${selectedContext.channelId}` })
      } else if (selectedContext.kind === 'dm') {
        wsClient.sendMessage({ type: 'message', content, context: 'dm', context_id: selectedContext.dmId })
      } else {
        wsClient.sendMessage({ type: 'message', content, context: 'global', context_id: null })
      }
      setDraft('')
    }
  }

  const sendMessageWithFiles = async (content: string) => {
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
          context_id: `${selectedContext.serverId}/${selectedContext.channelId}`
        })
      } else if (selectedContext.kind === 'dm') {
        wsClient.sendMessage({ 
          type: 'message', 
          content, 
          context: 'dm', 
          context_id: selectedContext.dmId
        })
      } else {
        wsClient.sendMessage({ 
          type: 'message', 
          content, 
          context: 'global', 
          context_id: null
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

      // Clear files and draft
      setSelectedFiles([])
      setDraft('')
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    
    if (e.dataTransfer.files) {
      handleFileSelect(e.dataTransfer.files)
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
                    // Request server members
                    wsClient.getServerMembers({ type: 'get_server_members', server_id: server.id })
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
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800/50 text-xl hover:bg-slate-700/50 hover:rounded-xl transition overflow-hidden"
              title={init?.username ?? 'User'}
            >
              {init?.avatar_type === 'image' && init?.avatar_data ? (
                <img src={init.avatar_data} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <>{init?.avatar ?? '👤'}</>
              )}
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
                          <span className="text-lg flex h-8 w-8 items-center justify-center overflow-hidden rounded-full">
                            {dm.avatar_type === 'image' && dm.avatar_data ? (
                              <img src={dm.avatar_data} alt="Avatar" className="h-full w-full object-cover" />
                            ) : (
                              <>{dm.avatar ?? '👤'}</>
                            )}
                          </span>
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
              <div className="flex items-center gap-3">
                {selectedServerId && (
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

          <section className="flex-1 overflow-auto px-6 py-5">
            <div className="mx-auto max-w-5xl">
              <div className="rounded-2xl border border-white/10 bg-slate-900/20 p-4">
                {messages.length === 0 ? (
                  <div className="text-sm text-slate-400">No messages yet.</div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {messages.map((m: WsChatMessage, idx: number) => (
                      <div key={(m.id ?? idx).toString()} className="flex gap-3">
                        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-slate-950/30 text-sm overflow-hidden">
                          {m.avatar_type === 'image' && m.avatar_data ? (
                            <img src={m.avatar_data} alt="Avatar" className="h-full w-full object-cover" />
                          ) : (
                            <>{m.avatar ?? '👤'}</>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <div className="font-semibold text-slate-100">{m.username}</div>
                            <div className="text-xs text-slate-500">{new Date(m.timestamp).toLocaleString()}</div>
                          </div>
                          {m.content && (
                            <>
                              <div className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{linkifyText(m.content)}</div>
                              <MessageEmbeds content={m.content} />
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
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={isDragging ? "Drop files here..." : selectedFiles.length > 0 ? "Add a message (optional)…" : "Type a message…"}
                  disabled={isUploading}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40 disabled:opacity-50"
                />
                
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
                    {/* Owner first */}
                    {serverMembers[selectedServerId]
                      .filter((member) => member.is_owner)
                      .map((member) => (
                        <div
                          key={member.username}
                          className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5 transition"
                        >
                          <span className="text-lg flex h-8 w-8 items-center justify-center overflow-hidden rounded-full">
                            {member.avatar_type === 'image' && member.avatar_data ? (
                              <img src={member.avatar_data} alt="Avatar" className="h-full w-full object-cover" />
                            ) : (
                              <>{member.avatar ?? '👤'}</>
                            )}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-slate-100 truncate">{member.username}</span>
                              <span className="text-xs" title="Server Owner">👑</span>
                            </div>
                            {member.status_message && (
                              <div className="text-xs text-slate-400 truncate">{member.status_message}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    
                    {/* Members section separator */}
                    {serverMembers[selectedServerId].some((m) => m.is_owner) && 
                     serverMembers[selectedServerId].some((m) => !m.is_owner) && (
                      <div className="px-2 text-xs font-medium text-slate-500 uppercase mt-3 mb-1">Members</div>
                    )}
                    
                    {/* Regular members */}
                    {serverMembers[selectedServerId]
                      .filter((member) => !member.is_owner)
                      .map((member) => (
                        <div
                          key={member.username}
                          className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/5 transition"
                        >
                          <span className="text-lg flex h-8 w-8 items-center justify-center overflow-hidden rounded-full">
                            {member.avatar_type === 'image' && member.avatar_data ? (
                              <img src={member.avatar_data} alt="Avatar" className="h-full w-full object-cover" />
                            ) : (
                              <>{member.avatar ?? '👤'}</>
                            )}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-slate-200 truncate">{member.username}</div>
                            {member.status_message && (
                              <div className="text-xs text-slate-400 truncate">{member.status_message}</div>
                            )}
                          </div>
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
                      <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-slate-950/30 text-4xl overflow-hidden">
                        {init?.avatar_type === 'image' && init?.avatar_data ? (
                          <img src={init.avatar_data} alt="Avatar" className="h-full w-full object-cover" />
                        ) : (
                          <>{init?.avatar ?? '👤'}</>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm text-slate-200 mb-2">Current Avatar</div>
                        <div className="text-xs text-slate-400">
                          Type: {init?.avatar_type || 'emoji'}
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
                    <label className="block">
                      <div className="mb-2 text-sm text-slate-200">Notification Mode</div>
                      <select
                        value={notificationMode}
                        onChange={(e) => setNotificationMode(e.target.value as 'all' | 'mentions' | 'none')}
                        className="w-full max-w-md rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                      >
                        <option value="all">All messages</option>
                        <option value="mentions">Only mentions</option>
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
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setIsServerSettingsOpen(false)}>
            <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
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

              <div className="p-6">
                <div className="space-y-6">
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

                      <button
                        type="button"
                        onClick={() => {
                          createChannel()
                          setChannelName('')
                        }}
                        disabled={!channelName.trim() || wsClient.readyState !== WebSocket.OPEN}
                        className="w-full rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-60"
                      >
                        Create Channel
                      </button>
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
                </div>
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
