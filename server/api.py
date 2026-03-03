#!/usr/bin/env python3
"""
REST API endpoints for Decentra Chat Server
Provides HTTP REST API for future desktop application integration
"""

import json
import os
import uuid
import base64
import re
import secrets
import hashlib
from aiohttp import web
import bcrypt
from license_validator import check_limit, check_feature_access
from sso_utils import OIDCProvider, SAMLProvider, LDAPSync, SCIMHandler, _hash_token
from search_parser import parse_search_query, has_filters

# Database instance will be set by setup_api_routes
db = None
# JWT verification function will be set by setup_api_routes
verify_jwt_token = None
# JWT generation function will be set by setup_api_routes
generate_jwt_token_func = None
# WebSocket broadcast function will be set by setup_api_routes
broadcast_to_server_func = None
# send_to_user function will be set by setup_api_routes
send_to_user_func = None
# get_or_create_dm function will be set by setup_api_routes
get_or_create_dm_func = None
# get_avatar_data function will be set by setup_api_routes
get_avatar_data_func = None


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
        
        raw_query = request.query.get('query', '').strip()
        limit = int(request.query.get('limit', 50))
        
        if not raw_query:
            return web.json_response({
                'success': True,
                'results': []
            })
        
        # Limit to max 100 results
        limit = min(limit, 100)
        
        # Parse rich filter syntax (from:, in:, has:, before:, after:, etc.)
        parsed = parse_search_query(raw_query)
        free_text = parsed.get('text', '')
        filters = parsed if has_filters(parsed) else None
        
        # If there's no free text and no filters, return empty
        if not free_text and not filters:
            return web.json_response({
                'success': True,
                'results': []
            })
        
        # Use the authenticated username from the token
        # The database function enforces access control for DMs and servers
        results = db.search_messages(username, free_text, limit, filters=filters)
        
        return web.json_response({
            'success': True,
            'results': results,
            'filters_applied': filters is not None
        })
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_search_filters(request):
    """
    GET /api/search-filters
    Returns the list of supported search filter operators and their usage.
    No auth required — this is purely informational.
    """
    return web.json_response({
        'success': True,
        'filters': [
            {'key': 'from',    'description': 'Messages from a user',           'example': 'from:alice'},
            {'key': 'mentions','description': 'Messages mentioning a user',     'example': 'mentions:bob'},
            {'key': 'in',      'description': 'Messages in a channel or DMs',   'example': 'in:general  or  in:dm'},
            {'key': 'has',     'description': 'Messages with specific content', 'example': 'has:file  has:link  has:image  has:video'},
            {'key': 'before',  'description': 'Messages before a date',         'example': 'before:2025-06-01  or  before:7d'},
            {'key': 'after',   'description': 'Messages after a date',          'example': 'after:2025-01-01  or  after:30d'},
            {'key': 'during',  'description': 'Messages on a specific date',    'example': 'during:2025-03-15  or  during:today'},
            {'key': 'is',      'description': 'Message flags',                  'example': 'is:pinned'},
        ]
    })


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


# ============================================================================
# Soundboard API Endpoints
# ============================================================================

