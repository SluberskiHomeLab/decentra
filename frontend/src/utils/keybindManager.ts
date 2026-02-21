import { useSettingsStore } from '../store/settingsStore'
import type { Keybinds } from '../store/settingsStore'

type KeybindAction = keyof Keybinds

type KeybindCallback = () => void

class KeybindManager {
  private callbacks: Map<KeybindAction, KeybindCallback> = new Map()
  private activeKeys: Set<string> = new Set()
  private isEnabled = true

  constructor() {
    this.handleKeyDown = this.handleKeyDown.bind(this)
    this.handleKeyUp = this.handleKeyUp.bind(this)
  }

  /**
   * Initialize the keybind manager and start listening for keyboard events
   */
  init() {
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('keyup', this.handleKeyUp)
  }

  /**
   * Cleanup and remove event listeners
   */
  destroy() {
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
    this.callbacks.clear()
    this.activeKeys.clear()
  }

  /**
   * Register a callback for a specific keybind action
   */
  on(action: KeybindAction, callback: KeybindCallback) {
    this.callbacks.set(action, callback)
  }

  /**
   * Unregister a callback for a specific action
   */
  off(action: KeybindAction) {
    this.callbacks.delete(action)
  }

  /**
   * Enable the keybind manager
   */
  enable() {
    this.isEnabled = true
  }

  /**
   * Disable the keybind manager (useful when typing in inputs)
   */
  disable() {
    this.isEnabled = false
    this.activeKeys.clear()
  }

  /**
   * Check if the target element is an input field where we should ignore keybinds
   */
  private isInputElement(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false
    
    const tagName = target.tagName.toLowerCase()
    const isContentEditable = target.isContentEditable
    
    return (
      tagName === 'input' ||
      tagName === 'textarea' ||
      tagName === 'select' ||
      isContentEditable
    )
  }

  /**
   * Handle keydown events
   */
  private handleKeyDown(event: KeyboardEvent) {
    if (!this.isEnabled) return
    if (this.isInputElement(event.target)) return

    const keyCode = event.code
    
    // Track active keys for push-to-talk
    this.activeKeys.add(keyCode)

    // Get current keybinds from store
    const keybinds = useSettingsStore.getState().keybinds

    // Check if this key matches any keybind (except push_to_talk which is handled in keyup)
    for (const [action, key] of Object.entries(keybinds)) {
      if (key === keyCode && action !== 'push_to_talk') {
        const callback = this.callbacks.get(action as KeybindAction)
        if (callback) {
          event.preventDefault()
          callback()
        }
      }
    }

    // Handle push-to-talk (activate on keydown)
    if (keybinds.push_to_talk === keyCode) {
      const callback = this.callbacks.get('push_to_talk')
      if (callback) {
        event.preventDefault()
        // Special handling: PTT activates on keydown
        callback()
      }
    }
  }

  /**
   * Handle keyup events
   */
  private handleKeyUp(event: KeyboardEvent) {
    if (!this.isEnabled) return
    if (this.isInputElement(event.target)) return

    const keyCode = event.code
    this.activeKeys.delete(keyCode)

    // Get current keybinds from store
    const keybinds = useSettingsStore.getState().keybinds

    // Deactivate push-to-talk on keyup
    if (keybinds.push_to_talk === keyCode) {
      // We'll use a special callback for PTT release
      const callback = this.callbacks.get('push_to_talk')
      if (callback) {
        event.preventDefault()
        // Call again to toggle back (PTT is hold-to-talk)
        callback()
      }
    }
  }

  /**
   * Check if a specific key is currently pressed
   */
  isKeyPressed(keyCode: string): boolean {
    return this.activeKeys.has(keyCode)
  }

  /**
   * Get all currently pressed keys
   */
  getActiveKeys(): string[] {
    return Array.from(this.activeKeys)
  }

  /**
   * Validate if a key code would conflict with existing keybinds
   * Returns the conflicting action name if there's a conflict, null otherwise
   */
  getKeyConflict(keyCode: string, excludeAction?: KeybindAction): KeybindAction | null {
    const keybinds = useSettingsStore.getState().keybinds
    
    for (const [action, key] of Object.entries(keybinds)) {
      if (key === keyCode && action !== excludeAction) {
        return action as KeybindAction
      }
    }
    
    return null
  }
}

// Export a singleton instance
export const keybindManager = new KeybindManager()

/**
 * Get a human-readable label for a key code
 */
export function getKeyLabel(keyCode: string): string {
  // Common key mappings
  const keyLabels: Record<string, string> = {
    KeyA: 'A', KeyB: 'B', KeyC: 'C', KeyD: 'D', KeyE: 'E',
    KeyF: 'F', KeyG: 'G', KeyH: 'H', KeyI: 'I', KeyJ: 'J',
    KeyK: 'K', KeyL: 'L', KeyM: 'M', KeyN: 'N', KeyO: 'O',
    KeyP: 'P', KeyQ: 'Q', KeyR: 'R', KeyS: 'S', KeyT: 'T',
    KeyU: 'U', KeyV: 'V', KeyW: 'W', KeyX: 'X', KeyY: 'Y', KeyZ: 'Z',
    Digit0: '0', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4',
    Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9',
    Space: 'Space',
    Enter: 'Enter',
    Escape: 'Escape',
    Backspace: 'Backspace',
    Tab: 'Tab',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
    MetaLeft: 'Left Meta',
    MetaRight: 'Right Meta',
    ArrowUp: 'Up Arrow',
    ArrowDown: 'Down Arrow',
    ArrowLeft: 'Left Arrow',
    ArrowRight: 'Right Arrow',
    F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
    F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
  }

  return keyLabels[keyCode] || keyCode
}

/**
 * Get a human-readable label for a keybind action
 */
export function getActionLabel(action: KeybindAction): string {
  const actionLabels: Record<KeybindAction, string> = {
    push_to_talk: 'Push to Talk',
    toggle_mute: 'Toggle Mute',
    toggle_deafen: 'Toggle Deafen',
    toggle_video: 'Toggle Video',
    toggle_screen_share: 'Toggle Screen Share',
    answer_end_call: 'Answer/End Call',
  }

  return actionLabels[action] || action
}
