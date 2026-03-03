import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { wsClient } from '../api/wsClient'
import { clearStoredAuth, setStoredAuth } from '../auth/storage'
import { useAppStore } from '../store/appStore'
import type { WsMessage } from '../types/protocol'

export function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
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
  const [ssoEnabled, setSsoEnabled] = useState(false)
  const [ssoLoading, setSsoLoading] = useState(false)
  const [serverName, setServerName] = useState('Decentra')
  const [serverLogo, setServerLogo] = useState('')

  // If already authenticated, redirect to chat
  useEffect(() => {
    if (authToken) {
      const serverInvite = searchParams.get('server_invite')
      const redirectPath = serverInvite ? `/chat?server_invite=${serverInvite}` : '/chat'
      navigate(redirectPath)
    }
  }, [authToken, navigate, searchParams])

  // Check if SSO is enabled
  useEffect(() => {
    fetch('/api/auth/sso/config')
      .then((r) => r.json())
      .then((data) => {
        if (data.sso_enabled) setSsoEnabled(true)
      })
      .catch(() => { /* SSO not available */ })
  }, [])

  // Fetch server branding (name + logo) for the login screen
  useEffect(() => {
    fetch('/api/branding')
      .then((r) => r.json())
      .then((data) => {
        if (data.server_name) {
          setServerName(data.server_name)
          document.title = data.server_name
        }
        if (data.server_logo) setServerLogo(data.server_logo)
      })
      .catch(() => { /* branding not available, use defaults */ })
  }, [])

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
        
        // Redirect to chat with server_invite parameter if present
        const serverInvite = searchParams.get('server_invite')
        const redirectPath = serverInvite ? `/chat?server_invite=${serverInvite}` : '/chat'
        navigate(redirectPath)
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
  }, [navigate, setAuth, setInit, setLastAuthError, username, searchParams])

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

    const unsubOpen = wsClient.onOpen(() => {
      unsubOpen()
      sendLogin()
    })
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

    const unsubOpen = wsClient.onOpen(() => {
      unsubOpen()
      sendReset()
    })
  }

  return (
    <div className="relative min-h-screen bg-bg-primary">
      <div className="absolute inset-0 bg-cover bg-center bg-no-repeat blur-sm" style={{ backgroundImage: 'url(/login-background.png)' }} />
      <div className="relative mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6">
            {serverLogo ? (
              <img src={serverLogo} alt={serverName} className="mb-3 h-10 w-auto object-contain" />
            ) : null}
            <div className="text-xs font-medium text-sky-200/70">{serverName}</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-text-primary">Sign in</h1>
            <p className="mt-2 text-sm text-text-secondary">Dashboard UI (React + Tailwind) – migration in progress.</p>
          </div>

          <div className="rounded-2xl border border-border-primary bg-bg-secondary/40 p-5 shadow-xl">
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <label className="text-sm">
                <div className="mb-1 text-text-secondary">Username</div>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-xl border border-border-primary bg-bg-primary/40 px-3 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/40"
                  placeholder="alice"
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-text-secondary">Password</div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-border-primary bg-bg-primary/40 px-3 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/40"
                  placeholder="••••••••"
                />
              </label>

              {needs2fa && (
                <label className="text-sm">
                  <div className="mb-1 text-text-secondary">2FA Code</div>
                  <input
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="123456"
                    className="w-full rounded-xl border border-border-primary bg-bg-primary/40 px-3 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/40"
                  />
                </label>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-1 inline-flex items-center justify-center rounded-xl bg-accent-primary px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Signing in…' : needs2fa ? 'Verify 2FA' : 'Sign In'}
              </button>
            </form>

            {ssoEnabled && (
              <div className="mt-3">
                <div className="relative my-3">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border-primary" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-bg-secondary/40 px-2 text-text-muted">or</span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={ssoLoading}
                  onClick={async () => {
                    setSsoLoading(true)
                    try {
                      const serverInvite = searchParams.get('server_invite')
                      if (serverInvite) sessionStorage.setItem('sso_pending_invite', serverInvite)
                      const resp = await fetch('/api/auth/sso/initiate')
                      const data = await resp.json()
                      if (data.redirect_url) {
                        window.location.href = data.redirect_url
                      } else {
                        setLastAuthError(data.error || 'SSO initiation failed')
                        setSsoLoading(false)
                      }
                    } catch (e) {
                      setLastAuthError('Failed to start SSO sign-in')
                      setSsoLoading(false)
                    }
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-border-primary bg-bg-primary/40 px-4 py-2.5 text-sm font-semibold text-text-primary shadow hover:bg-bg-tertiary disabled:opacity-60"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                  </svg>
                  {ssoLoading ? 'Redirecting…' : 'Sign in with SSO'}
                </button>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <Link className="text-accent-primary hover:text-accent-hover" to="/signup">
                Create Account
              </Link>
              <button
                type="button"
                className="text-accent-primary hover:text-accent-hover"
                onClick={() => setShowForgotPassword(true)}
              >
                Forgot Password?
              </button>
              <button
                type="button"
                className="text-accent-primary hover:text-accent-hover"
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

          <div className="mt-6 text-xs text-text-muted">
            Backend via nginx proxy: <span className="text-text-secondary">/api</span> and <span className="text-text-secondary">/ws</span>
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
            className="w-full max-w-md rounded-2xl border border-border-primary bg-bg-secondary p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-xl font-semibold text-text-primary">Reset Password</h2>
            
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
                  className="w-full rounded-xl bg-bg-tertiary px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-bg-tertiary/70"
                >
                  Close
                </button>
              </div>
            ) : (
              <form onSubmit={handlePasswordReset} className="space-y-4">
                <p className="text-sm text-text-secondary">
                  Enter your username to receive a password reset link at your registered email address.
                </p>
                
                <label className="block text-sm">
                  <div className="mb-1 text-text-secondary">Username</div>
                  <input
                    type="text"
                    value={resetUsername}
                    onChange={(e) => setResetUsername(e.target.value)}
                    className="w-full rounded-xl border border-border-primary bg-bg-primary/40 px-3 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/40"
                    placeholder="Your username"
                    required
                  />
                </label>

                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={!resetUsername.trim()}
                    className="flex-1 rounded-xl bg-accent-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
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
                    className="rounded-xl bg-bg-tertiary px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-bg-tertiary/70"
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
