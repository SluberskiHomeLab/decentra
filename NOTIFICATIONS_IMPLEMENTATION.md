# Browser Notifications Implementation

## Overview
Browser notifications have been fully implemented and integrated into the Decentra chat application. The system provides desktop notifications for mentions, replies, and messages based on user preferences. **Notifications automatically appear in the Windows Action Center (system tray)** when using Chrome, Edge, or other Chromium-based browsers.

## What Was Implemented

### 1. Notification Manager Utility (`frontend/src/utils/notifications.ts`)
A comprehensive notification manager class that handles:
- Browser notification permission management
- Permission status checking and requesting
- Notification display with auto-close (8 seconds)
- Click-to-focus functionality
- Comprehensive error handling and logging
- Specialized notification methods for:
  - Mentions
  - Replies
  - Regular messages
  - Voice calls

**Key Features:**
- Shows notifications even when app is visible (no longer requires page to be in background)
- Automatically integrates with Windows Action Center on Windows 10/11
- Console logging for debugging (`[Notifications]` prefix)
- Error event handlers for troubleshooting

### 2. Frontend Integration (`frontend/src/App.tsx`)

#### Added Features:
- **Import of notification manager** - Integrated the notification utility
- **State management** - Added `notificationPermission` state to track permission status
- **Permission check on mount** - Automatically checks notification permission when app loads
- **Mention notification handler** - Added handler for `mention_notification` WebSocket messages with console logging
- **Enhanced reply notification handler** - Updated to show browser notifications alongside toasts with console logging
- **Message notification handler** - Shows notifications for regular messages when `notificationMode` is set to 'all' with console logging
- **Test notification button** - Instant test button to verify notifications are working
- **Notification UI** - Complete settings panel for:
  - Requesting browser notification permission
  - Displaying current permission status (Enabled/Blocked/Not requested)
  - Test notification button (appears when permission is granted)
  - Selection of notification mode (All messages / Only mentions and replies / None)
  - Visual feedback for permission status

#### Notification Behavior:
- **Shows notifications immediately** - No longer requires page to be in background (easier testing and better UX)
- **Windows integration** - Notifications automatically appear in Windows Action Center (system tray)
- **Respects notification mode**:
  - `all`: Shows notifications for all messages from other users
  - `mentions`: Shows only mention and reply notifications
  - `none`: No notifications
- **Auto-closes after 8 seconds** - Prevents notification accumulation
- **Click to focus** - Clicking a notification brings the app window to focus
- **Console logging** - All notifications log to console for debugging (look for `[Notifications]` prefix)

### 3. Server-Side Support
The server already had notification support implemented:
- Sends `mention_notification` messages when users are mentioned
- Sends `reply_notification` messages when someone replies to a message
- Stores and syncs `notification_mode` preference per user

## How to Test

### 1. Enable Notifications
1. Open the application
2. Go to Settings (user menu)
3. Scroll to the "Notifications" section
4. Click "Enable Notifications" button
5. Accept the browser permission prompt
6. A test notification should appear immediately saying "Notifications Enabled!"
7. **Check your Windows Action Center** (system tray) - the notification should appear there

### 2. Test Using Test Button (Quickest Way)
1. After enabling notifications, a "Test Notification" button will appear
2. Click the button
3. A test notification should appear immediately
4. **On Windows**: Check the Action Center (bottom-right corner of taskbar)
5. If you see the notification, the system is working correctly

### 3. Test Mention Notifications
1. Have another user mention you using @username
2. You should receive a desktop notification with the mention
3. **No need to switch tabs** - notifications now show even when app is visible
4. Click the notification to focus the app
5. Check Windows Action Center for notification history

### 4. Test Reply Notifications
1. Send a message in any channel or DM
2. Have another user reply to your message
3. You should receive a desktop notification with the reply
4. Click the notification to focus the app

### 5. Test Message Notifications (All mode)
1. Ensure notification mode is set to "All messages"
2. Click "Save Notification Settings"
3. Have another user send any message
4. You should receive a desktop notification
5. **Check console logs**: Open DevTools (F12) and look for `[Notifications]` logs

### 6. Test Notification Modes
- **All messages**: Should notify for all incoming messages (set this first, save, then have someone send a message)
- **Only mentions and replies**: Should only notify when mentioned or replied to
- **None**: Should not show any notifications

### 7. Debugging
If notifications aren't showing:
1. Open browser DevTools (F12)
2. Go to Console tab
3. Look for `[Notifications]` logs
4. Check for error messages
5. Verify permission status in logs

