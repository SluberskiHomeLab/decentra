#!/usr/bin/env python3
"""
Decentra Chat Client
A terminal-based chat client for the Decentra chat server.
"""

import asyncio
import json
import sys
import websockets
from datetime import datetime
import os


class ChatClient:
    def __init__(self, server_url, username):
        self.server_url = server_url
        self.username = username
        self.websocket = None
        self.running = False
    
    async def receive_messages(self):
        """Receive and display messages from the server."""
        try:
            async for message in self.websocket:
                data = json.loads(message)
                
                if data['type'] == 'history':
                    # Display message history
                    if data['messages']:
                        print("\n" + "=" * 50)
                        print("Message History:")
                        print("=" * 50)
                        for msg in data['messages']:
                            self.display_message(msg)
                        print("=" * 50 + "\n")
                elif data['type'] == 'message':
                    self.display_message(data)
                elif data['type'] == 'system':
                    timestamp = datetime.fromisoformat(data['timestamp']).strftime('%H:%M:%S')
                    print(f"\n\033[90m[{timestamp}] {data['content']}\033[0m")
                    print(f"{self.username}> ", end='', flush=True)
                    
        except websockets.exceptions.ConnectionClosed:
            print("\n\nConnection to server lost.")
            self.running = False
        except Exception as e:
            print(f"\nError receiving messages: {e}")
            self.running = False
    
    def display_message(self, msg):
        """Display a chat message."""
        timestamp = datetime.fromisoformat(msg['timestamp']).strftime('%H:%M:%S')
        username = msg['username']
        content = msg['content']
        
        # Color the username
        if username == self.username:
            colored_username = f"\033[92m{username}\033[0m"  # Green for own messages
        else:
            colored_username = f"\033[94m{username}\033[0m"  # Blue for others
        
        print(f"\r[{timestamp}] {colored_username}: {content}")
        print(f"{self.username}> ", end='', flush=True)
    
    async def send_messages(self):
        """Read user input and send messages to the server."""
        try:
            # Use asyncio to read from stdin
            loop = asyncio.get_event_loop()
            
            while self.running:
                # Print prompt
                print(f"{self.username}> ", end='', flush=True)
                
                # Read input in a non-blocking way
                message = await loop.run_in_executor(None, sys.stdin.readline)
                message = message.strip()
                
                if not message:
                    continue
                
                if message.lower() in ['/quit', '/exit', '/q']:
                    self.running = False
                    break
                
                # Send message to server
                msg_data = json.dumps({
                    'type': 'message',
                    'content': message
                })
                await self.websocket.send(msg_data)
                
        except Exception as e:
            print(f"\nError sending messages: {e}")
            self.running = False
    
    async def connect(self):
        """Connect to the chat server and start messaging."""
        try:
            print(f"Connecting to {self.server_url}...")
            async with websockets.connect(self.server_url) as websocket:
                self.websocket = websocket
                self.running = True
                
                # Send join message
                join_data = json.dumps({
                    'type': 'join',
                    'username': self.username
                })
                await websocket.send(join_data)
                
                print(f"Connected as {self.username}")
                print("Type your message and press Enter to send.")
                print("Type /quit to exit.\n")
                
                # Run receive and send concurrently
                await asyncio.gather(
                    self.receive_messages(),
                    self.send_messages()
                )
                
        except websockets.exceptions.WebSocketException as e:
            print(f"WebSocket error: {e}")
        except Exception as e:
            print(f"Connection error: {e}")
        finally:
            self.running = False
            print("\nDisconnected from server.")


async def main():
    """Main entry point for the client."""
    # Get server URL from environment or use default
    server_host = os.environ.get('SERVER_HOST', 'localhost')
    server_port = os.environ.get('SERVER_PORT', '8765')
    server_url = f"ws://{server_host}:{server_port}"
    
    # Get username from command line or prompt
    if len(sys.argv) > 1:
        username = sys.argv[1]
    else:
        username = input("Enter your username: ").strip()
        if not username:
            username = "Anonymous"
    
    print("\nDecentra Chat Client")
    print("=" * 50)
    
    client = ChatClient(server_url, username)
    await client.connect()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\nGoodbye!")
        sys.exit(0)
