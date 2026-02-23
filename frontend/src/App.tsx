import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { getStoredAuth } from './auth/storage'
import { useAppStore } from './store/appStore'
import { ToastHost } from './components/ToastHost'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { SignUpPage } from './pages/SignUpPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { ChatPage } from './pages/ChatPage'
import './App.css'

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