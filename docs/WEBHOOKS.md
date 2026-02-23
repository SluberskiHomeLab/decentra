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

Instance webhooks are system-wide webhooks that send direct messages to **all registered users** on the Decentra instance. These are only available to administrators and work similarly to server webhooks, but instead of sending to a specific channel, they create a DM with each user.

**Features:**
- Send direct messages to all users simultaneously
- Messages appear in users' DM list from a system webhook user
- Customize webhook name and avatar
- Each webhook has a unique URL and token
- Perfect for system-wide announcements, maintenance notices, or important updates

**Use Cases:**
- System maintenance announcements
- Security alerts
- Platform-wide updates
- Emergency notifications

**Note:** Instance webhook messages appear as direct messages in each user's DM list. Users will see a DM from `__webhook__` with the custom name and avatar you configure.

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

## Testing Webhooks

### Using Postman

Postman is a great tool for testing your webhooks before integrating them into your applications.

#### Step 1: Get Your Webhook URL

1. In Decentra, go to Server Settings → Webhooks
2. Create a new webhook or use an existing one
3. Copy the webhook URL (it looks like: `https://your-decentra-instance.com/api/webhooks/WEBHOOK_ID/TOKEN`)

**For Local Development:**
- If you copied the URL from your local Decentra instance, it might show `https://localhost/...`
- Change it to use `http://` instead of `https://` (unless you have SSL configured)
- Include the port if your server runs on a non-standard port: `http://localhost:8080/api/webhooks/...`
- Common local URLs:
  - `http://localhost:8080/api/webhooks/WEBHOOK_ID/TOKEN`
  - `http://127.0.0.1:8080/api/webhooks/WEBHOOK_ID/TOKEN`

#### Step 2: Create a New Request in Postman

1. Open Postman
2. Click **New** → **HTTP Request** (or use the `+` tab)
3. Set the request method to **POST**
4. Paste your webhook URL into the URL field

#### Step 3: Configure Headers

1. Click on the **Headers** tab
2. Add a new header:
   - **Key**: `Content-Type`
   - **Value**: `application/json`

#### Step 4: Add Request Body

1. Click on the **Body** tab
2. Select **raw**
3. Choose **JSON** from the dropdown (next to the binary/text options)
4. Enter your JSON payload:

**Basic Message:**
```json
{
  "content": "Hello from Postman! This is a test message."
}
```

**Message with Custom Username:**
```json
{
  "content": "🧪 Testing webhook integration",
  "username": "Postman Tester"
}
```

**Rich Formatted Message:**
```json
{
  "content": "**Deployment Status**\n\n✅ Build: Success\n⏱️ Duration: 2m 34s\n🔗 Environment: Production\n\n```\nCommit: abc123\nBranch: main\n```",
  "username": "CI/CD Pipeline"
}
```

#### Step 5: Send the Request

1. Click the blue **Send** button
2. Check the response in the lower panel

**Expected Response (Success):**
```json
{
  "success": true,
  "message": "Webhook executed successfully",
  "webhook_data": {
    "channel_id": "channel-456",
    "server_id": "server-123",
    "content": "Hello from Postman! This is a test message.",
    "display_name": "Postman Tester",
    "webhook_id": "webhook-789"
  }
}
```

3. Check your Decentra channel to see the message appear!

#### Step 6: Save Your Request (Optional)

1. Click **Save** in the top right
2. Name it (e.g., "Decentra Webhook - Test Channel")
3. Create or select a collection
4. Save it for future use

### Using Postman Collections

You can create a collection with multiple webhook requests:

1. **Create Collection**
   - Click **Collections** in the sidebar
   - Click **+ New Collection**
   - Name it "Decentra Webhooks"

2. **Add Environment Variables**
   - Click **Environments** in the sidebar
   - Click **+ Create Environment**
   - Add variables:
     - `webhook_url`: Your full webhook URL
     - `server_id`: Your server ID
     - `channel_id`: Your channel ID

3. **Use Variables in Requests**
   - In your request URL field, use: `{{webhook_url}}`
   - In your JSON body, use:
     ```json
     {
       "content": "Testing from {{$timestamp}}",
       "username": "Automated Test"
     }
     ```

