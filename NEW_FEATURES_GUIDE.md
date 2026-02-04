# New Features User Guide

This guide explains the new features added to Decentra chat application.

## 🟢 User Status

Set your online status to let others know your availability.

**How to use:**
1. Click your username in the top-right corner
2. Select "Set Status" from the dropdown menu
3. Choose from:
   - 🟢 **Online** - You're available
   - 🟡 **Away** - You're away from keyboard
   - 🔴 **Busy** - You're busy, don't disturb
   - ⚫ **Invisible** - Appear offline to others

**Status indicators:**
- Your status appears as a colored dot next to your name throughout the app
- Other users' status dots appear in the friends list and member list
- Status automatically updates to Online when you log in
- Status automatically updates to Offline when you log out or disconnect

---

## 📝 Channel Topics

Add descriptions to your channels to explain their purpose.

**How to use:**
1. Select a channel in a server
2. Look for the topic text below the channel name in the header
3. If you have permission, click the edit icon (✏️) to change the topic
4. Type your topic and click "Save"

**Permissions:**
- Server owners can always edit channel topics
- Users with "Edit Channel" permission can edit topics
- All users can see the channel topic

**Tips:**
- Use topics to describe what the channel is for
- Update topics for events, announcements, or guidelines
- Topics are visible to all server members

---

## 📌 Pinned Messages

Pin important messages to keep them easily accessible.

**How to use:**
1. Hover over any message
2. Click the pin icon (📌) that appears
3. The message will be added to the pinned messages panel
4. Click the pinned panel at the top to view all pinned messages
5. Click a pinned message to jump to it in the chat
6. Click the unpin icon to remove a message from pins

**Permissions:**
- Server owners can pin any message
- Users with "Edit Channel" permission can pin messages
- In DMs, both participants can pin messages

**Tips:**
- Pin announcements, important links, or rules
- Pinned messages show who pinned them and when
- The pinned panel can be collapsed to save space

---

## 🔍 Message Search

Search through all your messages to find what you're looking for.

**How to use:**
1. Click the search icon (🔍) in the chat header
2. Type your search query
3. Press Enter or click "Search"
4. View results in the modal
5. Click any result to jump to that message

**Search features:**
- Searches the current channel or DM
- Results show message preview, author, and timestamp
- Highlights matching text
- Sorted by relevance

**Tips:**
- Search is case-insensitive
- Searches message content only (not usernames or attachments)
- Use specific terms for better results

---

## ✨ Message Formatting

Format your messages to make them more expressive.

**Formatting options:**

**Bold text:**
- Type: `**bold**` or `__bold__`
- Result: **bold**

**Italic text:**
- Type: `*italic*` or `_italic_`
- Result: *italic*

**Inline code:**
- Type: `` `code` ``
- Result: `code` (monospace with gray background)

**Code blocks:**
- Type: ` ```code block``` `
- Result: Multi-line code block with gray background

**Quotes:**
- Type: `> quoted text`
- Result: Indented text with left border (like email quotes)

**Spoilers:**
- Type: `||spoiler text||`
- Result: Hidden text that reveals on click (for spoilers/secrets)

**Mentions:**
- Type: `@username`
- Result: Highlighted mention (yellow background if you're mentioned)

**Tips:**
- You can combine formatting (e.g., `**bold _and italic_**`)
- Code blocks preserve spacing and special characters
- Spoilers are great for hiding plot twists or puzzle answers

---

## 📬 Read/Unread Indicators

See which channels and DMs have new messages.

**How it works:**
- Unread channels/DMs show a badge with the number of unread messages
- The badge appears next to the channel/DM name in the sidebar
- Messages are automatically marked as read when you view them
- Unread counts update in real-time

**Features:**
- Only counts messages from other users (not your own)
- Counts reset when you open a channel/DM
- Badges are color-coded for visibility

**Tips:**
- Use unread counts to quickly see where you have new activity
- Open a channel briefly to mark all messages as read

---

## 💬 Enhanced @Mentions

Mentions now have visual highlighting to make them stand out.

**Features:**
- Mentioned usernames appear with a yellow background
- Your own mentions are highlighted more prominently
- Mentions are validated against channel members
- Existing autocomplete helps you mention the right person

**How to use:**
1. Type `@` in a message
2. Start typing a username
3. Select from the autocomplete dropdown or finish typing
4. The mention will be highlighted when sent

**Tips:**
- Only valid usernames for the current context are highlighted
- In servers, you can mention any server member
- In DMs, you can mention yourself or the other person
- Mentions make it clear you're addressing someone specific

---

## Quick Start Example

Try these features together:

1. **Set your status to Online** 🟢
2. **Pin an important message** in your favorite channel 📌
3. **Search for a previous conversation** 🔍
4. **Send a formatted message**: 
   ```
   **Hey everyone!** Check out this `new feature`:
   > It's pretty cool!
   ||And there are spoilers too!||
   
   @username what do you think?
   ```
5. **Check your unread counts** on other channels 📬

---

## Keyboard Shortcuts

- **Search**: Click search icon or use search input
- **Formatting**: Use markdown-like syntax while typing
- **Pin**: Hover over message and click pin icon
- **Status**: Click username menu in top-right

---

## Troubleshooting

**Status not updating?**
- Refresh the page
- Check your internet connection
- Status updates require an active WebSocket connection

**Can't edit channel topic?**
- Make sure you're a server owner or have "Edit Channel" permission
- Contact the server owner for permission

**Can't pin messages?**
- Same permissions as editing topics
- In DMs, both users can pin

**Search not finding results?**
- Make sure you're typing complete words
- Search is context-specific (current channel/DM only)
- Check spelling

**Formatting not working?**
- Make sure you're using the correct syntax
- Code blocks need three backticks
- Spoilers need double pipes on both sides

---

## Privacy Notes

- **Status**: Your status is visible to all users when you're not Invisible
- **Read receipts**: Message read status is tracked but not shown to other users (yet)
- **Search**: Search only searches messages you have access to
- **Pinned messages**: All channel members can see pinned messages

---

## Feedback

If you encounter any issues or have suggestions for these features, please:
1. Report bugs via GitHub issues
2. Suggest improvements in the discussions
3. Contribute fixes via pull requests

Enjoy the new features! 🎉
