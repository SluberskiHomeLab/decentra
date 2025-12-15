# Decentra

A decentralized Discord-like chat server and client that is non-federated and self-hostable. Built with Python and WebSockets, designed to run in Docker containers.

## Features

- 🚀 Real-time WebSocket-based messaging
- 💬 Multi-user chat support
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
python client.py YourUsername
```

Or run without specifying a username (you'll be prompted):
```bash
python client.py
```

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
- `/quit`, `/exit`, or `/q` to disconnect

### Message Format

- Your messages appear in **green**
- Other users' messages appear in **blue**
- System messages (joins/leaves) appear in **gray**

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
