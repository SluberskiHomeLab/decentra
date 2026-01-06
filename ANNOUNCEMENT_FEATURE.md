# Announcements Banner Feature

## Overview
This feature adds a configurable announcements banner to the top of the Decentra chat application. Admins can set announcement messages that appear to all users for a specified duration.

## Features Implemented

### 1. Database Schema
- Added 4 new columns to `admin_settings` table:
  - `announcement_enabled` (BOOLEAN, default: FALSE)
  - `announcement_message` (TEXT, default: '')
  - `announcement_duration_minutes` (INTEGER, default: 60)
  - `announcement_set_at` (TIMESTAMP, nullable)

### 2. Admin Configuration UI (`/static/adminconfig.html`)
New "Announcements" section with:
- **Enable Announcement Banner** - Checkbox to toggle announcements
- **Announcement Message** - Text input for the message
- **Display Duration** - Number input (1-10080 minutes = 1 minute to 7 days)

### 3. Chat Interface UI (`/static/chat.html`)
- Announcement banner positioned at top of page
- Contains message text and close button (✕)
- Initially hidden (collapsed)
- Slides down with animation when shown

### 4. Styling (`/static/styles.css`)
- Blue gradient background (#5865F2 to #7289da)
- Smooth slide-down animation
- Hover effects on close button
- Adjusts main container margin when visible

### 5. Server Logic (`server/server.py`)
- Sends announcement data to clients on connection
- Updates `announcement_set_at` timestamp when announcement is enabled/changed
- Broadcasts announcement updates to all connected clients
- Clears timestamp when announcement is disabled

### 6. Client Logic (`/static/chat.js`)
- Handles `announcement_update` WebSocket messages
- Checks if announcement has expired based on duration
- Stores dismissal in `localStorage` per announcement
- Shows announcement only if:
  - Enabled AND message is set
  - Not expired
  - Not dismissed by user
- Dismissal is specific to each announcement (by message + set_at)

## User Flow

### Admin Setting an Announcement
1. Admin navigates to Admin Configuration page
2. Scrolls to "Announcements" section
3. Checks "Enable Announcement Banner"
4. Enters message (e.g., "Server maintenance scheduled for tonight at 10 PM")
5. Sets duration (e.g., 240 minutes = 4 hours)
6. Clicks "Save Settings"
7. All connected users immediately see the announcement

### User Viewing/Dismissing Announcement
1. User logs in or is already connected
2. Banner slides down from top with announcement message
3. User reads the announcement
4. User clicks ✕ to dismiss
5. Banner slides up and disappears
6. Dismissal is remembered even after logout/login
7. If admin posts a new announcement, it will show again

### Announcement Expiration
- Announcements automatically hide after the configured duration
- Duration starts from when announcement is set/changed
- Users who dismissed the announcement won't see it even before expiration
- Expired announcements don't show to new users logging in

## Technical Details

### WebSocket Message Format
```json
{
  "type": "announcement_update",
  "enabled": true,
  "message": "Welcome to Decentra!",
  "duration_minutes": 60,
  "set_at": "2024-01-06T18:00:00.000Z"
}
```

### Dismissal Storage (localStorage)
```json
{
  "message": "Welcome to Decentra!",
  "set_at": "2024-01-06T18:00:00.000Z",
  "dismissed_at": "2024-01-06T18:15:00.000Z"
}
```

### Expiration Calculation
```javascript
const setAt = new Date(data.set_at);
const expiresAt = new Date(setAt.getTime() + data.duration_minutes * 60000);
const now = new Date();
const isExpired = now > expiresAt;
```

## Files Modified

1. `server/database.py` - Added announcement columns migration
2. `server/server.py` - Added announcement handling logic
3. `server/static/adminconfig.html` - Added announcement controls
4. `server/static/chat.html` - Added banner HTML
5. `server/static/chat.js` - Added banner logic
6. `server/static/styles.css` - Added banner styles

## Testing

All validation checks passed:
- ✓ Database schema migration code
- ✓ Server-side WebSocket handlers
- ✓ Admin UI controls
- ✓ Chat UI banner element
- ✓ Client-side JavaScript logic
- ✓ CSS styling and animations

## Screenshots / Mockup

### Admin Configuration Page
```
┌─────────────────────────────────────────────────────────┐
│ ⚙️ Admin Configuration                                  │
│ Site-wide settings for Decentra                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Announcements                                            │
│                                                          │
│ ☑ Enable Announcement Banner                            │
│   Display an announcement banner at the top of chat     │
│                                                          │
│ Announcement Message                                    │
│ The message to display in the announcement banner       │
│ ┌─────────────────────────────────────────────────┐    │
│ │ Server maintenance tonight at 10 PM              │    │
│ └─────────────────────────────────────────────────┘    │
│                                                          │
│ Display Duration (minutes)                              │
│ How long to display (1 minute to 7 days / 10080 min)   │
│ ┌────┐                                                  │
│ │ 240│ minutes                                          │
│ └────┘                                                  │
└─────────────────────────────────────────────────────────┘

[ Save Settings ]
```

### Chat Interface with Banner
```
┌─────────────────────────────────────────────────────────┐
│ 📢 Server maintenance tonight at 10 PM              ✕  │ ← Banner
└─────────────────────────────────────────────────────────┘
┌───────┬──────────┬──────────────────────────────────────┐
│       │          │ Decentra Chat                        │
│ Srv   │ Channels │                                      │
│       │          │ Messages appear here...              │
│ * Srv1│ #general │                                      │
│   Srv2│ #random  │                                      │
│       │          │                                      │
│ DMs   │          │                                      │
│ @ User│          │                                      │
│       │          │                                      │
│       │          │ [Type a message...]         [Send]   │
└───────┴──────────┴──────────────────────────────────────┘
```

### Banner States
1. **Hidden** (default) - No announcement or dismissed
2. **Showing** - Slides down with blue gradient
3. **Hover on close** - Close button highlights
4. **Dismissed** - Slides up and remembers dismissal

## Future Enhancements (Not Implemented)
- Multiple announcement types (info, warning, error)
- Rich text formatting in messages
- Scheduled announcements
- Per-server announcements
- User role targeting (show only to certain roles)
