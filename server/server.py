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

# Store servers: {server_id: {name, owner, members: set(), channels: {channel_id: {name, messages: []}}}}
servers = {}
# Store direct messages: {dm_id: {participants: set(), messages: []}}
direct_messages = {}

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
                user_servers.append({
                    'id': server_id,
                    'name': server_data['name'],
                    'owner': server_data['owner'],
                    'channels': [
                        {'id': ch_id, 'name': ch_data['name']}
                        for ch_id, ch_data in server_data['channels'].items()
                    ]
                })
        
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
                                'channels': {
                                    channel_id: {
                                        'name': 'general',
                                        'messages': []
                                    }
                                }
                            }
                            
                            await websocket.send_str(json.dumps({
                                'type': 'server_created',
                                'server': {
                                    'id': server_id,
                                    'name': server_name,
                                    'owner': username,
                                    'channels': [{'id': channel_id, 'name': 'general'}]
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
                                        {'id': ch_id, 'name': ch_data['name']}
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