## Technical Details

### Windows System Tray Integration
**Browser notifications automatically integrate with Windows 10/11 Action Center**:
- Notifications appear as native Windows notifications
- They stack in the Action Center (notification icon in taskbar)
- Clicking them focuses the browser window
- They respect Windows notification settings
- They appear even if browser is minimized or in background

**No additional code needed** - This is built into the browser Notification API when running on Windows.

### Notification Permission States
- **default**: User has not been asked for permission yet
- **granted**: User has allowed notifications
- **denied**: User has blocked notifications (must be enabled in browser settings)

### Notification Tags
- `mention`: For mention notifications
- `reply`: For reply notifications
- `message`: For regular message notifications
- `call`: For voice call notifications

### Browser Compatibility
The notification system uses the standard Notification API which is supported in:
- Chrome/Edge 22+
- Firefox 22+
- Safari 6+
- Opera 25+

Not supported in:
- Internet Explorer (use a modern browser)

## Files Modified

1. **frontend/src/utils/notifications.ts** (NEW)
   - Notification manager utility class
   - Handles all browser notification logic

2. **frontend/src/App.tsx**
   - Added notification manager import
   - Added `notificationPermission` state
   - Added `mention_notification` message handler
   - Enhanced `reply_notification` handler with browser notifications
   - Added browser notifications for regular messages
   - Added notification permission check on mount
   - Added comprehensive notification settings UI

## Future Enhancements (Optional)

1. **Sound customization** - Add sound options for different notification types
2. **Persistent storage** - Remember permission state across sessions
3. **Notification grouping** - Group multiple notifications from same context
4. **Do Not Disturb mode** - Temporarily disable all notifications
5. **Custom notification sounds** - Per-channel or per-contact notification sounds
6. **Notification history** - View past notifications you might have missed

## Troubleshooting

### Notifications Not Showing

#### Step 1: Check Permission
1. Go to Settings → Notifications
2. Check that permission status shows "Enabled" (green)
3. If not, click "Enable Notifications" and accept the prompt

#### Step 2: Test with Test Button
1. Click the "Test Notification" button
2. Look for the notification popup
3. **On Windows**: Check Action Center (click notification icon in taskbar, bottom-right)
4. Check browser console (F12) for `[Notifications]` logs

#### Step 3: Check Browser Console
1. Press F12 to open DevTools
2. Go to Console tab
3. Look for messages with `[Notifications]` prefix:
   - `[Notifications] Attempting to show notification:` - Notification was requested
   - `[Notifications] Current permission:` - Shows permission status
   - `[Notifications] Notification shown successfully` - Notification was created
   - `[Notifications] Notification permission not granted` - Need to enable permission

#### Step 4: Check Notification Mode
1. Ensure notification mode is NOT set to "None"
2. For testing, set to "All messages"
3. Click "Save Notification Settings"
4. Try having another user send a message

#### Step 5: Check Browser Settings
1. Look in browser address bar for a notification icon
2. Click it and ensure notifications are allowed for this site
3. Check browser settings (see below)

### Permission Blocked
If notifications are blocked:
1. Click the lock/info icon in the browser address bar
2. Find "Notifications" permission
3. Change from "Block" to "Allow"
4. Refresh the page
5. Go to Settings → Notifications and enable again

### Windows Action Center Not Showing Notifications
1. Right-click the Windows taskbar notification icon
2. Ensure "Focus Assist" is OFF (or set to "Priority only" and add browser to priority list)
3. Go to Windows Settings → System → Notifications & actions
4. Ensure notifications are enabled for your browser
5. Ensure "Do Not Disturb" mode is disabled

### Browser-Specific Issues
- **Chrome/Edge**: Check chrome://settings/content/notifications
  - Ensure the site is in "Allowed" list
  - Check that "Use quieter messaging" is disabled
- **Firefox**: Check about:preferences#privacy (Permissions → Notifications)
  - Ensure the site has notification permission
- **Safari**: Check Safari → Preferences → Websites → Notifications
  - Ensure the site is set to "Allow"

### Still Not Working?
1. Open browser console (F12)
2. Copy all `[Notifications]` log messages
3. Check if there are any error messages
4. Verify `[Notifications] Current permission:` shows `granted`
5. Try closing and reopening the browser
6. Try clearing browser cache and re-enabling notifications

## Status
✅ **COMPLETE** - Browser notifications are fully implemented and functional.
