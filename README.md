# Decentra

A decentralized Discord-like chat server and client that is non-federated and self-hostable. Built with Python and WebSockets, designed to run in Docker containers.

## Features

- 🚀 Real-time WebSocket-based messaging
- 💬 Multi-user chat support
- 🔐 Username/password authentication
- 🎟️ Invite code system for controlled access
- 📜 Message history (last 100 messages)
- 🐳 Docker containerized for easy deployment
- 🔌 Simple server-client architecture
- 🎨 Color-coded terminal interface

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

2. Start the server and clients:
```bash
docker-compose up --build
```

This will start:
- One chat server on port 8765
- Two chat clients (Client1 and Client2) connected to the server

3. To interact with the clients, attach to their containers:
```bash
# In one terminal
docker attach decentra-client1

# In another terminal
docker attach decentra-client2
```

4. Start chatting! Type your message and press Enter.

5. To detach from a client without stopping it, press `Ctrl+P` then `Ctrl+Q`

6. To stop all containers:
```bash
docker-compose down
```

### Running Manually with Docker

#### Start the Server

```bash
cd server
docker build -t decentra-server .
docker run -p 8765:8765 decentra-server
```

#### Start a Client

```bash
cd client
docker build -t decentra-client .
docker run -it --network host -e SERVER_HOST=localhost decentra-client
```

### Running Locally (without Docker)

#### Server

```bash
cd server
pip install -r requirements.txt
python server.py
```

#### Client

```bash
cd client
pip install -r requirements.txt
python client.py
```

When prompted:
1. Enter your username
2. Enter your password
3. Choose to login (1) or sign up (2)
4. If signing up and not the first user, provide an invite code

**Note**: The first user can sign up without an invite code. All subsequent users need an invite code from an existing user.

## Architecture

### Server (`server/`)

- **server.py**: WebSocket server that handles client connections, broadcasts messages, and maintains chat history
- **Dockerfile**: Container configuration for the server
- **requirements.txt**: Python dependencies

### Client (`client/`)

- **client.py**: Terminal-based chat client with color-coded interface
- **Dockerfile**: Container configuration for the client
- **requirements.txt**: Python dependencies

### Configuration

The client can be configured using environment variables:

- `SERVER_HOST`: Hostname or IP of the chat server (default: `localhost`)
- `SERVER_PORT`: Port number of the chat server (default: `8765`)

## Usage

### Client Commands

- Type any message and press Enter to send
- `/invite` - Generate an invite code for new users
- `/quit`, `/exit`, or `/q` to disconnect

### Message Format

- Your messages appear in **green**
- Other users' messages appear in **blue**
- System messages (joins/leaves) appear in **gray**
- Invite codes appear in **yellow**

## Authentication

### First User Setup

The first user to connect to a new server can sign up without an invite code:

1. Run the client: `python client.py`
2. Enter a username and password
3. Choose option "2" (Sign up)
4. Leave the invite code field empty
5. You're now authenticated and can start chatting!

### Subsequent Users

After the first user is created, all new users need an invite code:

1. Ask an existing user to generate an invite code using `/invite`
2. Run the client: `python client.py`
3. Enter your desired username and password
4. Choose option "2" (Sign up)
5. Enter the invite code provided
6. You're now authenticated!

### Logging In

If you already have an account:

1. Run the client: `python client.py`
2. Enter your username and password
3. Choose option "1" (Login)
4. Start chatting!

### Generating Invite Codes

Any authenticated user can generate invite codes:

1. Type `/invite` in the chat
2. Share the generated code with someone you want to invite
3. Each invite code can only be used once

## Customization

### Adding More Clients

Edit `docker-compose.yml` and add more client services:

```yaml
  client3:
    build:
      context: ./client
      dockerfile: Dockerfile
    container_name: decentra-client3
    environment:
      - SERVER_HOST=server
      - SERVER_PORT=8765
    stdin_open: true
    tty: true
    depends_on:
      - server
    networks:
      - decentra-network
    command: python client.py Client3
```

### Changing the Port

To use a different port, update:
1. `docker-compose.yml`: Change the server ports mapping
2. Client environment variables: Update `SERVER_PORT`

## Development

### Project Structure

```
decentra/
├── server/
│   ├── server.py          # WebSocket server implementation
│   ├── Dockerfile         # Server container config
│   └── requirements.txt   # Server dependencies
├── client/
│   ├── client.py          # Chat client implementation
│   ├── Dockerfile         # Client container config
│   └── requirements.txt   # Client dependencies
├── docker-compose.yml     # Multi-container orchestration
├── .dockerignore         # Files to exclude from Docker builds
├── .gitignore            # Files to exclude from git
├── README.md             # This file
└── LICENSE               # Apache 2.0 License
```

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
