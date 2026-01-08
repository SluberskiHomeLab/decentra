# Rich Embeds - Visual Examples

## Example 1: Regular URL
**User Message:**
```
Check out https://github.com for great projects!
```

**Display:**
- The URL becomes a clickable blue link
- Link preview card shown below the message

---

## Example 2: Image URL
**User Message:**
```
Look at this amazing photo: https://example.com/sunset.jpg
```

**Display:**
- The URL is clickable
- Image preview displayed inline below the message
- Image is clickable to open in new tab
- Max size: 400px width/height on desktop, 300px on mobile

---

## Example 3: Video URL
**User Message:**
```
Watch this clip: https://example.com/funny-cat.mp4
```

**Display:**
- The URL is clickable
- Video player embedded below the message
- Full playback controls (play/pause, volume, fullscreen)
- Max size: 400px width/height on desktop, 300px on mobile

---

## Example 4: YouTube Video
**User Message:**
```
This tutorial is great: https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

**Display:**
- The URL is clickable
- YouTube player embedded below the message
- Full YouTube controls (play, quality, captions, etc.)
- Responsive 16:9 aspect ratio
- Max width: 400px on desktop

---

## Example 5: Multiple URLs
**User Message:**
```
Visit https://github.com and check out this image: https://example.com/photo.png
```

**Display:**
- Both URLs are clickable
- Link embed for github.com
- Image embed for photo.png
- Each embed appears below the message

---

## Example 6: YouTube Short URL
**User Message:**
```
Quick link: https://youtu.be/dQw4w9WgXcQ
```

**Display:**
- Same YouTube embed as standard URL
- Full player functionality

---

## Visual Structure

```
┌─────────────────────────────────────────┐
│ 👤 Username                    12:34 PM │
│                                         │
│ Check out this photo:                   │
│ https://example.com/sunset.jpg          │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │                                     │ │
│ │         [Image Preview]             │ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

## Styling Details

### Colors (Discord-like theme)
- **Links**: Blue (#00b0f4)
- **Background**: Dark theme (#36393f)
- **Message text**: Light gray (#dcddde)
- **Link embeds**: Darker background with blue left border

### Responsive Behavior
- **Desktop**: Max 400px for images/videos
- **Mobile**: Max 300px for images/videos, full width for YouTube
- **Aspect Ratio**: 16:9 maintained for YouTube embeds

### Hover Effects
- Links underline on hover
- Images slightly dim (opacity 0.9) on hover

## Error Handling

If an image or video fails to load, it falls back to a styled link:
```
🖼️ https://example.com/broken-image.jpg
```

This ensures the user can still access the content even if embedding fails.
