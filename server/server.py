#!/usr/bin/env python3
"""
Decentra Chat Server
A simple WebSocket-based chat server for decentralized communication.
"""

import asyncio
import json
import websockets
from datetime import datetime
import bcrypt
import secrets
import string
import random
from aiohttp import web
import os

# Store connected clients: {websocket: username}
clients = {}
# Store message history (deprecated - now per server/channel)
messages = []
MAX_HISTORY = 100

# Store user accounts: {username: {password_hash, created_at, friends: set()}}
users = {}
# Store active invite codes: {code: creator_username}
invite_codes = {}

# Store servers: {
#   server_id: {
#     name, owner, members: set(),
#     permissions: {username: {can_create_channel, can_edit_channel, can_delete_channel}},
#     invite_codes: {code: creator},
#     channels: {channel_id: {name, type: 'text'|'voice', messages: [], voice_members: set()}}
#   }
# }
servers = {}
# Store direct messages: {dm_id: {participants: set(), messages: []}}
direct_messages = {}
# Store voice calls: {call_id: {participants: set(), type: 'direct'|'channel', server_id: str, channel_id: str}}
voice_calls = {}
# Store voice state: {username: {in_voice: bool, channel_id: str, server_id: str, muted: bool}}
voice_states = {}

# Helper counters for IDs
server_counter = 0
channel_counter = 0
dm_counter = 0


def hash_password(password):
    """Hash a password using bcrypt."""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(password, password_hash):
    """Verify a password against its hash."""
    return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))


def generate_invite_code():
    """Generate a random invite code."""
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(8))


def get_next_server_id():
    """Get next server ID."""
    global server_counter
    server_counter += 1
    return f"server_{server_counter}"


def get_next_channel_id():
    """Get next channel ID."""
    global channel_counter
    channel_counter += 1
    return f"channel_{channel_counter}"


def get_next_dm_id():
    """Get next DM ID."""
    global dm_counter
    dm_counter += 1
    return f"dm_{dm_counter}"


def get_next_call_id():
    """Get next voice call ID."""
    return f"call_{random.randint(100000, 999999)}"


def get_or_create_dm(user1, user2):
    """Get existing DM or create new one between two users."""
    participants = {user1, user2}
    # Find existing DM
    for dm_id, dm_data in direct_messages.items():
        if dm_data['participants'] == participants:
            return dm_id
    # Create new DM
    dm_id = get_next_dm_id()
    direct_messages[dm_id] = {
        'participants': participants,
        'messages': []
    }
    return dm_id


def has_permission(server_id, username, permission):
    """Check if user has specific permission in a server.
    Owner always has all permissions.
    Permission can be: 'can_create_channel', 'can_edit_channel', 'can_delete_channel'
    """
    if server_id not in servers:
        return False
    
    server = servers[server_id]
    
    # Owner has all permissions
    if server['owner'] == username:
        return True
    
    # Check user's specific permissions
    if username in server.get('permissions', {}):
        return server['permissions'][username].get(permission, False)
    
    # Default: no permission
    return False


def get_default_permissions():
    """Get default permissions for new server members."""
    return {
        'can_create_channel': False,
        'can_edit_channel': False,
        'can_delete_channel': False
    }


async def broadcast(message, exclude=None):
    """Broadcast a message to all connected clients except the excluded one."""
    if clients:
        tasks = []
        for client_ws, client_username in clients.items():
            if client_ws != exclude:
                tasks.append(client_ws.send_str(message))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


async def broadcast_to_server(server_id, message, exclude=None):
    """Broadcast a message to all members of a server."""
    if server_id not in servers:
        return
    
    server_members = servers[server_id]['members']
    tasks = []
    for client_ws, client_username in clients.items():
        if client_username in server_members and client_ws != exclude:
            tasks.append(client_ws.send_str(message))
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def send_to_user(username, message):
    """Send a message to a specific user."""
    for client_ws, client_username in clients.items():
        if client_username == username:
            await client_ws.send_str(message)
            break