async def api_upload_soundboard_sound(request):
    """
    POST /api/upload-soundboard-sound
    Upload a soundboard sound (personal or server-based)
    
    Request body (multipart/form-data):
        - file: The audio file to upload (.mp3, .wav, .ogg)
        - sound_name: Name for the sound (max 30 chars)
        - is_server_sound: 'true' or 'false' (default: false)
        - server_id: Required if is_server_sound is true
        - token: JWT authentication token
    
    Response: {
        "success": true,
        "sound": {
            "sound_id": "string",
            "name": "string",
            "duration_ms": int,
            "file_size": int
        }
    }
    """
    try:
        from audio_utils import validate_audio_format, get_audio_duration
        
        # Get admin settings
        admin_settings = db.get_admin_settings()
        
        # Check if soundboard is allowed
        if not admin_settings.get('allow_soundboard', False):
            return web.json_response({
                'success': False,
                'error': 'Soundboard is disabled'
            }, status=403)
        
        # Get multipart data
        reader = await request.multipart()
        
        token = None
        sound_name = None
        is_server_sound = False
        server_id = None
        filename = None
        content_type = None
        file_data = None
        
        async for field in reader:
            if field.name == 'token':
                token = (await field.read()).decode('utf-8').strip()
            elif field.name == 'sound_name':
                sound_name = (await field.read()).decode('utf-8').strip()
            elif field.name == 'is_server_sound':
                is_server_sound_str = (await field.read()).decode('utf-8').strip().lower()
                is_server_sound = is_server_sound_str == 'true'
            elif field.name == 'server_id':
                server_id = (await field.read()).decode('utf-8').strip()
            elif field.name == 'file':
                filename = field.filename
                content_type = field.headers.get('Content-Type', 'application/octet-stream')
                file_data = await field.read()
        
        # Validate required fields
        if not sound_name or not file_data:
            return web.json_response({
                'success': False,
                'error': 'Missing required fields (sound_name and file are required)'
            }, status=400)
        
        # Authenticate user
        if not token:
            return web.json_response({
                'success': False,
                'error': 'Authentication required'
            }, status=401)
        
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({
                'success': False,
                'error': 'Invalid or expired token'
            }, status=401)
        
        # Validate sound name
        if len(sound_name) > 30:
            return web.json_response({
                'success': False,
                'error': 'Sound name must be 30 characters or less'
            }, status=400)
        
        if not re.match(r'^[a-zA-Z0-9\s\-_]+$', sound_name):
            return web.json_response({
                'success': False,
                'error': 'Sound name can only contain letters, numbers, spaces, hyphens, and underscores'
            }, status=400)
        
        # Validate audio format
        if not validate_audio_format(filename, content_type):
            return web.json_response({
                'success': False,
                'error': 'Invalid audio format. Supported formats: .mp3, .wav, .ogg'
            }, status=400)
        
        # Check file size (max 2MB for soundboard sounds)
        max_size_bytes = 2 * 1024 * 1024  # 2MB
        file_size = len(file_data)
        
        if file_size > max_size_bytes:
            return web.json_response({
                'success': False,
                'error': 'File size exceeds maximum of 2MB'
            }, status=413)
        
        # Extract audio duration
        try:
            duration_ms = get_audio_duration(file_data, content_type)
            if duration_ms is None:
                return web.json_response({
                    'success': False,
                    'error': 'Unable to determine audio duration'
                }, status=400)
        except Exception as e:
            return web.json_response({
                'success': False,
                'error': f'Invalid audio file: {str(e)}'
            }, status=400)
        
        # Check duration limits (admin setting vs license limit)
        admin_max_duration = admin_settings.get('max_sound_duration_seconds', 10)
        license_max_duration = check_limit('max_sound_duration_seconds')
        
        if license_max_duration != -1:
            max_duration_seconds = min(admin_max_duration, license_max_duration)
        else:
            max_duration_seconds = admin_max_duration
        
        if duration_ms > max_duration_seconds * 1000:
            return web.json_response({
                'success': False,
                'error': f'Sound duration exceeds maximum of {max_duration_seconds} seconds'
            }, status=400)
        
        # Handle server sound vs personal sound
        if is_server_sound:
            if not server_id:
                return web.json_response({
                    'success': False,
                    'error': 'server_id is required for server sounds'
                }, status=400)
            
            # Verify user has permission to upload server sounds (must be admin/owner)
            server = db.get_server(server_id)
            if not server:
                return web.json_response({
                    'success': False,
                    'error': 'Server not found'
                }, status=404)
            
            # Check if user is server owner or has admin permissions
            is_owner = server['owner'] == username
            member_info = db.get_server_member(server_id, username)
            
            if not is_owner and (not member_info or member_info.get('permissions', {}).get('manage_server') != True):
                return web.json_response({
                    'success': False,
                    'error': 'You must be a server admin to upload server sounds'
                }, status=403)
            
            # Check server sound count limit
            admin_max_server_sounds = admin_settings.get('max_server_sounds', 25)
            license_max_server_sounds = check_limit('max_server_sounds')
            
            if license_max_server_sounds != -1:
                max_server_sounds = min(admin_max_server_sounds, license_max_server_sounds)
            else:
                max_server_sounds = admin_max_server_sounds
            
            current_count = db.count_server_soundboard_sounds(server_id)
            if max_server_sounds != -1 and current_count >= max_server_sounds:
                return web.json_response({
                    'success': False,
                    'error': f'Server has reached maximum of {max_server_sounds} sounds'
                }, status=403)
            
            # Generate sound ID and save
            sound_id = f"snd_{uuid.uuid4().hex[:16]}"
            file_data_b64 = base64.b64encode(file_data).decode('utf-8')
            
            success = db.save_server_soundboard_sound(
                sound_id=sound_id,
                server_id=server_id,
                name=sound_name,
                audio_data=file_data_b64,
                content_type=content_type,
                duration_ms=duration_ms,
                file_size=file_size,
                uploader=username
            )
            
            if not success:
                return web.json_response({
                    'success': False,
                    'error': 'Sound name already exists for this server'
                }, status=409)
        
        else:  # Personal sound
            # Check user sound count limit
            admin_max_user_sounds = admin_settings.get('max_sounds_per_user', 10)
            license_max_user_sounds = check_limit('max_sounds_per_user')
            
            if license_max_user_sounds != -1:
                max_user_sounds = min(admin_max_user_sounds, license_max_user_sounds)
            else:
                max_user_sounds = admin_max_user_sounds
            
            current_count = db.count_user_soundboard_sounds(username)
            if max_user_sounds != -1 and current_count >= max_user_sounds:
                return web.json_response({
                    'success': False,
                    'error': f'You have reached maximum of {max_user_sounds} personal sounds'
                }, status=403)
            
            # Generate sound ID and save
            sound_id = f"snd_{uuid.uuid4().hex[:16]}"
            file_data_b64 = base64.b64encode(file_data).decode('utf-8')
            
            success = db.save_user_soundboard_sound(
                sound_id=sound_id,
                username=username,
                name=sound_name,
                audio_data=file_data_b64,
                content_type=content_type,
                duration_ms=duration_ms,
                file_size=file_size
            )
            
            if not success:
                return web.json_response({
                    'success': False,
                    'error': 'Sound name already exists in your personal soundboard'
                }, status=409)
        
        return web.json_response({
            'success': True,
            'sound': {
                'sound_id': sound_id,
                'name': sound_name,
                'duration_ms': duration_ms,
                'file_size': file_size,
                'is_server_sound': is_server_sound
            }
        })
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_get_soundboard_sounds(request):
    """
    GET /api/soundboard-sounds?type=user&server_id=X
    Get soundboard sounds (personal or server-based)
    
    Query parameters:
        - type: 'user' for personal sounds, 'server' for server sounds
        - server_id: Required if type=server
        - token: JWT authentication token
    
    Response: {
        "success": true,
        "sounds": [
            {
                "sound_id": "string",
                "name": "string",
                "duration_ms": int,
                "file_size": int,
                "created_at": "string"
            }
        ]
    }
    """
    try:
        # Get query parameters
        sound_type = request.query.get('type', 'user')
        server_id = request.query.get('server_id')
        token = request.query.get('token')
        
        # Authenticate user
        if not token:
            return web.json_response({
                'success': False,
                'error': 'Authentication required'
            }, status=401)
        
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({
                'success': False,
                'error': 'Invalid or expired token'
            }, status=401)
        
        # Get sounds based on type
        if sound_type == 'server':
            if not server_id:
                return web.json_response({
                    'success': False,
                    'error': 'server_id is required for server sounds'
                }, status=400)
            
            # Verify user is a member of the server
            member = db.get_server_member(server_id, username)
            if not member:
                return web.json_response({
                    'success': False,
                    'error': 'You are not a member of this server'
                }, status=403)
            
            sounds = db.get_server_soundboard_sounds(server_id)
        else:  # 'user'
            sounds = db.get_user_soundboard_sounds(username)
        
        return web.json_response({
            'success': True,
            'sounds': sounds
        })
    
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_download_soundboard_sound(request):
    """
    GET /api/download-soundboard-sound/<sound_id>
    Download a soundboard sound file
    
    Response: Binary audio data with appropriate content-type
    """
    try:
        sound_id = request.match_info.get('sound_id')
        if not sound_id:
            return web.json_response({
                'success': False,
                'error': 'Sound ID is required'
            }, status=400)
        
        # Get sound
        sound = db.get_soundboard_sound(sound_id)
        if not sound:
            return web.json_response({
                'success': False,
                'error': 'Sound not found'
            }, status=404)
        
        # Decode base64 audio data
        audio_data = base64.b64decode(sound['audio_data'])
        
        # Sanitize content type
        safe_content_type = sanitize_content_type(sound['content_type'])
        safe_filename = sanitize_filename(sound['name'])
        
        # Add appropriate extension if not present
        if not any(safe_filename.endswith(ext) for ext in ['.mp3', '.wav', '.ogg', '.opus']):
            if 'mp3' in safe_content_type:
                safe_filename += '.mp3'
            elif 'wav' in safe_content_type:
                safe_filename += '.wav'
            elif 'ogg' in safe_content_type or 'opus' in safe_content_type:
                safe_filename += '.ogg'
        
        # Return audio file
        return web.Response(
            body=audio_data,
            content_type=safe_content_type,
            headers={
                'Content-Disposition': f'inline; filename="{safe_filename}"',
                'Content-Length': str(len(audio_data))
            }
        )
    
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


async def api_delete_soundboard_sound(request):
    """
    DELETE /api/delete-soundboard-sound/<sound_id>
    Delete a soundboard sound
    
    Query parameters:
        - token: JWT authentication token
    
    Response: {
        "success": true,
        "message": "Sound deleted successfully"
    }
    """
    try:
        sound_id = request.match_info.get('sound_id')
        token = request.query.get('token')
        
        if not sound_id:
            return web.json_response({
                'success': False,
                'error': 'Sound ID is required'
            }, status=400)
        
        # Authenticate user
        if not token:
            return web.json_response({
                'success': False,
                'error': 'Authentication required'
            }, status=401)
        
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({
                'success': False,
                'error': 'Invalid or expired token'
            }, status=401)
        
        # Get sound to verify ownership
        sound = db.get_soundboard_sound(sound_id)
        if not sound:
            return web.json_response({
                'success': False,
                'error': 'Sound not found'
            }, status=404)
        
        # Check permissions
        if sound['sound_type'] == 'user':
            # For personal sounds, must be the owner
            if sound['owner'] != username:
                return web.json_response({
                    'success': False,
                    'error': 'You can only delete your own personal sounds'
                }, status=403)
        else:  # server sound
            # For server sounds, must be server admin or the uploader
            server_id = sound['server_id']
            server = db.get_server(server_id)
            
            is_owner = server['owner'] == username
            is_uploader = sound['uploader'] == username
            member_info = db.get_server_member(server_id, username)
            is_admin = member_info and member_info.get('permissions', {}).get('manage_server') == True
            
            if not (is_owner or is_uploader or is_admin):
                return web.json_response({
                    'success': False,
                    'error': 'You do not have permission to delete this sound'
                }, status=403)
        
        # Delete the sound
        success = db.delete_soundboard_sound(sound_id)
        if not success:
            return web.json_response({
                'success': False,
                'error': 'Failed to delete sound'
            }, status=500)
        
        return web.json_response({
            'success': True,
            'message': 'Sound deleted successfully'
        })
    
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


