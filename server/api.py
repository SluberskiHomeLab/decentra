#!/usr/bin/env python3
"""
REST API endpoints for Decentra Chat Server
Provides HTTP REST API for future desktop application integration
"""

import json
from aiohttp import web
import bcrypt
from database import Database
import os

# Use the same database instance
db = Database(os.getenv('DB_PATH', 'decentra.db'))


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


def setup_api_routes(app):
    """Setup REST API routes on the aiohttp application."""
    app.router.add_post('/api/auth', api_auth)
    app.router.add_get('/api/servers', api_servers)
    app.router.add_get('/api/messages', api_messages)
    app.router.add_get('/api/friends', api_friends)
    app.router.add_get('/api/dms', api_dms)