async def handler(websocket):
    """Handle client connections."""
    username = None
    authenticated = False
    
    try:
        # Register client
        clients[websocket] = None  # Will be set after authentication
        
        # Authentication loop
        while not authenticated:
            msg = await websocket.receive()
            if msg.type == web.WSMsgType.TEXT:
                auth_data = json.loads(msg.data)
            elif msg.type == web.WSMsgType.ERROR:
                print(f'WebSocket connection closed with exception {websocket.exception()}')
                break
            else:
                break
            
            # Handle signup
            if auth_data.get('type') == 'signup':
                username = auth_data.get('username', '').strip()
                password = auth_data.get('password', '')
                invite_code = auth_data.get('invite_code', '').strip()
                
                # Validation
                if not username or not password:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Username and password are required'
                    }))
                    continue
                
                if username in users:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Username already exists'
                    }))
                    continue
                
                # Check invite code (required if users exist)
                if users and invite_code not in invite_codes:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Valid invite code required'
                    }))
                    continue
                
                # Create user account
                users[username] = {
                    'password_hash': hash_password(password),
                    'created_at': datetime.now().isoformat(),
                    'friends': set()
                }
                
                # Remove used invite code
                if invite_code in invite_codes:
                    del invite_codes[invite_code]
                
                await websocket.send_str(json.dumps({
                    'type': 'auth_success',
                    'message': 'Account created successfully'
                }))
                authenticated = True
                clients[websocket] = username
                print(f"[{datetime.now().strftime('%H:%M:%S')}] New user registered: {username}")
            
            # Handle login
            elif auth_data.get('type') == 'login':
                username = auth_data.get('username', '').strip()
                password = auth_data.get('password', '')
                
                if not username or not password:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Username and password are required'
                    }))
                    continue
                
                if username not in users:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Invalid username or password'
                    }))
                    continue
                
                if not verify_password(password, users[username]['password_hash']):
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Invalid username or password'
                    }))
                    continue
                
                await websocket.send_str(json.dumps({
                    'type': 'auth_success',
                    'message': 'Login successful'
                }))
                authenticated = True
                clients[websocket] = username
                print(f"[{datetime.now().strftime('%H:%M:%S')}] User logged in: {username}")
            
            else:
                await websocket.send_str(json.dumps({
                    'type': 'auth_error',
                    'message': 'Invalid authentication request'
                }))
        
        # Send user data to authenticated client
        user_servers = []
        for server_id, server_data in servers.items():
            if username in server_data['members']:
                server_info = {
                    'id': server_id,
                    'name': server_data['name'],
                    'owner': server_data['owner'],
                    'channels': [
                        {'id': ch_id, 'name': ch_data['name'], 'type': ch_data.get('type', 'text')}
                        for ch_id, ch_data in server_data['channels'].items()
                    ]
                }
                # Add permissions if user is not owner
                if username != server_data['owner']:
                    server_info['permissions'] = server_data.get('permissions', {}).get(username, get_default_permissions())
                user_servers.append(server_info)
        
        user_dms = []
        for dm_id, dm_data in direct_messages.items():
            if username in dm_data['participants']:
                other_user = list(dm_data['participants'] - {username})[0]
                user_dms.append({
                    'id': dm_id,
                    'username': other_user
                })
        
        user_data = json.dumps({
            'type': 'init',
            'username': username,
            'servers': user_servers,
            'dms': user_dms,
            'friends': list(users[username]['friends'])
        })
        await websocket.send_str(user_data)
        
        # Deprecated: Send old message history for backward compatibility
        if messages:
            history_message = json.dumps({
                'type': 'history',
                'messages': messages[-MAX_HISTORY:]
            })
            await websocket.send_str(history_message)
        
        # Notify others about new user joining
        join_message = json.dumps({
            'type': 'system',
            'content': f'{username} joined the chat',
            'timestamp': datetime.now().isoformat()
        })
        await broadcast(join_message, exclude=websocket)
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} joined chat")
        
        # Handle messages from this client
        async for msg in websocket:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                    
                    if data.get('type') == 'message':
                        msg_content = data.get('content', '')
                        context = data.get('context', 'global')  # 'global', 'server', or 'dm'
                        context_id = data.get('context_id', None)
                        
                        # Create message object
                        msg_obj = {
                            'type': 'message',
                            'username': username,
                            'content': msg_content,
                            'timestamp': datetime.now().isoformat(),
                            'context': context,
                            'context_id': context_id
                        }
                        
                        # Route message based on context
                        if context == 'server' and context_id:
                            # Server channel message
                            if '/' in context_id:
                                server_id, channel_id = context_id.split('/', 1)
                                if server_id in servers and channel_id in servers[server_id]['channels']:
                                    if username in servers[server_id]['members']:
                                        # Store in channel history
                                        servers[server_id]['channels'][channel_id]['messages'].append(msg_obj)
                                        if len(servers[server_id]['channels'][channel_id]['messages']) > MAX_HISTORY:
                                            servers[server_id]['channels'][channel_id]['messages'].pop(0)
                                        
                                        # Broadcast to server members
                                        await broadcast_to_server(server_id, json.dumps(msg_obj))
                                        print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} in {server_id}/{channel_id}: {msg_content}")
                        
                        elif context == 'dm' and context_id:
                            # Direct message
                            if context_id in direct_messages:
                                if username in direct_messages[context_id]['participants']:
                                    # Store in DM history
                                    direct_messages[context_id]['messages'].append(msg_obj)
                                    if len(direct_messages[context_id]['messages']) > MAX_HISTORY:
                                        direct_messages[context_id]['messages'].pop(0)
                                    
                                    # Send to both participants
                                    for participant in direct_messages[context_id]['participants']:
                                        await send_to_user(participant, json.dumps(msg_obj))
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] DM {username}: {msg_content}")
                        
                        else:
                            # Global chat (backward compatibility)
                            messages.append(msg_obj)
                            if len(messages) > MAX_HISTORY:
                                messages.pop(0)
                            await broadcast(json.dumps(msg_obj))
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username}: {msg_content}")
                    
                    elif data.get('type') == 'create_server':
                        server_name = data.get('name', '').strip()
                        if server_name:
                            server_id = get_next_server_id()
                            channel_id = get_next_channel_id()
                            
                            servers[server_id] = {
                                'name': server_name,
                                'owner': username,
                                'members': {username},
                                'permissions': {},  # Permissions for non-owners
                                'invite_codes': {},  # Server-specific invite codes
                                'channels': {
                                    channel_id: {
                                        'name': 'general',
                                        'type': 'text',
                                        'messages': [],
                                        'voice_members': set()
                                    }
                                }
                            }
                            
                            await websocket.send_str(json.dumps({
                                'type': 'server_created',
                                'server': {
                                    'id': server_id,
                                    'name': server_name,
                                    'owner': username,
                                    'channels': [{'id': channel_id, 'name': 'general', 'type': 'text'}]
                                }
                            }))
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} created server: {server_name}")
                    
                    elif data.get('type') == 'join_server':
                        server_id = data.get('server_id', '')
                        if server_id in servers:
                            servers[server_id]['members'].add(username)
                            
                            await websocket.send_str(json.dumps({
                                'type': 'server_joined',
                                'server': {
                                    'id': server_id,
                                    'name': servers[server_id]['name'],
                                    'owner': servers[server_id]['owner'],
                                    'channels': [
                                        {'id': ch_id, 'name': ch_data['name'], 'type': ch_data.get('type', 'text')}
                                        for ch_id, ch_data in servers[server_id]['channels'].items()
                                    ]
                                }
                            }))
                    
                    elif data.get('type') == 'get_channel_history':
                        server_id = data.get('server_id', '')
                        channel_id = data.get('channel_id', '')
                        
                        if server_id in servers and channel_id in servers[server_id]['channels']:
                            if username in servers[server_id]['members']:
                                channel_messages = servers[server_id]['channels'][channel_id]['messages']
                                await websocket.send_str(json.dumps({
                                    'type': 'channel_history',
                                    'server_id': server_id,
                                    'channel_id': channel_id,
                                    'messages': channel_messages[-MAX_HISTORY:]
                                }))
                    
                    elif data.get('type') == 'get_dm_history':
                        dm_id = data.get('dm_id', '')
                        
                        if dm_id in direct_messages:
                            if username in direct_messages[dm_id]['participants']:
                                dm_messages = direct_messages[dm_id]['messages']
                                await websocket.send_str(json.dumps({
                                    'type': 'dm_history',
                                    'dm_id': dm_id,
                                    'messages': dm_messages[-MAX_HISTORY:]
                                }))
                    
                    elif data.get('type') == 'search_users':
                        query = data.get('query', '').strip().lower()
                        results = []
                        if query:
                            for user in users.keys():
                                if query in user.lower() and user != username:
                                    results.append({
                                        'username': user,
                                        'is_friend': user in users[username]['friends']
                                    })
                        
                        await websocket.send_str(json.dumps({
                            'type': 'search_results',
                            'results': results[:20]  # Limit to 20 results
                        }))
                    
                    elif data.get('type') == 'add_friend':
                        friend_username = data.get('username', '').strip()
                        
                        if friend_username in users and friend_username != username:
                            users[username]['friends'].add(friend_username)
                            users[friend_username]['friends'].add(username)
                            
                            await websocket.send_str(json.dumps({
                                'type': 'friend_added',
                                'username': friend_username
                            }))
                            
                            # Notify the other user
                            await send_to_user(friend_username, json.dumps({
                                'type': 'friend_added',
                                'username': username
                            }))
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} added {friend_username} as friend")
                    
                    elif data.get('type') == 'remove_friend':
                        friend_username = data.get('username', '').strip()
                        
                        if friend_username in users[username]['friends']:
                            users[username]['friends'].discard(friend_username)
                            users[friend_username]['friends'].discard(username)
                            
                            await websocket.send_str(json.dumps({
                                'type': 'friend_removed',
                                'username': friend_username
                            }))
                    
                    elif data.get('type') == 'start_dm':
                        friend_username = data.get('username', '').strip()
                        
                        if friend_username in users and friend_username in users[username]['friends']:
                            dm_id = get_or_create_dm(username, friend_username)
                            
                            dm_info = {
                                'type': 'dm_started',
                                'dm': {
                                    'id': dm_id,
                                    'username': friend_username
                                }
                            }
                            await websocket.send_str(json.dumps(dm_info))
                            
                            # Notify the other user
                            await send_to_user(friend_username, json.dumps({
                                'type': 'dm_started',
                                'dm': {
                                    'id': dm_id,
                                    'username': username
                                }
                            }))
                    
                    elif data.get('type') == 'generate_invite':
                        # Generate a new invite code
                        invite_code = generate_invite_code()
                        invite_codes[invite_code] = username
                        
                        await websocket.send_str(json.dumps({
                            'type': 'invite_code',
                            'code': invite_code,
                            'message': f'Invite code generated: {invite_code}'
                        }))
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} generated invite code: {invite_code}")
                    
                    # Server settings handlers
                    elif data.get('type') == 'rename_server':
                        server_id = data.get('server_id', '')
                        new_name = data.get('name', '').strip()
                        
                        if server_id in servers and new_name:
                            if username == servers[server_id]['owner']:
                                old_name = servers[server_id]['name']
                                servers[server_id]['name'] = new_name
                                
                                # Notify all server members
                                await broadcast_to_server(server_id, json.dumps({
                                    'type': 'server_renamed',
                                    'server_id': server_id,
                                    'name': new_name
                                }))
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} renamed server {old_name} to {new_name}")
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Only the server owner can rename the server'
                                }))
                    
                    elif data.get('type') == 'generate_server_invite':
                        server_id = data.get('server_id', '')
                        
                        if server_id in servers:
                            if username in servers[server_id]['members']:
                                invite_code = generate_invite_code()
                                servers[server_id]['invite_codes'][invite_code] = username
                                
                                await websocket.send_str(json.dumps({
                                    'type': 'server_invite_code',
                                    'server_id': server_id,
                                    'code': invite_code,
                                    'message': f'Server invite code generated: {invite_code}'
                                }))
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} generated invite for server {server_id}: {invite_code}")
                    
                    elif data.get('type') == 'join_server_with_invite':
                        invite_code = data.get('invite_code', '').strip()
                        
                        # Find server with this invite code
                        for server_id, server_data in servers.items():
                            if invite_code in server_data.get('invite_codes', {}):
                                if username not in server_data['members']:
                                    server_data['members'].add(username)
                                    
                                    # Initialize default permissions (none)
                                    if 'permissions' not in server_data:
                                        server_data['permissions'] = {}
                                    server_data['permissions'][username] = get_default_permissions()
                                    
                                    # Remove used invite code
                                    del server_data['invite_codes'][invite_code]
                                    
                                    await websocket.send_str(json.dumps({
                                        'type': 'server_joined',
                                        'server': {
                                            'id': server_id,
                                            'name': server_data['name'],
                                            'owner': server_data['owner'],
                                            'channels': [
                                                {'id': ch_id, 'name': ch_data['name'], 'type': ch_data.get('type', 'text')}
                                                for ch_id, ch_data in server_data['channels'].items()
                                            ]
                                        }
                                    }))
                                    
                                    # Notify other server members
                                    await broadcast_to_server(server_id, json.dumps({
                                        'type': 'member_joined',
                                        'server_id': server_id,
                                        'username': username
                                    }), exclude=websocket)
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} joined server {server_id} via invite")
                                    break
                                else:
                                    await websocket.send_str(json.dumps({
                                        'type': 'error',
                                        'message': 'You are already a member of this server'
                                    }))
                                    break
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid server invite code'
                            }))
                    
                    elif data.get('type') == 'update_user_permissions':
                        server_id = data.get('server_id', '')
                        target_username = data.get('username', '')
                        permissions = data.get('permissions', {})
                        
                        if server_id in servers and target_username:
                            if username == servers[server_id]['owner']:
                                if target_username in servers[server_id]['members'] and target_username != servers[server_id]['owner']:
                                    # Update permissions
                                    if 'permissions' not in servers[server_id]:
                                        servers[server_id]['permissions'] = {}
                                    servers[server_id]['permissions'][target_username] = {
                                        'can_create_channel': permissions.get('can_create_channel', False),
                                        'can_edit_channel': permissions.get('can_edit_channel', False),
                                        'can_delete_channel': permissions.get('can_delete_channel', False)
                                    }
                                    
                                    # Notify the user whose permissions were updated
                                    await send_to_user(target_username, json.dumps({
                                        'type': 'permissions_updated',
                                        'server_id': server_id,
                                        'permissions': servers[server_id]['permissions'][target_username]
                                    }))
                                    
                                    # Confirm to the owner
                                    await websocket.send_str(json.dumps({
                                        'type': 'permissions_updated_success',
                                        'server_id': server_id,
                                        'username': target_username,
                                        'permissions': servers[server_id]['permissions'][target_username]
                                    }))
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} updated permissions for {target_username} in server {server_id}")
                                else:
                                    await websocket.send_str(json.dumps({
                                        'type': 'error',
                                        'message': 'Cannot update permissions for this user'
                                    }))
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Only the server owner can update permissions'
                                }))
                    
                    elif data.get('type') == 'get_server_members':
                        server_id = data.get('server_id', '')
                        
                        if server_id in servers:
                            if username in servers[server_id]['members']:
                                members = []
                                for member in servers[server_id]['members']:
                                    member_data = {
                                        'username': member,
                                        'is_owner': member == servers[server_id]['owner']
                                    }
                                    if member != servers[server_id]['owner']:
                                        member_data['permissions'] = servers[server_id].get('permissions', {}).get(member, get_default_permissions())
                                    members.append(member_data)
                                
                                await websocket.send_str(json.dumps({
                                    'type': 'server_members',
                                    'server_id': server_id,
                                    'members': members
                                }))
                    
                    # Voice chat handlers
                    elif data.get('type') == 'create_voice_channel':
                        server_id = data.get('server_id', '')
                        channel_name = data.get('name', '').strip()
                        
                        if server_id in servers and channel_name:
                            if has_permission(server_id, username, 'can_create_channel'):
                                channel_id = get_next_channel_id()
                                servers[server_id]['channels'][channel_id] = {
                                    'name': channel_name,
                                    'type': 'voice',
                                    'messages': [],
                                    'voice_members': set()
                                }
                                
                                # Notify all server members
                                channel_info = json.dumps({
                                    'type': 'voice_channel_created',
                                    'server_id': server_id,
                                    'channel': {'id': channel_id, 'name': channel_name, 'type': 'voice'}
                                })
                                await broadcast_to_server(server_id, channel_info)
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} created voice channel: {channel_name}")
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'You do not have permission to create channels'
                                }))
                    
                    elif data.get('type') == 'join_voice_channel':
                        server_id = data.get('server_id', '')
                        channel_id = data.get('channel_id', '')
                        
                        if server_id in servers and channel_id in servers[server_id]['channels']:
                            if username in servers[server_id]['members']:
                                # Add to voice channel
                                servers[server_id]['channels'][channel_id]['voice_members'].add(username)
                                voice_states[username] = {
                                    'in_voice': True,
                                    'channel_id': channel_id,
                                    'server_id': server_id,
                                    'muted': False
                                }
                                
                                # Get current voice members
                                voice_members = list(servers[server_id]['channels'][channel_id]['voice_members'])
                                
                                # Notify all server members about voice state change
                                await broadcast_to_server(server_id, json.dumps({
                                    'type': 'voice_state_update',
                                    'server_id': server_id,
                                    'channel_id': channel_id,
                                    'username': username,
                                    'state': 'joined',
                                    'voice_members': voice_members
                                }))
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} joined voice channel {channel_id}")
                    
                    elif data.get('type') == 'leave_voice_channel':
                        if username in voice_states:
                            state = voice_states[username]
                            server_id = state.get('server_id')
                            channel_id = state.get('channel_id')
                            
                            if server_id and channel_id:
                                if server_id in servers and channel_id in servers[server_id]['channels']:
                                    servers[server_id]['channels'][channel_id]['voice_members'].discard(username)
                                    voice_members = list(servers[server_id]['channels'][channel_id]['voice_members'])
                                    
                                    # Notify all server members
                                    await broadcast_to_server(server_id, json.dumps({
                                        'type': 'voice_state_update',
                                        'server_id': server_id,
                                        'channel_id': channel_id,
                                        'username': username,
                                        'state': 'left',
                                        'voice_members': voice_members
                                    }))
                            
                            del voice_states[username]
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} left voice channel")
                    
                    elif data.get('type') == 'voice_mute':
                        muted = data.get('muted', False)
                        if username in voice_states:
                            voice_states[username]['muted'] = muted
                            state = voice_states[username]
                            
                            # Notify others in the same voice channel
                            if state.get('server_id') and state.get('channel_id'):
                                await broadcast_to_server(state['server_id'], json.dumps({
                                    'type': 'voice_mute_update',
                                    'username': username,
                                    'muted': muted
                                }))
                    
                    # WebRTC signaling
                    elif data.get('type') == 'webrtc_offer':
                        target_user = data.get('target')
                        offer = data.get('offer')
                        context = data.get('context', {})
                        
                        if target_user:
                            await send_to_user(target_user, json.dumps({
                                'type': 'webrtc_offer',
                                'from': username,
                                'offer': offer,
                                'context': context
                            }))
                    
                    elif data.get('type') == 'webrtc_answer':
                        target_user = data.get('target')
                        answer = data.get('answer')
                        
                        if target_user:
                            await send_to_user(target_user, json.dumps({
                                'type': 'webrtc_answer',
                                'from': username,
                                'answer': answer
                            }))
                    
                    elif data.get('type') == 'webrtc_ice_candidate':
                        target_user = data.get('target')
                        candidate = data.get('candidate')
                        
                        if target_user:
                            await send_to_user(target_user, json.dumps({
                                'type': 'webrtc_ice_candidate',
                                'from': username,
                                'candidate': candidate
                            }))
                    
                    elif data.get('type') == 'start_voice_call':
                        # Direct voice call with a friend
                        friend_username = data.get('username', '').strip()
                        
                        # Verify mutual friendship
                        if friend_username in users and friend_username in users[username]['friends'] and username in users[friend_username]['friends']:
                            # Notify the friend about incoming call
                            await send_to_user(friend_username, json.dumps({
                                'type': 'incoming_voice_call',
                                'from': username
                            }))
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} calling {friend_username}")
                    
                    elif data.get('type') == 'accept_voice_call':
                        caller_username = data.get('from', '').strip()
                        
                        if caller_username in users:
                            await send_to_user(caller_username, json.dumps({
                                'type': 'voice_call_accepted',
                                'from': username
                            }))
                    
                    elif data.get('type') == 'reject_voice_call':
                        caller_username = data.get('from', '').strip()
                        
                        if caller_username in users:
                            await send_to_user(caller_username, json.dumps({
                                'type': 'voice_call_rejected',
                                'from': username
                            }))
                        
                except json.JSONDecodeError:
                    print("Invalid JSON received")
                except Exception as e:
                    print(f"Error processing message: {e}")
                    import traceback
                    traceback.print_exc()
            elif msg.type == web.WSMsgType.ERROR:
                print(f'WebSocket connection closed with exception {websocket.exception()}')
                break
                
    except Exception as e:
        print(f"Error in handler: {e}")
    finally:
        # Unregister client
        if websocket in clients:
            del clients[websocket]
        
        if username and authenticated:
            # Clean up voice state
            if username in voice_states:
                state = voice_states[username]
                server_id = state.get('server_id')
                channel_id = state.get('channel_id')
                
                if server_id and channel_id:
                    if server_id in servers and channel_id in servers[server_id]['channels']:
                        servers[server_id]['channels'][channel_id]['voice_members'].discard(username)
                        voice_members = list(servers[server_id]['channels'][channel_id]['voice_members'])
                        
                        # Notify all server members
                        await broadcast_to_server(server_id, json.dumps({
                            'type': 'voice_state_update',
                            'server_id': server_id,
                            'channel_id': channel_id,
                            'username': username,
                            'state': 'left',
                            'voice_members': voice_members
                        }))
                
                del voice_states[username]
            
            # Notify others about user leaving
            leave_message = json.dumps({
                'type': 'system',
                'content': f'{username} left the chat',
                'timestamp': datetime.now().isoformat()
            })
            await broadcast(leave_message)
            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} left")


