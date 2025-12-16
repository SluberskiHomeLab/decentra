# Decentra

A decentralized Discord-like chat server and client that is non-federated and self-hostable. Built with Python and WebSockets, designed to run in Docker containers.

## Features

- 🚀 Real-time WebSocket-based messaging
- 🖥️ **Servers** - Create and manage multiple servers with channels
- 💬 **Direct Messages** - Private conversations with friends
- 👥 **Friend System** - Search for users and add friends
- 🔐 Username/password authentication
- 🎟️ Invite code system for controlled access
- 📜 Message history (last 100 messages per channel/DM)
- 🐳 Docker containerized for easy deployment
- 🌐 Modern web-based interface with Discord-like layout
- 🎨 Beautiful responsive UI design

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

2. Start the server:
```bash
docker-compose up --build
```

This will start the chat server on port 8765.

3. Open your web browser and navigate to:
```
http://localhost:8765
```

4. Create an account or log in to start chatting!

5. To stop the server:
```bash
docker-compose down
```

### Running Manually with Docker

```bash
cd server
docker build -t decentra-server .
docker run -p 8765:8765 decentra-server
```

Then open your browser to `http://localhost:8765`

### Running Locally (without Docker)

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
  - Server and channel creation
  - Friend system and user search
  - Direct messaging
  - Message routing to appropriate contexts
  - Real-time WebSocket communication
- **static/**: Web client files (HTML, CSS, JavaScript)
  - **index.html**: Login and signup page
  - **chat.html**: Main chat interface with servers, channels, DMs, and friends
  - **styles.css**: Application styling with Discord-like layout
  - **auth.js**: Authentication logic
  - **chat.js**: Chat functionality, WebSocket client, and UI management
- **Dockerfile**: Container configuration for the server
- **requirements.txt**: Python dependencies (websockets, bcrypt, aiohttp)

### Legacy Terminal Client (`client/`)

The terminal-based client is still available for backwards compatibility but is deprecated in favor of the web interface.

### Configuration

The server runs on port 8765 by default and serves both HTTP and WebSocket connections.

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

#### Friends
- Click the **Friends** button in the header to view your friends list
- Click **Search Users** to find other users by username
- Click **Add Friend** to send a friend request
- Friends are added instantly (no approval needed)

#### Direct Messages
- Once you've added friends, click the **DM** button next to a friend's name
- Start a private conversation that only you and your friend can see
- All your DMs appear in the left sidebar under "Direct Messages"

### Message Display

- Your messages appear in **green** bubbles
- Other users' messages appear in **blue** bubbles
- System messages (joins/leaves) appear in **gray** text
- Message history is displayed when you first join a channel or DM

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

## Customization

### Changing the Port

To use a different port, update the port mapping in `docker-compose.yml`:

```yaml
services:
  server:
    ports:
      - "8080:8765"  # Change 8080 to your desired port
```

Then access the web interface at `http://localhost:8080`

### Multiple Users

The web-based client supports unlimited simultaneous users. Simply have each user open the URL in their browser and log in or sign up.

## Development

### Project Structure

```
decentra/
├── server/
│   ├── server.py          # HTTP and WebSocket server
│   ├── static/            # Web client files
│   │   ├── index.html     # Login/signup page
│   │   ├── chat.html      # Chat interface
│   │   ├── styles.css     # Application styles
│   │   ├── auth.js        # Authentication logic
│   │   └── chat.js        # Chat and WebSocket client
│   ├── Dockerfile         # Server container config
│   └── requirements.txt   # Server dependencies
├── client/                # Legacy terminal client (deprecated)
│   ├── client.py          
│   ├── Dockerfile         
│   └── requirements.txt   
├── docker-compose.yml     # Docker orchestration
├── .dockerignore         # Files to exclude from Docker builds
├── .gitignore            # Files to exclude from git
├── README.md             # This file
└── LICENSE               # Apache 2.0 License
```

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
