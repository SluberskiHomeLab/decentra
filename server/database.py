#!/usr/bin/env python3
"""
Database module for Decentra Chat Server
Provides persistent storage using PostgreSQL
"""

import psycopg2
import psycopg2.extras
import json
import os
import time
from datetime import datetime
from contextlib import contextmanager
from typing import List, Dict, Set, Optional, Tuple


class Database:
    """Database handler for persistent storage."""
    
    def __init__(self, db_url: str = None):
        """Initialize database connection."""
        # Use environment variable or provided URL
        self.db_url = db_url or os.getenv('DATABASE_URL', 
            'postgresql://decentra:decentra@localhost:5432/decentra')
        self.init_database()
    
    @contextmanager
    def get_connection(self):
        """Context manager for database connections."""
        conn = psycopg2.connect(self.db_url)
        conn.cursor_factory = psycopg2.extras.RealDictCursor
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
    
    def init_database(self):
        """Initialize database schema with retry logic."""
        max_retries = 5
        retry_delay = 1  # Initial delay in seconds
        
        for attempt in range(max_retries):
            try:
                with self.get_connection() as conn:
                    cursor = conn.cursor()
                    
                    # Users table
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS users (
                            username VARCHAR(255) PRIMARY KEY,
                            password_hash VARCHAR(255) NOT NULL,
                            created_at TIMESTAMP NOT NULL,
                            avatar VARCHAR(255) DEFAULT '👤',
                            avatar_type VARCHAR(50) DEFAULT 'emoji',
                            avatar_data TEXT
                        )
                    ''')
                    
                    # Servers table
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS servers (
                            server_id VARCHAR(255) PRIMARY KEY,
                            name VARCHAR(255) NOT NULL,
                            owner VARCHAR(255) NOT NULL,
                            FOREIGN KEY (owner) REFERENCES users(username)
                        )
                    ''')
                    
                    # Channels table
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS channels (
                            channel_id VARCHAR(255) PRIMARY KEY,
                            server_id VARCHAR(255) NOT NULL,
                            name VARCHAR(255) NOT NULL,
                            type VARCHAR(50) DEFAULT 'text',
                            FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
                        )
                    ''')
                    
                    # Server members table
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS server_members (
                            server_id VARCHAR(255) NOT NULL,
                            username VARCHAR(255) NOT NULL,
                            can_create_channel BOOLEAN DEFAULT FALSE,
                            can_edit_channel BOOLEAN DEFAULT FALSE,
                            can_delete_channel BOOLEAN DEFAULT FALSE,
                            PRIMARY KEY (server_id, username),
                            FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
                            FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
                        )
                    ''')
                    
                    # Messages table
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS messages (
                            id SERIAL PRIMARY KEY,
                            username VARCHAR(255) NOT NULL,
                            content TEXT NOT NULL,
                            timestamp TIMESTAMP NOT NULL,
                            context_type VARCHAR(50) NOT NULL,
                            context_id VARCHAR(255),
                            FOREIGN KEY (username) REFERENCES users(username)
                        )
                    ''')
                    
                    # Create index for faster message retrieval
                    cursor.execute('''
                        CREATE INDEX IF NOT EXISTS idx_messages_context 
                        ON messages(context_type, context_id, timestamp)
                    ''')
                    
                    # Friendships table
                    # Note: user1 and user2 are stored in sorted order (user1 < user2)
                    # to ensure consistent ordering and prevent duplicate entries.
                    # The CHECK constraint enforces this at the database level.
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS friendships (
                            user1 VARCHAR(255) NOT NULL,
                            user2 VARCHAR(255) NOT NULL,
                            status VARCHAR(50) DEFAULT 'pending',
                            requester VARCHAR(255) NOT NULL,
                            created_at TIMESTAMP NOT NULL,
                            PRIMARY KEY (user1, user2),
                            FOREIGN KEY (user1) REFERENCES users(username) ON DELETE CASCADE,
                            FOREIGN KEY (user2) REFERENCES users(username) ON DELETE CASCADE,
                            CHECK (user1 < user2)
                        )
                    ''')
                    
                    # Direct messages table
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS direct_messages (
                            dm_id VARCHAR(255) PRIMARY KEY,
                            user1 VARCHAR(255) NOT NULL,
                            user2 VARCHAR(255) NOT NULL,
                            created_at TIMESTAMP NOT NULL,
                            FOREIGN KEY (user1) REFERENCES users(username) ON DELETE CASCADE,
                            FOREIGN KEY (user2) REFERENCES users(username) ON DELETE CASCADE
                        )
                    ''')
                    
                    # Invite codes table
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS invite_codes (
                            code VARCHAR(255) PRIMARY KEY,
                            creator VARCHAR(255) NOT NULL,
                            code_type VARCHAR(50) DEFAULT 'global',
                            server_id VARCHAR(255),
                            created_at TIMESTAMP NOT NULL,
                            FOREIGN KEY (creator) REFERENCES users(username) ON DELETE CASCADE,
                            FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
                        )
                    ''')
                    
                    conn.commit()
                
                # If we get here, connection was successful
                print(f"Database connection established successfully")
                return
                
            except psycopg2.OperationalError as e:
                if attempt < max_retries - 1:
                    print(f"Database connection attempt {attempt + 1}/{max_retries} failed: {e}")
                    print(f"Retrying in {retry_delay} seconds...")
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                else:
                    print(f"Failed to connect to database after {max_retries} attempts")
                    raise
            except Exception as e:
                print(f"Unexpected error during database initialization: {e}")
                raise
    
    # User operations
    def create_user(self, username: str, password_hash: str) -> bool:
        """Create a new user."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO users (username, password_hash, created_at)
                    VALUES (%s, %s, %s)
                ''', (username, password_hash, datetime.now()))
                return True
        except psycopg2.IntegrityError:
            return False
    
    def get_user(self, username: str) -> Optional[Dict]:
        """Get user data."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM users WHERE username = %s', (username,))
            row = cursor.fetchone()
            if row:
                return dict(row)
            return None
    
    def get_all_users(self) -> List[str]:
        """Get all usernames."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT username FROM users')
            return [row['username'] for row in cursor.fetchall()]
    
    def update_user_avatar(self, username: str, avatar: str, avatar_type: str, avatar_data: Optional[str] = None):
        """Update user avatar."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE users 
                SET avatar = %s, avatar_type = %s, avatar_data = %s
                WHERE username = %s
            ''', (avatar, avatar_type, avatar_data, username))
    
    # Server operations
    def create_server(self, server_id: str, name: str, owner: str) -> bool:
        """Create a new server."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO servers (server_id, name, owner)
                    VALUES (%s, %s, %s)
                ''', (server_id, name, owner))
                # Add owner as member
                cursor.execute('''
                    INSERT INTO server_members (server_id, username)
                    VALUES (%s, %s)
                ''', (server_id, owner))
                return True
        except psycopg2.IntegrityError:
            return False
    
    def get_server(self, server_id: str) -> Optional[Dict]:
        """Get server data."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM servers WHERE server_id = %s', (server_id,))
            row = cursor.fetchone()
            if row:
                return dict(row)
            return None
    
    def get_all_servers(self) -> List[Dict]:
        """Get all servers."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM servers')
            return [dict(row) for row in cursor.fetchall()]
    
    def update_server_name(self, server_id: str, name: str):
        """Update server name."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE servers SET name = %s WHERE server_id = %s
            ''', (name, server_id))
    
    # Channel operations
    def create_channel(self, channel_id: str, server_id: str, name: str, channel_type: str = 'text') -> bool:
        """Create a new channel."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO channels (channel_id, server_id, name, type)
                    VALUES (%s, %s, %s, %s)
                ''', (channel_id, server_id, name, channel_type))
                return True
        except psycopg2.IntegrityError:
            return False
    
    def get_server_channels(self, server_id: str) -> List[Dict]:
        """Get all channels for a server."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT * FROM channels WHERE server_id = %s ORDER BY channel_id
            ''', (server_id,))
            return [dict(row) for row in cursor.fetchall()]
    
    # Server members operations
    def add_server_member(self, server_id: str, username: str) -> bool:
        """Add a member to a server."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO server_members (server_id, username)
                    VALUES (%s, %s)
                ''', (server_id, username))
                return True
        except psycopg2.IntegrityError:
            return False
    
    def get_server_members(self, server_id: str) -> List[Dict]:
        """Get all members of a server."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT * FROM server_members WHERE server_id = %s
            ''', (server_id,))
            return [dict(row) for row in cursor.fetchall()]
    
    def get_user_servers(self, username: str) -> List[str]:
        """Get all servers a user is a member of."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT server_id FROM server_members WHERE username = %s
            ''', (username,))
            return [row['server_id'] for row in cursor.fetchall()]
    
    def update_member_permissions(self, server_id: str, username: str, permissions: Dict[str, bool]):
        """Update member permissions."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE server_members 
                SET can_create_channel = %s, can_edit_channel = %s, can_delete_channel = %s
                WHERE server_id = %s AND username = %s
            ''', (
                permissions.get('can_create_channel', False),
                permissions.get('can_edit_channel', False),
                permissions.get('can_delete_channel', False),
                server_id, username
            ))
    
    # Message operations
    def save_message(self, username: str, content: str, context_type: str, context_id: Optional[str] = None) -> int:
        """Save a message and return its ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO messages (username, content, timestamp, context_type, context_id)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
            ''', (username, content, datetime.now(), context_type, context_id))
            result = cursor.fetchone()
            return result['id']
    
    def get_messages(self, context_type: str, context_id: Optional[str] = None, limit: int = 100) -> List[Dict]:
        """Get messages for a context."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT id, username, content, 
                       timestamp::text as timestamp,
                       context_type, context_id
                FROM messages 
                WHERE context_type = %s AND context_id = %s
                ORDER BY timestamp DESC
                LIMIT %s
            ''', (context_type, context_id, limit))
            # Reverse to get chronological order and return as list of dicts
            return [dict(row) for row in reversed(cursor.fetchall())]
    
    # Friendship operations
    def add_friend_request(self, requester: str, target: str) -> bool:
        """Add a friend request."""
        user1, user2 = sorted([requester, target])
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO friendships (user1, user2, status, requester, created_at)
                    VALUES (%s, %s, 'pending', %s, %s)
                ''', (user1, user2, requester, datetime.now()))
                return True
        except psycopg2.IntegrityError:
            return False
    
    def accept_friend_request(self, requester: str, accepter: str) -> bool:
        """Accept a friend request."""
        user1, user2 = sorted([requester, accepter])
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE friendships 
                SET status = 'accepted'
                WHERE user1 = %s AND user2 = %s AND status = 'pending'
            ''', (user1, user2))
            return cursor.rowcount > 0
    
    def remove_friendship(self, user_a: str, user_b: str):
        """Remove a friendship or friend request."""
        user1, user2 = sorted([user_a, user_b])
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                DELETE FROM friendships WHERE user1 = %s AND user2 = %s
            ''', (user1, user2))
    
    def get_friends(self, username: str) -> List[str]:
        """Get all friends of a user."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT CASE 
                    WHEN user1 = %s THEN user2 
                    ELSE user1 
                END as friend
                FROM friendships 
                WHERE (user1 = %s OR user2 = %s) AND status = 'accepted'
            ''', (username, username, username))
            return [row['friend'] for row in cursor.fetchall()]
    
    def get_friend_requests_sent(self, username: str) -> List[str]:
        """Get pending friend requests sent by user."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT CASE 
                    WHEN user1 = %s THEN user2 
                    ELSE user1 
                END as other_user
                FROM friendships 
                WHERE requester = %s AND status = 'pending'
            ''', (username, username))
            return [row['other_user'] for row in cursor.fetchall()]
    
    def get_friend_requests_received(self, username: str) -> List[str]:
        """Get pending friend requests received by user."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT requester
                FROM friendships 
                WHERE (user1 = %s OR user2 = %s) AND requester != %s AND status = 'pending'
            ''', (username, username, username))
            return [row['requester'] for row in cursor.fetchall()]
    
    # Direct message operations
    def create_dm(self, dm_id: str, user1: str, user2: str) -> bool:
        """Create a direct message channel."""
        # Always store in sorted order
        sorted_users = sorted([user1, user2])
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO direct_messages (dm_id, user1, user2, created_at)
                    VALUES (%s, %s, %s, %s)
                ''', (dm_id, sorted_users[0], sorted_users[1], datetime.now()))
                return True
        except psycopg2.IntegrityError:
            return False
    
    def get_dm(self, user1: str, user2: str) -> Optional[str]:
        """Get DM ID for two users."""
        sorted_users = sorted([user1, user2])
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT dm_id FROM direct_messages 
                WHERE user1 = %s AND user2 = %s
            ''', (sorted_users[0], sorted_users[1]))
            row = cursor.fetchone()
            if row:
                return row['dm_id']
            return None
    
    def get_user_dms(self, username: str) -> List[Dict]:
        """Get all DMs for a user."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT dm_id, user1, user2 FROM direct_messages 
                WHERE user1 = %s OR user2 = %s
            ''', (username, username))
            return [dict(row) for row in cursor.fetchall()]
    
    # Invite code operations
    def create_invite_code(self, code: str, creator: str, code_type: str = 'global', server_id: Optional[str] = None) -> bool:
        """Create an invite code."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO invite_codes (code, creator, code_type, server_id, created_at)
                    VALUES (%s, %s, %s, %s, %s)
                ''', (code, creator, code_type, server_id, datetime.now()))
                return True
        except psycopg2.IntegrityError:
            return False
    
    def get_invite_code(self, code: str) -> Optional[Dict]:
        """Get invite code data."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM invite_codes WHERE code = %s', (code,))
            row = cursor.fetchone()
            if row:
                return dict(row)
            return None
    
    def delete_invite_code(self, code: str):
        """Delete an invite code."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM invite_codes WHERE code = %s', (code,))
    
    def get_server_invite_codes(self, server_id: str) -> Dict[str, str]:
        """Get all invite codes for a server."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT code, creator FROM invite_codes 
                WHERE server_id = %s AND code_type = 'server'
            ''', (server_id,))
            return {row['code']: row['creator'] for row in cursor.fetchall()}
