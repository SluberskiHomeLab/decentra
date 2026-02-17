#!/usr/bin/env python3
"""
REST API endpoints for Decentra Chat Server
Provides HTTP REST API for future desktop application integration
"""

import json
import uuid
import base64
import re
import secrets
from aiohttp import web
import bcrypt
from license_validator import check_limit

# Database instance will be set by setup_api_routes
db = None
# JWT verification function will be set by setup_api_routes
verify_jwt_token = None
# WebSocket broadcast function will be set by setup_api_routes
broadcast_to_server_func = None


def sanitize_filename(filename):
    """Sanitize filename for safe use in headers."""
    # Remove any path separators and control characters
    filename = filename.replace('\\', '').replace('/', '').replace('\r', '').replace('\n', '')
    # Keep only safe characters
    filename = re.sub(r'[^\w\s\-\.]', '', filename)
    # Limit length safely for UTF-8 (encode, truncate bytes, decode)
    if len(filename.encode('utf-8')) > 255:
        # Truncate at byte level and decode, ignoring errors
        filename = filename.encode('utf-8')[:255].decode('utf-8', errors='ignore')
    return filename or 'download'


def sanitize_content_type(content_type):
    """Sanitize content type to prevent header injection."""
    # Remove newlines and control characters
    content_type = content_type.replace('\r', '').replace('\n', '')
    # Validate against common MIME types or default to safe value
    if not re.match(r'^[a-zA-Z0-9\-\+\.]+/[a-zA-Z0-9\-\+\.]+$', content_type):
        return 'application/octet-stream'
    return content_type


def verify_password(password, password_hash):
    """Verify a password against its hash."""
    return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))


