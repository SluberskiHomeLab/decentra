import { useLicenseStore } from '../store/licenseStore'
import type { LicenseFeatures } from '../types/protocol'

interface FeatureGateProps {
  feature: keyof LicenseFeatures
  fallback?: React.ReactNode
  children: React.ReactNode
}

export function FeatureGate({ feature, fallback, children }: FeatureGateProps) {
  const hasFeature = useLicenseStore((s) => s.features[feature])

  if (!hasFeature) {
    return fallback ? <>{fallback}</> : (
      <div className="flex items-center gap-2 rounded-lg bg-[#2f3136] border border-[#40444b] p-4 text-[#b9bbbe]">
        <svg className="w-5 h-5 text-yellow-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
        </svg>
        <div>
          <p className="text-sm font-medium text-white">Feature unavailable</p>
          <p className="text-xs text-[#72767d]">
            This feature requires a Professional or Enterprise license. Contact your administrator.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
