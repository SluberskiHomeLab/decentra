import React from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAppStore } from '../store/appStore'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const authToken = useAppStore((s) => s.authToken)
  const [searchParams] = useSearchParams()

  if (!authToken) {
    // Preserve server_invite parameter when redirecting to login
    const serverInvite = searchParams.get('server_invite')
    const redirectPath = serverInvite ? `/login?redirect=chat&server_invite=${serverInvite}` : '/login'
    return <Navigate to={redirectPath} replace />
  }

  return <>{children}</>
}
