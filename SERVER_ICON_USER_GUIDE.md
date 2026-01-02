# Server Icon Feature - User Guide

## How to Set a Server Icon

### For Server Owners

1. **Access Server Settings**
   - Click on your server in the server list
   - Click the ⚙ (settings) button in the header
   - Navigate to the "General" tab

2. **Choose Icon Type**
   
   You have two options:

   **Option A: Select an Emoji**
   - Stay on the "Emoji" tab (selected by default)
   - Click on any of the 12 available emojis:
     - 🏠 (Home) - Default
     - 🎮 (Gaming)
     - 💬 (Chat)
     - 🎵 (Music)
     - 🎨 (Art)
     - 🚀 (Rocket)
     - ⚡ (Lightning)
     - 🔥 (Fire)
     - 💎 (Diamond)
     - 🌟 (Star)
     - 🎯 (Target)
     - 🎪 (Circus)
   - Icon is applied immediately!

   **Option B: Upload Custom Image**
   - Click the "Upload Image" tab
   - Click "📁 Choose an image"
   - Select a PNG, JPG, or GIF file (max 2MB)
   - Click "Upload Icon" button
   - Icon is applied immediately!

3. **See the Changes**
   - Your server icon will appear in the server list
   - All server members will see the new icon instantly

## What Server Members See

- Server icons appear next to server names in the server list
- When a server owner changes the icon, all members see the update in real-time
- Icons can be either:
  - An emoji character (like 🎮)
  - A custom uploaded image (displayed as a 24x24px thumbnail)

## Technical Details

### Permissions
- Only users with "access server settings" permission can change icons
- Server owners always have this permission
- Other members can be granted this permission by the owner

### File Requirements
- **Supported formats**: PNG, JPG, GIF (other image formats are not officially supported)
- **Maximum size**: 2MB (configurable by admin)
- **Display size**: 24x24 pixels in server list

### Data Storage
- Emoji icons are stored as text characters
- Image icons are stored as base64-encoded data in the database
- All icon data persists across server restarts

## Frequently Asked Questions

**Q: Can I change my server icon multiple times?**
A: Yes! You can change it as many times as you want.

**Q: Will existing servers get an icon?**
A: Yes, all existing servers automatically get the default 🏠 (home) emoji icon.

**Q: Can members without owner permissions see the icon?**
A: Yes, all server members can see the server icon, but only authorized users can change it.

**Q: What happens if I upload an image larger than 2MB?**
A: The upload will be rejected with an error message.

**Q: Can I use animated GIFs?**
A: Yes! Animated GIFs are supported and will animate in the server list.

**Q: Is the icon visible in the REST API?**
A: Yes, server icons are included in all server data returned by the REST API.
