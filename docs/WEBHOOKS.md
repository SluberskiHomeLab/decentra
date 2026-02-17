# Webhooks Documentation

## Overview

Webhooks allow you to automate message posting to your Decentra server channels from external applications. Similar to Discord webhooks, they provide a simple HTTP API that can be used to send messages programmatically.

## Types of Webhooks

### Server Webhooks

Server webhooks allow you to send messages to specific channels within a server. They are created and managed by server members with appropriate permissions.

**Features:**
- Send messages to specific channels
- Customize webhook name and avatar
- Each webhook has a unique URL and token
- Can be created by any server member

### Instance Webhooks (Admin Only)

Instance webhooks are system-wide webhooks that can respond to specific events across the entire Decentra instance. These are only available to administrators.

**Supported Events:**
- `user.signup` - Triggered when a new user signs up
- `user.login` - Triggered when a user logs in
- `message.create` - Triggered when a message is created
- `server.create` - Triggered when a new server is created

## Creating a Server Webhook

### Via Web Interface

1. **Navigate to Server Settings**
   - Click on the server icon in the sidebar
   - Select "Server Settings" from the dropdown menu

2. **Go to Webhooks Section**
   - Scroll down to the "🔗 Webhooks" section
   - Click "Create Webhook"

3. **Configure Your Webhook**
   - **Name**: Enter a descriptive name for your webhook
   - **Channel**: Select the target channel where messages will be posted
   - **Avatar**: (Optional) Choose an emoji or icon for the webhook

4. **Save and Copy URL**
   - Click "Create" to generate your webhook
   - Copy the webhook URL from the list
   - Keep this URL secure - anyone with the URL can post to your channel!

### Via API

```bash
curl -X POST https://your-decentra-instance.com/api/webhooks \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "server_id": "server-123",
    "channel_id": "channel-456",
    "name": "GitHub Notifications",
    "avatar": "🐙"
  }'
```

**Response:**
```json
{
  "success": true,
  "webhook": {
    "id": "webhook-789",
    "name": "GitHub Notifications",
    "url": "https://your-decentra-instance.com/api/webhooks/webhook-789/TOKEN",
    "token": "SECRET_TOKEN_HERE",
    "avatar": "🐙",
    "channel_id": "channel-456"
  }
}
```

## Using a Webhook

### Basic Message

To send a message via webhook, make a POST request to the webhook URL:

```bash
curl -X POST "https://your-decentra-instance.com/api/webhooks/WEBHOOK_ID/TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Hello from my webhook!"
  }'
```

### Custom Display Name

You can override the webhook name for individual messages:

```bash
curl -X POST "https://your-decentra-instance.com/api/webhooks/WEBHOOK_ID/TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Deploy completed successfully!",
    "username": "CI/CD Bot"
  }'
```

## Use Cases

### GitHub Integration

Receive notifications when code is pushed to your repository:

```javascript
// GitHub webhook handler (Node.js example)
const fetch = require('node-fetch');

async function sendToDecentra(event, repository, pusher) {
  const webhookUrl = process.env.DECENTRA_WEBHOOK_URL;
  
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: `📦 **${repository.name}**: New push by ${pusher.name}\n${event.commits.length} commit(s)`,
      username: 'GitHub'
    })
  });
}
```

### Monitoring Alerts

Send server monitoring alerts to your team:

```python
import requests
import json

def send_alert(message, severity="info"):
    webhook_url = "https://your-decentra-instance.com/api/webhooks/WEBHOOK_ID/TOKEN"
    
    emojis = {
        "info": "ℹ️",
        "warning": "⚠️",
        "error": "🔴",
        "success": "✅"
    }
    
    payload = {
        "content": f"{emojis.get(severity, 'ℹ️')} **Alert**: {message}",
        "username": "Monitoring System"
    }
    
    response = requests.post(webhook_url, json=payload)
    return response.json()

# Usage
send_alert("Server load is above 80%", "warning")
send_alert("Backup completed successfully", "success")
```

### Scheduled Tasks

Post scheduled reminders or announcements:

