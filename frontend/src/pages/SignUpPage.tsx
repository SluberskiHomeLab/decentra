import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { wsClient } from '../api/wsClient'
import { setStoredAuth } from '../auth/storage'
import { useAppStore } from '../store/appStore'
import type { WsMessage } from '../types/protocol'

export function SignUpPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
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

  // Auto-fill invite code from URL parameter
  useEffect(() => {
    const inviteParam = searchParams.get('invite')
    if (inviteParam) {
      setInviteCode(inviteParam)
    }
  }, [searchParams])

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

      wsClient.connect()
      const sendVerify = () => {
        wsClient.verifyEmail({
          type: 'verify_email',
          username: u,
          code,
        })
      }

      if (wsClient.readyState === WebSocket.OPEN) {
        sendVerify()
        return
      }

      let unsubVerify: (() => void) | undefined
      unsubVerify = wsClient.onOpen(() => { unsubVerify?.(); sendVerify() })
    } else {
      // Signup step
      if (!u || !password || !email) {
        setIsSubmitting(false)
        setLastAuthError('Username, password, and email are required')
        return
      }

      wsClient.connect()
      const sendSignup = () => {
        wsClient.signup({
          type: 'signup',
          username: u,
          password,
          email,
          invite_code: inviteCode.trim() || undefined,
        })
      }

      if (wsClient.readyState === WebSocket.OPEN) {
        sendSignup()
        return
      }

      let unsubSignup: (() => void) | undefined
      unsubSignup = wsClient.onOpen(() => { unsubSignup?.(); sendSignup() })
    }
  }

  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6">
            <div className="text-xs font-medium text-sky-200/70">Decentra</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-text-primary">
              {needsVerification ? 'Verify Email' : 'Sign Up'}
            </h1>
            <p className="mt-2 text-sm text-text-secondary">
              {needsVerification
                ? 'Enter the verification code sent to your email.'
                : 'Create a new account to get started.'}
            </p>
          </div>

          <div className="rounded-2xl border border-border-primary bg-bg-secondary/40 p-5 shadow-xl">
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              {needsVerification ? (
                <>
                  <label className="text-sm">
                    <div className="mb-1 text-text-secondary">Username</div>
                    <input
                      value={username}
                      readOnly
                      className="w-full rounded-xl border border-border-primary bg-bg-primary/60 px-3 py-2 text-text-muted"
                    />
                  </label>
                  <label className="text-sm">
                    <div className="mb-1 text-text-secondary">Verification Code</div>
                    <input
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value)}
                      className="w-full rounded-xl border border-border-primary bg-bg-primary/40 px-3 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/40"
                      placeholder="123456"
                      maxLength={6}
                    />
                  </label>
                </>
              ) : (
                <>
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
                  <label className="text-sm">
                    <div className="mb-1 text-text-secondary">Email</div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-border-primary bg-bg-primary/40 px-3 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/40"
                      placeholder="alice@example.com"
                    />
                  </label>
                  <label className="text-sm">
                    <div className="mb-1 text-text-secondary">
                      Invite Code <span className="text-xs text-text-muted">(optional, empty for first user)</span>
                    </div>
                    <input
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      className="w-full rounded-xl border border-border-primary bg-bg-primary/40 px-3 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/40"
                      placeholder="ABC123"
                    />
                  </label>
                </>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-1 inline-flex items-center justify-center rounded-xl bg-accent-primary px-4 py-2.5 text-sm font-semibold text-white shadow hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Processing…' : needsVerification ? 'Verify Email' : 'Create Account'}
              </button>
            </form>

            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <Link className="text-accent-primary hover:text-accent-hover" to="/login">
                Already have an account? Sign In
              </Link>
              {needsVerification && (
                <button
                  type="button"
                  className="text-accent-primary hover:text-accent-hover"
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

          <div className="mt-6 text-xs text-text-muted">
            Backend via nginx proxy: <span className="text-text-secondary">/api</span> and <span className="text-text-secondary">/ws</span>
          </div>
        </div>
      </div>
    </div>
  )
}