async def api_auth(request):
    """
    POST /api/auth
    Authenticate a user and return user data
    
    Request body: {
        "username": "string",
        "password": "string"
    }
    
    Response: {
        "success": true,
        "user": {
            "username": "string",
            "avatar": "string",
            "avatar_type": "emoji|image",
            "avatar_data": "string|null"
        }
    }
    """
    try:
        data = await request.json()
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        if not username or not password:
            return web.json_response({
                'success': False,
                'error': 'Username and password are required'
            }, status=400)
        
        user = db.get_user(username)
        if not user or not verify_password(password, user['password_hash']):
            return web.json_response({
                'success': False,
                'error': 'Invalid username or password'
            }, status=401)
        
        return web.json_response({
            'success': True,
            'user': {
                'username': user['username'],
                'avatar': user.get('avatar', '👤'),
                'avatar_type': user.get('avatar_type', 'emoji'),
                'avatar_data': user.get('avatar_data')
            }
        })
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_servers(request):
    """
    GET /api/servers?username=<username>
    Get all servers for a user
    
    Response: {
        "success": true,
        "servers": [
            {
                "id": "string",
                "name": "string",
                "owner": "string",
                "channels": [
                    {
                        "id": "string",
                        "name": "string",
                        "type": "text|voice"
                    }
                ]
            }
        ]
    }
    """
    try:
        username = request.query.get('username')
        if not username:
            return web.json_response({
                'success': False,
                'error': 'Username parameter is required'
            }, status=400)
        
        servers_list = []
        user_server_ids = db.get_user_servers(username)
        
        for server_id in user_server_ids:
            server_data = db.get_server(server_id)
            if server_data:
                channels = db.get_server_channels(server_id)
                servers_list.append({
                    'id': server_id,
                    'name': server_data['name'],
                    'owner': server_data['owner'],
                    'icon': server_data.get('icon', '🏠'),
                    'icon_type': server_data.get('icon_type', 'emoji'),
                    'icon_data': server_data.get('icon_data'),
                    'channels': [
                        {
                            'id': ch['channel_id'],
                            'name': ch['name'],
                            'type': ch.get('type', 'text')
                        }
                        for ch in channels
                    ]
                })
        
        return web.json_response({
            'success': True,
            'servers': servers_list
        })
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_messages(request):
    """
    GET /api/messages?context_type=<type>&context_id=<id>&limit=<limit>
    Get messages for a context (server channel or DM)
    
    Parameters:
    - context_type: "server" or "dm"
    - context_id: "server_id/channel_id" for servers, "dm_id" for DMs
    - limit: number of messages to return (default: 100, max: 500)
    
    Response: {
        "success": true,
        "messages": [
            {
                "id": number,
                "username": "string",
                "content": "string",
                "timestamp": "ISO 8601 string",
                "context_type": "server|dm",
                "context_id": "string"
            }
        ]
    }
    """
    try:
        context_type = request.query.get('context_type')
        context_id = request.query.get('context_id')
        limit = int(request.query.get('limit', 100))
        
        if not context_type or not context_id:
            return web.json_response({
                'success': False,
                'error': 'context_type and context_id parameters are required'
            }, status=400)
        
        # Limit to max 500 messages
        limit = min(limit, 500)
        
        messages = db.get_messages(context_type, context_id, limit)
        
        return web.json_response({
            'success': True,
            'messages': messages
        })
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_friends(request):
    """
    GET /api/friends?username=<username>
    Get friends list for a user
    
    Response: {
        "success": true,
        "friends": ["username1", "username2", ...],
        "friend_requests_sent": ["username1", ...],
        "friend_requests_received": ["username1", ...]
    }
    """
    try:
        username = request.query.get('username')
        if not username:
            return web.json_response({
                'success': False,
                'error': 'Username parameter is required'
            }, status=400)
        
        friends = db.get_friends(username)
        requests_sent = db.get_friend_requests_sent(username)
        requests_received = db.get_friend_requests_received(username)
        
        return web.json_response({
            'success': True,
            'friends': friends,
            'friend_requests_sent': requests_sent,
            'friend_requests_received': requests_received
        })
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_dms(request):
    """
    GET /api/dms?username=<username>
    Get direct messages list for a user
    
    Response: {
        "success": true,
        "dms": [
            {
                "dm_id": "string",
                "other_user": "string"
            }
        ]
    }
    """
    try:
        username = request.query.get('username')
        if not username:
            return web.json_response({
                'success': False,
                'error': 'Username parameter is required'
            }, status=400)
        
        dm_list = db.get_user_dms(username)
        dms = []
        for dm in dm_list:
            other_user = dm['user2'] if dm['user1'] == username else dm['user1']
            dms.append({
                'dm_id': dm['dm_id'],
                'other_user': other_user
            })
        
        return web.json_response({
            'success': True,
            'dms': dms
        })
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_search_messages(request):
    """
    GET /api/search-messages?query=<query>&limit=<limit>
    Search messages for a user across all their accessible chats
    
    Requires: Authorization header with Bearer token
    
    Parameters:
    - query: search query string
    - limit: number of results to return (default: 50, max: 100)
    
    Response: {
        "success": true,
        "results": [
            {
                "id": number,
                "username": "string",
                "content": "string",
                "timestamp": "ISO 8601 string",
                "context_type": "server|dm",
                "context_id": "string",
                "avatar": "string",
                "avatar_type": "emoji|image",
                "avatar_data": "string|null"
            }
        ]
    }
    """
    try:
        # Extract and verify JWT token from Authorization header
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({
                'success': False,
                'error': 'Missing or invalid Authorization header'
            }, status=401)
        
        token = auth_header[7:]  # Remove 'Bearer ' prefix
        username = verify_jwt_token(token)
        
        if not username:
            return web.json_response({
                'success': False,
                'error': 'Invalid or expired token'
            }, status=401)
        
        query = request.query.get('query', '').strip()
        limit = int(request.query.get('limit', 50))
        
        if not query:
            return web.json_response({
                'success': True,
                'results': []
            })
        
        # Limit to max 100 results
        limit = min(limit, 100)
        
        # Use the authenticated username from the token
        # The database function enforces access control for DMs and servers
        results = db.search_messages(username, query, limit)
        
        return web.json_response({
            'success': True,
            'results': results
        })
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_upload_attachment(request):
    """
    POST /api/upload-attachment
    Upload a file attachment
    
    Request body (multipart/form-data):
        - file: The file to upload
        - message_id: The message ID to attach to
        - token: JWT authentication token (optional if password provided)
        - username: The username uploading the file (optional if token provided)
        - password: The user's password for auth (optional if token provided)
    
    Note: Either 'token' OR both 'username' and 'password' must be provided for authentication.
    
    Response: {
        "success": true,
        "attachment": {
            "attachment_id": "string",
            "filename": "string",
            "content_type": "string",
            "file_size": int
        }
    }
    """
    try:
        # Get admin settings
        admin_settings = db.get_admin_settings()
        
        # Check if file attachments are allowed
        if not admin_settings.get('allow_file_attachments', True):
            return web.json_response({
                'success': False,
                'error': 'File attachments are disabled'
            }, status=403)
        
        # Get multipart data
        reader = await request.multipart()
        
        username = None
        password = None
        token = None
        message_id = None
        filename = None
        content_type = None
        file_data = None
        
        async for field in reader:
            if field.name == 'username':
                username = (await field.read()).decode('utf-8').strip()
            elif field.name == 'password':
                password = (await field.read()).decode('utf-8')
            elif field.name == 'token':
                token = (await field.read()).decode('utf-8').strip()
            elif field.name == 'message_id':
                message_id = int((await field.read()).decode('utf-8'))
            elif field.name == 'file':
                filename = field.filename
                content_type = field.headers.get('Content-Type', 'application/octet-stream')
                file_data = await field.read()
        
        # Validate required fields
        if message_id is None or not file_data:
            return web.json_response({
                'success': False,
                'error': 'Missing required fields (message_id and file are required)'
            }, status=400)
        
        # Authenticate user - either by token or password
        authenticated_username = None
        
        if token:
            # Token-based authentication
            authenticated_username = verify_jwt_token(token)
            if not authenticated_username:
                return web.json_response({
                    'success': False,
                    'error': 'Invalid or expired token'
                }, status=401)
        elif username and password:
            # Password-based authentication
            user = db.get_user(username)
            if not user or not verify_password(password, user['password_hash']):
                return web.json_response({
                    'success': False,
                    'error': 'Invalid credentials'
                }, status=401)
            authenticated_username = username
        else:
            return web.json_response({
                'success': False,
                'error': 'Authentication required (provide either token or username+password)'
            }, status=401)
        
        # Use authenticated username for the rest of the function
        username = authenticated_username
        
        # Check file size
        max_size_mb = admin_settings.get('max_attachment_size_mb', 10)

        # Apply license ceiling for file size
        license_max_size = check_limit('max_file_size_mb')
        if license_max_size != -1:
            max_size_mb = min(max_size_mb, license_max_size) if max_size_mb > 0 else license_max_size

        max_size_bytes = max_size_mb * 1024 * 1024
        file_size = len(file_data)
        
        if file_size > max_size_bytes:
            return web.json_response({
                'success': False,
                'error': f'File size exceeds maximum of {max_size_mb}MB'
            }, status=413)
        
        # Get message by ID (allow 0 for embedding without message association)
        message = None
        if message_id != 0:
            message = db.get_message(message_id)
            
            if not message:
                return web.json_response({
                    'success': False,
                    'error': 'Message not found'
                }, status=404)
            
            if message['username'] != username:
                return web.json_response({
                    'success': False,
                    'error': 'You can only attach files to your own messages'
                }, status=403)
        
        # Generate attachment ID
        attachment_id = f"att_{uuid.uuid4().hex[:16]}"
        
        # Encode file data as base64
        file_data_b64 = base64.b64encode(file_data).decode('utf-8')
        
        # Save attachment
        db.save_attachment(
            attachment_id=attachment_id,
            message_id=message_id,
            filename=filename,
            content_type=content_type,
            file_size=file_size,
            file_data=file_data_b64
        )
        
        return web.json_response({
            'success': True,
            'attachment': {
                'attachment_id': attachment_id,
                'filename': filename,
                'content_type': content_type,
                'file_size': file_size
            }
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_download_attachment(request):
    """
    GET /api/download-attachment/<attachment_id>[/<filename>]
    Download a file attachment
    
    Optional filename parameter for URL clarity and extension-based embed detection
    
    Response: Binary file data with appropriate content-type
    """
    try:
        attachment_id = request.match_info.get('attachment_id')
        if not attachment_id:
            return web.json_response({
                'success': False,
                'error': 'Attachment ID is required'
            }, status=400)
        
        # Get attachment
        attachment = db.get_attachment(attachment_id)
        if not attachment:
            return web.json_response({
                'success': False,
                'error': 'Attachment not found'
            }, status=404)
        
        # Decode base64 file data
        file_data = base64.b64decode(attachment['file_data'])
        
        # Sanitize headers to prevent injection
        safe_content_type = sanitize_content_type(attachment['content_type'])
        safe_filename = sanitize_filename(attachment['filename'])
        
        # Return file with appropriate headers
        return web.Response(
            body=file_data,
            content_type=safe_content_type,
            headers={
                'Content-Disposition': f'attachment; filename="{safe_filename}"',
                'Content-Length': str(len(file_data))
            }
        )
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_get_message_attachments(request):
    """
    GET /api/message-attachments/<message_id>
    Get all attachments for a message
    
    Response: {
        "success": true,
        "attachments": [
            {
                "attachment_id": "string",
                "filename": "string",
                "content_type": "string",
                "file_size": int,
                "uploaded_at": "string"
            }
        ]
    }
    """
    try:
        message_id = request.match_info.get('message_id')
        if not message_id:
            return web.json_response({
                'success': False,
                'error': 'Message ID is required'
            }, status=400)
        
        # Validate message_id is numeric
        try:
            message_id_int = int(message_id)
        except (ValueError, TypeError):
            return web.json_response({
                'success': False,
                'error': 'Invalid message ID format'
            }, status=400)
        
        # Get attachments (without file data)
        attachments = db.get_message_attachments(message_id_int)
        
        return web.json_response({
            'success': True,
            'attachments': attachments
        })
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_reset_password(request):
    """
    POST /api/reset-password
    Reset user password with a valid reset token.
    
    Request body:
    {
        "token": "reset_token",
        "new_password": "newpassword123"
    }
    
    Response:
    {
        "success": true/false,
        "message": "..."
    }
    """
    try:
        data = await request.json()
        token = data.get('token', '').strip()
        new_password = data.get('new_password', '').strip()
        
        if not token:
            return web.json_response({
                'success': False,
                'message': 'Reset token is required'
            }, status=400)
        
        if not new_password:
            return web.json_response({
                'success': False,
                'message': 'New password is required'
            }, status=400)
        
        if len(new_password) < 8:
            return web.json_response({
                'success': False,
                'message': 'Password must be at least 8 characters long'
            }, status=400)
        
        # Get token info from database
        token_info = db.get_password_reset_token(token)
        
        if not token_info:
            return web.json_response({
                'success': False,
                'message': 'Invalid or expired reset token'
            }, status=400)
        
        if token_info.get('used'):
            return web.json_response({
                'success': False,
                'message': 'This reset token has already been used'
            }, status=400)
        
        # Hash the new password
        password_hash = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        
        # Update user password
        username = token_info['username']
        if db.update_user_password(username, password_hash):
            # Mark token as used
            db.mark_reset_token_used(token)
            
            return web.json_response({
                'success': True,
                'message': 'Password reset successfully'
            })
        else:
            return web.json_response({
                'success': False,
                'message': 'Failed to update password'
            }, status=500)
            
    except Exception as e:
        return web.json_response({
            'success': False,
            'message': f'Error: {str(e)}'
        }, status=500)


async def api_create_webhook(request):
    """
    POST /api/webhooks
    Create a new webhook for a server channel.
    
    Request body: {
        "server_id": "string",
        "channel_id": "string",
        "name": "string",
        "avatar": "string" (optional)
    }
    
    Response: {
        "success": true,
        "webhook": {
            "id": "string",
            "name": "string",
            "url": "string",
            "token": "string",
            "avatar": "string"
        }
    }
    """
    try:
        # Verify JWT token
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({
                'success': False,
                'error': 'Authorization required'
            }, status=401)
        
        token = auth_header.split(' ')[1]
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({
                'success': False,
                'error': 'Invalid token'
            }, status=401)
        
        data = await request.json()
        server_id = data.get('server_id', '').strip()
        channel_id = data.get('channel_id', '').strip()
        name = data.get('name', '').strip()
        avatar = data.get('avatar', '🔗')
        
        if not server_id or not channel_id or not name:
            return web.json_response({
                'success': False,
                'error': 'server_id, channel_id, and name are required'
            }, status=400)
        
        # Check if user is a member of the server
        if not db.is_server_member(username, server_id):
            return web.json_response({
                'success': False,
                'error': 'You are not a member of this server'
            }, status=403)
        
        # Generate webhook ID and token
        webhook_id = str(uuid.uuid4())
        webhook_token = secrets.token_urlsafe(32)
        
        # Create webhook
        if db.create_webhook(webhook_id, server_id, channel_id, name, webhook_token, username, avatar):
            # Get base URL from request
            scheme = request.scheme
            host = request.host
            webhook_url = f"{scheme}://{host}/api/webhooks/{webhook_id}/{webhook_token}"
            
            return web.json_response({
                'success': True,
                'webhook': {
                    'id': webhook_id,
                    'name': name,
                    'url': webhook_url,
                    'token': webhook_token,
                    'avatar': avatar,
                    'channel_id': channel_id
                }
            })
        else:
            return web.json_response({
                'success': False,
                'error': 'Failed to create webhook'
            }, status=500)
            
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_get_server_webhooks(request):
    """
    GET /api/webhooks/server/{server_id}
    Get all webhooks for a server.
    """
    try:
        # Verify JWT token
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({
                'success': False,
                'error': 'Authorization required'
            }, status=401)
        
        token = auth_header.split(' ')[1]
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({
                'success': False,
                'error': 'Invalid token'
            }, status=401)
        
        server_id = request.match_info['server_id']
        
        # Check if user is a member of the server
        if not db.is_server_member(username, server_id):
            return web.json_response({
                'success': False,
                'error': 'You are not a member of this server'
            }, status=403)
        
        webhooks = db.get_server_webhooks(server_id)
        
        # Format webhooks for response (exclude tokens)
        formatted_webhooks = []
        scheme = request.scheme
        host = request.host
        
        for wh in webhooks:
            formatted_webhooks.append({
                'id': wh['webhook_id'],
                'name': wh['name'],
                'channel_id': wh['channel_id'],
                'avatar': wh['avatar'],
                'created_by': wh['created_by'],
                'created_at': wh['created_at'].isoformat() if wh['created_at'] else None,
                'url': f"{scheme}://{host}/api/webhooks/{wh['webhook_id']}/{wh['token']}"
            })
        
        return web.json_response({
            'success': True,
            'webhooks': formatted_webhooks
        })
        
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_delete_webhook(request):
    """
    DELETE /api/webhooks/{webhook_id}
    Delete a webhook.
    """
    try:
        # Verify JWT token
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({
                'success': False,
                'error': 'Authorization required'
            }, status=401)
        
        token = auth_header.split(' ')[1]
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({
                'success': False,
                'error': 'Invalid token'
            }, status=401)
        
        webhook_id = request.match_info['webhook_id']
        
        # Get webhook to verify ownership
        webhook = db.get_webhook(webhook_id)
        if not webhook:
            return web.json_response({
                'success': False,
                'error': 'Webhook not found'
            }, status=404)
        
        # Check if user created the webhook or is server owner
        server = db.get_server(webhook['server_id'])
        if webhook['created_by'] != username and server['owner'] != username:
            return web.json_response({
                'success': False,
                'error': 'You do not have permission to delete this webhook'
            }, status=403)
        
        if db.delete_webhook(webhook_id):
            return web.json_response({
                'success': True,
                'message': 'Webhook deleted successfully'
            })
        else:
            return web.json_response({
                'success': False,
                'error': 'Failed to delete webhook'
            }, status=500)
            
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_execute_webhook(request):
    """
    POST /api/webhooks/{webhook_id}/{token}
    Execute a webhook to send a message to the channel.
    
    Request body: {
        "content": "string",
        "username": "string" (optional, uses webhook name if not provided),
        "avatar_url": "string" (optional)
    }
    """
    try:
        webhook_id = request.match_info['webhook_id']
        token = request.match_info['token']
        
        # Get webhook by token
        webhook = db.get_webhook_by_token(token)
        if not webhook or webhook['webhook_id'] != webhook_id:
            return web.json_response({
                'success': False,
                'error': 'Invalid webhook'
            }, status=404)
        
        data = await request.json()
        content = data.get('content', '').strip()
        display_name = data.get('username', webhook['name'])
        
        if not content:
            return web.json_response({
                'success': False,
                'error': 'Content is required'
            }, status=400)
        
        # Save message to database and broadcast to server
        server_id = webhook['server_id']
        channel_id = webhook['channel_id']
        context_id = f"{server_id}/{channel_id}"
        
        # Ensure webhook system user exists
        db.ensure_webhook_system_user()
        
        # Save message to database using the system webhook user
        # The actual webhook identity is preserved in the broadcast message
        message_id = db.save_message(
            username='__webhook__',
            content=content,
            context_type='server',
            context_id=context_id
        )
        
        # Create a webhook user profile with the display name and avatar
        webhook_profile = {
            'avatar': webhook.get('avatar', '🔗'),
            'avatar_type': 'emoji',
            'avatar_data': None,
            'is_webhook': True,
            'webhook_name': display_name
        }
        
        # Create message object directly (don't use create_message_object_func 
        # because it tries to look up user status/roles for non-existent webhook user)
        from datetime import datetime, timezone
        msg_obj = {
            'type': 'message',
            'username': display_name,
            'content': content,
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'context': 'server',
            'context_id': context_id,
            'avatar': webhook.get('avatar', '🔗'),
            'avatar_type': 'emoji',
            'avatar_data': None,
            'user_status': 'offline',  # Webhooks don't have status
            'id': message_id,
            'attachments': [],
            'reactions': [],
            'mentions': [],
            'is_webhook': True
        }
        
        # Broadcast message to all server members
        await broadcast_to_server_func(server_id, json.dumps(msg_obj))
        
        return web.json_response({
            'success': True,
            'message': 'Webhook executed successfully',
            'webhook_data': {
                'channel_id': channel_id,
                'server_id': server_id,
                'content': content,
                'display_name': display_name,
                'webhook_id': webhook_id,
                'message_id': message_id
            }
        })
        
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_get_instance_webhooks(request):
    """
    GET /api/instance-webhooks
    Get all instance-level webhooks (admin only).
    """
    try:
        # Verify JWT token
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({
                'success': False,
                'error': 'Authorization required'
            }, status=401)
        
        token = auth_header.split(' ')[1]
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({
                'success': False,
                'error': 'Invalid token'
            }, status=401)
        
        # Check if user is admin
        user = db.get_user(username)
        if not user or user.get('username') != 'admin':
            return web.json_response({
                'success': False,
                'error': 'Admin access required'
            }, status=403)
        
        webhooks = db.get_all_instance_webhooks()
        
        # Format webhooks for response (exclude tokens)
        formatted_webhooks = [{
            'id': wh['webhook_id'],
            'name': wh['name'],
            'event_type': wh['event_type'],
            'target_url': wh['target_url'],
            'enabled': wh['enabled'],
            'created_by': wh['created_by'],
            'created_at': wh['created_at'].isoformat() if wh['created_at'] else None
        } for wh in webhooks]
        
        return web.json_response({
            'success': True,
            'webhooks': formatted_webhooks
        })
        
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_create_instance_webhook(request):
    """
    POST /api/instance-webhooks
    Create an instance-level webhook (admin only).
    """
    try:
        # Verify JWT token and admin access
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({
                'success': False,
                'error': 'Authorization required'
            }, status=401)
        
        token = auth_header.split(' ')[1]
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({
                'success': False,
                'error': 'Invalid token'
            }, status=401)
        
        # Check if user is admin
        user = db.get_user(username)
        if not user or user.get('username') != 'admin':
            return web.json_response({
                'success': False,
                'error': 'Admin access required'
            }, status=403)
        
        data = await request.json()
        name = data.get('name', '').strip()
        event_type = data.get('event_type', '').strip()
        target_url = data.get('target_url', '').strip()
        enabled = data.get('enabled', True)
        
        if not name or not event_type or not target_url:
            return web.json_response({
                'success': False,
                'error': 'name, event_type, and target_url are required'
            }, status=400)
        
        # Validate event_type
        valid_events = ['user.signup', 'user.login', 'message.create', 'server.create']
        if event_type not in valid_events:
            return web.json_response({
                'success': False,
                'error': f'Invalid event_type. Must be one of: {", ".join(valid_events)}'
            }, status=400)
        
        # Generate webhook ID and token
        webhook_id = str(uuid.uuid4())
        webhook_token = secrets.token_urlsafe(32)
        
        if db.create_instance_webhook(webhook_id, name, webhook_token, event_type, target_url, username, enabled):
            return web.json_response({
                'success': True,
                'webhook': {
                    'id': webhook_id,
                    'name': name,
                    'event_type': event_type,
                    'target_url': target_url,
                    'enabled': enabled
                }
            })
        else:
            return web.json_response({
                'success': False,
                'error': 'Failed to create instance webhook'
            }, status=500)
            
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_delete_instance_webhook(request):
    """
    DELETE /api/instance-webhooks/{webhook_id}
    Delete an instance webhook (admin only).
    """
    try:
        # Verify JWT token and admin access
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({
                'success': False,
                'error': 'Authorization required'
            }, status=401)
        
        token = auth_header.split(' ')[1]
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({
                'success': False,
                'error': 'Invalid token'
            }, status=401)
        
        # Check if user is admin
        user = db.get_user(username)
        if not user or user.get('username') != 'admin':
            return web.json_response({
                'success': False,
                'error': 'Admin access required'
            }, status=403)
        
        webhook_id = request.match_info['webhook_id']
        
        if db.delete_instance_webhook(webhook_id):
            return web.json_response({
                'success': True,
                'message': 'Instance webhook deleted successfully'
            })
        else:
            return web.json_response({
                'success': False,
                'error': 'Failed to delete instance webhook'
            }, status=500)
            
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


def setup_api_routes(app, database, jwt_verify_func, broadcast_func):
    """Setup REST API routes on the aiohttp application."""
    global db, verify_jwt_token, broadcast_to_server_func
    db = database
    verify_jwt_token = jwt_verify_func
    broadcast_to_server_func = broadcast_func
    app.router.add_post('/api/auth', api_auth)
    app.router.add_post('/api/reset-password', api_reset_password)
    app.router.add_get('/api/servers', api_servers)
    app.router.add_get('/api/messages', api_messages)
    app.router.add_get('/api/search-messages', api_search_messages)
    app.router.add_get('/api/friends', api_friends)
    app.router.add_get('/api/dms', api_dms)
    app.router.add_post('/api/upload-attachment', api_upload_attachment)
    app.router.add_get('/api/download-attachment/{attachment_id}', api_download_attachment)
    app.router.add_get('/api/download-attachment/{attachment_id}/{filename}', api_download_attachment)
    app.router.add_get('/api/message-attachments/{message_id}', api_get_message_attachments)
    # Webhook routes
    app.router.add_post('/api/webhooks', api_create_webhook)
    app.router.add_get('/api/webhooks/server/{server_id}', api_get_server_webhooks)
    app.router.add_delete('/api/webhooks/{webhook_id}', api_delete_webhook)
    app.router.add_post('/api/webhooks/{webhook_id}/{token}', api_execute_webhook)
    # Instance webhook routes (admin only)
    app.router.add_get('/api/instance-webhooks', api_get_instance_webhooks)
    app.router.add_post('/api/instance-webhooks', api_create_instance_webhook)
    app.router.add_delete('/api/instance-webhooks/{webhook_id}', api_delete_instance_webhook)