### Testing Error Scenarios

**Test 1: Missing Content**
```json
{
  "username": "Test User"
}
```
Expected: 400 error - "Content is required"

**Test 2: Invalid Webhook URL**
- Use a wrong token in the URL
- Expected: 404 error - "Invalid webhook"

**Test 3: Empty Content**
```json
{
  "content": "",
  "username": "Test User"
}
```
Expected: 400 error - "Content is required"

### Advanced Testing with Postman Scripts

Add a pre-request script to generate dynamic content:

**Pre-request Script Tab:**
```javascript
// Generate timestamp
pm.environment.set("timestamp", new Date().toISOString());

// Generate random test ID
pm.environment.set("test_id", Math.random().toString(36).substr(2, 9));
```

**Request Body:**
```json
{
  "content": "🧪 Test run at {{timestamp}}\nTest ID: {{test_id}}",
  "username": "Automated Tester"
}
```

Add a test script to verify the response:

**Tests Tab:**
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Response has success field", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('success');
    pm.expect(jsonData.success).to.be.true;
});

pm.test("Webhook data is present", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('webhook_data');
    pm.expect(jsonData.webhook_data).to.have.property('channel_id');
});

console.log("✅ Webhook test completed successfully!");
```

### Quick Tips

1. **Use Postman Console**: View → Show Postman Console to see detailed request/response logs
2. **Export for Team**: Export your collection and share with team members
3. **Automate Tests**: Use Postman's Collection Runner to run multiple tests
4. **Mock Integrations**: Test your webhook before building the actual integration

### Troubleshooting Local Development

#### Error: connect ECONNREFUSED 127.0.0.1:443

This error means Postman cannot connect to your local server. Here's how to fix it:

**1. Check Your Server is Running**
```bash
# Check if the server is running
docker ps
# or
docker compose ps
```

If the server isn't running, start it:
```bash
docker compose up -d
```

**2. Use the Correct Protocol and Port**

The error shows port 443 (HTTPS), but local servers typically use HTTP:

❌ **Wrong:**
```
https://localhost/api/webhooks/WEBHOOK_ID/TOKEN
```

✅ **Correct:**
```
http://localhost:8080/api/webhooks/WEBHOOK_ID/TOKEN
```

**Common Local Configurations:**
- If using Docker with default settings: `http://localhost:8080`
- If running directly: `http://localhost:5000` or `http://localhost:3000`
- Check your `docker-compose.yml` for the port mapping (e.g., `8080:8080`)

**3. Find Your Server's Port**

Check your docker-compose.yml file:
```yaml
services:
  server:
    ports:
      - "8080:8080"  # The first number is your local port
```

Or check running containers:
```bash
docker compose ps
# Look for the port mapping like 0.0.0.0:8080->8080/tcp
```

**4. Disable SSL Verification (Local Only)**

If you're using self-signed certificates locally:
1. In Postman, go to Settings (⚙️)
2. Turn OFF "SSL certificate verification"
3. **⚠️ Only do this for local testing, never in production!**

**5. Copy the Correct Webhook URL**

When you create a webhook in your local Decentra:
1. The UI might show `https://localhost/api/webhooks/...`
2. Manually change it to match your actual server URL
3. Example: If your frontend is at `http://localhost:5173` and backend at `http://localhost:8080`:
   - Change: `https://localhost/api/webhooks/abc123/token456`
   - To: `http://localhost:8080/api/webhooks/abc123/token456`

**6. Test Server Connectivity**

First verify your server is accessible:
```bash
# Test the base URL
curl http://localhost:8080/

# Or in PowerShell
Invoke-WebRequest -Uri http://localhost:8080/
```

If this works, your webhook URL should be:
```
http://localhost:8080/api/webhooks/WEBHOOK_ID/TOKEN
```

**Quick Checklist:**
- ✅ Server is running (`docker compose ps`)
- ✅ Using `http://` not `https://`
- ✅ Correct port number (check docker-compose.yml)
- ✅ Full URL includes `/api/webhooks/WEBHOOK_ID/TOKEN`
- ✅ Content-Type header is `application/json`

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

