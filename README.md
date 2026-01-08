# Decentra

A decentralized Discord-like chat server and client that is non-federated and self-hostable. Built with Python and WebSockets, designed to run in Docker containers with persistent data storage using PostgreSQL.

## Features

- 🚀 Real-time WebSocket-based messaging
- 💾 **Persistent Data Storage** - All data stored in PostgreSQL database
  - User accounts and friendships persist across restarts
  - Message history saved permanently
  - Servers and channels maintained
  - Scalable and production-ready database
- 🖥️ **Servers** - Create and manage multiple servers with channels
  - ⚙️ Server settings for owners (rename, invites, permissions)
  - 🎫 Server-specific invite codes
  - 🔐 Granular user permissions (create/edit/delete channels)
- 💬 **Direct Messages** - Private conversations with friends
- 👥 **Friend System** - Search for users and add friends
- 🎤 **Voice Chat** - Direct voice calls and voice channels in servers
  - 📞 Call friends directly from DMs or friends list
  - 🔊 Join voice channels in servers for group voice chat
  - 🔇 Mute/unmute controls
  - 🌐 Peer-to-peer WebRTC connections for high-quality audio
- 🔐 Username/password authentication
- 🎟️ Invite code system for controlled access
- 📜 Complete message history with database persistence
- 🔔 **Browser Notifications** - Desktop notification popups
  - Real-time notification popups for new messages
  - Incoming voice call notifications
  - Customizable notification sounds
  - Notification modes: all messages, mentions only, or disabled
  - Automatic permission requests on first use
- 🖼️ **Rich Embeds** - Auto-embedding links, images, videos in messages
  - Automatic link detection and clickable URLs
  - Image previews for JPG, PNG, GIF, WebP, SVG
  - Embedded video players for MP4, WebM, OGG
  - YouTube video embeds with full player controls
  - Responsive sizing and lazy loading
- 📧 **Email Notifications** - SMTP support for system emails
  - Configurable SMTP settings in admin panel
  - Welcome emails for new users
  - Test SMTP connection before saving
- 🐳 Docker containerized for easy deployment
- 🌐 Modern web-based interface with Discord-like layout
- 🎨 Beautiful responsive UI design
- 🔌 **REST API** - HTTP REST API for desktop app integration

## Quick Start

### Prerequisites

- Docker
- Docker Compose

### Running with Docker Compose

1. Clone the repository:
```bash
git clone https://github.com/SluberskiHomeLab/decentra.git
cd decentra
```

2. Set up environment variables:
```bash
cp .env.example .env
```

Then edit `.env` and update the required configuration:

**Required Configuration:**
```env
# PostgreSQL Database Configuration
POSTGRES_DB=decentra
POSTGRES_USER=decentra
POSTGRES_PASSWORD=your_secure_password_here

# Server Configuration
DATABASE_URL=postgresql://decentra:your_secure_password_here@postgres:5432/decentra

# Encryption Configuration (REQUIRED)
DECENTRA_ENCRYPTION_KEY=your_encryption_key_here
```

**⚠️ IMPORTANT: Encryption Key Setup**

The `DECENTRA_ENCRYPTION_KEY` environment variable is **required** for the application to start. It is used to encrypt sensitive data like SMTP passwords in the database.

To generate a secure encryption key, run:
```bash
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
```

Copy the output and set it as the value of `DECENTRA_ENCRYPTION_KEY` in your `.env` file.

**Security Note:** 
- Keep this key secret and secure
- Never commit the `.env` file to version control
- If you lose this key, encrypted data cannot be recovered
- Use a different key for each deployment/environment
**Note**: The `DATABASE_URL` is automatically constructed from these variables. You don't need to set it manually unless you want to override the default connection string.

3. Start the server:
```bash
docker-compose up --build
```

This will start both the PostgreSQL database and the chat server on port 8765 with persistent data storage in a Docker volume.

4. Open your web browser and navigate to:
```
https://localhost:8765
```

