# Manual Test: WebM Drag-and-Drop Support

## Overview
This document describes manual testing procedures for the WebM drag-and-drop feature.

## Test Setup
1. Start the Decentra application using Docker Compose
2. Create a test account and log in
3. Navigate to a server channel or DM

## Test Cases

### Test 1: Drag-and-Drop Visual Feedback
**Objective:** Verify that drag-and-drop provides visual feedback

**Steps:**
1. Open a file explorer window
2. Drag any file over the chat area
3. Observe the visual feedback

**Expected Result:**
- Chat area background should change to a light blue tint
- A "Drop files to attach" message should appear in the center
- When you move the file outside the chat area, the feedback should disappear

### Test 2: Drop WebM File
**Objective:** Verify WebM files can be attached via drag-and-drop

**Steps:**
1. Create or download a sample WebM file (e.g., sample.webm)
2. Drag the WebM file from your file explorer
3. Drop it onto the chat area
4. Observe the attachment preview

**Expected Result:**
- File should appear in the attachment preview area above the message input
- File name and size should be displayed
- File can be removed by clicking the × button

### Test 3: Send Message with WebM Attachment
**Objective:** Verify WebM files are embedded in messages

**Steps:**
1. Drag and drop a WebM file (or use the 📎 attach button)
2. Type a message (e.g., "Check out this video")
3. Click Send
4. Wait for the message to appear

**Expected Result:**
- Message should be sent successfully
- WebM file should appear as an embedded video player below the message
- Video player should have controls (play, pause, volume, fullscreen)
- Video should be playable inline

### Test 4: Multiple File Drop
**Objective:** Verify multiple files can be dropped at once

**Steps:**
1. Select multiple files (e.g., 2 WebM files, 1 image, 1 PDF)
2. Drag all files to the chat area
3. Drop them

**Expected Result:**
- All files should appear in the attachment preview
- Each file should show its name and size
- Each file can be removed individually

### Test 5: File Size Validation
**Objective:** Verify files exceeding size limit are rejected

**Steps:**
1. Get the current max file size from admin settings (default: 10MB)
2. Create or find a file larger than the limit
3. Drag and drop the large file

**Expected Result:**
- Alert should appear: "The following file(s) exceed the maximum size of XMB..."
- File should NOT be added to pending attachments

### Test 6: Different Video Formats
**Objective:** Verify other video formats are also embedded

**Steps:**
1. Drag and drop files with different extensions: .mp4, .webm, .ogg, .mov
2. Send messages with each attachment
3. Observe how they are displayed

**Expected Result:**
- All video files should be embedded as video players
- Each should have controls and be playable inline

### Test 7: Image Attachment Embedding
**Objective:** Verify images are also embedded

**Steps:**
1. Drag and drop image files: .jpg, .png, .gif, .webp
2. Send messages with each attachment
3. Observe how they are displayed

**Expected Result:**
- All image files should be embedded as inline images
- Images should be displayed with max-width/height constraints

### Test 8: Non-Media File Attachment
**Objective:** Verify non-media files show as download links

**Steps:**
1. Drag and drop a non-media file (e.g., .pdf, .txt, .zip)
2. Send a message with the attachment
3. Observe how it is displayed

**Expected Result:**
- File should appear as a download link with 📎 icon
- Clicking the link should download the file
- File name and size should be visible

### Test 9: WebM URL Embed (Existing Feature)
**Objective:** Verify WebM URLs are still detected and embedded

**Steps:**
1. Send a message with a WebM URL: "Check this: https://example.com/video.webm"
2. Observe the message

**Expected Result:**
- URL should be detected automatically
- WebM should be embedded as a video player
- Video should be playable inline

### Test 10: Disabled File Attachments
**Objective:** Verify drag-and-drop respects admin settings

**Steps:**
1. As admin, disable file attachments in admin settings
2. Try to drag and drop a file
3. Observe the behavior

**Expected Result:**
- No visual feedback should appear when dragging
- If dropped, alert should appear: "File attachments are disabled by the administrator"
- File should NOT be added to pending attachments

## Browser Compatibility
Test the above scenarios in:
- [ ] Chrome/Chromium
- [ ] Firefox
- [ ] Safari
- [ ] Edge

## Mobile Testing
Test the file picker (📎 button) on mobile devices:
- [ ] iOS Safari
- [ ] Android Chrome
- [ ] Android Firefox

Note: Drag-and-drop may not work on mobile, but the file picker should work.

## Integration Points
The following components are involved:
- `/server/static/chat.js` - Drag-and-drop event handlers
- `/server/static/styles.css` - Drag-over visual feedback
- `/server/api.py` - File upload endpoint
- `/server/database.py` - Attachment storage
