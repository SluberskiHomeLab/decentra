/**
 * Browser Notifications Manager
 * Handles desktop notifications with permission management
 */

export class NotificationManager {
  private static instance: NotificationManager
  private permission: NotificationPermission = 'default'
  private debug: boolean = import.meta.env.DEV ?? false

  private constructor() {
    if ('Notification' in window) {
      this.permission = Notification.permission
    }
  }

  static getInstance(): NotificationManager {
    if (!NotificationManager.instance) {
      NotificationManager.instance = new NotificationManager()
    }
    return NotificationManager.instance
  }

  /**
   * Enable debug logging (for development/troubleshooting only)
   */
  setDebug(enabled: boolean): void {
    this.debug = enabled
  }

  /**
   * Check if notifications are supported
   */
  isSupported(): boolean {
    return 'Notification' in window
  }

  /**
   * Get current permission status
   */
  getPermission(): NotificationPermission {
    if (!this.isSupported()) return 'denied'
    return Notification.permission
  }

  /**
   * Request notification permission from user
   */
  async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported()) {
      return 'denied'
    }

    if (this.permission === 'granted') {
      return 'granted'
    }

    try {
      const permission = await Notification.requestPermission()
      this.permission = permission
      return permission
    } catch (error) {
      console.error('Failed to request notification permission:', error)
      return 'denied'
    }
  }

  /**
   * Show a browser notification
   * Only shows if:
   * - Notifications are supported
   * - Permission is granted
   * Notifications will show in system tray on Windows automatically
   */
  showNotification(title: string, options?: NotificationOptions): Notification | null {
    if (this.debug) {
      console.log('[Notifications] Attempting to show notification')
    }
    
    if (!this.isSupported()) {
      return null
    }

    const permission = this.getPermission()
    
    if (permission !== 'granted') {
      if (this.debug) {
        console.warn('[Notifications] Permission not granted:', permission)
      }
      return null
    }

    try {
      const notification = new Notification(title, {
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        requireInteraction: false,
        ...options,
      })

      // Auto-close after 8 seconds (longer for readability)
      setTimeout(() => {
        notification.close()
      }, 8000)

      // Focus window when notification is clicked
      notification.onclick = () => {
        window.focus()
        notification.close()
      }

      notification.onerror = (error) => {
        console.error('[Notifications] Error:', error)
      }

      return notification
    } catch (error) {
      console.error('[Notifications] Failed to show notification:', error)
      return null
    }
  }

  /**
   * Show notification for a mention
   */
  showMentionNotification(mentionedBy: string, content: string, _contextType: string): void {
    const preview = content.length > 100 ? content.substring(0, 100) + '...' : content
    this.showNotification(`${mentionedBy} mentioned you`, {
      body: preview,
      tag: 'mention',
      icon: '/favicon.ico',
    })
  }

  /**
   * Show notification for a reply
   */
  showReplyNotification(repliedBy: string, content: string): void {
    const preview = content.length > 100 ? content.substring(0, 100) + '...' : content
    this.showNotification(`${repliedBy} replied to you`, {
      body: preview,
      tag: 'reply',
      icon: '/favicon.ico',
    })
  }

  /**
   * Show notification for a new message
   */
  showMessageNotification(from: string, content: string, contextType: string): void {
    const preview = content.length > 100 ? content.substring(0, 100) + '...' : content
    const contextLabel = contextType === 'dm' ? 'sent you a message' : 'sent a message'
    this.showNotification(`${from} ${contextLabel}`, {
      body: preview,
      tag: 'message',
      icon: '/favicon.ico',
    })
  }

  /**
   * Show notification for a voice call
   */
  showCallNotification(caller: string, callType: 'voice' | 'video'): void {
    this.showNotification(`Incoming ${callType} call`, {
      body: `${caller} is calling you`,
      tag: 'call',
      requireInteraction: true, // Keep notification visible until user interacts
    })
  }
}

// Export singleton instance
export const notificationManager = NotificationManager.getInstance()
