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
import base64
import hashlib
from database import Database
from api import setup_api_routes

# Initialize database
db = Database()

# Store connected clients: {websocket: username}
clients = {}
# Store message history (deprecated - now per server/channel)
messages = []
MAX_HISTORY = 100
MAX_AVATAR_SIZE = 2 * 1024 * 1024  # 2MB

# Runtime-only data structures (not persisted)
# Store voice calls: {call_id: {participants: set(), type: 'direct'|'channel', server_id: str, channel_id: str}}
voice_calls = {}
# Store voice state: {username: {in_voice: bool, channel_id: str, server_id: str, muted: bool, video: bool, screen_sharing: bool}}
voice_states = {}
# Store voice members per channel: {server_id/channel_id: set(usernames)}
voice_members = {}

# Helper counters for IDs (load from database on startup)
server_counter = 0
channel_counter = 0
dm_counter = 0
role_counter = 0


def hash_password(password):
    """Hash a password using bcrypt."""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def serialize_role(role):
    """Serialize a role dict for JSON transmission, converting datetime to string."""
    if not role:
        return None
    serialized = role.copy()
    if 'created_at' in serialized and serialized['created_at']:
        serialized['created_at'] = serialized['created_at'].isoformat()
    return serialized


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


def get_next_role_id():
    """Get next role ID."""
    global role_counter
    role_counter += 1
    return f"role_{role_counter}"


def get_next_dm_id():
    """Get next DM ID."""
    global dm_counter
    dm_counter += 1
    return f"dm_{dm_counter}"


def init_counters_from_db():
    """Initialize ID counters from database."""
    global server_counter, channel_counter, dm_counter, role_counter
    
    # Get highest server ID
    servers = db.get_all_servers()
    if servers:
        max_server = max([int(s['server_id'].split('_')[1]) for s in servers] + [0])
        server_counter = max_server
    
    # Get highest channel ID
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT channel_id FROM channels')
        channel_ids = [row['channel_id'] for row in cursor.fetchall()]
        if channel_ids:
            max_channel = max([int(c.split('_')[1]) for c in channel_ids] + [0])
            channel_counter = max_channel
    
    # Get highest DM ID
    dms = db.get_user_dms('')  # Empty string won't match, but we get all DMs
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT dm_id FROM direct_messages')
        dm_ids = [row['dm_id'] for row in cursor.fetchall()]
        if dm_ids:
            max_dm = max([int(d.split('_')[1]) for d in dm_ids] + [0])
            dm_counter = max_dm
    
    # Get highest role ID
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT role_id FROM server_roles')
        role_ids = [row['role_id'] for row in cursor.fetchall()]
        if role_ids:
            # Handle both formats: "role_1" and "role_server_1_server_2"
            max_role = 0
            for rid in role_ids:
                parts = rid.split('_')
                # If it's the new format "role_N", get the number
                if len(parts) == 2 and parts[1].isdigit():
                    max_role = max(max_role, int(parts[1]))
                # If it's the old format "role_server_X_server_Y", get the last number
                elif len(parts) > 2 and parts[-1].isdigit():
                    max_role = max(max_role, int(parts[-1]))
            role_counter = max_role


def get_next_call_id():
    """Get next voice call ID."""
    return f"call_{random.randint(100000, 999999)}"


def get_or_create_dm(user1, user2):
    """Get existing DM or create new one between two users."""
    # Check if DM exists in database
    dm_id = db.get_dm(user1, user2)
    if dm_id:
        return dm_id
    
    # Create new DM
    dm_id = get_next_dm_id()
    db.create_dm(dm_id, user1, user2)
    return dm_id


def get_avatar_data(username):
    """Get avatar data for a user."""
    user = db.get_user(username)
    if not user:
        return {'avatar': '👤', 'avatar_type': 'emoji', 'avatar_data': None}
    
    return {
        'avatar': user.get('avatar', '👤'),
        'avatar_type': user.get('avatar_type', 'emoji'),
        'avatar_data': user.get('avatar_data', None)
    }


