import { useState, useEffect } from 'react'
import { wsClient } from '../../api/wsClient'
import { FeatureGate } from '../FeatureGate'
import type { WsMessage } from '../../types/protocol'

type SsoProvider = 'oidc' | 'saml' | 'auth0' | 'ldap' | ''

interface SsoSettings {
  sso_enabled: boolean
  sso_provider: SsoProvider
  sso_oidc_issuer_url: string
  sso_oidc_client_id: string
  sso_oidc_client_secret: string
  sso_oidc_preset: string
  sso_saml_entity_id: string
  sso_saml_sso_url: string
  sso_saml_certificate: string
  sso_ldap_server_url: string
  sso_ldap_bind_dn: string
  sso_ldap_bind_password: string
  sso_ldap_user_search_base: string
  sso_ldap_user_filter: string
  scim_enabled: boolean
  scim_bearer_token: string
}

const EMPTY: SsoSettings = {
  sso_enabled: false,
  sso_provider: '',
  sso_oidc_issuer_url: '',
  sso_oidc_client_id: '',
  sso_oidc_client_secret: '',
  sso_oidc_preset: 'custom',
  sso_saml_entity_id: '',
  sso_saml_sso_url: '',
  sso_saml_certificate: '',
  sso_ldap_server_url: '',
  sso_ldap_bind_dn: '',
  sso_ldap_bind_password: '',
  sso_ldap_user_search_base: '',
  sso_ldap_user_filter: '(uid={username})',
  scim_enabled: false,
  scim_bearer_token: '',
}

