import { useState } from 'react'
import type { Keybinds } from '../store/settingsStore'

export type ServerSettingsTab = 'overview' | 'channels' | 'roles' | 'customization' | 'automations' | 'members' | 'audit'
export type AdminSettingsTab = 'general' | 'email' | 'announcements' | 'license' | 'webhooks' | 'users' | 'sso'
export type AccountSettingsTab = 'profile' | 'security' | 'notifications' | 'keybinds'

export function useChatLayoutState() {
  // Sidebar / panel toggles
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isDmSidebarOpen, setIsDmSidebarOpen] = useState(false)
  const [isMembersSidebarOpen, setIsMembersSidebarOpen] = useState(true)
  const [showPinsPanel, setShowPinsPanel] = useState(false)
  const [isSoundboardOpen, setIsSoundboardOpen] = useState(false)

  // Modal toggles
  const [isServerSettingsOpen, setIsServerSettingsOpen] = useState(false)
  const [serverSettingsTab, setServerSettingsTab] = useState<ServerSettingsTab>('overview')
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false)
  const [accountSettingsTab, setAccountSettingsTab] = useState<AccountSettingsTab>('profile')
  const [isAdminMode, setIsAdminMode] = useState(false)
  const [adminSettingsTab, setAdminSettingsTab] = useState<AdminSettingsTab>('general')

  // Keybind rebinding UI state
  const [rebindingAction, setRebindingAction] = useState<keyof Keybinds | null>(null)
  const [rebindConflict, setRebindConflict] = useState<string | null>(null)

  return {
    // Sidebar / panel toggles
    isUserMenuOpen, setIsUserMenuOpen,
    isDmSidebarOpen, setIsDmSidebarOpen,
    isMembersSidebarOpen, setIsMembersSidebarOpen,
    showPinsPanel, setShowPinsPanel,
    isSoundboardOpen, setIsSoundboardOpen,

    // Modal toggles
    isServerSettingsOpen, setIsServerSettingsOpen,
    serverSettingsTab, setServerSettingsTab,
    isAccountSettingsOpen, setIsAccountSettingsOpen,
    accountSettingsTab, setAccountSettingsTab,
    isAdminMode, setIsAdminMode,
    adminSettingsTab, setAdminSettingsTab,

    // Keybind rebinding
    rebindingAction, setRebindingAction,
    rebindConflict, setRebindConflict,
  }
}
