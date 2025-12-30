# Decentra Android App

An Android client application for the Decentra decentralized chat platform.

## Features

- 🔐 User authentication (login)
- 💬 Real-time messaging via WebSocket
- 🖥️ Server and channel browsing
- 📱 Direct messaging support
- 🎨 Modern Material Design 3 UI
- 📲 Native Android experience

## Requirements

- Android Studio Hedgehog (2023.1.1) or later
- Android SDK 24+ (Android 7.0 and above)
- Kotlin 1.9.20

## Setup

1. **Open the project in Android Studio:**
   ```bash
   cd android
   # Open this directory in Android Studio
   ```

2. **Configure the server URL:**
   - The default server URL is `http://10.0.2.2:8765` which points to localhost on the Android emulator
   - For physical devices, update the server URL in the login screen to point to your server's IP address
   - For example: `http://192.168.1.100:8765`

3. **Build and run:**
   - Click "Run" in Android Studio or use `./gradlew installDebug`

## Project Structure

```
android/
├── app/
│   ├── src/main/
│   │   ├── java/com/decentra/chat/
│   │   │   ├── data/           # Data models
│   │   │   ├── network/        # API service and WebSocket
│   │   │   ├── ui/             # Compose UI screens
│   │   │   │   └── theme/      # Material Design theme
│   │   │   ├── viewmodel/      # ViewModels
│   │   │   └── MainActivity.kt
│   │   ├── res/                # Resources (strings, themes, etc.)
│   │   └── AndroidManifest.xml
│   └── build.gradle.kts
├── build.gradle.kts
└── settings.gradle.kts
```

## Architecture

The app follows modern Android development practices:

- **MVVM Architecture**: Separation of concerns with ViewModel
- **Jetpack Compose**: Declarative UI framework
- **Kotlin Coroutines**: Asynchronous programming
- **Retrofit**: REST API communication
- **OkHttp WebSocket**: Real-time messaging
- **StateFlow**: Reactive state management

## Key Components

### Network Layer

- **DecentraApiService**: Retrofit interface for REST API endpoints
- **WebSocketManager**: Manages WebSocket connection for real-time messaging
- **RetrofitClient**: Singleton for API service configuration

### Data Models

- User, Server, Channel, Message, DirectMessage
- Request/Response models for API communication

### UI Screens

- **LoginScreen**: User authentication
- **ChatScreen**: Main chat interface with servers, channels, and messages

### ViewModel

- **ChatViewModel**: Manages app state and business logic
  - User authentication
  - Server/channel/DM loading
  - Message sending and receiving
  - WebSocket connection management

## Usage

1. **Login:**
   - Enter your Decentra server URL (e.g., `http://192.168.1.100:8765`)
   - Enter your username and password
   - Tap "Login"

2. **Browse Servers:**
   - Your servers appear in the left sidebar
   - Tap a server to view its channels

3. **Join a Channel:**
   - Select a channel from the middle sidebar
   - View message history and send messages

4. **Direct Messages:**
   - DMs appear below servers in the left sidebar
   - Tap a DM to start chatting

5. **Send Messages:**
   - Type your message in the text field at the bottom
   - Tap the send button

## Configuration

### Server URL

The default server URL for the Android emulator is `http://10.0.2.2:8765`. This is a special alias that routes to `localhost:8765` on your development machine.

**For physical devices:**
- Find your computer's local IP address
- Update the server URL to `http://<your-ip>:8765`
- Ensure your device and server are on the same network

**For production:**
- Update the default server URL in `LoginScreen.kt`
- Or use a remote server with a public IP/domain

### API Endpoints

The app uses the following Decentra REST API endpoints:

- `POST /api/auth` - User authentication
- `GET /api/servers` - Get user's servers
- `GET /api/messages` - Get message history
- `GET /api/friends` - Get friends list
- `GET /api/dms` - Get direct messages

### WebSocket

Real-time messaging uses WebSocket connection to `/ws` endpoint.

## Building

### Debug Build

```bash
./gradlew assembleDebug
```

The APK will be generated at `app/build/outputs/apk/debug/app-debug.apk`

### Release Build

1. Create a keystore for signing
2. Configure signing in `app/build.gradle.kts`
3. Build:
   ```bash
   ./gradlew assembleRelease
   ```

## Testing

The app can be tested with:
- Android Emulator (default server URL: `http://10.0.2.2:8765`)
- Physical device (update server URL to your machine's IP)

Make sure the Decentra server is running:
```bash
cd ../
docker-compose up
```

## Troubleshooting

### Connection Issues

- **Emulator**: Use `http://10.0.2.2:8765`
- **Physical Device**: 
  - Use your machine's local IP: `http://192.168.x.x:8765`
  - Ensure firewall allows connections on port 8765
  - Ensure device and server are on same network

### Clear Text Traffic

The app allows clear text HTTP traffic for development (configured in `AndroidManifest.xml`). For production, use HTTPS.

## Future Enhancements

- [ ] User registration/signup
- [ ] Friend search and management
- [ ] Push notifications
- [ ] Voice chat support
- [ ] File/image sharing
- [ ] User profile customization
- [ ] Offline message caching
- [ ] Material You dynamic theming

## License

Licensed under the Apache License, Version 2.0. See the main repository LICENSE file for details.