export function SsoPanel() {
  const [settings, setSettings] = useState<SsoSettings>({ ...EMPTY })
  const [saved, setSaved] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [generatedToken, setGeneratedToken] = useState<string | null>(null)

  // Load current settings
  useEffect(() => {
    const unsub = wsClient.onMessage((msg: WsMessage) => {
      if (msg.type === 'admin_settings' && msg.settings) {
        const s = msg.settings as Record<string, unknown>
        setSettings((prev) => ({
          ...prev,
          sso_enabled: (s.sso_enabled as boolean) ?? false,
          sso_provider: (s.sso_provider as SsoProvider) ?? '',
          sso_oidc_issuer_url: (s.sso_oidc_issuer_url as string) ?? '',
          sso_oidc_client_id: (s.sso_oidc_client_id as string) ?? '',
          sso_oidc_client_secret: (s.sso_oidc_client_secret as string) ?? '',
          sso_oidc_preset: (s.sso_oidc_preset as string) ?? 'custom',
          sso_saml_entity_id: (s.sso_saml_entity_id as string) ?? '',
          sso_saml_sso_url: (s.sso_saml_sso_url as string) ?? '',
          sso_saml_certificate: (s.sso_saml_certificate as string) ?? '',
          sso_ldap_server_url: (s.sso_ldap_server_url as string) ?? '',
          sso_ldap_bind_dn: (s.sso_ldap_bind_dn as string) ?? '',
          sso_ldap_bind_password: (s.sso_ldap_bind_password as string) ?? '',
          sso_ldap_user_search_base: (s.sso_ldap_user_search_base as string) ?? '',
          sso_ldap_user_filter: (s.sso_ldap_user_filter as string) ?? '(uid={username})',
          scim_enabled: (s.scim_enabled as boolean) ?? false,
          scim_bearer_token: (s.scim_bearer_token as string) ?? '',
        }))
      }
      if (msg.type === 'settings_saved') {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    })
    wsClient.send({ type: 'get_admin_settings' })
    return unsub
  }, [])

  function patch(field: keyof SsoSettings, value: unknown) {
    setSettings((prev) => ({ ...prev, [field]: value }))
  }

  function handleProviderChange(provider: SsoProvider) {
    // When provider is 'auth0', also set the OIDC preset
    if (provider === 'auth0') {
      setSettings((prev) => ({
        ...prev,
        sso_provider: 'auth0',
        sso_oidc_preset: 'auth0',
      }))
    } else {
      setSettings((prev) => ({
        ...prev,
        sso_provider: provider,
        sso_oidc_preset: provider === 'oidc' ? 'custom' : prev.sso_oidc_preset,
      }))
    }
  }

  function save() {
    // Build the settings payload — for auth0, map provider to 'oidc' internally
    const payload: Record<string, unknown> = { ...settings }
    if (settings.sso_provider === 'auth0') {
      payload.sso_provider = 'oidc'
      payload.sso_oidc_preset = 'auth0'
    }
    wsClient.send({ type: 'save_admin_settings', settings: payload })
  }

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const resp = await fetch('/api/auth/sso/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth_token') || ''}`,
        },
      })
      const data = await resp.json()
      setTestResult({ success: data.success, message: data.message })
    } catch (e) {
      setTestResult({ success: false, message: String(e) })
    }
    setTesting(false)
  }

  function generateScimToken() {
    // Generate a random token client-side, save it to backend
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    setGeneratedToken(token)
    // Save token hash on the server via settings
    patch('scim_bearer_token', token)
  }

  const inputCls =
    'w-full rounded-xl border border-white/10 bg-slate-800/60 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40'
  const labelCls = 'block text-sm text-slate-300 mb-1'

  return (
    <FeatureGate feature="sso">
      <div className="space-y-6">
        {/* ─── SSO Configuration ─────────────────────────────── */}
        <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
          <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">
            🔐 Single Sign-On (SSO)
          </h3>

          {/* Enable toggle */}
          <div className="flex items-center gap-3 mb-4">
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={settings.sso_enabled}
                onChange={(e) => patch('sso_enabled', e.target.checked)}
                className="peer sr-only"
              />
              <div className="h-6 w-11 rounded-full bg-slate-700 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-sky-500 peer-checked:after:translate-x-full" />
            </label>
            <span className="text-sm text-slate-300">Enable SSO</span>
          </div>

          {/* Provider dropdown */}
          <div className="mb-4">
            <label className={labelCls}>Identity Provider</label>
            <select
              value={settings.sso_provider}
              onChange={(e) => handleProviderChange(e.target.value as SsoProvider)}
              className={inputCls}
            >
              <option value="">Select a provider…</option>
              <option value="oidc">OIDC (OpenID Connect)</option>
              <option value="saml">SAML 2.0</option>
              <option value="auth0">Auth0 (OIDC Preset)</option>
              <option value="ldap">LDAP Directory Sync</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">Only one SSO provider can be active at a time.</p>
          </div>

          {/* ─── OIDC / Auth0 Config ──────────────────────────── */}
          {(settings.sso_provider === 'oidc' || settings.sso_provider === 'auth0') && (
            <div className="space-y-3 rounded-xl border border-white/5 bg-slate-800/30 p-4">
              <h4 className="text-sm font-semibold text-sky-400">
                {settings.sso_provider === 'auth0' ? 'Auth0 Configuration' : 'OIDC Configuration'}
              </h4>
              <div>
                <label className={labelCls}>
                  {settings.sso_provider === 'auth0' ? 'Auth0 Domain' : 'Issuer URL'}
                </label>
                <input
                  value={settings.sso_oidc_issuer_url}
                  onChange={(e) => patch('sso_oidc_issuer_url', e.target.value)}
                  className={inputCls}
                  placeholder={
                    settings.sso_provider === 'auth0'
                      ? 'your-tenant.auth0.com'
                      : 'https://accounts.google.com'
                  }
                />
                {settings.sso_provider === 'auth0' && (
                  <p className="mt-1 text-xs text-slate-500">
                    Enter your Auth0 tenant domain (e.g. your-tenant.auth0.com). The OIDC discovery URL will be auto-constructed.
                  </p>
                )}
              </div>
              <div>
                <label className={labelCls}>Client ID</label>
                <input
                  value={settings.sso_oidc_client_id}
                  onChange={(e) => patch('sso_oidc_client_id', e.target.value)}
                  className={inputCls}
                  placeholder="your-client-id"
                />
              </div>
              <div>
                <label className={labelCls}>Client Secret</label>
                <input
                  type="password"
                  value={settings.sso_oidc_client_secret}
                  onChange={(e) => patch('sso_oidc_client_secret', e.target.value)}
                  className={inputCls}
                  placeholder="your-client-secret"
                />
              </div>
              <p className="text-xs text-slate-500">
                <strong>Callback URL:</strong>{' '}
                <code className="rounded bg-slate-700 px-1 py-0.5">{window.location.origin}/auth/sso/callback</code>
              </p>
            </div>
          )}

          {/* ─── SAML Config ──────────────────────────────────── */}
          {settings.sso_provider === 'saml' && (
            <div className="space-y-3 rounded-xl border border-white/5 bg-slate-800/30 p-4">
              <h4 className="text-sm font-semibold text-sky-400">SAML 2.0 Configuration</h4>
              <div>
                <label className={labelCls}>SP Entity ID</label>
                <input
                  value={settings.sso_saml_entity_id}
                  onChange={(e) => patch('sso_saml_entity_id', e.target.value)}
                  className={inputCls}
                  placeholder="https://your-decentra.com/saml/metadata"
                />
              </div>
              <div>
                <label className={labelCls}>IdP SSO URL</label>
                <input
                  value={settings.sso_saml_sso_url}
                  onChange={(e) => patch('sso_saml_sso_url', e.target.value)}
                  className={inputCls}
                  placeholder="https://idp.example.com/saml2/sso"
                />
              </div>
              <div>
                <label className={labelCls}>IdP Certificate (PEM)</label>
                <textarea
                  value={settings.sso_saml_certificate}
                  onChange={(e) => patch('sso_saml_certificate', e.target.value)}
                  className={inputCls + ' h-32 font-mono text-xs'}
                  placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                />
              </div>
              <p className="text-xs text-slate-500">
                <strong>ACS URL:</strong>{' '}
                <code className="rounded bg-slate-700 px-1 py-0.5">{window.location.origin}/auth/sso/callback</code>
              </p>
            </div>
          )}

          {/* ─── LDAP Config ──────────────────────────────────── */}
          {settings.sso_provider === 'ldap' && (
            <div className="space-y-3 rounded-xl border border-white/5 bg-slate-800/30 p-4">
              <h4 className="text-sm font-semibold text-sky-400">LDAP Directory Sync</h4>
              <p className="text-xs text-slate-400 mb-2">
                LDAP is used for user directory synchronisation, not direct browser-based login.
                Users synced via LDAP are provisioned automatically.
              </p>
              <div>
                <label className={labelCls}>Server URL</label>
                <input
                  value={settings.sso_ldap_server_url}
                  onChange={(e) => patch('sso_ldap_server_url', e.target.value)}
                  className={inputCls}
                  placeholder="ldaps://ldap.example.com:636"
                />
              </div>
              <div>
                <label className={labelCls}>Bind DN</label>
                <input
                  value={settings.sso_ldap_bind_dn}
                  onChange={(e) => patch('sso_ldap_bind_dn', e.target.value)}
                  className={inputCls}
                  placeholder="cn=admin,dc=example,dc=com"
                />
              </div>
              <div>
                <label className={labelCls}>Bind Password</label>
                <input
                  type="password"
                  value={settings.sso_ldap_bind_password}
                  onChange={(e) => patch('sso_ldap_bind_password', e.target.value)}
                  className={inputCls}
                  placeholder="Password"
                />
              </div>
              <div>
                <label className={labelCls}>User Search Base</label>
                <input
                  value={settings.sso_ldap_user_search_base}
                  onChange={(e) => patch('sso_ldap_user_search_base', e.target.value)}
                  className={inputCls}
                  placeholder="ou=users,dc=example,dc=com"
                />
              </div>
              <div>
                <label className={labelCls}>User Filter</label>
                <input
                  value={settings.sso_ldap_user_filter}
                  onChange={(e) => patch('sso_ldap_user_filter', e.target.value)}
                  className={inputCls}
                  placeholder="(uid={username})"
                />
              </div>
            </div>
          )}

          {/* ─── Test & Save ──────────────────────────────────── */}
          {settings.sso_provider && (
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={testConnection}
                disabled={testing}
                className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2 text-sm font-semibold text-sky-300 hover:bg-sky-500/20 disabled:opacity-50"
              >
                {testing ? 'Testing…' : 'Test Connection'}
              </button>
              <button
                type="button"
                onClick={save}
                className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
              >
                Save SSO Settings
              </button>
              {saved && (
                <span className="text-sm text-emerald-400">✓ Saved</span>
              )}
            </div>
          )}

          {testResult && (
            <div
              className={`mt-3 rounded-xl border px-3 py-2 text-sm ${
                testResult.success
                  ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                  : 'border-rose-500/25 bg-rose-500/10 text-rose-300'
              }`}
            >
              {testResult.success ? '✓' : '✗'} {testResult.message}
            </div>
          )}
        </section>

        {/* ─── SCIM Provisioning ─────────────────────────────── */}
        <section className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
          <h3 className="mb-4 text-base font-semibold text-white border-b border-sky-500/30 pb-2">
            👥 SCIM 2.0 Provisioning
          </h3>
          <p className="text-sm text-slate-400 mb-3">
            SCIM enables automatic user and group provisioning from your identity provider
            (Okta, Google Workspace, Microsoft Entra ID, etc).
          </p>

          {/* Enable toggle */}
          <div className="flex items-center gap-3 mb-4">
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={settings.scim_enabled}
                onChange={(e) => patch('scim_enabled', e.target.checked)}
                className="peer sr-only"
              />
              <div className="h-6 w-11 rounded-full bg-slate-700 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all peer-checked:bg-sky-500 peer-checked:after:translate-x-full" />
            </label>
            <span className="text-sm text-slate-300">Enable SCIM Provisioning</span>
          </div>

          {settings.scim_enabled && (
            <div className="space-y-3 rounded-xl border border-white/5 bg-slate-800/30 p-4">
              <div>
                <label className={labelCls}>SCIM Base URL</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-300">
                    {window.location.origin}/scim/v2
                  </code>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(`${window.location.origin}/scim/v2`)}
                    className="rounded-lg bg-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-600"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div>
                <label className={labelCls}>Bearer Token</label>
                {generatedToken ? (
                  <div className="space-y-2">
                    <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                      ⚠ Copy this token now — it will not be shown again.
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 break-all rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-300 font-mono">
                        {generatedToken}
                      </code>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(generatedToken)}
                        className="rounded-lg bg-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-600"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    {settings.scim_bearer_token && settings.scim_bearer_token !== '' ? (
                      <span className="text-sm text-slate-400">Token configured ••••••••</span>
                    ) : (
                      <span className="text-sm text-slate-500">No token generated</span>
                    )}
                    <button
                      type="button"
                      onClick={generateScimToken}
                      className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/20"
                    >
                      Generate New Token
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  onClick={save}
                  className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
                >
                  Save SCIM Settings
                </button>
                {saved && (
                  <span className="ml-3 text-sm text-emerald-400">✓ Saved</span>
                )}
              </div>

              <div className="mt-3 rounded-xl border border-white/5 bg-slate-800/20 p-3">
                <h5 className="text-xs font-semibold text-slate-400 mb-2">Provider Setup Guides</h5>
                <ul className="space-y-1 text-xs text-slate-500">
                  <li>
                    <strong className="text-slate-400">Okta:</strong> Add SCIM integration → Provisioning → Base URL + Token
                  </li>
                  <li>
                    <strong className="text-slate-400">Google Workspace:</strong> Custom SAML App → Auto-provisioning → SCIM endpoint
                  </li>
                  <li>
                    <strong className="text-slate-400">Microsoft Entra ID:</strong> Enterprise App → Provisioning → SCIM connector
                  </li>
                </ul>
              </div>
            </div>
          )}
        </section>
      </div>
    </FeatureGate>
  )
}
