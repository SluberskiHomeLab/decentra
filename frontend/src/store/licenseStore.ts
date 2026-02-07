import { create } from 'zustand'
import type { LicenseFeatures, LicenseLimits, LicenseInfo } from '../types/protocol'

interface LicenseState {
  tier: string
  features: LicenseFeatures
  limits: LicenseLimits
  customer: { name: string; email: string; company: string } | null
  expiresAt: string | null
  isAdmin: boolean
  loading: boolean

  setLicenseInfo: (info: LicenseInfo) => void
  hasFeature: (name: keyof LicenseFeatures) => boolean
  getLimit: (name: keyof LicenseLimits) => number
  isUnlimited: (name: keyof LicenseLimits) => boolean
  setLoading: (loading: boolean) => void
  clear: () => void
}

const DEFAULT_FEATURES: LicenseFeatures = {
  voice_chat: false,
  file_uploads: true,
  webhooks: false,
  custom_emojis: false,
  audit_logs: false,
  sso: false,
}

const DEFAULT_LIMITS: LicenseLimits = {
  max_users: 50,
  max_servers: 1,
  max_channels_per_server: 10,
  max_file_size_mb: 10,
  max_messages_history: 10000,
}

export const useLicenseStore = create<LicenseState>((set, get) => ({
  tier: 'free',
  features: { ...DEFAULT_FEATURES },
  limits: { ...DEFAULT_LIMITS },
  customer: null,
  expiresAt: null,
  isAdmin: false,
  loading: true,

  setLicenseInfo: (info) =>
    set({
      tier: info.tier,
      features: info.features,
      limits: info.limits,
      customer: info.customer || null,
      expiresAt: info.expires_at || null,
      isAdmin: info.is_admin,
      loading: false,
    }),

  hasFeature: (name) => get().features[name],
  getLimit: (name) => get().limits[name],
  isUnlimited: (name) => get().limits[name] === -1,
  setLoading: (loading) => set({ loading }),
  clear: () =>
    set({
      tier: 'free',
      features: { ...DEFAULT_FEATURES },
      limits: { ...DEFAULT_LIMITS },
      customer: null,
      expiresAt: null,
      loading: false,
    }),
}))