**Note**: Since the server uses a self-signed SSL certificate for local security, your browser will show a security warning. This is expected behavior. Click "Advanced" or "Show Details" and then "Proceed to localhost" (the exact wording varies by browser) to continue.

5. Create an account or log in to start chatting!

6. To stop the server (data will persist):
```bash
docker-compose down
```

7. To completely remove all data and start fresh:
```bash
docker-compose down -v
```

**Note**: Your data (users, messages, servers) is stored in a PostgreSQL database in the Docker volume named `decentra-data` and will persist across container restarts.

### Running Manually with Docker

If you want to run the components separately:

1. Set up your environment variables (same as above):
```bash
cp .env.example .env
# Edit .env with your credentials
```

2. First, start PostgreSQL:
```bash
docker run -d --name decentra-postgres \
  --env-file .env \
  -v decentra-data:/var/lib/postgresql/data \
  postgres:16-alpine
```

3. Then, build and run the server:
```bash
# Load environment variables into shell for variable expansion in docker run command
# This is needed because we construct DATABASE_URL with the container hostname
set -a
source .env
set +a

cd server
docker build -t decentra-server .
docker run -p 8765:8765 \
  -e DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@decentra-postgres:5432/${POSTGRES_DB} \
  -e DECENTRA_ENCRYPTION_KEY=${DECENTRA_ENCRYPTION_KEY} \
  --link decentra-postgres \
  decentra-server
```

**Note**: For easier management, consider using docker-compose instead of running containers manually. Docker Compose automatically loads the .env file.

Then open your browser to `https://localhost:8765`

**Note**: You will see a browser warning about the self-signed certificate. This is normal for local development.

### Running Locally (without Docker)

**Prerequisites**: PostgreSQL 12+ installed and running locally

1. Create a PostgreSQL database:
```bash
createdb decentra
# Or use psql:
psql -c "CREATE DATABASE decentra;"
```

2. Set the required environment variables:
```bash
# Database connection (optional, defaults to localhost)
export DATABASE_URL=postgresql://username:password@localhost:5432/decentra

# Encryption key (REQUIRED) - Generate using:
# python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
export DECENTRA_ENCRYPTION_KEY='your-generated-encryption-key-here'
```

3. Install dependencies and run the server:
```bash
cd server
pip install -r requirements.txt
python server.py
```

Then open your browser to `http://localhost:8765`

**Note**: The first user can sign up without an invite code. All subsequent users need an invite code from an existing user.

## Architecture

### Server (`server/`)

- **server.py**: Combined HTTP and WebSocket server that handles:
  - User authentication and management
  - Server and channel creation (text and voice channels)
  - Friend system and user search
  - Direct messaging
  - Message routing to appropriate contexts
  - Real-time WebSocket communication
  - WebRTC signaling for voice chat connections
  - Voice state management
- **database.py**: PostgreSQL database layer for persistent storage
  - User accounts and authentication
  - Servers, channels, and memberships
  - Messages and chat history
  - Friendships and direct messages
  - Invite codes
