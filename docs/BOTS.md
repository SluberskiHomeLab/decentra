# Decentra Bot System

This document covers the complete bot system for Decentra — creating bots, managing them, developing with the SDK, and the underlying protocol.

## Table of Contents

- [Overview](#overview)
- [Creating a Bot](#creating-a-bot)
- [Bot Authentication](#bot-authentication)
- [Scopes & Intents](#scopes--intents)
- [WebSocket Protocol](#websocket-protocol)
- [REST API Endpoints](#rest-api-endpoints)
- [Slash Commands](#slash-commands)
- [Rate Limiting](#rate-limiting)
- [Bot SDK](#bot-sdk)
- [Docker Deployment](#docker-deployment)

## Overview

Decentra bots are automated accounts that can:
- Send and receive messages
- Respond to slash commands
- React to events (member joins, reactions, etc.)
- Manage server content (with appropriate permissions)

Bots use a **dual connectivity** model:
- **WebSocket** — receives real-time events from the server
- **REST API** — performs actions (send messages, query data, etc.)

## Creating a Bot

1. Navigate to **Admin Settings → Bots**
2. Click **+ Create Bot**
3. Fill in the details:
   - **Name**: Display name shown in chat
   - **Username**: Unique identifier (used for @mentions)
   - **Description**: What the bot does
   - **Scopes**: Permission grants (what the bot can do)
   - **Intents**: Event subscriptions (what events the bot receives)
   - **Rate Limits**: Message/API call limits
4. Click **Create Bot**
5. **Copy the token immediately** — it's only displayed once

### Adding a Bot to a Server

1. Go to **Server Settings → Bots**
2. Click **+ Add Bot**
3. Select from available bots
4. The bot will appear in the server member list with a BOT badge

## Bot Authentication

### WebSocket Authentication

Connect to `wss://your-instance/ws` and send:

```json
{
  "type": "bot_auth",
  "token": "your-bot-token"
}
```

Success response:
```json
{
  "type": "bot_auth_success",
  "bot_id": "uuid",
  "username": "mybot",
  "name": "My Bot"
}
```

### REST API Authentication

Include the bot token in the `Authorization` header:

```
Authorization: Bot your-bot-token
```

## Scopes & Intents

### Scopes (Permissions)

| Scope | Description |
|---|---|
| `READ_MESSAGES` | Read messages in channels |
| `SEND_MESSAGES` | Send messages to channels |
| `MANAGE_MESSAGES` | Edit and delete messages |
| `READ_MEMBERS` | View server member lists |
| `MANAGE_MEMBERS` | Kick and ban members |
| `MANAGE_CHANNELS` | Create, edit, delete channels |
| `MANAGE_ROLES` | Create, edit, assign roles |
| `ADD_REACTIONS` | Add and remove reactions |
| `MANAGE_THREADS` | Create and manage threads |
| `USE_SLASH_COMMANDS` | Register and handle slash commands |
| `SEND_DMS` | Send direct messages |
| `MANAGE_SERVER` | Edit server settings |
| `READ_VOICE_STATE` | See voice channel users |
| `ADMINISTRATOR` | Full access — bypasses all scope checks |

### Intents (Event Subscriptions)

| Intent | Events Received |
|---|---|
| `GUILD_MESSAGES` | `message_create`, `message_update`, `message_delete` |
| `GUILD_MEMBERS` | `member_join`, `member_leave`, `member_ban`, `member_update` |
| `GUILD_REACTIONS` | `reaction_add`, `reaction_remove` |
| `GUILD_CHANNELS` | `channel_create`, `channel_update`, `channel_delete` |
| `GUILD_ROLES` | `role_create`, `role_update`, `role_delete` |
| `GUILD_VOICE_STATE` | `voice_state_update` |
| `GUILD_THREADS` | `thread_create`, `thread_update`, `thread_delete` |
| `GUILD_POLLS` | `poll_create`, `poll_vote`, `poll_end` |
| `DIRECT_MESSAGES` | `dm_message_create` |
| `SLASH_COMMANDS` | `slash_command` |

## WebSocket Protocol

### Event Format

All bot events are delivered in this format:

```json
{
  "type": "bot_event",
  "event": "message_create",
  "server_id": "server-uuid",
  "channel_id": "channel-uuid",
  "data": {
    "id": 123,
    "username": "alice",
    "content": "Hello world!",
    "timestamp": "2024-01-01T00:00:00Z"
  }
}
```

### Slash Command Event

When a user invokes a slash command:

```json
{
  "type": "bot_event",
  "event": "slash_command",
  "server_id": "server-uuid",
  "channel_id": "channel-uuid",
  "data": {
    "command": "hello",
    "arguments": {"name": "Alice"},
    "user": "alice"
  }
}
```

## REST API Endpoints

### Bot Action Endpoints

All require `Authorization: Bot <token>` header.

#### Send Message
```
POST /api/bot/messages
```
```json
{
  "server_id": "uuid",
  "channel_id": "uuid",
  "content": "Hello from bot!"
}
```

#### Edit Message
```
PUT /api/bot/messages/:message_id
```
```json
{
  "content": "Updated content"
}
```

#### Delete Message
```
DELETE /api/bot/messages/:message_id
```

#### Get Bot's Servers
```
GET /api/bot/servers
```

#### Get Server Channels
```
GET /api/bot/servers/:server_id/channels
```

#### Get Server Members
```
GET /api/bot/servers/:server_id/members
```

#### Get Channel Messages
```
GET /api/bot/servers/:server_id/channels/:channel_id/messages?limit=50
```

#### Register Slash Commands
```
POST /api/bot/commands
```
```json
{
  "commands": [
    {
      "name": "hello",
      "description": "Say hello!",
      "parameters": [
        {
          "name": "target",
          "description": "Who to greet",
          "type": "string",
          "required": false
        }
      ]
    }
  ]
}
```

#### Add Reaction
```
POST /api/bot/messages/:message_id/reactions
```
```json
{
  "emoji": "👍"
}
```

### Admin Endpoints

Require admin's `Authorization: Bearer <jwt>` header.

#### Create Bot
```
POST /api/bots
```
```json
{
  "name": "My Bot",
  "username": "mybot",
  "description": "Does cool things",
  "scopes": ["READ_MESSAGES", "SEND_MESSAGES"],
  "intents": ["GUILD_MESSAGES", "SLASH_COMMANDS"],
  "rate_limit_messages": 30,
  "rate_limit_api": 120
}
```

Response includes `bot.token` — shown only once.

#### List/Get/Update/Delete Bots
```
GET    /api/bots
GET    /api/bots/:bot_id
PUT    /api/bots/:bot_id
DELETE /api/bots/:bot_id
```

#### Regenerate Token
```
POST /api/bots/:bot_id/regenerate-token
```

#### Manage Server Membership
```
POST   /api/bots/:bot_id/servers/:server_id   # Add to server
DELETE /api/bots/:bot_id/servers/:server_id   # Remove from server
```

## Slash Commands

### Registration

Bots register commands via REST API. Commands are:
- **Global** (no `server_id`): Available in all servers the bot joins
- **Server-specific** (`server_id` set): Only available in that server

### User Interaction

1. User types `/` in a server channel
2. Autocomplete shows available commands from server bots
3. User selects a command and provides arguments
4. Server delivers a `slash_command` event to the owning bot's WebSocket
5. Bot processes and responds

### Admin Control

Server owners can disable specific slash commands in **Server Settings → Bots**.

## Rate Limiting

| Rate | Default | Description |
|---|---|---|
| Messages | 30/10s per channel | Sliding window per bot per channel |
| API calls | 120/min | Global per bot |

Rate limits are configurable per-bot by the instance admin.

When rate limited, the API returns:
```json
{
  "error": "Rate limited",
  "retry_after_ms": 1234
}
```

## Bot SDK

The `decentra-botdev/` directory contains a Python SDK for building bots.

### Quick Start

```python
from sdk import DecentraBot

bot = DecentraBot()

@bot.on_message()
async def handle(message):
    if message.content == '!ping':
        await bot.send_message(message.server_id, message.channel_id, 'Pong!')

bot.run()
```

See [decentra-botdev/README.md](../decentra-botdev/README.md) for full SDK documentation.

## Docker Deployment

```bash
cd decentra-botdev
cp .env.example .env
# Edit .env with your instance URL and bot token
docker-compose up -d
```

Or build manually:
```bash
docker build -t my-bot .
docker run --env-file .env my-bot
```