def has_permission(server_id, username, permission):
    """Check if user has specific permission in a server through roles.
    Owner always has all permissions.
    Permission can be: 'create_invite', 'create_channel', 'create_voice_channel', 
                       'delete_messages', 'edit_messages', 'send_files', 'access_settings'
    """
    server = db.get_server(server_id)
    if not server:
        return False
    
    # Owner has all permissions
    if server['owner'] == username:
        return True
    
    # Check user's roles for the permission
    user_roles = db.get_user_roles(server_id, username)
    for role in user_roles:
        # Check if role has the requested permission
        if role.get('permissions', {}).get(permission, False):
            return True
    
    # Legacy: Check old permission system for backward compatibility
    if permission in ['can_create_channel', 'can_edit_channel', 'can_delete_channel']:
        members = db.get_server_members(server_id)
        for member in members:
            if member['username'] == username:
                return member.get(permission, False)
    
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
    server_members_data = db.get_server_members(server_id)
    server_members = {m['username'] for m in server_members_data}
    
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
                
                # Get admin settings
                admin_settings = db.get_admin_settings()
                allow_registration = admin_settings.get('allow_registration', True)
                require_invite = admin_settings.get('require_invite', False)
                
                # Check if registration is disabled
                if not allow_registration:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Registration is currently disabled'
                    }))
                    continue
                
                # Validation
                if not username or not password:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Username and password are required'
                    }))
                    continue
                
                if db.get_user(username):
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Username already exists'
                    }))
                    continue
                
                # Check invite code requirement
                all_users = db.get_all_users()
                invite_data = db.get_invite_code(invite_code) if invite_code else None
                
                # Require invite if admin setting is enabled OR if users already exist (legacy behavior)
                if (require_invite or all_users) and not invite_data:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Valid invite code required'
                    }))
                    continue
                
                # Create user account in database
                if not db.create_user(username, hash_password(password)):
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Failed to create account'
                    }))
                    continue
                
                # Auto-friend inviter if signing up with invite code
                inviter_username = None
                if invite_data:
                    inviter_username = invite_data['creator']
                    # Add mutual friendship
                    db.add_friend_request(inviter_username, username)
                    db.accept_friend_request(inviter_username, username)
                    # Remove used invite code
                    db.delete_invite_code(invite_code)
                
                await websocket.send_str(json.dumps({
                    'type': 'auth_success',
                    'message': 'Account created successfully'
                }))
                authenticated = True
                clients[websocket] = username
                print(f"[{datetime.now().strftime('%H:%M:%S')}] New user registered: {username}")
                
                # Notify inviter that they are now friends
                if inviter_username:
                    new_user_avatar = get_avatar_data(username)
                    await send_to_user(inviter_username, json.dumps({
                        'type': 'friend_added',
                        'username': username,
                        **new_user_avatar
                    }))
            
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
                
                user = db.get_user(username)
                if not user:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Invalid username or password'
                    }))
                    continue
                
                if not verify_password(password, user['password_hash']):
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
        user_server_ids = db.get_user_servers(username)
        for server_id in user_server_ids:
            server_data = db.get_server(server_id)
            if server_data:
                channels = db.get_server_channels(server_id)
                server_info = {
                    'id': server_id,
                    'name': server_data['name'],
                    'owner': server_data['owner'],
                    'channels': [
                        {'id': ch['channel_id'], 'name': ch['name'], 'type': ch.get('type', 'text')}
                        for ch in channels
                    ]
                }
                # Add permissions if user is not owner
                if username != server_data['owner']:
                    members = db.get_server_members(server_id)
                    for member in members:
                        if member['username'] == username:
                            server_info['permissions'] = {
                                'can_create_channel': member.get('can_create_channel', False),
                                'can_edit_channel': member.get('can_edit_channel', False),
                                'can_delete_channel': member.get('can_delete_channel', False)
                            }
                            break
                user_servers.append(server_info)
        
        user_dms = []
        dm_list = db.get_user_dms(username)
        for dm in dm_list:
            other_user = dm['user2'] if dm['user1'] == username else dm['user1']
            avatar_data = get_avatar_data(other_user)
            user_dms.append({
                'id': dm['dm_id'],
                'username': other_user,
                **avatar_data
            })
        
        # Build friends list with avatars
        friends_list = []
        for friend in db.get_friends(username):
            avatar_data = get_avatar_data(friend)
            friends_list.append({
                'username': friend,
                **avatar_data
            })
        
        # Build friend requests lists
        friend_requests_sent = []
        for requested_user in db.get_friend_requests_sent(username):
            avatar_data = get_avatar_data(requested_user)
            friend_requests_sent.append({
                'username': requested_user,
                **avatar_data
            })
        
        friend_requests_received = []
        for requester_user in db.get_friend_requests_received(username):
            avatar_data = get_avatar_data(requester_user)
            friend_requests_received.append({
                'username': requester_user,
                **avatar_data
            })
        
        current_avatar = get_avatar_data(username)
        user = db.get_user(username)
        notification_mode = user.get('notification_mode', 'all') if user else 'all'
        user_data = json.dumps({
            'type': 'init',
            'username': username,
            **current_avatar,
            'notification_mode': notification_mode,
            'servers': user_servers,
            'dms': user_dms,
            'friends': friends_list,
            'friend_requests_sent': friend_requests_sent,
            'friend_requests_received': friend_requests_received
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
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Received message type: {data.get('type')}", flush=True)
                    
                    if data.get('type') == 'message':
                        msg_content = data.get('content', '')
                        context = data.get('context', 'global')  # 'global', 'server', or 'dm'
                        context_id = data.get('context_id', None)
                        
                        # Get admin settings and enforce max message length
                        admin_settings = db.get_admin_settings()
                        max_length = admin_settings.get('max_message_length', 2000)
                        
                        if len(msg_content) > max_length:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': f'Message exceeds maximum length of {max_length} characters'
                            }))
                            continue
                        
                        # Create message object
                        user_profile = db.get_user(username)
                        msg_obj = {
                            'type': 'message',
                            'username': username,
                            'content': msg_content,
                            'timestamp': datetime.now().isoformat(),
                            'context': context,
                            'context_id': context_id,
                            'avatar': user_profile.get('avatar', '👤') if user_profile else '👤',
                            'avatar_type': user_profile.get('avatar_type', 'emoji') if user_profile else 'emoji',
                            'avatar_data': user_profile.get('avatar_data') if user_profile else None
                        }
                        
                        # Route message based on context
                        if context == 'server' and context_id:
                            # Server channel message
                            if '/' in context_id:
                                server_id, channel_id = context_id.split('/', 1)
                                # Verify server and channel exist and user is member
                                server = db.get_server(server_id)
                                if server:
                                    members = db.get_server_members(server_id)
                                    member_usernames = {m['username'] for m in members}
                                    if username in member_usernames:
                                        # Save message to database
                                        db.save_message(username, msg_content, 'server', context_id)
                                        
                                        # Broadcast to server members
                                        await broadcast_to_server(server_id, json.dumps(msg_obj))
                                        print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} in {server_id}/{channel_id}: {msg_content}")
                        
                        elif context == 'dm' and context_id:
                            # Direct message - verify DM exists and user is participant
                            dm_users = db.get_user_dms(username)
                            dm_ids = [dm['dm_id'] for dm in dm_users]
                            if context_id in dm_ids:
                                # Save message to database
                                db.save_message(username, msg_content, 'dm', context_id)
                                
                                # Get participants and send to both
                                for dm in dm_users:
                                    if dm['dm_id'] == context_id:
                                        participants = [dm['user1'], dm['user2']]
                                        for participant in participants:
                                            await send_to_user(participant, json.dumps(msg_obj))
                                        break
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
                            # Get admin settings for server limits
                            admin_settings = db.get_admin_settings()
                            max_servers_per_user = admin_settings.get('max_servers_per_user', 100)
                            
                            # Check if user has reached server limit (0 = unlimited)
                            if max_servers_per_user > 0:
                                user_servers = db.get_user_servers(username)
                                if len(user_servers) >= max_servers_per_user:
                                    await websocket.send_str(json.dumps({
                                        'type': 'error',
                                        'message': f'Maximum servers per user ({max_servers_per_user}) reached'
                                    }))
                                    continue
                            
                            server_id = get_next_server_id()
                            channel_id = get_next_channel_id()
                            
                            # Create server in database
                            db.create_server(server_id, server_name, username)
                            # Create default general channel
                            db.create_channel(channel_id, server_id, 'general', 'text')
                            
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
                        
                        # Verify user is member of server
                        members = db.get_server_members(server_id)
                        member_usernames = {m['username'] for m in members}
                        if username in member_usernames:
                            # Get messages from database
                            context_id = f"{server_id}/{channel_id}"
                            channel_messages = db.get_messages('server', context_id, MAX_HISTORY)
                            await websocket.send_str(json.dumps({
                                'type': 'channel_history',
                                'server_id': server_id,
                                'channel_id': channel_id,
                                'messages': channel_messages
                            }))
                    
                    elif data.get('type') == 'get_dm_history':
                        dm_id = data.get('dm_id', '')
                        
                        # Verify user is participant in DM
                        user_dms = db.get_user_dms(username)
                        dm_ids = [dm['dm_id'] for dm in user_dms]
                        if dm_id in dm_ids:
                            # Get messages from database
                            dm_messages = db.get_messages('dm', dm_id, MAX_HISTORY)
                            await websocket.send_str(json.dumps({
                                'type': 'dm_history',
                                'dm_id': dm_id,
                                'messages': dm_messages
                            }))
                    
                    elif data.get('type') == 'search_users':
                        query = data.get('query', '').strip().lower()
                        results = []
                        if query:
                            all_users = db.get_all_users()
                            friends = set(db.get_friends(username))
                            requests_sent = set(db.get_friend_requests_sent(username))
                            requests_received = set(db.get_friend_requests_received(username))
                            
                            for user in all_users:
                                if query in user.lower() and user != username:
                                    avatar_data = get_avatar_data(user)
                                    results.append({
                                        'username': user,
                                        'is_friend': user in users[username]['friends'],
                                        'request_sent': user in users[username].get('friend_requests_sent', set()),
                                        'request_received': user in users[username].get('friend_requests_received', set()),
                                        **avatar_data
                                    })
                        
                        await websocket.send_str(json.dumps({
                            'type': 'search_results',
                            'results': results[:20]  # Limit to 20 results
                        }))
                    
                    elif data.get('type') == 'add_friend':
                        # Send friend request
                        friend_username = data.get('username', '').strip()
                        
                        if db.get_user(friend_username) and friend_username != username:
                            friends = set(db.get_friends(username))
                            requests_sent = set(db.get_friend_requests_sent(username))
                            requests_received = set(db.get_friend_requests_received(username))
                            
                            # Check if already friends
                            if friend_username in friends:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Already friends with this user'
                                }))
                            # Check if request already sent
                            elif friend_username in requests_sent:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Friend request already sent'
                                }))
                            # Check if they already sent you a request (auto-accept in this case)
                            elif friend_username in requests_received:
                                # Auto-accept their pending request
                                db.accept_friend_request(friend_username, username)
                                
                                friend_avatar = get_avatar_data(friend_username)
                                await websocket.send_str(json.dumps({
                                    'type': 'friend_added',
                                    'username': friend_username,
                                    **friend_avatar
                                }))
                                
                                # Notify the other user
                                user_avatar = get_avatar_data(username)
                                await send_to_user(friend_username, json.dumps({
                                    'type': 'friend_added',
                                    'username': username,
                                    **user_avatar
                                }))
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} and {friend_username} are now friends (mutual request)")
                            else:
                                # Send friend request
                                db.add_friend_request(username, friend_username)
                                
                                friend_avatar = get_avatar_data(friend_username)
                                await websocket.send_str(json.dumps({
                                    'type': 'friend_request_sent',
                                    'username': friend_username,
                                    **friend_avatar
                                }))
                                
                                # Notify the other user
                                user_avatar = get_avatar_data(username)
                                await send_to_user(friend_username, json.dumps({
                                    'type': 'friend_request_received',
                                    'username': username,
                                    **user_avatar
                                }))
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} sent friend request to {friend_username}")
                    
                    elif data.get('type') == 'remove_friend':
                        friend_username = data.get('username', '').strip()
                        
                        friends = set(db.get_friends(username))
                        if friend_username in friends:
                            db.remove_friendship(username, friend_username)
                            
                            await websocket.send_str(json.dumps({
                                'type': 'friend_removed',
                                'username': friend_username
                            }))
                    
                    elif data.get('type') == 'approve_friend_request':
                        # Approve a friend request
                        requester_username = data.get('username', '').strip()
                        
                        requests_received = set(db.get_friend_requests_received(username))
                        if requester_username in requests_received:
                            # Accept the request
                            db.accept_friend_request(requester_username, username)
                            
                            requester_avatar = get_avatar_data(requester_username)
                            await websocket.send_str(json.dumps({
                                'type': 'friend_request_approved',
                                'username': requester_username,
                                **requester_avatar
                            }))
                            
                            # Notify the requester
                            user_avatar = get_avatar_data(username)
                            await send_to_user(requester_username, json.dumps({
                                'type': 'friend_request_accepted',
                                'username': username,
                                **user_avatar
                            }))
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} approved friend request from {requester_username}")
                    
                    elif data.get('type') == 'deny_friend_request':
                        # Deny a friend request
                        requester_username = data.get('username', '').strip()
                        
                        requests_received = set(db.get_friend_requests_received(username))
                        if requester_username in requests_received:
                            # Remove the request
                            db.remove_friendship(requester_username, username)
                            
                            await websocket.send_str(json.dumps({
                                'type': 'friend_request_denied',
                                'username': requester_username
                            }))
                            
                            # Optionally notify the requester (not doing this for privacy)
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} denied friend request from {requester_username}")
                    
                    elif data.get('type') == 'cancel_friend_request':
                        # Cancel a sent friend request
                        friend_username = data.get('username', '').strip()
                        
                        requests_sent = set(db.get_friend_requests_sent(username))
                        if friend_username in requests_sent:
                            # Remove the request
                            db.remove_friendship(username, friend_username)
                            
                            await websocket.send_str(json.dumps({
                                'type': 'friend_request_cancelled',
                                'username': friend_username
                            }))
                            
                            # Notify the other user
                            await send_to_user(friend_username, json.dumps({
                                'type': 'friend_request_cancelled_by_sender',
                                'username': username
                            }))
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} cancelled friend request to {friend_username}")
                    
                    elif data.get('type') == 'start_dm':
                        friend_username = data.get('username', '').strip()
                        
                        friends = set(db.get_friends(username))
                        if db.get_user(friend_username) and friend_username in friends:
                            dm_id = get_or_create_dm(username, friend_username)
                            
                            friend_avatar = get_avatar_data(friend_username)
                            dm_info = {
                                'type': 'dm_started',
                                'dm': {
                                    'id': dm_id,
                                    'username': friend_username,
                                    **friend_avatar
                                }
                            }
                            await websocket.send_str(json.dumps(dm_info))
                            
                            # Notify the other user
                            user_avatar = get_avatar_data(username)
                            await send_to_user(friend_username, json.dumps({
                                'type': 'dm_started',
                                'dm': {
                                    'id': dm_id,
                                    'username': username,
                                    **user_avatar
                                }
                            }))
                    
                    elif data.get('type') == 'generate_invite':
                        # Generate a new invite code
                        invite_code = generate_invite_code()
                        db.create_invite_code(invite_code, username, 'global')
                        
                        await websocket.send_str(json.dumps({
                            'type': 'invite_code',
                            'code': invite_code,
                            'message': f'Invite code generated: {invite_code}'
                        }))
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} generated invite code: {invite_code}")
                    
                    # Admin configuration handlers
                    elif data.get('type') == 'check_admin':
                        first_user = db.get_first_user()
                        is_admin = (username == first_user)
                        
                        await websocket.send_str(json.dumps({
                            'type': 'admin_status',
                            'is_admin': is_admin,
                            'first_user': first_user
                        }))
                    
                    elif data.get('type') == 'get_admin_settings':
                        # Verify user is admin
                        first_user = db.get_first_user()
                        if username != first_user:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Access denied. Admin only.'
                            }))
                        else:
                            # Load settings from database
                            settings = db.get_admin_settings()
                            
                            await websocket.send_str(json.dumps({
                                'type': 'admin_settings',
                                'settings': settings
                            }))
                    
                    elif data.get('type') == 'save_admin_settings':
                        # Verify user is admin
                        first_user = db.get_first_user()
                        if username != first_user:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Access denied. Admin only.'
                            }))
                        else:
                            settings = data.get('settings', {})
                            # Save settings to database
                            success = db.update_admin_settings(settings)
                            
                            if success:
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] Admin {username} updated settings: {settings}")
                                await websocket.send_str(json.dumps({
                                    'type': 'settings_saved',
                                    'message': 'Settings saved successfully'
                                }))
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Failed to save settings'
                                }))
                    
                    # Server settings handlers
                    elif data.get('type') == 'rename_server':
                        server_id = data.get('server_id', '')
                        new_name = data.get('name', '').strip()
                        
                        server = db.get_server(server_id)
                        if server and new_name:
                            if has_permission(server_id, username, 'access_settings'):
                                old_name = server['name']
                                db.update_server_name(server_id, new_name)
                                
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
                                    'message': 'You do not have permission to access server settings'
                                }))
                    
                    elif data.get('type') == 'generate_server_invite':
                        server_id = data.get('server_id', '')
                        
                        # Check if user has permission to create invites
                        if has_permission(server_id, username, 'create_invite'):
                            invite_code = generate_invite_code()
                            db.create_invite_code(invite_code, username, 'server', server_id)
                            
                            await websocket.send_str(json.dumps({
                                'type': 'server_invite_code',
                                'server_id': server_id,
                                'code': invite_code,
                                'message': f'Server invite code generated: {invite_code}'
                            }))
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} generated invite for server {server_id}: {invite_code}")
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'You do not have permission to create server invites'
                            }))
                    
                    elif data.get('type') == 'join_server_with_invite':
                        invite_code = data.get('invite_code', '').strip()
                        
                        # Find server with this invite code
                        invite_data = db.get_invite_code(invite_code)
                        if invite_data and invite_data['code_type'] == 'server':
                            server_id = invite_data['server_id']
                            server = db.get_server(server_id)
                            
                            # Check if user is already a member
                            members = db.get_server_members(server_id)
                            member_usernames = {m['username'] for m in members}
                            
                            if username not in member_usernames:
                                # Get admin settings for member limits
                                admin_settings = db.get_admin_settings()
                                max_members = admin_settings.get('max_members_per_server', 1000)
                                
                                # Check if server has reached member limit (0 = unlimited)
                                if max_members > 0 and len(members) >= max_members:
                                    await websocket.send_str(json.dumps({
                                        'type': 'error',
                                        'message': f'Server has reached maximum members ({max_members})'
                                    }))
                                    continue
                                
                                # Add user to server
                                db.add_server_member(server_id, username)
                                
                                # Remove used invite code
                                db.delete_invite_code(invite_code)
                                
                                # Get channels for response
                                channels = db.get_server_channels(server_id)
                                await websocket.send_str(json.dumps({
                                    'type': 'server_joined',
                                    'server': {
                                        'id': server_id,
                                        'name': server['name'],
                                        'owner': server['owner'],
                                        'channels': [
                                            {'id': ch['channel_id'], 'name': ch['name'], 'type': ch.get('type', 'text')}
                                            for ch in channels
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
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'You are already a member of this server'
                                }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid server invite code'
                            }))
                    
                    elif data.get('type') == 'update_user_permissions':
                        server_id = data.get('server_id', '')
                        target_username = data.get('username', '')
                        permissions = data.get('permissions', {})
                        
                        server = db.get_server(server_id)
                        if server and target_username:
                            if username == server['owner']:
                                # Verify target user is a member
                                members = db.get_server_members(server_id)
                                member_usernames = {m['username'] for m in members}
                                
                                if target_username in member_usernames and target_username != server['owner']:
                                    # Update permissions in database
                                    db.update_member_permissions(server_id, target_username, permissions)
                                    
                                    # Notify the user whose permissions were updated
                                    await send_to_user(target_username, json.dumps({
                                        'type': 'permissions_updated',
                                        'server_id': server_id,
                                        'permissions': permissions
                                    }))
                                    
                                    # Confirm to the owner
                                    await websocket.send_str(json.dumps({
                                        'type': 'permissions_updated_success',
                                        'server_id': server_id,
                                        'username': target_username,
                                        'permissions': permissions
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
                        
                        server = db.get_server(server_id)
                        if server:
                            # Verify user is a member
                            members = db.get_server_members(server_id)
                            member_usernames = {m['username'] for m in members}
                            
                            if username in member_usernames:
                                # Precompute avatar data for all members to avoid calling get_avatar_data() in the loop
                                avatar_data_map = {
                                    m['username']: get_avatar_data(m['username'])
                                    for m in members
                                }

                                members_list = []
                                for member in members:
                                    avatar_data = avatar_data_map.get(member['username'], {})
                                    member_data = {
                                        'username': member['username'],
                                        'is_owner': member['username'] == server['owner'],
                                        **avatar_data
                                    }
                                    if member['username'] != server['owner']:
                                        member_data['permissions'] = {
                                            'can_create_channel': member.get('can_create_channel', False),
                                            'can_edit_channel': member.get('can_edit_channel', False),
                                            'can_delete_channel': member.get('can_delete_channel', False)
                                        }
                                    members_list.append(member_data)
                                
                                await websocket.send_str(json.dumps({
                                    'type': 'server_members',
                                    'server_id': server_id,
                                    'members': members_list
                                }))
                    
                    # Role management handlers
                    elif data.get('type') == 'create_role':
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] Received create_role request from {username}", flush=True)
                        server_id = data.get('server_id', '')
                        role_name = data.get('name', '').strip()
                        color = data.get('color', '#99AAB5')
                        permissions = data.get('permissions', {})
                        
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] server_id={server_id}, role_name={role_name}, color={color}", flush=True)
                        
                        server = db.get_server(server_id)
                        if server and role_name:
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] Server found, checking ownership")
                            if username == server['owner']:
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] User is owner, creating role")
                                role_id = get_next_role_id()
                                
                                # Get highest position and add 1
                                existing_roles = db.get_server_roles(server_id)
                                position = max([r['position'] for r in existing_roles] + [0]) + 1
                                
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] Creating role with position {position}")
                                if db.create_role(role_id, server_id, role_name, color, position, permissions):
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Role created in DB, fetching...")
                                    role = db.get_role(role_id)
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Role fetched: {role}")
                                    
                                    # Broadcast to all server members
                                    serialized_role = serialize_role(role)
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Serialized role: {serialized_role}")
                                    await broadcast_to_server(server_id, json.dumps({
                                        'type': 'role_created',
                                        'server_id': server_id,
                                        'role': serialized_role
                                    }))
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} created role {role_name} in server {server_id}")
                                else:
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Failed to create role in DB")
                            else:
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] User {username} is not owner of server")
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Only the server owner can create roles'
                                }))
                        else:
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] Server not found or role_name empty")

                    
                    elif data.get('type') == 'update_role':
                        role_id = data.get('role_id', '')
                        role_name = data.get('name')
                        color = data.get('color')
                        permissions = data.get('permissions')
                        
                        role = db.get_role(role_id)
                        if role:
                            server = db.get_server(role['server_id'])
                            if server and username == server['owner']:
                                if db.update_role(role_id, role_name, color, None, permissions):
                                    updated_role = db.get_role(role_id)
                                    
                                    # Broadcast to all server members
                                    await broadcast_to_server(role['server_id'], json.dumps({
                                        'type': 'role_updated',
                                        'server_id': role['server_id'],
                                        'role': serialize_role(updated_role)
                                    }))
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} updated role {role_id}")
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Only the server owner can update roles'
                                }))
                    
                    elif data.get('type') == 'delete_role':
                        role_id = data.get('role_id', '')
                        
                        role = db.get_role(role_id)
                        if role:
                            server = db.get_server(role['server_id'])
                            if server and username == server['owner']:
                                if db.delete_role(role_id):
                                    # Broadcast to all server members
                                    await broadcast_to_server(role['server_id'], json.dumps({
                                        'type': 'role_deleted',
                                        'server_id': role['server_id'],
                                        'role_id': role_id
                                    }))
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} deleted role {role_id}")
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Only the server owner can delete roles'
                                }))
                    
                    elif data.get('type') == 'assign_role':
                        server_id = data.get('server_id', '')
                        target_username = data.get('username', '')
                        role_id = data.get('role_id', '')
                        
                        server = db.get_server(server_id)
                        role = db.get_role(role_id)
                        if server and role and username == server['owner']:
                            if db.assign_role(server_id, target_username, role_id):
                                # Notify the user who got the role
                                await send_to_user(target_username, json.dumps({
                                    'type': 'role_assigned',
                                    'server_id': server_id,
                                    'role': role
                                }))
                                
                                # Broadcast to server
                                await broadcast_to_server(server_id, json.dumps({
                                    'type': 'member_role_updated',
                                    'server_id': server_id,
                                    'username': target_username,
                                    'role_id': role_id,
                                    'action': 'added'
                                }))
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} assigned role {role_id} to {target_username}")
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Only the server owner can assign roles'
                            }))
                    
                    elif data.get('type') == 'remove_role_from_user':
                        server_id = data.get('server_id', '')
                        target_username = data.get('username', '')
                        role_id = data.get('role_id', '')
                        
                        server = db.get_server(server_id)
                        if server and username == server['owner']:
                            if db.remove_role_from_user(server_id, target_username, role_id):
                                # Notify the user
                                await send_to_user(target_username, json.dumps({
                                    'type': 'role_removed',
                                    'server_id': server_id,
                                    'role_id': role_id
                                }))
                                
                                # Broadcast to server
                                await broadcast_to_server(server_id, json.dumps({
                                    'type': 'member_role_updated',
                                    'server_id': server_id,
                                    'username': target_username,
                                    'role_id': role_id,
                                    'action': 'removed'
                                }))
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} removed role {role_id} from {target_username}")
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Only the server owner can remove roles'
                            }))
                    
                    elif data.get('type') == 'get_server_roles':
                        server_id = data.get('server_id', '')
                        
                        server = db.get_server(server_id)
                        if server:
                            # Verify user is a member
                            members = db.get_server_members(server_id)
                            member_usernames = {m['username'] for m in members}
                            
                            if username in member_usernames:
                                roles = db.get_server_roles(server_id)
                                await websocket.send_str(json.dumps({
                                    'type': 'server_roles',
                                    'server_id': server_id,
                                    'roles': [serialize_role(r) for r in roles]
                                }))
                    
                    elif data.get('type') == 'get_user_roles':
                        server_id = data.get('server_id', '')
                        target_username = data.get('username', username)
                        
                        server = db.get_server(server_id)
                        if server:
                            roles = db.get_user_roles(server_id, target_username)
                            await websocket.send_str(json.dumps({
                                'type': 'user_roles',
                                'server_id': server_id,
                                'username': target_username,
                                'roles': [serialize_role(r) for r in roles]
                            }))
                    
                    # Channel creation handlers
                    elif data.get('type') == 'create_channel':
                        server_id = data.get('server_id', '')
                        channel_name = data.get('name', '').strip()
                        channel_type = data.get('channel_type', 'text')  # Default to text channel
                        
                        if db.get_server(server_id) and channel_name:
                            if has_permission(server_id, username, 'create_channel'):
                                # Get admin settings for channel limits
                                admin_settings = db.get_admin_settings()
                                max_channels = admin_settings.get('max_channels_per_server', 50)
                                
                                # Check if server has reached channel limit (0 = unlimited)
                                if max_channels > 0:
                                    server_channels = db.get_server_channels(server_id)
                                    if len(server_channels) >= max_channels:
                                        await websocket.send_str(json.dumps({
                                            'type': 'error',
                                            'message': f'Maximum channels per server ({max_channels}) reached'
                                        }))
                                        continue
                                
                                channel_id = get_next_channel_id()
                                db.create_channel(channel_id, server_id, channel_name, channel_type)
                                
                                # Notify all server members
                                channel_info = json.dumps({
                                    'type': 'channel_created',
                                    'server_id': server_id,
                                    'channel': {'id': channel_id, 'name': channel_name, 'type': channel_type}
                                })
                                await broadcast_to_server(server_id, channel_info)
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} created {channel_type} channel: {channel_name}")
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'You do not have permission to create channels'
                                }))
                    
                    # Voice chat handlers (legacy endpoint for backward compatibility)
                    elif data.get('type') == 'create_voice_channel':
                        server_id = data.get('server_id', '')
                        channel_name = data.get('name', '').strip()
                        
                        if db.get_server(server_id) and channel_name:
                            if has_permission(server_id, username, 'create_voice_channel'):
                                # Get admin settings for channel limits
                                admin_settings = db.get_admin_settings()
                                max_channels = admin_settings.get('max_channels_per_server', 50)
                                
                                # Check if server has reached channel limit (0 = unlimited)
                                if max_channels > 0:
                                    server_channels = db.get_server_channels(server_id)
                                    if len(server_channels) >= max_channels:
                                        await websocket.send_str(json.dumps({
                                            'type': 'error',
                                            'message': f'Maximum channels per server ({max_channels}) reached'
                                        }))
                                        continue
                                
                                channel_id = get_next_channel_id()
                                db.create_channel(channel_id, server_id, channel_name, 'voice')
                                
                                # Notify all server members (use unified message type)
                                channel_info = json.dumps({
                                    'type': 'channel_created',
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
                        
                        # Verify server and channel exist and user is member
                        server = db.get_server(server_id)
                        if server:
                            members = db.get_server_members(server_id)
                            member_usernames = {m['username'] for m in members}
                            if username in member_usernames:
                                # Add to voice channel (runtime tracking)
                                voice_key = f"{server_id}/{channel_id}"
                                if voice_key not in voice_members:
                                    voice_members[voice_key] = set()
                                voice_members[voice_key].add(username)
                                
                                voice_states[username] = {
                                    'in_voice': True,
                                    'channel_id': channel_id,
                                    'server_id': server_id,
                                    'muted': False,
                                    'video': False,
                                    'screen_sharing': False
                                }
                                
                                # Get current voice members with state details
                                voice_members_list = []
                                for member in voice_members.get(voice_key, set()):
                                    member_state = voice_states.get(member, {})
                                    member_avatar = get_avatar_data(member)
                                    voice_members_list.append({
                                        'username': member,
                                        **member_avatar,
                                        'muted': member_state.get('muted', False),
                                        'video': member_state.get('video', False),
                                        'screen_sharing': member_state.get('screen_sharing', False)
                                    })
                                
                                # Notify all server members about voice state change
                                user_avatar = get_avatar_data(username)
                                await broadcast_to_server(server_id, json.dumps({
                                    'type': 'voice_state_update',
                                    'server_id': server_id,
                                    'channel_id': channel_id,
                                    'username': username,
                                    **user_avatar,
                                    'state': 'joined',
                                    'voice_members': voice_members_list
                                }))
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} joined voice channel {channel_id}")
                    
                    elif data.get('type') == 'leave_voice_channel':
                        if username in voice_states:
                            state = voice_states[username]
                            server_id = state.get('server_id')
                            channel_id = state.get('channel_id')
                            
                            if server_id and channel_id:
                                voice_key = f"{server_id}/{channel_id}"
                                if voice_key in voice_members:
                                    voice_members[voice_key].discard(username)
                                    
                                    # Get current voice members with state details
                                    voice_members_list = []
                                    for member in voice_members.get(voice_key, set()):
                                        member_state = voice_states.get(member, {})
                                        member_avatar = get_avatar_data(member)
                                        voice_members_list.append({
                                            'username': member,
                                            **member_avatar,
                                            'muted': member_state.get('muted', False),
                                            'video': member_state.get('video', False),
                                            'screen_sharing': member_state.get('screen_sharing', False)
                                        })
                                    
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
                    
                    elif data.get('type') == 'set_avatar':
                        # Update user avatar (emoji or image upload)
                        avatar_type = data.get('avatar_type', 'emoji')
                        
                        # Get admin settings for file size limits
                        admin_settings = db.get_admin_settings()
                        max_file_size_mb = admin_settings.get('max_file_size_mb', 10)
                        max_file_size = max_file_size_mb * 1024 * 1024
                        
                        user = db.get_user(username)
                        if user:
                            if avatar_type == 'emoji':
                                avatar = data.get('avatar', '👤').strip()
                                db.update_user_avatar(username, avatar, 'emoji', None)
                            elif avatar_type == 'image':
                                # Handle image upload via base64
                                avatar_data = data.get('avatar_data', '')
                                
                                # Validate size (base64 is ~33% larger than original)
                                if len(avatar_data) > max_file_size * 1.5:
                                    await websocket.send_str(json.dumps({
                                        'type': 'error',
                                        'message': f'Avatar image too large. Maximum size is {max_file_size_mb}MB.'
                                    }))
                                    continue
                                
                                db.update_user_avatar(username, None, 'image', avatar_data)
                            
                            # Get full avatar data to broadcast
                            avatar_update = get_avatar_data(username)
                            
                            # Notify all friends about avatar change
                            for friend_username in db.get_friends(username):
                                await send_to_user(friend_username, json.dumps({
                                    'type': 'avatar_update',
                                    'username': username,
                                    **avatar_update
                                }))
                            
                            # Notify all servers the user is in
                            for server_id in db.get_user_servers(username):
                                await broadcast_to_server(server_id, json.dumps({
                                    'type': 'avatar_update',
                                    'username': username,
                                    **avatar_update
                                }))
                            
                            await websocket.send_str(json.dumps({
                                'type': 'avatar_updated',
                                **avatar_update
                            }))
                    
                    elif data.get('type') == 'set_notification_mode':
                        # Update user notification mode
                        notification_mode = data.get('notification_mode', 'all')
                        
                        # Validate notification mode
                        if notification_mode not in ['all', 'mentions', 'none']:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid notification mode'
                            }))
                            continue
                        
                        user = db.get_user(username)
                        if user:
                            db.update_notification_mode(username, notification_mode)
                            
                            await websocket.send_str(json.dumps({
                                'type': 'notification_mode_updated',
                                'notification_mode': notification_mode
                            }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'User not found'
                            }))
                    
                    elif data.get('type') == 'voice_video':
                        # Toggle video state
                        video = data.get('video', False)
                        if username in voice_states:
                            voice_states[username]['video'] = video
                            state = voice_states[username]
                            
                            # Notify others in the same voice channel
                            if state.get('server_id') and state.get('channel_id'):
                                await broadcast_to_server(state['server_id'], json.dumps({
                                    'type': 'voice_video_update',
                                    'username': username,
                                    'video': video
                                }))
                    
                    elif data.get('type') == 'voice_screen_share':
                        # Toggle screen sharing state
                        screen_sharing = data.get('screen_sharing', False)
                        if username in voice_states:
                            voice_states[username]['screen_sharing'] = screen_sharing
                            state = voice_states[username]
                            
                            # Notify others in the same voice channel
                            if state.get('server_id') and state.get('channel_id'):
                                await broadcast_to_server(state['server_id'], json.dumps({
                                    'type': 'voice_screen_share_update',
                                    'username': username,
                                    'screen_sharing': screen_sharing
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
                    voice_key = f"{server_id}/{channel_id}"
                    if voice_key in voice_members:
                        voice_members[voice_key].discard(username)
                        
                        # Get current voice members with state details
                        voice_members_list = []
                        for member in voice_members.get(voice_key, set()):
                            member_state = voice_states.get(member, {})
                            member_avatar = get_avatar_data(member)
                            voice_members_list.append({
                                'username': member,
                                **member_avatar,
                                'muted': member_state.get('muted', False),
                                'video': member_state.get('video', False),
                                'screen_sharing': member_state.get('screen_sharing', False)
                            })
                        
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
    print(f"[HTTP_HANDLER ENTRY] Received request for path: {path}")
    
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
            # Determine content type and whether file is binary
            is_binary = False
            content_type = 'text/html'
            
            if full_path.endswith('.css'):
                content_type = 'text/css'
            elif full_path.endswith('.js'):
                content_type = 'application/javascript'
            elif full_path.endswith('.json'):
                content_type = 'application/json'
            elif full_path.endswith('.png'):
                content_type = 'image/png'
                is_binary = True
            elif full_path.endswith('.jpg') or full_path.endswith('.jpeg'):
                content_type = 'image/jpeg'
                is_binary = True
            elif full_path.endswith('.gif'):
                content_type = 'image/gif'
                is_binary = True
            elif full_path.endswith('.svg'):
                content_type = 'image/svg+xml'
            elif full_path.endswith('.ico'):
                content_type = 'image/x-icon'
                is_binary = True
            elif full_path.endswith('.webp'):
                content_type = 'image/webp'
                is_binary = True
            
            # Read file
            with open(full_path, 'rb') as f:
                binary_content = f.read()
            
            # Decode text files only
            if not is_binary:
                content = binary_content.decode('utf-8')
                print(f"[HTTP_HANDLER] Serving text {full_path}, size: {len(content)} chars")
            else:
                print(f"[HTTP_HANDLER] Serving binary {full_path}, size: {len(binary_content)} bytes")
            
            # Add cache control headers to prevent browser caching during development
            headers = {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
            
            # Return appropriate response based on file type
            if is_binary:
                return web.Response(body=binary_content, content_type=content_type, headers=headers)
            else:
                return web.Response(text=content, content_type=content_type, headers=headers)
    
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
    
    # Initialize database counters from existing data
    init_counters_from_db()
    print(f"Initialized counters from database (servers: {server_counter}, channels: {channel_counter}, dms: {dm_counter}, roles: {role_counter})")
    
    # Create aiohttp application
    app = web.Application()
    app.router.add_get('/', http_handler)
    app.router.add_get('/static/{path:.*}', http_handler)
    app.router.add_get('/ws', websocket_handler)
    
    # Setup REST API routes
    setup_api_routes(app, db)
    
    # Run the server
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', 8765)
    await site.start()
    
    print("Server started successfully!")
    print("Access the web client at http://localhost:8765")
    print(f"Database: PostgreSQL at {db.db_url}")
    print("REST API available at http://localhost:8765/api/*")
    
    # Keep running
    await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
