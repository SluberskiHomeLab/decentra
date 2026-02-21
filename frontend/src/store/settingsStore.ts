import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'dark' | 'light' | 'high_contrast'

export type Keybinds = {
  push_to_talk: string
  toggle_mute: string
  toggle_deafen: string
  toggle_video: string
  toggle_screen_share: string
  answer_end_call: string
}

export const DEFAULT_KEYBINDS: Keybinds = {
  push_to_talk: 'KeyV',
  toggle_mute: 'KeyM',
  toggle_deafen: 'KeyD',
  toggle_video: 'KeyC',
  toggle_screen_share: 'KeyS',
  answer_end_call: 'KeyA',
}

type SettingsState = {
  themeMode: ThemeMode
  keybinds: Keybinds
  
  setThemeMode: (theme: ThemeMode) => void
  setKeybind: (action: keyof Keybinds, key: string) => void
  setKeybinds: (keybinds: Keybinds) => void
  resetKeybinds: () => void
  loadPreferences: (theme: ThemeMode, keybinds: Keybinds) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: 'dark',
      keybinds: DEFAULT_KEYBINDS,

      setThemeMode: (theme) => set({ themeMode: theme }),
      
      setKeybind: (action, key) =>
        set((state) => ({
          keybinds: { ...state.keybinds, [action]: key },
        })),
      
      setKeybinds: (keybinds) => set({ keybinds }),
      
      resetKeybinds: () => set({ keybinds: DEFAULT_KEYBINDS }),
      
      loadPreferences: (theme, keybinds) =>
        set({ themeMode: theme, keybinds }),
    }),
    {
      name: 'decentra-settings',
      // Only persist as fallback; preferences primarily come from backend
      partialize: (state) => ({
        themeMode: state.themeMode,
        keybinds: state.keybinds,
      }),
    }
  )
)