Via Web Interface:
1. Click on your profile → Admin Settings
2. Scroll to "Instance Webhooks" section
3. Click "Create Webhook"
4. Enter a webhook name
5. (Optional) Choose an emoji avatar (defaults to 📢)
6. Click "Create"
7. Copy the generated webhook URL

Via API:
```bash
curl -X POST https://your-decentra-instance.com/api/instance-webhooks \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "System Announcements",
    "avatar": "📢"
  }'
```

**Response:**
```json
{
  "success": true,
  "webhook": {
    "id": "webhook-abc123",
    "name": "System Announcements",
    "avatar": "📢",
    "url": "https://your-decentra-instance.com/api/instance-webhooks/webhook-abc123/TOKEN",
    "token": "SECRET_TOKEN_HERE",
    "enabled": true
  }
}
```

### Using an Instance Webhook

Instance webhooks work exactly like server webhooks, but send a DM to all users:

```bash
curl -X POST "https://your-decentra-instance.com/api/instance-webhooks/WEBHOOK_ID/TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "🚨 **System Maintenance**: The server will be restarted in 10 minutes. Please save your work.",
    "username": "System Admin"
  }'
```

**Example Use Cases:**

1. **Maintenance Announcements:**
```bash
curl -X POST "https://your-decentra-instance.com/api/instance-webhooks/WEBHOOK_ID/TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "⚙️ **Scheduled Maintenance**\n\nThe system will be offline from 2:00 AM to 4:00 AM UTC for upgrades.\n\nThank you for your patience!",
    "username": "System Administrator"
  }'
```

2. **Security Alerts:**
```python
import requests

def send_security_alert(message):
    webhook_url = "https://your-decentra-instance.com/api/instance-webhooks/WEBHOOK_ID/TOKEN"
    
    payload = {
        "content": f"🔒 **Security Alert**: {message}",
        "username": "Security System"
    }
    
    requests.post(webhook_url, json=payload)

# Usage
send_security_alert("Multiple failed login attempts detected. Please review your password.")
```

### Managing Instance Webhooks

Instance webhooks can be managed from the Admin Settings panel:

1. Click on your profile → Admin Settings
2. Scroll to "Instance Webhooks" section
3. View all instance webhooks with their URLs
4. Copy webhook URLs
5. Delete webhooks you no longer need

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

## Instance Webhook API Reference

### Create Instance Webhook

**Endpoint:** `POST /api/instance-webhooks`

**Headers:**
- `Authorization: Bearer {admin_jwt_token}`
- `Content-Type: application/json`

**Request Body:**
```json
{
  "name": "System Announcements",
  "avatar": "📢"
}
```

**Response:**
```json
{
  "success": true,
  "webhook": {
    "id": "webhook-abc123",
    "name": "System Announcements",
    "avatar": "📢",
    "url": "https://your-decentra-instance.com/api/instance-webhooks/webhook-abc123/TOKEN",
    "token": "SECRET_TOKEN_HERE",
    "enabled": true
  }
}
```

### Execute Instance Webhook

**Endpoint:** `POST /api/instance-webhooks/{webhook_id}/{token}`

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
  "message": "Instance webhook executed successfully",
  "webhook_data": {
    "content": "Message content",
    "display_name": "System Announcements",
    "webhook_id": "webhook-abc123",
    "users_notified": 42,
    "messages_sent": 42,
    "broadcast_type": "direct_messages"
  }
}
```

### Get Instance Webhooks

**Endpoint:** `GET /api/instance-webhooks`

**Headers:**
- `Authorization: Bearer {admin_jwt_token}`

### Delete Instance Webhook

**Endpoint:** `DELETE /api/instance-webhooks/{webhook_id}`

**Headers:**
- `Authorization: Bearer {admin_jwt_token}`

## Support

For additional help or to report issues:
- Check the main [API documentation](../API.md)
- Review [security guidelines](../SECURITY.md)
- Consult the [contributing guide](../CONTRIBUTING.md) if you want to enhance webhook functionality