```python
import requests
from datetime import datetime

def post_daily_update():
    webhook_url = "https://your-decentra-instance.com/api/webhooks/WEBHOOK_ID/TOKEN"
    
    today = datetime.now().strftime("%B %d, %Y")
    
    payload = {
        "content": f"📅 **Daily Update for {today}**\n\nGood morning team! Here's what's on the agenda today...",
        "username": "Daily Bot"
    }
    
    requests.post(webhook_url, json=payload)
```

## Managing Webhooks

### Listing Server Webhooks

```bash
curl https://your-decentra-instance.com/api/webhooks/server/SERVER_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Deleting a Webhook

Via Web Interface:
1. Go to Server Settings → Webhooks
2. Find the webhook you want to delete
3. Click the trash icon
4. Confirm deletion

Via API:
```bash
curl -X DELETE https://your-decentra-instance.com/api/webhooks/WEBHOOK_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Instance Webhooks (Admin Only)

### Creating an Instance Webhook

```bash
curl -X POST https://your-decentra-instance.com/api/instance-webhooks \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New User Notifications",
    "event_type": "user.signup",
    "target_url": "https://my-external-service.com/webhook",
    "enabled": true
  }'
```

### Managing Instance Webhooks

Instance webhooks can be managed from the Admin Settings panel:

1. Click on your profile → Admin Settings
2. Scroll to "Instance Webhooks" section
3. Create, view, or delete instance webhooks

## Security Best Practices

1. **Keep URLs Secret**: Treat webhook URLs like passwords. Anyone with the URL can post messages.

2. **Use HTTPS**: Always use HTTPS endpoints for webhook URLs to prevent interception.

3. **Rotate Tokens**: If a webhook URL is compromised, delete it and create a new one.

4. **Limit Permissions**: Only give webhook creation permissions to trusted users.

5. **Monitor Usage**: Regularly review active webhooks and remove unused ones.

6. **Validate Payloads**: When creating external services that post to webhooks, validate and sanitize all input.

## Rate Limiting

To prevent abuse, webhook endpoints may be rate-limited:
- Maximum 60 requests per minute per webhook
- Excessive use may result in temporary suspension

## Troubleshooting

### Webhook Not Posting Messages

1. **Verify the URL**: Make sure you're using the complete webhook URL including the token
2. **Check Channel Permissions**: Ensure the webhook's target channel still exists
3. **Validate JSON**: Ensure your request body is valid JSON
4. **Check Content**: The `content` field is required and cannot be empty

### "Invalid webhook" Error

- The webhook may have been deleted
- The token might be incorrect
- Verify the webhook ID and token in the URL

### "Authorization required" Error

- This error occurs when trying to manage webhooks (create/delete) without proper authentication
- Ensure you're including a valid JWT token in the Authorization header

## API Reference

### Execute Webhook

**Endpoint:** `POST /api/webhooks/{webhook_id}/{token}`

**Request Body:**
```json
{
  "content": "Message content (required)",
  "username": "Display name (optional)"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Webhook executed successfully",
  "webhook_data": {
    "channel_id": "channel-456",
    "server_id": "server-123",
    "content": "Message content",
    "display_name": "Webhook Name",
    "webhook_id": "webhook-789"
  }
}
```

### Create Webhook

**Endpoint:** `POST /api/webhooks`

**Headers:**
- `Authorization: Bearer {jwt_token}`
- `Content-Type: application/json`

**Request Body:**
```json
{
  "server_id": "server-123",
  "channel_id": "channel-456",
  "name": "My Webhook",
  "avatar": "🔗"
}
```

### Get Server Webhooks

**Endpoint:** `GET /api/webhooks/server/{server_id}`

**Headers:**
- `Authorization: Bearer {jwt_token}`

### Delete Webhook

**Endpoint:** `DELETE /api/webhooks/{webhook_id}`

**Headers:**
- `Authorization: Bearer {jwt_token}`

## Support

For additional help or to report issues:
- Check the main [API documentation](../API.md)
- Review [security guidelines](../SECURITY.md)
- Consult the [contributing guide](../CONTRIBUTING.md) if you want to enhance webhook functionality
