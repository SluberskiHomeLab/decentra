#!/usr/bin/env python3
"""
Decentra Chat Server
A simple WebSocket-based chat server for decentralized communication.
"""

import asyncio
import json
import websockets
from datetime import datetime

# Store connected clients
clients = set()
# Store message history
messages = []
MAX_HISTORY = 100


async def broadcast(message, exclude=None):
    """Broadcast a message to all connected clients except the excluded one."""
    if clients:
        tasks = []
        for client in clients:
            if client != exclude:
                tasks.append(client.send(message))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


async def handler(websocket):
    """Handle client connections."""
    username = None
    
    try:
        # Register client
        clients.add(websocket)
        
        # Wait for username
        init_message = await websocket.recv()
        init_data = json.loads(init_message)
        
        if init_data.get('type') == 'join':
            username = init_data.get('username', 'Anonymous')
            
            # Send message history to new client
            history_message = json.dumps({
                'type': 'history',
                'messages': messages[-MAX_HISTORY:]
            })
            await websocket.send(history_message)
            
            # Notify others about new user
            join_message = json.dumps({
                'type': 'system',
                'content': f'{username} joined the chat',
                'timestamp': datetime.now().isoformat()
            })
            await broadcast(join_message, exclude=websocket)
            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} joined")
            
            # Handle messages from this client
            async for message in websocket:
                try:
                    data = json.loads(message)
                    
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
                        
                except json.JSONDecodeError:
                    print("Invalid JSON received")
                except Exception as e:
                    print(f"Error processing message: {e}")
                    
    except websockets.exceptions.ConnectionClosed:
        pass
    except Exception as e:
        print(f"Error in handler: {e}")
    finally:
        # Unregister client
        clients.discard(websocket)
        
        if username:
            # Notify others about user leaving
            leave_message = json.dumps({
                'type': 'system',
                'content': f'{username} left the chat',
                'timestamp': datetime.now().isoformat()
            })
            await broadcast(leave_message)
            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} left")


async def main():
    """Start the WebSocket server."""
    print("Decentra Chat Server")
    print("=" * 50)
    print("Starting server on ws://0.0.0.0:8765")
    print("=" * 50)
    
    async with websockets.serve(handler, "0.0.0.0", 8765):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
