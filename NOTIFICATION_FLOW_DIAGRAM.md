# Browser Notifications Flow Diagram

This diagram illustrates how browser notifications work in Decentra.

## Notification Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     User Opens Decentra                          │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              NotificationManager Initialized                     │
│         (Loads settings from localStorage)                       │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
           ┌──────────────────────┐
           │ Notifications         │
           │ Enabled?              │
           └──────┬────────────┬───┘
                  │            │
              Yes │            │ No → Skip permission request
                  │            │
                  ▼            │
    ┌──────────────────────┐  │
    │ Browser Permission    │  │
    │ Already Granted?      │  │
    └──────┬────────┬───────┘  │
           │        │           │
        No │        │ Yes       │
           │        │           │
           ▼        ▼           ▼
    ┌──────────┐  ┌─────────────────────────┐
    │ Request  │  │ Ready to Show            │
    │Permission│→ │ Notifications            │
    └──────────┘  └─────────────────────────┘
```

## Message Notification Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                   New Message Received                           │
│              (via WebSocket from server)                         │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
           ┌──────────────────────┐
           │ Message from         │
           │ another user?        │
           └──────┬────────┬──────┘
                  │        │
              Yes │        │ No → Don't notify
                  │        │
                  ▼        │
    ┌──────────────────────────┐
    │ Check Notification Mode: │
    │ • All Messages           │
    │ • Mentions Only          │
    │ • None                   │
    └──────┬───────────────────┘
           │
           ▼
    ┌──────────────────────┐
    │ Mode = None?         │
    └──────┬────────┬──────┘
           │        │
        Yes│        │No
           │        │
           │        ▼
           │ ┌──────────────────────┐
           │ │ Mode = Mentions Only?│
           │ └──────┬────────┬──────┘
           │        │        │
           │     Yes│        │No (All Messages)
           │        │        │
           │        ▼        │
           │ ┌──────────────┐│
           │ │ Contains     ││
           │ │ @mention?    ││
           │ └──────┬───┬───┘│
           │        │   │    │
           │     Yes│   │No  │
           │        │   │    │
           │        ▼   │    ▼
           │        ┌───┴────────────┐
           │        │ Check Page     │
           │        │ Visibility     │
           │        └────┬───────────┘
           │             │
           │             ▼
           │      ┌──────────────┐
           │      │ Page Hidden? │
           │      └──────┬───┬───┘
           │             │   │
           │          Yes│   │No
           │             │   │
           │             ▼   │
           │      ┌──────────────────┐
           │      │ Show Notification│
           │      │ Popup            │
           │      └──────────────────┘
           │             │
           ▼             ▼
    ┌──────────────────────────┐
    │ Play Sound (if enabled)  │
    └──────────────────────────┘
```

## Voice Call Notification Flow

```
┌─────────────────────────────────────────────────────────────────┐
│              Incoming Voice Call Received                        │
│              (via WebSocket signaling)                           │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
           ┌──────────────────────┐
           │ Show Notification    │
           │ "Incoming Call from  │
           │  [username]"         │
           └──────────┬───────────┘
                      │
                      ▼
           ┌──────────────────────┐
           │ Play Call Sound      │
           │ (loops until         │
           │  answered/rejected)  │
           └──────────┬───────────┘
                      │
           ┌──────────┴────────────┐
           │                       │
           ▼                       ▼
    ┌──────────┐           ┌──────────┐
    │ Accept   │           │ Reject   │
    │ Call     │           │ Call     │
    └─────┬────┘           └─────┬────┘
          │                      │
          ▼                      ▼
    ┌──────────────────────────────┐
    │ Stop Call Sound              │
    │ Close Notification           │
    └──────────────────────────────┘
```

## Settings Persistence

```
┌─────────────────────────────────────────────────────────────────┐
│                User Changes Settings                             │
│         (via Notification Settings modal)                        │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
    ┌─────────────────────────────────────────┐
    │ Settings Saved to localStorage:         │
    │                                          │
    │ • notificationsEnabled: true/false       │
    │ • notificationSoundsEnabled: true/false  │
    │ • notificationMode: all/mentions/none    │
    │ • messageSound: soft-ping/gentle-chime/  │
    │                 subtle-pop               │
    │ • callSound: classic-ring/modern-tone/   │
    │              upbeat-call                 │
    └─────────────────┬───────────────────────┘
                      │
                      ▼
    ┌─────────────────────────────────────────┐
    │ Settings Persist Across:                │
    │ • Page Reloads                          │
    │ • Browser Restarts                      │
    │ • Login Sessions                        │
    └─────────────────────────────────────────┘
```

## Notification Modes Comparison

| Mode | Regular Messages | @Mentions | Voice Calls |
|------|------------------|-----------|-------------|
| **All Messages** | ✅ Show | ✅ Show | ✅ Show |
| **Mentions Only** | ❌ Hide | ✅ Show | ✅ Show |
| **None** | ❌ Hide | ❌ Hide | ❌ Hide |

**Note:** All modes still play sounds if "Enable Notification Sounds" is enabled.

## Page Visibility Detection

```
┌─────────────────────────────────────────────────────────────────┐
│                 Message Notification Trigger                     │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
           ┌──────────────────────┐
           │ document.            │
           │ visibilityState      │
           └──────┬────────┬──────┘
                  │        │
          'hidden'│        │'visible'
                  │        │
                  ▼        ▼
        ┌──────────────┐  ┌──────────────┐
        │ Show Popup   │  │ Skip Popup   │
        │ Notification │  │ (user can    │
        │              │  │  see the     │
        │              │  │  message)    │
        └──────────────┘  └──────────────┘
               │                  │
               └──────────┬───────┘
                          ▼
                  ┌──────────────┐
                  │ Play Sound   │
                  │ (if enabled) │
                  └──────────────┘
```

This prevents notification spam when the user is actively viewing the chat window.
