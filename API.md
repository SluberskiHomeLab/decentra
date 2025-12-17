# Decentra REST API Documentation

This document describes the REST API endpoints available for desktop application integration.

## Base URL

When running locally: `http://localhost:8765/api`

## Authentication

### POST /api/auth

Authenticate a user and retrieve their profile information.

**Request Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "user": {
    "username": "string",
    "avatar": "string (emoji or null for images)",
    "avatar_type": "emoji|image",
    "avatar_data": "string (base64 image data) or null"
  }
}
```

**Error Response (401):**
```json
{
  "success": false,
  "error": "Invalid username or password"
}
```

## Servers

### GET /api/servers?username=<username>

Get all servers for a user.

**Query Parameters:**
- `username` (required): The username to get servers for

**Success Response (200):**
```json
{
  "success": true,
  "servers": [
    {
      "id": "server_1",
      "name": "My Server",
      "owner": "username",
      "channels": [
        {
          "id": "channel_1",
          "name": "general",
          "type": "text"
        },
        {
          "id": "channel_2",
          "name": "voice-chat",
          "type": "voice"
        }
      ]
    }
  ]
}
```

## Messages

### GET /api/messages?context_type=<type>&context_id=<id>&limit=<limit>

Get messages for a specific context (server channel or DM).

**Query Parameters:**
- `context_type` (required): "server" or "dm"
- `context_id` (required): 
  - For servers: "server_id/channel_id" (e.g., "server_1/channel_1")
  - For DMs: "dm_id" (e.g., "dm_1")
- `limit` (optional): Number of messages to return (default: 100, max: 500)

**Success Response (200):**
```json
{
  "success": true,
  "messages": [
    {
      "id": 1,
      "username": "john_doe",
      "content": "Hello, world!",
      "timestamp": "2024-01-15T10:30:00.000000",
      "context_type": "server",
      "context_id": "server_1/channel_1"
    }
  ]
}
```

## Friends

### GET /api/friends?username=<username>

Get friends list and friend requests for a user.

**Query Parameters:**
- `username` (required): The username to get friends for

**Success Response (200):**
```json
{
  "success": true,
  "friends": ["alice", "bob", "charlie"],
  "friend_requests_sent": ["dave"],
  "friend_requests_received": ["eve"]
}
```

## Direct Messages

### GET /api/dms?username=<username>

Get list of direct message conversations for a user.

**Query Parameters:**
- `username` (required): The username to get DMs for

**Success Response (200):**
```json
{
  "success": true,
  "dms": [
    {
      "dm_id": "dm_1",
      "other_user": "alice"
    },
    {
      "dm_id": "dm_2",
      "other_user": "bob"
    }
  ]
}
```

## Error Responses

All endpoints may return the following error responses:

**400 Bad Request:**
```json
{
  "success": false,
  "error": "Error message describing the problem"
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "error": "Error message describing the problem"
}
```

## WebSocket API

For real-time features (sending messages, receiving updates, voice chat), use the WebSocket API at `ws://localhost:8765/ws`.

The WebSocket protocol is documented in the server source code. Desktop applications should connect to the WebSocket endpoint after authenticating via the REST API to receive real-time updates.

## Example Usage

### Python Example

```python
import requests

# Authenticate
response = requests.post('http://localhost:8765/api/auth', json={
    'username': 'myusername',
    'password': 'mypassword'
})
user_data = response.json()

if user_data['success']:
    username = user_data['user']['username']
    
    # Get user's servers
    servers = requests.get(f'http://localhost:8765/api/servers?username={username}').json()
    
    # Get messages from a channel
    messages = requests.get(
        'http://localhost:8765/api/messages',
        params={
            'context_type': 'server',
            'context_id': 'server_1/channel_1',
            'limit': 50
        }
    ).json()
```

### JavaScript Example

```javascript
// Authenticate
const authResponse = await fetch('http://localhost:8765/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        username: 'myusername',
        password: 'mypassword'
    })
});
const userData = await authResponse.json();

if (userData.success) {
    const username = userData.user.username;
    
    // Get user's servers
    const serversResponse = await fetch(`http://localhost:8765/api/servers?username=${username}`);
    const servers = await serversResponse.json();
    
    // Get messages from a channel
    const messagesResponse = await fetch(
        `http://localhost:8765/api/messages?context_type=server&context_id=server_1/channel_1&limit=50`
    );
    const messages = await messagesResponse.json();
}
```

## Notes

- The REST API provides read-only access to data
- For sending messages and real-time features, use the WebSocket API
- The API uses JSON for all request and response bodies
- Currently, the API does not require session tokens - authentication is done per request
- For desktop applications, consider caching authentication results and user data locally
