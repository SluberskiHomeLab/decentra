import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { setStoredAuth } from '../auth/storage'
import { useAppStore } from '../store/appStore'

/**
 * Handles the redirect back from the SSO identity provider.
 *
 * OIDC flow: receives `?code=...&state=...` query params.
 * SAML flow: receives a POST with `SAMLResponse` (handled via hidden form redirect).
 */
export function SSOCallbackPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const setAuth = useAppStore((s) => s.setAuth)
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(true)

  useEffect(() => {
    async function handleCallback() {
      try {
        // OIDC: authorization code in query string
        const code = searchParams.get('code')
        const state = searchParams.get('state')

        // SAML: base64-encoded response (typically posted, but we also check query for relay)
        const samlResponse = searchParams.get('SAMLResponse')

        let body: Record<string, string> = {}

        if (code) {
          body = { code, state: state || '' }
        } else if (samlResponse) {
          body = { SAMLResponse: samlResponse }
        } else {
          // Check if SAML response was posted as form data (browser redirect)
          // In that case the backend redirect should have included it in the URL
          setError('No authorization code or SAML response found in the callback URL.')
          setProcessing(false)
          return
        }

        const resp = await fetch('/api/auth/sso/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })

        const data = await resp.json()

        if (!resp.ok || !data.token) {
          setError(data.error || 'SSO authentication failed.')
          setProcessing(false)
          return
        }

        // Store auth and redirect to chat
        setStoredAuth({ token: data.token, username: data.username })
        setAuth({ token: data.token, username: data.username })

        // Preserve server invite if it was stored before SSO redirect
        const pendingInvite = sessionStorage.getItem('sso_pending_invite')
        sessionStorage.removeItem('sso_pending_invite')
        const redirectPath = pendingInvite ? `/chat?server_invite=${pendingInvite}` : '/chat'
        navigate(redirectPath)
      } catch (e) {
        setError(`SSO callback error: ${e instanceof Error ? e.message : String(e)}`)
        setProcessing(false)
      }
    }

    handleCallback()
  }, [searchParams, navigate, setAuth])

  return (
    <div className="relative min-h-screen bg-bg-primary">
      <div className="absolute inset-0 bg-cover bg-center bg-no-repeat blur-sm" style={{ backgroundImage: 'url(/login-background.png)' }} />
      <div className="relative mx-auto flex min-h-screen max-w-md items-center justify-center px-4">
        <div className="w-full rounded-2xl border border-border-primary bg-bg-secondary/40 p-6 shadow-xl text-center">
          {processing && !error && (
            <div className="space-y-3">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
              <p className="text-sm text-text-secondary">Completing SSO sign-in…</p>
            </div>
          )}

          {error && (
            <div className="space-y-4">
              <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-50">
                {error}
              </div>
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="rounded-xl bg-accent-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover"
              >
                Back to Login
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
