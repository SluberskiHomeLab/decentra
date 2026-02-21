import { useEffect } from 'react'
import { useSettingsStore } from '../store/settingsStore'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeMode = useSettingsStore((state) => state.themeMode)

  useEffect(() => {
    // Apply theme to HTML element
    const root = document.documentElement
    root.setAttribute('data-theme', themeMode)
  }, [themeMode])

  return <>{children}</>
}