async def http_handler(request):
    """Handle HTTP requests and serve static files."""
    path = request.path
    
    # Redirect root to index.html
    if path == '/':
        raise web.HTTPFound('/static/index.html')
    
    # Serve static files
    if path.startswith('/static/'):
        file_path = path[8:]  # Remove '/static/' prefix
        static_dir = os.path.join(os.path.dirname(__file__), 'static')
        full_path = os.path.join(static_dir, file_path)
        
        # Security check: ensure the path is within static directory
        real_path = os.path.realpath(full_path)
        real_static = os.path.realpath(static_dir)
        if not real_path.startswith(real_static):
            raise web.HTTPNotFound()
        
        if os.path.isfile(full_path):
            # Determine content type
            content_type = 'text/html'
            if full_path.endswith('.css'):
                content_type = 'text/css'
            elif full_path.endswith('.js'):
                content_type = 'application/javascript'
            elif full_path.endswith('.json'):
                content_type = 'application/json'
            
            with open(full_path, 'r', encoding='utf-8') as f:
                content = f.read()
            return web.Response(text=content, content_type=content_type)
    
    raise web.HTTPNotFound()


async def websocket_handler(request):
    """Handle WebSocket upgrade requests."""
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    
    # Use the existing handler logic
    await handler(ws)
    
    return ws


async def main():
    """Start the HTTP and WebSocket server."""
    print("Decentra Chat Server")
    print("=" * 50)
    print("Starting HTTP server on http://0.0.0.0:8765")
    print("Starting WebSocket server on ws://0.0.0.0:8765")
    print("=" * 50)
    
    # Create aiohttp application
    app = web.Application()
    app.router.add_get('/', http_handler)
    app.router.add_get('/static/{path:.*}', http_handler)
    app.router.add_get('/ws', websocket_handler)
    
    # Run the server
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', 8765)
    await site.start()
    
    print("Server started successfully!")
    print("Access the web client at http://localhost:8765")
    
    # Keep running
    await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
