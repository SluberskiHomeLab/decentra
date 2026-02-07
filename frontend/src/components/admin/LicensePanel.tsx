import { useState } from 'react'
import { useLicenseStore } from '../../store/licenseStore'
import { wsClient } from '../../api/wsClient'
import type { LicenseFeatures, LicenseLimits } from '../../types/protocol'

const FEATURE_LABELS: Record<keyof LicenseFeatures, string> = {
  voice_chat: 'Voice Chat',
  file_uploads: 'File Uploads',
  webhooks: 'Webhooks',
  custom_emojis: 'Custom Emojis',
  audit_logs: 'Audit Logs',
  sso: 'Single Sign-On (SSO)',
}

const LIMIT_LABELS: Record<keyof LicenseLimits, string> = {
  max_users: 'Max Users',
  max_servers: 'Max Servers',
  max_channels_per_server: 'Channels per Server',
  max_file_size_mb: 'Max File Size (MB)',
  max_messages_history: 'Message History',
}

const TIER_COLORS: Record<string, string> = {
  free: '#72767d',
  professional: '#5865f2',
  enterprise: '#9b59b6',
}

function TierBadge({ tier }: { tier: string }) {
  const color = TIER_COLORS[tier.toLowerCase()] ?? '#72767d'
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white"
      style={{ backgroundColor: color }}
    >
      {tier}
    </span>
  )
}

function FeatureRow({ name, enabled }: { name: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-[#202225] px-3 py-2">
      <span className="text-sm text-[#dcddde]">{name}</span>
      {enabled ? (
        <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-5 w-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      )}
    </div>
  )
}

function LimitRow({ name, value }: { name: string; value: number }) {
  const isUnlimited = value === -1
  const displayValue = isUnlimited ? 'Unlimited' : value.toLocaleString()

  const pct = 100 // Full bar for now (no usage data from server yet)
  const barColor = isUnlimited ? 'bg-blue-500' : pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-green-500'

  return (
    <div className="rounded-md bg-[#202225] px-3 py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-[#dcddde]">{name}</span>
        <span className="text-sm font-medium text-white">{displayValue}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-[#40444b]">
        <div
          className={`h-1.5 rounded-full ${barColor} transition-all duration-300`}
          style={{ width: isUnlimited ? '100%' : '0%' }}
        />
      </div>
    </div>
  )
}

export function LicensePanel() {
  const { tier, features, limits, customer, expiresAt, isAdmin, loading } = useLicenseStore()
  const [licenseKey, setLicenseKey] = useState('')
  const [activating, setActivating] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const handleActivate = () => {
    const trimmed = licenseKey.trim()
    if (!trimmed) {
      setFeedback({ kind: 'error', message: 'Please enter a license key.' })
      return
    }
    setActivating(true)
    setFeedback(null)
    try {
      wsClient.updateLicense(trimmed)
      setFeedback({ kind: 'success', message: 'License key submitted. Waiting for server response...' })
      setLicenseKey('')
    } catch {
      setFeedback({ kind: 'error', message: 'Failed to send license key. Check your connection.' })
    } finally {
      setActivating(false)
    }
  }

  const handleRemove = () => {
    if (!confirmRemove) {
      setConfirmRemove(true)
      return
    }
    try {
      wsClient.removeLicense()
      setFeedback({ kind: 'success', message: 'License removal requested.' })
    } catch {
      setFeedback({ kind: 'error', message: 'Failed to remove license. Check your connection.' })
    }
    setConfirmRemove(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#5865f2] border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      {/* ── License Status Card ────────────────────────── */}
      <div className="rounded-lg bg-[#2f3136] border border-[#40444b] p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">License Status</h2>
            <div className="flex items-center gap-3 mt-2">
              <TierBadge tier={tier} />
              {expiresAt && (
                <span className="text-xs text-[#b9bbbe]">
                  Expires: {new Date(expiresAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
          {tier.toLowerCase() !== 'free' && (
            <div className="flex items-center gap-1 text-green-400">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="text-xs font-medium">Active</span>
            </div>
          )}
        </div>

        {isAdmin && customer && (
          <div className="mt-4 rounded-md bg-[#202225] p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[#72767d] mb-2">Customer Info</h3>
            <div className="space-y-1 text-sm text-[#dcddde]">
              <p><span className="text-[#72767d]">Name:</span> {customer.name}</p>
              <p><span className="text-[#72767d]">Email:</span> {customer.email}</p>
              <p><span className="text-[#72767d]">Company:</span> {customer.company}</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Feature Matrix ─────────────────────────────── */}
      <div className="rounded-lg bg-[#2f3136] border border-[#40444b] p-5">
        <h2 className="text-lg font-semibold text-white mb-3">Features</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(Object.keys(FEATURE_LABELS) as Array<keyof LicenseFeatures>).map((key) => (
            <FeatureRow key={key} name={FEATURE_LABELS[key]} enabled={features[key]} />
          ))}
        </div>
      </div>

      {/* ── Limits Dashboard ───────────────────────────── */}
      <div className="rounded-lg bg-[#2f3136] border border-[#40444b] p-5">
        <h2 className="text-lg font-semibold text-white mb-3">Limits</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(Object.keys(LIMIT_LABELS) as Array<keyof LicenseLimits>).map((key) => (
            <LimitRow key={key} name={LIMIT_LABELS[key]} value={limits[key]} />
          ))}
        </div>
      </div>

      {/* ── License Key Input ──────────────────────────── */}
      {isAdmin && (
        <div className="rounded-lg bg-[#2f3136] border border-[#40444b] p-5">
          <h2 className="text-lg font-semibold text-white mb-3">Activate License</h2>
          <textarea
            className="w-full rounded-md border border-[#40444b] bg-[#202225] px-3 py-2 text-sm text-white placeholder-[#72767d] focus:border-[#5865f2] focus:outline-none focus:ring-1 focus:ring-[#5865f2] resize-none"
            rows={3}
            placeholder="Paste your license key here..."
            value={licenseKey}
            onChange={(e) => {
              setLicenseKey(e.target.value)
              setFeedback(null)
            }}
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              className="rounded-md bg-[#5865f2] px-4 py-2 text-sm font-medium text-white hover:bg-[#4752c4] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleActivate}
              disabled={activating || !licenseKey.trim()}
            >
              {activating ? 'Activating...' : 'Activate License'}
            </button>

            {tier.toLowerCase() !== 'free' && (
              <button
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  confirmRemove
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-transparent border border-red-500 text-red-400 hover:bg-red-500/10'
                }`}
                onClick={handleRemove}
                onBlur={() => setConfirmRemove(false)}
              >
                {confirmRemove ? 'Are you sure?' : 'Remove License'}
              </button>
            )}
          </div>

          {feedback && (
            <div
              className={`mt-3 rounded-md px-3 py-2 text-sm ${
                feedback.kind === 'success'
                  ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                  : 'bg-red-500/10 border border-red-500/30 text-red-400'
              }`}
            >
              {feedback.message}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