# ============================================================================
# Webhook API Endpoints
# ============================================================================

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
        first_user = db.get_first_user()
        if username != first_user:
            return web.json_response({
                'success': False,
                'error': 'Admin access required'
            }, status=403)
        
        webhooks = db.get_all_instance_webhooks()
        
        # Get request host to build webhook URLs
        scheme = 'https' if request.secure else 'http'
        host = request.host
        
        # Format webhooks for response
        formatted_webhooks = [{
            'id': wh['webhook_id'],
            'name': wh['name'],
            'avatar': wh.get('avatar', '📢'),
            'url': f"{scheme}://{host}/api/instance-webhooks/{wh['webhook_id']}/{wh['token']}",
            'event_type': wh.get('event_type'),
            'target_url': wh.get('target_url'),
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
        first_user = db.get_first_user()
        if username != first_user:
            return web.json_response({
                'success': False,
                'error': 'Admin access required'
            }, status=403)
        
        data = await request.json()
        name = data.get('name', '').strip()
        avatar = data.get('avatar', '📢')  # Default to megaphone emoji
        enabled = data.get('enabled', True)
        
        # event_type and target_url are optional (for future outgoing webhook support)
        event_type = data.get('event_type', None)
        target_url = data.get('target_url', None)
        
        if not name:
            return web.json_response({
                'success': False,
                'error': 'name is required'
            }, status=400)
        
        # Validate event_type if provided
        if event_type:
            valid_events = ['user.signup', 'user.login', 'message.create', 'server.create']
            if event_type not in valid_events:
                return web.json_response({
                    'success': False,
                    'error': f'Invalid event_type. Must be one of: {", ".join(valid_events)}'
                }, status=400)
        
        # Generate webhook ID and token
        webhook_id = str(uuid.uuid4())
        webhook_token = secrets.token_urlsafe(32)
        
        # Get the request host to build webhook URL
        scheme = 'https' if request.secure else 'http'
        host = request.host
        webhook_url = f"{scheme}://{host}/api/instance-webhooks/{webhook_id}/{webhook_token}"
        
        if db.create_instance_webhook(webhook_id, name, webhook_token, username, avatar, event_type, target_url, enabled):
            return web.json_response({
                'success': True,
                'webhook': {
                    'id': webhook_id,
                    'name': name,
                    'avatar': avatar,
                    'url': webhook_url,
                    'token': webhook_token,
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
        first_user = db.get_first_user()
        if username != first_user:
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


async def api_get_branding(request):
    """
    GET /api/branding
    Public endpoint — returns server name and logo for the login screen.
    No authentication required.
    """
    try:
        settings = db.get_admin_settings()
        return web.json_response({
            'server_name': settings.get('server_name', 'Decentra'),
            'server_logo': settings.get('server_logo', ''),
        })
    except Exception as e:
        return web.json_response({
            'server_name': 'Decentra',
            'server_logo': '',
        })


async def api_execute_instance_webhook(request):
    """
    POST /api/instance-webhooks/{webhook_id}/{token}
    Execute an instance webhook to send a DM to all users.
    
    Request body: {
        "content": "string",
        "username": "string" (optional, uses webhook name if not provided)
    }
    """
    try:
        webhook_id = request.match_info['webhook_id']
        token = request.match_info['token']
        
        # Get webhook by token
        webhook = db.get_instance_webhook_by_token(token)
        if not webhook or webhook['webhook_id'] != webhook_id:
            return web.json_response({
                'success': False,
                'error': 'Invalid webhook'
            }, status=404)
        
        if not webhook.get('enabled', True):
            return web.json_response({
                'success': False,
                'error': 'Webhook is disabled'
            }, status=403)
        
        data = await request.json()
        content = data.get('content', '').strip()
        display_name = data.get('username', webhook['name'])
        
        if not content:
            return web.json_response({
                'success': False,
                'error': 'Content is required'
            }, status=400)
        
        # Ensure webhook system user exists
        db.ensure_webhook_system_user()
        
        # Get all users except the webhook system user
        all_users = db.get_all_users()
        real_users = [u for u in all_users if u != '__webhook__']
        
        # Create message object
        from datetime import datetime, timezone
        timestamp = datetime.now(timezone.utc).isoformat()
        
        # Track DMs created and messages sent
        dms_created = 0
        messages_sent = 0
        
        # For each user, create or get a DM with the webhook system user
        for user in real_users:
            # Get or create DM between webhook user and this user
            dm_id = get_or_create_dm_func('__webhook__', user)
            
            # Save message to this DM
            message_id = db.save_message(
                username='__webhook__',
                content=content,
                context_type='dm',
                context_id=dm_id
            )
            
            if message_id:
                messages_sent += 1
                
                # Create message object for this user
                msg_obj = {
                    'type': 'message',
                    'username': display_name,
                    'content': content,
                    'timestamp': timestamp,
                    'context': 'dm',
                    'context_id': dm_id,
                    'avatar': webhook.get('avatar', '📢'),
                    'avatar_type': 'emoji',
                    'avatar_data': None,
                    'user_status': 'offline',
                    'id': message_id,
                    'attachments': [],
                    'reactions': [],
                    'mentions': [],
                    'is_webhook': True,
                    'is_instance_webhook': True
                }
                
                # Send DM message to this user
                await send_to_user_func(user, json.dumps(msg_obj))
                
                # Also notify the user about the new DM if they don't have it yet
                dm_notification = {
                    'type': 'dm_started',
                    'dm': {
                        'id': dm_id,
                        'username': display_name,
                        'avatar': webhook.get('avatar', '📢'),
                        'avatar_type': 'emoji',
                        'avatar_data': None
                    }
                }
                await send_to_user_func(user, json.dumps(dm_notification))
        
        return web.json_response({
            'success': True,
            'message': 'Instance webhook executed successfully',
            'webhook_data': {
                'content': content,
                'display_name': display_name,
                'webhook_id': webhook_id,
                'users_notified': len(real_users),
                'messages_sent': messages_sent,
                'broadcast_type': 'direct_messages'
            }
        })
        
    except Exception as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=500)


# ╔═════════════════════════════════════════════════════════════════════════╗
# ║  SSO Endpoints                                                        ║
# ╚═════════════════════════════════════════════════════════════════════════╝

async def api_sso_config(request):
    """GET /api/auth/sso/config — public, returns whether SSO is enabled and which provider."""
    settings = db.get_admin_settings()
    return web.json_response({
        'sso_enabled': settings.get('sso_enabled', False),
        'sso_provider': settings.get('sso_provider', None),
    })


async def api_sso_initiate(request):
    """GET /api/auth/sso/initiate — start the SSO flow, returns redirect URL."""
    if not check_feature_access("sso"):
        return web.json_response({'error': 'SSO requires a paid license tier'}, status=403)

    settings = db.get_admin_settings()
    if not settings.get('sso_enabled'):
        return web.json_response({'error': 'SSO is not enabled'}, status=400)

    provider = settings.get('sso_provider', '')
    base_url = os.environ.get('DECENTRA_BASE_URL', request.url.origin().__str__())
    callback_url = f"{base_url}/auth/sso/callback"

    # Generate a state token for CSRF protection
    state = secrets.token_urlsafe(32)

    if provider in ('oidc', 'auth0'):
        oidc = OIDCProvider(settings)
        try:
            auth_url = await oidc.get_authorization_url(callback_url, state)
            return web.json_response({'redirect_url': auth_url, 'state': state})
        except Exception as e:
            return web.json_response({'error': f'OIDC initiation failed: {e}'}, status=500)

    elif provider == 'saml':
        saml = SAMLProvider(settings)
        try:
            auth_url = saml.get_auth_url(callback_url, state)
            return web.json_response({'redirect_url': auth_url, 'state': state})
        except Exception as e:
            return web.json_response({'error': f'SAML initiation failed: {e}'}, status=500)

    elif provider == 'ldap':
        return web.json_response({'error': 'LDAP uses directory sync, not browser-based login'}, status=400)

    return web.json_response({'error': f'Unknown SSO provider: {provider}'}, status=400)


async def api_sso_callback(request):
    """POST /api/auth/sso/callback — exchange auth code/assertion for a JWT."""
    if not check_feature_access("sso"):
        return web.json_response({'error': 'SSO requires a paid license tier'}, status=403)

    settings = db.get_admin_settings()
    if not settings.get('sso_enabled'):
        return web.json_response({'error': 'SSO is not enabled'}, status=400)

    provider = settings.get('sso_provider', '')
    body = await request.json()
    base_url = os.environ.get('DECENTRA_BASE_URL', request.url.origin().__str__())
    callback_url = f"{base_url}/auth/sso/callback"

    user_info = None

    if provider in ('oidc', 'auth0'):
        code = body.get('code', '')
        if not code:
            return web.json_response({'error': 'Missing authorization code'}, status=400)
        oidc = OIDCProvider(settings)
        try:
            user_info = await oidc.exchange_code(code, callback_url)
        except Exception as e:
            return web.json_response({'error': f'OIDC callback failed: {e}'}, status=500)

    elif provider == 'saml':
        saml_response = body.get('SAMLResponse', '')
        if not saml_response:
            return web.json_response({'error': 'Missing SAML response'}, status=400)
        saml = SAMLProvider(settings)
        try:
            user_info = saml.parse_response(saml_response)
        except Exception as e:
            return web.json_response({'error': f'SAML callback failed: {e}'}, status=500)

    if not user_info or not user_info.get('sub'):
        return web.json_response({'error': 'Could not extract user identity from SSO response'}, status=400)

    external_id = user_info['sub']
    email = user_info.get('email', '')
    display_name = user_info.get('name', '')

    # Look up existing SSO identity
    identity = db.get_sso_identity(provider, external_id)

    if identity:
        # Existing linked user — issue JWT
        username = identity['username']
    else:
        # Auto-provision: create new user or link by email
        from sso_utils import _sanitize_username
        username = _sanitize_username(display_name or email)

        # Check if a user with this email already exists
        with db.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT username FROM users WHERE email = %s', (email,))
            existing = cursor.fetchone()

        if existing:
            username = existing['username']
        else:
            # Create new SSO-only user (NULL password_hash)
            from datetime import datetime, timezone as tz
            try:
                with db.get_connection() as conn:
                    cursor = conn.cursor()
                    # Ensure unique username
                    base_uname = username
                    suffix = 0
                    while True:
                        cursor.execute('SELECT 1 FROM users WHERE username = %s', (username,))
                        if not cursor.fetchone():
                            break
                        suffix += 1
                        username = f"{base_uname}_{suffix}"

                    cursor.execute('''
                        INSERT INTO users (username, password_hash, created_at, email, email_verified, bio, status_message)
                        VALUES (%s, NULL, %s, %s, %s, %s, '')
                    ''', (username, datetime.now(tz.utc), email,
                          user_info.get('email_verified', False),
                          display_name))
            except Exception as e:
                return web.json_response({'error': f'Failed to create user: {e}'}, status=500)

        # Link SSO identity
        db.create_sso_identity(username, provider, external_id, email, display_name)

    # Generate JWT
    if generate_jwt_token_func:
        token = generate_jwt_token_func(username)
    else:
        return web.json_response({'error': 'JWT generation not available'}, status=500)

    return web.json_response({
        'token': token,
        'username': username,
        'sso_provider': provider,
    })


async def api_sso_test(request):
    """POST /api/auth/sso/test — test SSO provider connection (admin only)."""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return web.json_response({'error': 'Unauthorized'}, status=401)

    token = auth_header[7:]
    username = verify_jwt_token(token)
    if not username:
        return web.json_response({'error': 'Invalid token'}, status=401)

    first_user = db.get_first_user()
    if username != first_user:
        return web.json_response({'error': 'Admin only'}, status=403)

    settings = db.get_admin_settings()
    provider = settings.get('sso_provider', '')

    if provider in ('oidc', 'auth0'):
        oidc = OIDCProvider(settings)
        try:
            disc = await oidc._fetch_discovery()
            return web.json_response({
                'success': True,
                'message': f'OIDC discovery successful — found {len(disc)} configuration keys',
                'issuer': disc.get('issuer', ''),
            })
        except Exception as e:
            return web.json_response({'success': False, 'message': str(e)})

    elif provider == 'saml':
        # SAML test: just verify that the required fields are present
        if settings.get('sso_saml_entity_id') and settings.get('sso_saml_sso_url'):
            return web.json_response({
                'success': True,
                'message': 'SAML configuration looks valid',
            })
        return web.json_response({'success': False, 'message': 'Missing SAML entity ID or SSO URL'})

    elif provider == 'ldap':
        ldap_sync = LDAPSync(settings)
        success, message = ldap_sync.test_connection()
        return web.json_response({'success': success, 'message': message})

    return web.json_response({'success': False, 'message': f'Unknown provider: {provider}'})


# ╔═════════════════════════════════════════════════════════════════════════╗
# ║  SCIM 2.0 Endpoints                                                   ║
# ╚═════════════════════════════════════════════════════════════════════════╝

async def _verify_scim_token(request) -> bool:
    """Verify the SCIM bearer token from the Authorization header."""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return False
    raw_token = auth_header[7:]
    token_hash = _hash_token(raw_token)
    return db.verify_scim_token(token_hash)


async def api_scim_service_provider_config(request):
    """GET /scim/v2/ServiceProviderConfig"""
    base_url = os.environ.get('DECENTRA_BASE_URL', request.url.origin().__str__())
    return web.json_response(SCIMHandler.service_provider_config(base_url))


async def api_scim_schemas(request):
    """GET /scim/v2/Schemas"""
    return web.json_response(SCIMHandler.schemas())


async def api_scim_resource_types(request):
    """GET /scim/v2/ResourceTypes"""
    base_url = os.environ.get('DECENTRA_BASE_URL', request.url.origin().__str__())
    return web.json_response(SCIMHandler.resource_types(base_url))


async def api_scim_users(request):
    """GET/POST /scim/v2/Users"""
    if not check_feature_access("scim"):
        return web.json_response({'error': 'SCIM requires a paid license tier'}, status=403)
    if not await _verify_scim_token(request):
        return web.json_response({'error': 'Invalid SCIM token'}, status=401)

    base_url = os.environ.get('DECENTRA_BASE_URL', request.url.origin().__str__())

    if request.method == 'GET':
        filter_str = request.query.get('filter', '')
        start = int(request.query.get('startIndex', '1'))
        count = int(request.query.get('count', '100'))
        result = SCIMHandler.list_users(db, base_url, filter_str, start, count)
        return web.json_response(result)
    elif request.method == 'POST':
        body = await request.json()
        result, status = SCIMHandler.create_user(db, body, base_url)
        return web.json_response(result, status=status)


async def api_scim_user(request):
    """GET/PUT/PATCH/DELETE /scim/v2/Users/{id}"""
    if not check_feature_access("scim"):
        return web.json_response({'error': 'SCIM requires a paid license tier'}, status=403)
    if not await _verify_scim_token(request):
        return web.json_response({'error': 'Invalid SCIM token'}, status=401)

    user_id = request.match_info['id']
    base_url = os.environ.get('DECENTRA_BASE_URL', request.url.origin().__str__())

    if request.method == 'GET':
        result = SCIMHandler.get_user(db, user_id, base_url)
        if not result:
            return web.json_response({'error': 'User not found'}, status=404)
        return web.json_response(result)
    elif request.method == 'PUT':
        body = await request.json()
        result, status = SCIMHandler.update_user(db, user_id, body, base_url)
        return web.json_response(result, status=status)
    elif request.method == 'PATCH':
        body = await request.json()
        result, status = SCIMHandler.patch_user(db, user_id, body, base_url)
        return web.json_response(result, status=status)
    elif request.method == 'DELETE':
        result, status = SCIMHandler.delete_user(db, user_id)
        if status == 204:
            return web.Response(status=204)
        return web.json_response(result, status=status)


async def api_scim_groups(request):
    """GET/POST /scim/v2/Groups"""
    if not check_feature_access("scim"):
        return web.json_response({'error': 'SCIM requires a paid license tier'}, status=403)
    if not await _verify_scim_token(request):
        return web.json_response({'error': 'Invalid SCIM token'}, status=401)

    base_url = os.environ.get('DECENTRA_BASE_URL', request.url.origin().__str__())

    if request.method == 'GET':
        result = SCIMHandler.list_groups(db, base_url)
        return web.json_response(result)
    elif request.method == 'POST':
        body = await request.json()
        result, status = SCIMHandler.create_group(db, body, base_url)
        return web.json_response(result, status=status)


async def api_scim_group(request):
    """GET/PUT/PATCH/DELETE /scim/v2/Groups/{id}"""
    if not check_feature_access("scim"):
        return web.json_response({'error': 'SCIM requires a paid license tier'}, status=403)
    if not await _verify_scim_token(request):
        return web.json_response({'error': 'Invalid SCIM token'}, status=401)

    group_id = request.match_info['id']
    base_url = os.environ.get('DECENTRA_BASE_URL', request.url.origin().__str__())

    if request.method == 'GET':
        result = SCIMHandler.get_group(db, group_id, base_url)
        if not result:
            return web.json_response({'error': 'Group not found'}, status=404)
        return web.json_response(result)
    elif request.method == 'PUT':
        body = await request.json()
        result, status = SCIMHandler.update_group(db, group_id, body, base_url)
        return web.json_response(result, status=status)
    elif request.method == 'PATCH':
        body = await request.json()
        result, status = SCIMHandler.patch_group(db, group_id, body, base_url)
        return web.json_response(result, status=status)
    elif request.method == 'DELETE':
        result, status = SCIMHandler.delete_group(db, group_id)
        if status == 204:
            return web.Response(status=204)
        return web.json_response(result, status=status)


# ── Bot System API Endpoints ────────────────────────────────────────────────

def verify_bot_token_from_request(request):
    """Verify a bot token from an Authorization: Bot <token> header.
    Returns (bot_dict, scopes) or (None, None)."""
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bot '):
        return None, None
    token = auth_header[4:]
    import hashlib
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    bot = db.get_bot_by_token_hash(token_hash)
    if not bot or not bot.get('is_active', True):
        return None, None
    return bot, bot.get('scopes', [])


async def api_create_bot(request):
    """POST /api/bots — Create a new bot (admin only)."""
    try:
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({'error': 'Authentication required'}, status=401)
        token = auth_header[7:]
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({'error': 'Invalid token'}, status=401)
        
        # Admin check
        first_user = db.get_first_user()
        if username != first_user:
            return web.json_response({'error': 'Admin access required'}, status=403)
        
        data = await request.json()
        bot_name = data.get('name', '').strip()
        bot_username = data.get('username', '').strip()
        description = data.get('description', '').strip()
        avatar = data.get('avatar', '🤖')
        scopes = data.get('scopes', [])
        intents = data.get('intents', [])
        rate_limit_messages = data.get('rate_limit_messages', 30)
        rate_limit_api = data.get('rate_limit_api', 120)
        
        if not bot_name or not bot_username:
            return web.json_response({'error': 'Bot name and username are required'}, status=400)
        
        # Validate username doesn't exist
        if db.get_user(bot_username):
            return web.json_response({'error': 'Username already taken'}, status=400)
        
        # Generate bot ID and token
        bot_id = str(uuid.uuid4())
        raw_token = secrets.token_urlsafe(48)
        import hashlib
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        
        # Create bot user in users table
        db.ensure_bot_system_user(bot_username, avatar)
        
        # Create bot record
        success = db.create_bot(
            bot_id=bot_id,
            name=bot_name,
            username=bot_username,
            token_hash=token_hash,
            owner=username,
            description=description,
            avatar=avatar,
            scopes=scopes,
            intents=intents,
            rate_limit_messages=rate_limit_messages,
            rate_limit_api=rate_limit_api
        )
        
        if success:
            db.log_bot_action(bot_id, 'created', detail={'name': bot_name, 'owner': username})
            return web.json_response({
                'success': True,
                'bot': {
                    'bot_id': bot_id,
                    'name': bot_name,
                    'username': bot_username,
                    'description': description,
                    'avatar': avatar,
                    'scopes': scopes,
                    'intents': intents,
                    'rate_limit_messages': rate_limit_messages,
                    'rate_limit_api': rate_limit_api,
                    'is_active': True,
                    'token': raw_token  # Only returned once!
                }
            })
        return web.json_response({'error': 'Failed to create bot'}, status=500)
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_get_bots(request):
    """GET /api/bots — List all bots (admin only, or with Bot token returns own info)."""
    try:
        auth_header = request.headers.get('Authorization', '')
        
        # Check for Bot token first
        if auth_header.startswith('Bot '):
            bot, scopes = verify_bot_token_from_request(request)
            if not bot:
                return web.json_response({'error': 'Invalid bot token'}, status=401)
            servers = db.get_bot_servers(bot['bot_id'])
            return web.json_response({
                'bots': [{
                    'bot_id': bot['bot_id'],
                    'name': bot['name'],
                    'username': bot['username'],
                    'description': bot.get('description', ''),
                    'avatar': bot.get('avatar', '🤖'),
                    'scopes': bot.get('scopes', []),
                    'intents': bot.get('intents', []),
                    'is_active': bot.get('is_active', True),
                    'servers': [{'server_id': s['server_id'], 'name': s['name']} for s in servers]
                }]
            })
        
        if not auth_header.startswith('Bearer '):
            return web.json_response({'error': 'Authentication required'}, status=401)
        token = auth_header[7:]
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({'error': 'Invalid token'}, status=401)
        
        first_user = db.get_first_user()
        if username != first_user:
            return web.json_response({'error': 'Admin access required'}, status=403)
        
        bots = db.get_all_bots()
        bot_list = []
        for b in bots:
            servers = db.get_bot_servers(b['bot_id'])
            bot_list.append({
                'bot_id': b['bot_id'],
                'name': b['name'],
                'username': b['username'],
                'description': b.get('description', ''),
                'avatar': b.get('avatar', '🤖'),
                'scopes': b.get('scopes', []),
                'intents': b.get('intents', []),
                'rate_limit_messages': b.get('rate_limit_messages', 30),
                'rate_limit_api': b.get('rate_limit_api', 120),
                'is_active': b.get('is_active', True),
                'created_at': b['created_at'].isoformat() if b.get('created_at') else None,
                'owner': b.get('owner'),
                'server_count': len(servers)
            })
        
        return web.json_response({'bots': bot_list})
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_get_bot(request):
    """GET /api/bots/{bot_id} — Get bot details."""
    try:
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({'error': 'Authentication required'}, status=401)
        token = auth_header[7:]
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({'error': 'Invalid token'}, status=401)
        
        bot_id = request.match_info['bot_id']
        bot = db.get_bot(bot_id)
        if not bot:
            return web.json_response({'error': 'Bot not found'}, status=404)
        
        servers = db.get_bot_servers(bot_id)
        commands = db.get_bot_slash_commands(bot_id)
        
        return web.json_response({
            'bot': {
                'bot_id': bot['bot_id'],
                'name': bot['name'],
                'username': bot['username'],
                'description': bot.get('description', ''),
                'avatar': bot.get('avatar', '🤖'),
                'scopes': bot.get('scopes', []),
                'intents': bot.get('intents', []),
                'rate_limit_messages': bot.get('rate_limit_messages', 30),
                'rate_limit_api': bot.get('rate_limit_api', 120),
                'is_active': bot.get('is_active', True),
                'created_at': bot['created_at'].isoformat() if bot.get('created_at') else None,
                'owner': bot.get('owner'),
                'servers': [{'server_id': s['server_id'], 'name': s['name']} for s in servers],
                'commands': [{
                    'command_id': c['command_id'],
                    'name': c['name'],
                    'description': c.get('description', ''),
                    'parameters': c.get('parameters', []),
                    'enabled': c.get('enabled', True)
                } for c in commands]
            }
        })
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_update_bot(request):
    """PUT /api/bots/{bot_id} — Update bot details (admin only)."""
    try:
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({'error': 'Authentication required'}, status=401)
        token = auth_header[7:]
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({'error': 'Invalid token'}, status=401)
        
        first_user = db.get_first_user()
        if username != first_user:
            return web.json_response({'error': 'Admin access required'}, status=403)
        
        bot_id = request.match_info['bot_id']
        bot = db.get_bot(bot_id)
        if not bot:
            return web.json_response({'error': 'Bot not found'}, status=404)
        
        data = await request.json()
        update_fields = {}
        for field in ['name', 'description', 'avatar', 'scopes', 'intents',
                       'rate_limit_messages', 'rate_limit_api', 'is_active']:
            if field in data:
                update_fields[field] = data[field]
        
        success = db.update_bot(bot_id, **update_fields)
        if success:
            return web.json_response({'success': True, 'message': 'Bot updated'})
        return web.json_response({'error': 'Failed to update bot'}, status=500)
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_delete_bot(request):
    """DELETE /api/bots/{bot_id} — Delete a bot (admin only)."""
    try:
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({'error': 'Authentication required'}, status=401)
        token = auth_header[7:]
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({'error': 'Invalid token'}, status=401)
        
        first_user = db.get_first_user()
        if username != first_user:
            return web.json_response({'error': 'Admin access required'}, status=403)
        
        bot_id = request.match_info['bot_id']
        success = db.delete_bot(bot_id)
        if success:
            return web.json_response({'success': True, 'message': 'Bot deleted'})
        return web.json_response({'error': 'Bot not found'}, status=404)
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_regenerate_bot_token(request):
    """POST /api/bots/{bot_id}/regenerate-token — Regenerate bot token (admin only)."""
    try:
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({'error': 'Authentication required'}, status=401)
        token = auth_header[7:]
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({'error': 'Invalid token'}, status=401)
        
        first_user = db.get_first_user()
        if username != first_user:
            return web.json_response({'error': 'Admin access required'}, status=403)
        
        bot_id = request.match_info['bot_id']
        bot = db.get_bot(bot_id)
        if not bot:
            return web.json_response({'error': 'Bot not found'}, status=404)
        
        raw_token = secrets.token_urlsafe(48)
        import hashlib
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        success = db.regenerate_bot_token(bot_id, token_hash)
        
        if success:
            db.log_bot_action(bot_id, 'token_regenerated', detail={'by': username})
            return web.json_response({
                'success': True,
                'token': raw_token  # Only returned once!
            })
        return web.json_response({'error': 'Failed to regenerate token'}, status=500)
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_add_bot_to_server(request):
    """POST /api/bots/{bot_id}/servers/{server_id} — Add bot to a server."""
    try:
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({'error': 'Authentication required'}, status=401)
        token = auth_header[7:]
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({'error': 'Invalid token'}, status=401)
        
        bot_id = request.match_info['bot_id']
        server_id = request.match_info['server_id']
        
        # Verify user is server owner or instance admin
        server = db.get_server(server_id)
        if not server:
            return web.json_response({'error': 'Server not found'}, status=404)
        
        first_user = db.get_first_user()
        if server['owner'] != username and username != first_user:
            return web.json_response({'error': 'Only server owner or admin can add bots'}, status=403)
        
        bot = db.get_bot(bot_id)
        if not bot:
            return web.json_response({'error': 'Bot not found'}, status=404)
        
        data = {}
        try:
            data = await request.json()
        except Exception:
            pass
        scopes_override = data.get('scopes_override')
        
        success = db.add_bot_to_server(bot_id, server_id, username, scopes_override)
        if success:
            db.log_bot_action(bot_id, 'added_to_server', server_id=server_id, detail={'by': username})
            
            # Broadcast bot joined event to server
            await broadcast_to_server_func(server_id, json.dumps({
                'type': 'bot_joined_server',
                'server_id': server_id,
                'bot': {
                    'bot_id': bot['bot_id'],
                    'name': bot['name'],
                    'username': bot['username'],
                    'avatar': bot.get('avatar', '🤖'),
                    'is_bot': True
                }
            }))
            
            return web.json_response({'success': True, 'message': 'Bot added to server'})
        return web.json_response({'error': 'Failed to add bot to server'}, status=500)
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_remove_bot_from_server(request):
    """DELETE /api/bots/{bot_id}/servers/{server_id} — Remove bot from a server."""
    try:
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({'error': 'Authentication required'}, status=401)
        token = auth_header[7:]
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({'error': 'Invalid token'}, status=401)
        
        bot_id = request.match_info['bot_id']
        server_id = request.match_info['server_id']
        
        server = db.get_server(server_id)
        if not server:
            return web.json_response({'error': 'Server not found'}, status=404)
        
        first_user = db.get_first_user()
        if server['owner'] != username and username != first_user:
            return web.json_response({'error': 'Only server owner or admin can remove bots'}, status=403)
        
        bot = db.get_bot(bot_id)
        if bot:
            success = db.remove_bot_from_server(bot_id, server_id)
            if success:
                db.log_bot_action(bot_id, 'removed_from_server', server_id=server_id, detail={'by': username})
                await broadcast_to_server_func(server_id, json.dumps({
                    'type': 'bot_left_server',
                    'server_id': server_id,
                    'bot_username': bot['username']
                }))
                return web.json_response({'success': True, 'message': 'Bot removed from server'})
        return web.json_response({'error': 'Failed to remove bot'}, status=500)
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_get_server_bots(request):
    """GET /api/servers/{server_id}/bots — Get bots in a server."""
    try:
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({'error': 'Authentication required'}, status=401)
        token = auth_header[7:]
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({'error': 'Invalid token'}, status=401)
        
        server_id = request.match_info['server_id']
        bots = db.get_server_bots(server_id)
        
        return web.json_response({
            'bots': [{
                'bot_id': b['bot_id'],
                'name': b['name'],
                'username': b['username'],
                'description': b.get('description', ''),
                'avatar': b.get('avatar', '🤖'),
                'is_active': b.get('is_active', True),
                'added_by': b.get('added_by'),
                'added_at': b['added_at'].isoformat() if b.get('added_at') else None,
                'scopes_override': b.get('scopes_override')
            } for b in bots]
        })
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_get_server_commands(request):
    """GET /api/servers/{server_id}/commands — Get slash commands for a server."""
    try:
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({'error': 'Authentication required'}, status=401)
        token = auth_header[7:]
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({'error': 'Invalid token'}, status=401)
        
        server_id = request.match_info['server_id']
        commands = db.get_server_slash_commands(server_id)
        
        return web.json_response({
            'commands': [{
                'command_id': c['command_id'],
                'bot_id': c['bot_id'],
                'bot_name': c.get('bot_name', ''),
                'bot_avatar': c.get('bot_avatar', '🤖'),
                'bot_username': c.get('bot_username', ''),
                'name': c['name'],
                'description': c.get('description', ''),
                'parameters': c.get('parameters', []),
                'enabled': c.get('enabled', True)
            } for c in commands]
        })
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_toggle_server_command(request):
    """PUT /api/servers/{server_id}/commands/{command_id} — Toggle a command in a server."""
    try:
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({'error': 'Authentication required'}, status=401)
        token = auth_header[7:]
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({'error': 'Invalid token'}, status=401)
        
        server_id = request.match_info['server_id']
        command_id = request.match_info['command_id']
        
        server = db.get_server(server_id)
        if not server:
            return web.json_response({'error': 'Server not found'}, status=404)
        
        first_user = db.get_first_user()
        if server['owner'] != username and username != first_user:
            return web.json_response({'error': 'Only server owner or admin can manage commands'}, status=403)
        
        data = await request.json()
        enabled = data.get('enabled', True)
        
        success = db.toggle_slash_command(command_id, enabled)
        if success:
            return web.json_response({'success': True})
        return web.json_response({'error': 'Failed to toggle command'}, status=500)
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


# ── Bot Action Endpoints (used by bots with Bot token) ──────────────────────

async def api_bot_send_message(request):
    """POST /api/bot/messages — Send a message as a bot."""
    try:
        bot, scopes = verify_bot_token_from_request(request)
        if not bot:
            return web.json_response({'error': 'Invalid bot token'}, status=401)
        
        from bot_scopes import has_scope, SCOPE_SEND_MESSAGES
        if not has_scope(scopes, SCOPE_SEND_MESSAGES):
            return web.json_response({'error': 'Missing SEND_MESSAGES scope'}, status=403)
        
        data = await request.json()
        server_id = data.get('server_id', '')
        channel_id = data.get('channel_id', '')
        content = data.get('content', '').strip()
        reply_to = data.get('reply_to')
        
        if not server_id or not channel_id or not content:
            return web.json_response({'error': 'server_id, channel_id, and content are required'}, status=400)
        
        # Verify bot is in the server
        membership = db.get_bot_server_membership(bot['bot_id'], server_id)
        if not membership:
            return web.json_response({'error': 'Bot is not in this server'}, status=403)
        
        # Rate limit check
        from server import check_bot_rate_limit
        allowed, retry_after = check_bot_rate_limit(
            bot['bot_id'], 'messages',
            bot.get('rate_limit_messages', 30),
            window=10, channel_id=channel_id
        )
        if not allowed:
            return web.json_response({
                'error': 'Rate limited',
                'retry_after': round(retry_after, 2)
            }, status=429, headers={'Retry-After': str(int(retry_after) + 1)})
        
        context_id = f"{server_id}/{channel_id}"
        message_id = db.save_message(bot['username'], content, 'server', context_id, reply_to)
        
        from datetime import datetime, timezone
        msg_obj = {
            'type': 'message',
            'username': bot['username'],
            'content': content,
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'context': 'server',
            'context_id': context_id,
            'avatar': bot.get('avatar', '🤖'),
            'avatar_type': bot.get('avatar_type', 'emoji'),
            'avatar_data': bot.get('avatar_data'),
            'user_status': 'online',
            'id': message_id,
            'attachments': [],
            'reactions': [],
            'mentions': [],
            'is_bot': True
        }
        
        if reply_to:
            original_msg = db.get_message(reply_to)
            if original_msg:
                msg_obj['reply_data'] = {
                    'id': original_msg['id'],
                    'username': original_msg['username'],
                    'content': original_msg['content'],
                    'deleted': original_msg.get('deleted', False)
                }
        
        await broadcast_to_server_func(server_id, json.dumps(msg_obj), channel_id=channel_id)
        
        db.log_bot_action(bot['bot_id'], 'message_sent', server_id=server_id,
                          detail={'channel_id': channel_id, 'message_id': message_id})
        
        return web.json_response({
            'success': True,
            'message_id': message_id
        })
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_bot_edit_message(request):
    """PUT /api/bot/messages/{message_id} — Edit a bot's own message."""
    try:
        bot, scopes = verify_bot_token_from_request(request)
        if not bot:
            return web.json_response({'error': 'Invalid bot token'}, status=401)
        
        from bot_scopes import has_scope, SCOPE_SEND_MESSAGES
        if not has_scope(scopes, SCOPE_SEND_MESSAGES):
            return web.json_response({'error': 'Missing SEND_MESSAGES scope'}, status=403)
        
        message_id = int(request.match_info['message_id'])
        data = await request.json()
        new_content = data.get('content', '').strip()
        
        if not new_content:
            return web.json_response({'error': 'Content is required'}, status=400)
        
        msg = db.get_message(message_id)
        if not msg or msg['username'] != bot['username']:
            return web.json_response({'error': 'Message not found or not owned by this bot'}, status=404)
        
        db.edit_message(message_id, new_content)
        
        # Broadcast edit
        context_id = msg.get('context_id', '')
        if '/' in context_id:
            server_id = context_id.split('/')[0]
            await broadcast_to_server_func(server_id, json.dumps({
                'type': 'message_edited',
                'id': message_id,
                'content': new_content,
                'context': msg.get('context_type', 'server'),
                'context_id': context_id,
                'edited_at': datetime.now(timezone.utc).isoformat()
            }))
        
        return web.json_response({'success': True})
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_bot_delete_message(request):
    """DELETE /api/bot/messages/{message_id} — Delete a message."""
    try:
        bot, scopes = verify_bot_token_from_request(request)
        if not bot:
            return web.json_response({'error': 'Invalid bot token'}, status=401)
        
        message_id = int(request.match_info['message_id'])
        msg = db.get_message(message_id)
        if not msg:
            return web.json_response({'error': 'Message not found'}, status=404)
        
        # Bot can delete its own messages or others' if it has MANAGE_MESSAGES
        from bot_scopes import has_scope, SCOPE_MANAGE_MESSAGES, SCOPE_SEND_MESSAGES
        if msg['username'] != bot['username'] and not has_scope(scopes, SCOPE_MANAGE_MESSAGES):
            return web.json_response({'error': 'Missing MANAGE_MESSAGES scope'}, status=403)
        if msg['username'] == bot['username'] and not has_scope(scopes, SCOPE_SEND_MESSAGES):
            return web.json_response({'error': 'Missing SEND_MESSAGES scope'}, status=403)
        
        db.delete_message(message_id)
        
        context_id = msg.get('context_id', '')
        if '/' in context_id:
            server_id = context_id.split('/')[0]
            await broadcast_to_server_func(server_id, json.dumps({
                'type': 'message_deleted',
                'id': message_id,
                'context': msg.get('context_type', 'server'),
                'context_id': context_id
            }))
        
        return web.json_response({'success': True})
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_bot_get_servers(request):
    """GET /api/bot/servers — Get bot's servers."""
    try:
        bot, scopes = verify_bot_token_from_request(request)
        if not bot:
            return web.json_response({'error': 'Invalid bot token'}, status=401)
        
        servers = db.get_bot_servers(bot['bot_id'])
        return web.json_response({
            'servers': [{'server_id': s['server_id'], 'name': s['name']} for s in servers]
        })
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_bot_get_channels(request):
    """GET /api/bot/servers/{server_id}/channels — Get channels in a server."""
    try:
        bot, scopes = verify_bot_token_from_request(request)
        if not bot:
            return web.json_response({'error': 'Invalid bot token'}, status=401)
        
        server_id = request.match_info['server_id']
        membership = db.get_bot_server_membership(bot['bot_id'], server_id)
        if not membership:
            return web.json_response({'error': 'Bot is not in this server'}, status=403)
        
        channels = db.get_server_channels(server_id)
        return web.json_response({
            'channels': [{'channel_id': c['channel_id'], 'name': c['name'],
                          'type': c.get('type', 'text')} for c in channels]
        })
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_bot_get_members(request):
    """GET /api/bot/servers/{server_id}/members — Get members in a server."""
    try:
        bot, scopes = verify_bot_token_from_request(request)
        if not bot:
            return web.json_response({'error': 'Invalid bot token'}, status=401)
        
        from bot_scopes import has_scope, SCOPE_READ_MEMBERS
        if not has_scope(scopes, SCOPE_READ_MEMBERS):
            return web.json_response({'error': 'Missing READ_MEMBERS scope'}, status=403)
        
        server_id = request.match_info['server_id']
        membership = db.get_bot_server_membership(bot['bot_id'], server_id)
        if not membership:
            return web.json_response({'error': 'Bot is not in this server'}, status=403)
        
        members = db.get_server_members(server_id)
        return web.json_response({
            'members': [{'username': m['username']} for m in members]
        })
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_bot_get_messages(request):
    """GET /api/bot/servers/{server_id}/messages — Get message history."""
    try:
        bot, scopes = verify_bot_token_from_request(request)
        if not bot:
            return web.json_response({'error': 'Invalid bot token'}, status=401)
        
        from bot_scopes import has_scope, SCOPE_READ_MESSAGES
        if not has_scope(scopes, SCOPE_READ_MESSAGES):
            return web.json_response({'error': 'Missing READ_MESSAGES scope'}, status=403)
        
        server_id = request.match_info['server_id']
        channel_id = request.query.get('channel_id', '')
        limit = min(int(request.query.get('limit', '50')), 100)
        before = request.query.get('before')
        
        if not channel_id:
            return web.json_response({'error': 'channel_id query parameter required'}, status=400)
        
        membership = db.get_bot_server_membership(bot['bot_id'], server_id)
        if not membership:
            return web.json_response({'error': 'Bot is not in this server'}, status=403)
        
        context_id = f"{server_id}/{channel_id}"
        messages = db.get_messages(context_type='server', context_id=context_id, limit=limit, before_id=before)
        
        return web.json_response({'messages': messages})
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_bot_register_commands(request):
    """POST /api/bot/commands — Register slash commands (bot token auth)."""
    try:
        bot, scopes = verify_bot_token_from_request(request)
        if not bot:
            return web.json_response({'error': 'Invalid bot token'}, status=401)
        
        from bot_scopes import has_scope, SCOPE_USE_SLASH_COMMANDS
        if not has_scope(scopes, SCOPE_USE_SLASH_COMMANDS):
            return web.json_response({'error': 'Missing USE_SLASH_COMMANDS scope'}, status=403)
        
        data = await request.json()
        commands = data.get('commands', [])
        
        if not isinstance(commands, list):
            return web.json_response({'error': 'commands must be a list'}, status=400)
        
        # Delete existing commands and re-register
        db.delete_bot_commands(bot['bot_id'])
        
        registered = []
        for cmd in commands:
            name = cmd.get('name', '').strip().lower()
            description = cmd.get('description', '').strip()
            parameters = cmd.get('parameters', [])
            server_id = cmd.get('server_id')  # None = global
            
            if not name:
                continue
            
            command_id = str(uuid.uuid4())
            db.register_slash_command(command_id, bot['bot_id'], name, description, parameters, server_id)
            registered.append({'command_id': command_id, 'name': name})
        
        db.log_bot_action(bot['bot_id'], 'commands_registered',
                          detail={'count': len(registered)})
        
        return web.json_response({
            'success': True,
            'registered': registered
        })
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_bot_get_commands(request):
    """GET /api/bot/commands — Get bot's registered commands."""
    try:
        bot, scopes = verify_bot_token_from_request(request)
        if not bot:
            return web.json_response({'error': 'Invalid bot token'}, status=401)
        
        commands = db.get_bot_slash_commands(bot['bot_id'])
        return web.json_response({
            'commands': [{
                'command_id': c['command_id'],
                'name': c['name'],
                'description': c.get('description', ''),
                'parameters': c.get('parameters', []),
                'server_id': c.get('server_id'),
                'enabled': c.get('enabled', True)
            } for c in commands]
        })
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_bot_add_reaction(request):
    """POST /api/bot/reactions — Add a reaction to a message."""
    try:
        bot, scopes = verify_bot_token_from_request(request)
        if not bot:
            return web.json_response({'error': 'Invalid bot token'}, status=401)
        
        from bot_scopes import has_scope, SCOPE_ADD_REACTIONS
        if not has_scope(scopes, SCOPE_ADD_REACTIONS):
            return web.json_response({'error': 'Missing ADD_REACTIONS scope'}, status=403)
        
        data = await request.json()
        message_id = data.get('message_id')
        emoji = data.get('emoji', '')
        
        if not message_id or not emoji:
            return web.json_response({'error': 'message_id and emoji are required'}, status=400)
        
        success = db.add_reaction(message_id, bot['username'], emoji)
        if success:
            msg = db.get_message(message_id)
            if msg:
                context_id = msg.get('context_id', '')
                if '/' in context_id:
                    server_id = context_id.split('/')[0]
                    await broadcast_to_server_func(server_id, json.dumps({
                        'type': 'reaction_added',
                        'message_id': message_id,
                        'username': bot['username'],
                        'emoji': emoji,
                        'context_id': context_id,
                        'is_bot': True
                    }))
            return web.json_response({'success': True})
        return web.json_response({'error': 'Failed to add reaction'}, status=500)
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


async def api_bot_audit_log(request):
    """GET /api/bots/{bot_id}/audit-log — Get bot audit log (admin only)."""
    try:
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return web.json_response({'error': 'Authentication required'}, status=401)
        token = auth_header[7:]
        username = verify_jwt_token(token)
        if not username:
            return web.json_response({'error': 'Invalid token'}, status=401)
        
        first_user = db.get_first_user()
        if username != first_user:
            return web.json_response({'error': 'Admin access required'}, status=403)
        
        bot_id = request.match_info['bot_id']
        limit = min(int(request.query.get('limit', '50')), 200)
        entries = db.get_bot_audit_log(bot_id, limit)
        
        return web.json_response({
            'entries': [{
                'id': e['id'],
                'action': e['action'],
                'server_id': e.get('server_id'),
                'detail': e.get('detail', {}),
                'timestamp': e['timestamp'].isoformat() if e.get('timestamp') else None
            } for e in entries]
        })
    except Exception as e:
        return web.json_response({'error': str(e)}, status=500)


def setup_api_routes(app, database, jwt_verify_func, broadcast_func, send_user_func, create_dm_func, avatar_func, jwt_generate_func=None):
    """Setup REST API routes on the aiohttp application."""
    global db, verify_jwt_token, broadcast_to_server_func, send_to_user_func, get_or_create_dm_func, get_avatar_data_func, generate_jwt_token_func
    db = database
    verify_jwt_token = jwt_verify_func
    generate_jwt_token_func = jwt_generate_func
    broadcast_to_server_func = broadcast_func
    send_to_user_func = send_user_func
    get_or_create_dm_func = create_dm_func
    get_avatar_data_func = avatar_func
    app.router.add_post('/api/auth', api_auth)
    app.router.add_post('/api/reset-password', api_reset_password)
    app.router.add_get('/api/servers', api_servers)
    app.router.add_get('/api/messages', api_messages)
    app.router.add_get('/api/search-messages', api_search_messages)
    app.router.add_get('/api/search-filters', api_search_filters)
    app.router.add_get('/api/friends', api_friends)
    app.router.add_get('/api/dms', api_dms)
    app.router.add_post('/api/upload-attachment', api_upload_attachment)
    app.router.add_get('/api/download-attachment/{attachment_id}', api_download_attachment)
    app.router.add_get('/api/download-attachment/{attachment_id}/{filename}', api_download_attachment)
    app.router.add_get('/api/message-attachments/{message_id}', api_get_message_attachments)
    # Soundboard routes
    app.router.add_post('/api/upload-soundboard-sound', api_upload_soundboard_sound)
    app.router.add_get('/api/soundboard-sounds', api_get_soundboard_sounds)
    app.router.add_get('/api/download-soundboard-sound/{sound_id}', api_download_soundboard_sound)
    app.router.add_delete('/api/delete-soundboard-sound/{sound_id}', api_delete_soundboard_sound)
    # Webhook routes
    app.router.add_post('/api/webhooks', api_create_webhook)
    app.router.add_get('/api/webhooks/server/{server_id}', api_get_server_webhooks)
    app.router.add_delete('/api/webhooks/{webhook_id}', api_delete_webhook)
    app.router.add_post('/api/webhooks/{webhook_id}/{token}', api_execute_webhook)
    # Instance webhook routes (admin only)
    app.router.add_get('/api/instance-webhooks', api_get_instance_webhooks)
    app.router.add_post('/api/instance-webhooks', api_create_instance_webhook)
    app.router.add_delete('/api/instance-webhooks/{webhook_id}', api_delete_instance_webhook)
    app.router.add_post('/api/instance-webhooks/{webhook_id}/{token}', api_execute_instance_webhook)
    # Public branding endpoint (no auth required)
    app.router.add_get('/api/branding', api_get_branding)
    # SSO routes
    app.router.add_get('/api/auth/sso/config', api_sso_config)
    app.router.add_get('/api/auth/sso/initiate', api_sso_initiate)
    app.router.add_post('/api/auth/sso/callback', api_sso_callback)
    app.router.add_post('/api/auth/sso/test', api_sso_test)
    # SCIM 2.0 routes
    app.router.add_get('/scim/v2/ServiceProviderConfig', api_scim_service_provider_config)
    app.router.add_get('/scim/v2/Schemas', api_scim_schemas)
    app.router.add_get('/scim/v2/ResourceTypes', api_scim_resource_types)
    app.router.add_route('*', '/scim/v2/Users', api_scim_users)
    app.router.add_route('*', '/scim/v2/Users/{id}', api_scim_user)
    app.router.add_route('*', '/scim/v2/Groups', api_scim_groups)
    app.router.add_route('*', '/scim/v2/Groups/{id}', api_scim_group)
    # Bot management routes (admin)
    app.router.add_post('/api/bots', api_create_bot)
    app.router.add_get('/api/bots', api_get_bots)
    app.router.add_get('/api/bots/{bot_id}', api_get_bot)
    app.router.add_put('/api/bots/{bot_id}', api_update_bot)
    app.router.add_delete('/api/bots/{bot_id}', api_delete_bot)
    app.router.add_post('/api/bots/{bot_id}/regenerate-token', api_regenerate_bot_token)
    app.router.add_post('/api/bots/{bot_id}/servers/{server_id}', api_add_bot_to_server)
    app.router.add_delete('/api/bots/{bot_id}/servers/{server_id}', api_remove_bot_from_server)
    app.router.add_get('/api/bots/{bot_id}/audit-log', api_bot_audit_log)
    # Server-level bot routes
    app.router.add_get('/api/servers/{server_id}/bots', api_get_server_bots)
    app.router.add_get('/api/servers/{server_id}/commands', api_get_server_commands)
    app.router.add_put('/api/servers/{server_id}/commands/{command_id}', api_toggle_server_command)
    # Bot action routes (bot token auth)
    app.router.add_post('/api/bot/messages', api_bot_send_message)
    app.router.add_put('/api/bot/messages/{message_id}', api_bot_edit_message)
    app.router.add_delete('/api/bot/messages/{message_id}', api_bot_delete_message)
    app.router.add_get('/api/bot/servers', api_bot_get_servers)
    app.router.add_get('/api/bot/servers/{server_id}/channels', api_bot_get_channels)
    app.router.add_get('/api/bot/servers/{server_id}/members', api_bot_get_members)
    app.router.add_get('/api/bot/servers/{server_id}/messages', api_bot_get_messages)
    app.router.add_post('/api/bot/commands', api_bot_register_commands)
    app.router.add_get('/api/bot/commands', api_bot_get_commands)
    app.router.add_post('/api/bot/reactions', api_bot_add_reaction)
