# Rich Embeds Feature

## Overview

The Rich Embeds feature automatically detects and embeds links, images, videos, and YouTube content in chat messages. When a user sends a message containing a URL, the system automatically creates an interactive embed for better user experience.

## Supported Content Types

### 1. Regular URLs
Any standard HTTP/HTTPS URL will be automatically converted to a clickable link with visual styling.

**Example:**
```
Check out https://example.com
```

### 2. Image URLs
Images with the following extensions are automatically embedded:
- `.jpg`, `.jpeg`
- `.png`
- `.gif`
- `.webp`
- `.bmp`
- `.svg`

**Features:**
- Lazy loading for performance
- Click to open in new tab
- Fallback to link if image fails to load
- Responsive sizing (max 400px width/height on desktop, 300px on mobile)

**Example:**
```
Look at this: https://example.com/photo.jpg
```

### 3. Video URLs
Videos with the following extensions are automatically embedded with a video player:
- `.mp4`
- `.webm`
- `.ogg`
- `.mov`

**Features:**
- Native HTML5 video controls
- Metadata preloading
- Fallback to link if video fails to load
- Responsive sizing

**Example:**
```
Watch this clip: https://example.com/video.mp4
```

### 4. YouTube Videos
YouTube URLs are automatically embedded with a responsive iframe player.

**Supported URL formats:**
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`

**Features:**
- 16:9 aspect ratio
- Full YouTube player controls
- Autoplay support
- Picture-in-picture capability

**Example:**
```
Check out https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

## Implementation Details

### Client-Side Processing

The rich embeds feature is implemented entirely on the client side in `/server/static/chat.js`:

1. **URL Detection**: Uses regex pattern `/(https?:\/\/[^\s]+)/gi` to detect URLs in messages
2. **Content Type Classification**: Checks file extensions and URL patterns to determine embed type
3. **Embed Generation**: Creates appropriate HTML elements for each embed type
4. **DOM Insertion**: Appends embeds to message content wrapper

### Key Functions

- `processMessageEmbeds(content)`: Main function that processes message content and returns embed elements
- `linkifyText(text)`: Converts URLs in text to clickable links
- `createImageEmbed(url)`: Creates image embed element
- `createVideoEmbed(url)`: Creates video embed element
- `createYouTubeEmbed(videoId, url)`: Creates YouTube iframe embed
- `createLinkEmbed(url)`: Creates styled link preview

### Styling

All embed styles are defined in `/server/static/styles.css`:

- `.embed`: Base embed container
- `.embed-image`: Image-specific styling
- `.embed-video`: Video-specific styling
- `.embed-youtube`: YouTube iframe container with aspect ratio
- `.embed-link`: Link preview styling
- `.message-link`: In-text clickable links

## Security Considerations

1. **XSS Prevention**: User-supplied message text (including the clickable link text produced by `linkifyText()`) is escaped using the `escapeHtml()` function before being inserted into the DOM. URL values used in `href` and media `src` attributes are not modified by `escapeHtml()` and are used as provided to the client-side embed logic.
2. **Link Safety**: All external links use `rel="noopener noreferrer"` to prevent tabnabbing
3. **Lazy Loading**: Images use lazy loading to prevent resource exhaustion
4. **Error Handling**: Failed media loads gracefully fall back to plain links

## Performance Optimizations

1. **Lazy Loading**: Images use `loading="lazy"` attribute
2. **Duplicate Detection**: Tracks processed URLs to avoid duplicate embeds
3. **Metadata Preload**: Videos use `preload="metadata"` for faster initial load
4. **Responsive Design**: Media elements have max dimensions to prevent layout issues

## Browser Compatibility

The rich embeds feature uses standard web APIs and should work in all modern browsers:
- Chrome/Edge 22+
- Firefox 22+
- Safari 7+
- Opera 25+

## Testing

### Manual Testing

1. Start the Decentra server
2. Send messages with different URL types:
   - Regular links: `https://github.com`
   - Images: `https://via.placeholder.com/400.png`
   - Videos: `https://www.w3schools.com/html/mov_bbb.mp4`
   - YouTube: `https://www.youtube.com/watch?v=dQw4w9WgXcQ`

### Automated Testing

Run the test suite:
```bash
python3 test_rich_embeds.py
```

### Browser Testing

Open `test_rich_embeds.html` in a browser to see visual examples of all embed types.

## Future Enhancements

Potential improvements for future versions:
1. Link metadata preview (Open Graph/Twitter Cards)
2. Spotify/SoundCloud embeds
3. PDF previews
4. Tweet embeds
5. Custom embed size controls
6. Thumbnail generation for videos

## Troubleshooting

### Embeds not appearing
- Check browser console for JavaScript errors
- Verify URLs are properly formatted with `http://` or `https://`
- Ensure images/videos are accessible (not blocked by CORS)

### YouTube embeds not working
- Verify the video ID is correct (11 characters)
- Check if the video is available and not age-restricted
- Ensure the page is served over HTTPS (YouTube requires it)

### Images/Videos not loading
- Check if the URL is accessible
- Verify CORS headers allow embedding
- Check browser console for specific error messages