- **api.py**: REST API endpoints for external integrations
- **static/**: Web client files (HTML, CSS, JavaScript)
  - **index.html**: Login and signup page
  - **chat.html**: Main chat interface with servers, channels, DMs, friends, and voice controls
  - **styles.css**: Application styling with Discord-like layout
  - **auth.js**: Authentication logic
  - **chat.js**: Chat functionality, WebSocket client, and UI management
  - **voice.js**: WebRTC voice chat implementation and peer connection management
- **Dockerfile**: Container configuration for the server
- **requirements.txt**: Python dependencies (websockets, bcrypt, aiohttp, psycopg2-binary)

### Database

The application uses PostgreSQL for persistent data storage:
- **PostgreSQL 16**: Production-ready relational database
- **Docker Volume**: Data stored in `decentra-data` volume for persistence
- **Schema**: Automatically initialized on first run with all required tables

### Legacy Terminal Client (`client/`)

The terminal-based client is still available for backwards compatibility but is deprecated in favor of the web interface.

### Configuration

The server runs on port 8765 by default and serves both HTTPS and WebSocket connections with a self-signed SSL certificate for improved local security.

**SSL Certificate**: The server automatically generates a self-signed SSL certificate on first run, which is stored in the `server/certs/` directory. The certificate is valid for 1 year and will be reused on subsequent runs. When accessing the application in your browser, you'll need to accept the self-signed certificate warning.

## Usage

### Web Interface

1. **Login/Signup Page**: Enter your username and password
   - Click "Login" to sign in with an existing account
   - Click "Sign Up" to create a new account (first user doesn't need an invite code)
   
2. **Main Interface**: 
   - **Left Sidebar**: View your servers and direct messages
   - **Middle Sidebar**: View channels (when server selected) or friends list
   - **Main Chat Area**: Send and receive messages

### Core Features

#### Servers
- Click the **+ button** in the left sidebar to create a new server
- Each server automatically gets a "general" channel
- Click on any server to view its channels
- Send messages in server channels to communicate with all members

##### Server Settings (Owner Only)
Server owners can access settings by clicking the **⚙ button** next to the server name:

**General Settings:**
- Rename the server at any time
- Changes are visible to all server members immediately

**Server Invites:**
- Generate invite codes specific to your server
- Share invite codes with others to let them join
- Each invite code can only be used once
- New members join with no special permissions by default

**User Permissions:**
- Manage what each member can do in your server
- Available permissions:
  - **Create Channel**: Allow users to create new text/voice channels
  - **Edit Channel**: Allow users to modify channel settings
  - **Delete Channel**: Allow users to remove channels
- Server owners always have all permissions
- Toggle permissions on/off for each member individually

#### Friends
- Click the **Friends** button in the header to view your friends list
- Click **Search Users** to find other users by username
- Click **Add Friend** to send a friend request
- Friends are added instantly (no approval needed)

#### Direct Messages
- Once you've added friends, click the **DM** button next to a friend's name
- Start a private conversation that only you and your friend can see
- All your DMs appear in the left sidebar under "Direct Messages"

#### Voice Chat

##### Direct Voice Calls
- Click the **📞 button** next to a friend's name in the friends list or DMs
- Your friend will receive an incoming call notification
- They can accept or reject the call
- During a call, use the mute button (🎤) to mute/unmute your microphone
- Click "Leave Voice" to end the call

##### Voice Channels in Servers
- Users with "Create Channel" permission can create voice channels:
  1. Select a server
  2. Click the **⚙ menu button** (bottom left)
  3. Select **Create Voice Channel**
  4. Enter a name for the voice channel
- Voice channels appear with a 🔊 speaker icon
- Click on a voice channel to join it
- See how many users are currently in the channel (displayed next to channel name)
- Use the voice controls at the bottom to:
  - Mute/unmute your microphone
  - Leave the voice channel
- All users in the same voice channel can hear each other

**Note**: Voice chat uses WebRTC for peer-to-peer connections. Make sure your browser has microphone permissions enabled.

### Message Display

- Your messages appear in **green** bubbles
- Other users' messages appear in **blue** bubbles
- System messages (joins/leaves) appear in **gray** text
- Message history is displayed when you first join a channel or DM

#### Rich Embeds

Messages automatically detect and embed various types of content:

- **Links**: Regular URLs become clickable links with visual styling
- **Images**: Image URLs (.jpg, .png, .gif, .webp, .svg) display as inline images
  - Click images to open them in a new tab
  - Images are lazy-loaded for better performance
- **Videos**: Video URLs (.mp4, .webm, .ogg) embed with a video player
  - Full playback controls included
  - Click to play/pause, adjust volume, fullscreen
- **YouTube**: YouTube links automatically embed with the full YouTube player
  - Supports both `youtube.com/watch?v=...` and `youtu.be/...` formats
  - Full YouTube controls including quality selection

**Example messages:**
```
Check out https://github.com
Here's a photo: https://example.com/image.png
Watch this: https://example.com/video.mp4
Cool video: https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

For more details, see [RICH_EMBEDS.md](RICH_EMBEDS.md).

## Authentication

### First User Setup

The first user to connect to a new server can sign up without an invite code:

1. Navigate to `http://localhost:8765`
2. Click "Sign Up"
3. Enter your desired username and password
4. Leave the invite code field empty
5. Click "Create Account"
6. You're now authenticated and can start chatting!

### Subsequent Users

After the first user is created, all new users need an invite code:

1. Ask an existing user to generate an invite code (click "Generate Invite" button)
2. Navigate to `http://localhost:8765`
3. Click "Sign Up"
4. Enter your desired username and password
5. Enter the invite code provided
6. Click "Create Account"
7. You're now authenticated!

### Logging In

If you already have an account:

1. Navigate to `http://localhost:8765`
2. Enter your username and password
3. Click "Login"
4. Start chatting!

### Generating Invite Codes

Any authenticated user can generate invite codes:

1. Click the "Generate Invite" button in the chat header
2. Copy the displayed code from the modal
3. Share the code with someone you want to invite
4. Each invite code can only be used once

## Email Notifications (SMTP)

Decentra supports sending email notifications for system events like user registration. The first user (admin) can configure SMTP settings through the Admin Configuration page.

### Setting up SMTP

1. Log in as the first user (admin)
2. Navigate to Admin Configuration (accessible from the chat interface)
3. Scroll to the "Email & SMTP Settings" section
4. Configure your SMTP server settings:
   - Enable email notifications
   - Enter your SMTP host (e.g., smtp.gmail.com)
   - Set the SMTP port (587 for TLS, 465 for SSL)
   - Enter authentication credentials
   - Set the "From" email address and name
5. Click "Test SMTP Connection" to verify your settings
6. Click "Save Settings" to save your configuration

For detailed SMTP setup instructions and provider-specific examples, see [SMTP_SETUP.md](SMTP_SETUP.md).

### Common SMTP Providers

- **Gmail**: smtp.gmail.com:587 (requires App Password)
- **Office 365**: smtp.office365.com:587
- **SendGrid**: smtp.sendgrid.net:587
- **Mailgun**: smtp.mailgun.org:587

See [SMTP_SETUP.md](SMTP_SETUP.md) for complete configuration details.

## Browser Notifications

Decentra includes built-in browser notification support to keep you informed of new messages and incoming calls, even when the app is in the background.

### Features

- **Desktop Notification Popups**: Get native browser notifications for new messages and incoming voice calls
- **Customizable Sound Alerts**: Choose from multiple notification sounds for messages and calls
- **Notification Modes**: Control when you receive notifications
  - **All Messages**: Get notified for every new message
  - **Mentions Only**: Only receive notifications when someone @mentions you
  - **None**: Disable all notifications
- **Intelligent Visibility Detection**: Notifications are only shown when the chat window is not actively visible

### Setting up Browser Notifications

1. **Initial Permission Request**: When you first log in, Decentra will request permission to show notifications. Click "Allow" to enable notifications.

2. **Access Notification Settings**:
   - Click the **⚙ menu button** in the bottom left
   - Select **Notification Settings**

3. **Configure Your Preferences**:
   - **Enable Browser Notifications**: Toggle to enable/disable notification popups
   - **Enable Notification Sounds**: Toggle to enable/disable sound alerts
   - **Notification Mode**: Choose when to receive notifications (All, Mentions Only, or None)
   - **Message Sound**: Select from "Soft Ping", "Gentle Chime", or "Subtle Pop"
   - **Call Sound**: Select from "Classic Ring", "Modern Tone", or "Upbeat Call"

4. **Test Your Settings**: Use the test buttons next to each sound option to preview notification sounds

### How Notifications Work

- **New Messages**: When you receive a message while the chat window is in the background or another tab, you'll see a desktop notification with the sender's name and message preview
- **Incoming Calls**: When someone calls you, you'll receive a notification popup and hear your selected call sound
- **Mentions**: When someone @mentions your username in a message, it's treated as a priority notification (respects your notification mode setting)
- **Auto-Close**: Notification popups automatically close after 5 seconds
- **Click to Focus**: Clicking a notification brings the chat window into focus

### Browser Compatibility

Browser notifications are supported in:
- Chrome/Edge 22+
- Firefox 22+
- Safari 7+
- Opera 25+

**Note**: Notifications require HTTPS or localhost. The app uses a self-signed SSL certificate for local development, which ensures notifications work properly.

### Troubleshooting

If notifications aren't working:

1. **Check Browser Permissions**: Make sure you've allowed notifications for the site
   - Chrome: Click the lock icon in the address bar → Site Settings → Notifications
   - Firefox: Click the lock icon → Permissions → Receive Notifications
   - Safari: Safari menu → Preferences → Websites → Notifications

2. **Check Notification Settings**: Ensure "Enable Browser Notifications" is toggled on in the app settings

3. **System Notifications**: Make sure system-level notifications aren't disabled
   - Windows: Settings → System → Notifications
   - macOS: System Preferences → Notifications
   - Linux: Varies by desktop environment

## Customization

### Changing the Port

To use a different port, update the port mapping in `docker-compose.yml`:

```yaml
services:
  server:
    ports:
      - "8080:8765"  # Change 8080 to your desired port
```

Then access the web interface at `https://localhost:8080`

### Multiple Users

The web-based client supports unlimited simultaneous users. Simply have each user open the URL in their browser and log in or sign up.

### Data Persistence

All application data is stored in a PostgreSQL database:
- **With Docker**: Data is stored in a Docker volume (`decentra-data`) that persists the PostgreSQL database across container restarts
- **Local Development**: Connect to your local PostgreSQL instance using the DATABASE_URL environment variable

The PostgreSQL database stores:
- User accounts and passwords (hashed with bcrypt)
- Friendships and friend requests
- Servers, channels, and memberships
- All message history with timestamps
- Invite codes

To backup your data:
- **Docker**: Back up the Docker volume or use PostgreSQL's `pg_dump` tool
- **Local**: Use `pg_dump` to create database backups

```bash
# Backup database (Docker)
docker exec decentra-postgres pg_dump -U decentra decentra > backup.sql

# Restore database (Docker)
docker exec -i decentra-postgres psql -U decentra decentra < backup.sql
```

## REST API

Decentra includes a REST API for desktop application integration. The API provides HTTP endpoints for:
- User authentication
- Fetching servers and channels
- Retrieving message history
- Managing friends and direct messages

See [API.md](API.md) for complete API documentation.

**API Base URL**: `https://localhost:8765/api`

**Example**: Get user's servers
```bash
curl -k "https://localhost:8765/api/servers?username=myusername"
```

**Note**: Use the `-k` flag with curl to accept the self-signed certificate.

For real-time messaging and updates, desktop applications should use the WebSocket endpoint at `wss://localhost:8765/ws` in combination with the REST API.

## Development

### Project Structure

```
decentra/
├── server/
│   ├── server.py          # HTTP and WebSocket server
│   ├── database.py        # SQLite database layer
│   ├── api.py             # REST API endpoints
│   ├── static/            # Web client files
│   │   ├── index.html     # Login/signup page
│   │   ├── chat.html      # Chat interface
│   │   ├── styles.css     # Application styles
│   │   ├── auth.js        # Authentication logic
│   │   ├── chat.js        # Chat and WebSocket client
│   │   └── voice.js       # WebRTC voice chat
│   ├── Dockerfile         # Server container config
│   └── requirements.txt   # Server dependencies
├── client/                # Legacy terminal client (deprecated)
│   ├── client.py          
│   ├── Dockerfile         
│   └── requirements.txt   
├── docker-compose.yml     # Docker orchestration with volumes
├── API.md                 # REST API documentation
├── .dockerignore         # Files to exclude from Docker builds
├── .gitignore            # Files to exclude from git
├── README.md             # This file
└── LICENSE               # Apache 2.0 License
```

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
