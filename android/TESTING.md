# Testing the Decentra Android App

This guide explains how to test the Android application with the Decentra server.

## Prerequisites

1. **Running Decentra Server**
   - The server must be running and accessible
   - For development, use Docker Compose:
     ```bash
     cd /path/to/decentra
     docker-compose up
     ```

2. **Android Development Tools**
   - Android Studio Hedgehog (2023.1.1) or later
   - Android SDK 24+ 
   - Android Emulator or physical device

## Testing with Android Emulator

### Step 1: Start the Decentra Server

```bash
cd decentra
docker-compose up
```

The server should start on `http://localhost:8765`

### Step 2: Open Android Project

1. Open Android Studio
2. Open the `android/` directory as a project
3. Wait for Gradle sync to complete

### Step 3: Run the App

1. Start an Android emulator (API 24+)
2. Click "Run" in Android Studio
3. The app will install on the emulator

### Step 4: Login

1. On the login screen, the default server URL is `http://10.0.2.2:8765`
   - This special IP address maps to `localhost` on your development machine
2. Enter your Decentra username and password
3. Tap "Login"

### Step 5: Test Features

- **Servers**: View your servers in the left sidebar
- **Channels**: Select a server to see channels in the middle sidebar  
- **Messaging**: Select a channel to view and send messages
- **DMs**: Select a DM from the left sidebar to chat privately

## Testing with Physical Device

### Step 1: Find Your Computer's IP Address

**On macOS/Linux:**
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
```

**On Windows:**
```cmd
ipconfig
```

Look for your local IP address (e.g., `192.168.1.100`)

### Step 2: Update Server Configuration

Make sure your server allows connections from your local network:

```bash
# In docker-compose.yml, the server should bind to 0.0.0.0:8765
# This is the default configuration
docker-compose up
```

### Step 3: Connect Your Device

1. Connect your Android device via USB
2. Enable USB debugging on your device
3. In Android Studio, select your device from the dropdown
4. Click "Run"

### Step 4: Login with Your IP

1. On the login screen, change the server URL to: `http://192.168.1.100:8765`
   - Replace `192.168.1.100` with your actual IP address
2. Enter your username and password
3. Tap "Login"

### Step 5: Test Features

Same as emulator testing above.

## Common Issues

### Connection Failed

**Emulator:**
- Make sure you're using `http://10.0.2.2:8765`
- Verify the server is running on `localhost:8765`
- Check Docker logs: `docker-compose logs`

**Physical Device:**
- Use your machine's local IP address, not `localhost` or `10.0.2.2`
- Ensure device and computer are on the same network
- Check firewall settings (port 8765 must be open)
- Verify the server is bound to `0.0.0.0` not `127.0.0.1`

### Login Failed

- Verify your username/password are correct
- Check the web interface works: `http://localhost:8765`
- Look at server logs for authentication errors

### WebSocket Connection Issues

- Check the server logs for WebSocket connection attempts
- Verify `android:usesCleartextTraffic="true"` is in AndroidManifest.xml
- For production, use HTTPS/WSS instead of HTTP/WS

## Manual Testing Checklist

### Authentication
- [ ] Login with valid credentials succeeds
- [ ] Login with invalid credentials shows error
- [ ] Error messages are clear and helpful

### Server/Channel Navigation
- [ ] Servers list loads correctly
- [ ] Selecting a server shows its channels
- [ ] Channel icons display correctly (text vs voice)
- [ ] Selected items are visually highlighted

### Messaging
- [ ] Message history loads when selecting a channel
- [ ] New messages appear in real-time
- [ ] Sent messages appear immediately
- [ ] Messages from other users appear
- [ ] Messages are properly formatted

### Direct Messages
- [ ] DMs list loads correctly
- [ ] Selecting a DM shows message history
- [ ] Can send and receive DMs
- [ ] DM conversations are private

### Connection Management
- [ ] App reconnects after network interruption
- [ ] Logout works correctly
- [ ] App state persists during configuration changes (rotation)

### UI/UX
- [ ] Material Design 3 theming is consistent
- [ ] Touch targets are appropriately sized
- [ ] Scrolling is smooth
- [ ] Keyboard behavior is correct
- [ ] Loading states are shown
- [ ] Error states are handled gracefully

## Testing with Multiple Users

1. **Web Client + Android:**
   - Login to web interface: `http://localhost:8765`
   - Login to Android app
   - Send messages from web, verify they appear on Android
   - Send messages from Android, verify they appear on web

2. **Multiple Android Devices:**
   - Login with different users on different devices
   - Join the same server/channel
   - Send messages and verify real-time delivery

## Debugging

### Enable Verbose Logging

The app uses Android Logcat for debugging:

```bash
adb logcat | grep -E "WebSocketManager|ChatViewModel|DecentraApi"
```

Look for:
- Connection attempts
- Authentication results
- Message send/receive
- API calls and responses

### Network Traffic

Use Android Studio's Network Profiler to inspect:
- HTTP REST API calls
- WebSocket connections
- Request/response data

## Next Steps

After basic testing:

1. Test edge cases (poor network, server downtime)
2. Test with large message histories
3. Test with many servers/channels
4. Performance testing (memory, battery)
5. UI testing on different screen sizes
6. Accessibility testing (TalkBack, large fonts)

## Reporting Issues

When reporting issues, include:
- Android version
- Device model (or emulator configuration)
- Server URL used
- Error messages or screenshots
- Steps to reproduce
- Logcat output if available
