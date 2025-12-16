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

# Store connected clients
clients = set()
# Store message history
messages = []
MAX_HISTORY = 100

# Store user accounts: {username: {password_hash, invite_codes}}
users = {}
# Store active invite codes: {code: creator_username}
invite_codes = {}


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


async def broadcast(message, exclude=None):
    """Broadcast a message to all connected clients except the excluded one."""
    if clients:
        tasks = []
        for client in clients:
            if client != exclude:
                tasks.append(client.send_str(message))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


async def handler(websocket):
    """Handle client connections."""
    username = None
    authenticated = False
    
    try:
        # Register client
        clients.add(websocket)
        
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
                    'created_at': datetime.now().isoformat()
                }
                
                # Remove used invite code
                if invite_code in invite_codes:
                    del invite_codes[invite_code]
                
                await websocket.send_str(json.dumps({
                    'type': 'auth_success',
                    'message': 'Account created successfully'
                }))
                authenticated = True
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
                print(f"[{datetime.now().strftime('%H:%M:%S')}] User logged in: {username}")
            
            else:
                await websocket.send_str(json.dumps({
                    'type': 'auth_error',
                    'message': 'Invalid authentication request'
                }))
        
        # Send message history to authenticated client
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
                        
                        # Create message object
                        msg_obj = {
                            'type': 'message',
                            'username': username,
                            'content': msg_content,
                            'timestamp': datetime.now().isoformat()
                        }
                        
                        # Store in history
                        messages.append(msg_obj)
                        if len(messages) > MAX_HISTORY:
                            messages.pop(0)
                        
                        # Broadcast to all clients
                        await broadcast(json.dumps(msg_obj))
                        
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] {username}: {msg_content}")
                    
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
            elif msg.type == web.WSMsgType.ERROR:
                print(f'WebSocket connection closed with exception {websocket.exception()}')
                break
                
    except Exception as e:
        print(f"Error in handler: {e}")
    finally:
        # Unregister client
        clients.discard(websocket)
        
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
