#!/usr/bin/env python3
"""
Database module for Decentra Chat Server
Provides persistent storage using SQLite
"""

import sqlite3
import json
import os
from datetime import datetime
from contextlib import contextmanager
from typing import List, Dict, Set, Optional, Tuple


class Database:
    """Database handler for persistent storage."""
    
    def __init__(self, db_path: str = "decentra.db"):
        """Initialize database connection."""
        self.db_path = db_path
        self.init_database()
    
    @contextmanager
    def get_connection(self):
        """Context manager for database connections."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
    
    def init_database(self):
        """Initialize database schema."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Users table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    username TEXT PRIMARY KEY,
                    password_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    avatar TEXT DEFAULT '👤',
                    avatar_type TEXT DEFAULT 'emoji',
                    avatar_data TEXT
                )
            ''')
            
            # Servers table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS servers (
                    server_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    owner TEXT NOT NULL,
                    FOREIGN KEY (owner) REFERENCES users(username)
                )
            ''')
            
            # Channels table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS channels (
                    channel_id TEXT PRIMARY KEY,
                    server_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    type TEXT DEFAULT 'text',
                    FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
                )
            ''')
            
            # Server members table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS server_members (
                    server_id TEXT NOT NULL,
                    username TEXT NOT NULL,
                    can_create_channel INTEGER DEFAULT 0,
                    can_edit_channel INTEGER DEFAULT 0,
                    can_delete_channel INTEGER DEFAULT 0,
                    PRIMARY KEY (server_id, username),
                    FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
                    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
                )
            ''')
            
            # Messages table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    content TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    context_type TEXT NOT NULL,
                    context_id TEXT,
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
                    user1 TEXT NOT NULL,
                    user2 TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    requester TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (user1, user2),
                    FOREIGN KEY (user1) REFERENCES users(username) ON DELETE CASCADE,
                    FOREIGN KEY (user2) REFERENCES users(username) ON DELETE CASCADE,
                    CHECK (user1 < user2)
                )
            ''')
            
            # Direct messages table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS direct_messages (
                    dm_id TEXT PRIMARY KEY,
                    user1 TEXT NOT NULL,
                    user2 TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (user1) REFERENCES users(username) ON DELETE CASCADE,
                    FOREIGN KEY (user2) REFERENCES users(username) ON DELETE CASCADE
                )
            ''')
            
            # Invite codes table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS invite_codes (
                    code TEXT PRIMARY KEY,
                    creator TEXT NOT NULL,
                    code_type TEXT DEFAULT 'global',
                    server_id TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (creator) REFERENCES users(username) ON DELETE CASCADE,
                    FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
                )
            ''')
            
            conn.commit()
    
    # User operations
    def create_user(self, username: str, password_hash: str) -> bool:
        """Create a new user."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO users (username, password_hash, created_at)
                    VALUES (?, ?, ?)
                ''', (username, password_hash, datetime.now().isoformat()))
                return True
        except sqlite3.IntegrityError:
            return False
    
    def get_user(self, username: str) -> Optional[Dict]:
        """Get user data."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM users WHERE username = ?', (username,))
            row = cursor.fetchone()
            if row:
                return dict(row)
            return None
    
    def get_all_users(self) -> List[str]:
        """Get all usernames."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT username FROM users')
            return [row[0] for row in cursor.fetchall()]
    
    def update_user_avatar(self, username: str, avatar: str, avatar_type: str, avatar_data: Optional[str] = None):
        """Update user avatar."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE users 
                SET avatar = ?, avatar_type = ?, avatar_data = ?
                WHERE username = ?
            ''', (avatar, avatar_type, avatar_data, username))
    
    # Server operations
    def create_server(self, server_id: str, name: str, owner: str) -> bool:
        """Create a new server."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO servers (server_id, name, owner)
                    VALUES (?, ?, ?)
                ''', (server_id, name, owner))
                # Add owner as member
                cursor.execute('''
                    INSERT INTO server_members (server_id, username)
                    VALUES (?, ?)
                ''', (server_id, owner))
                return True
        except sqlite3.IntegrityError:
            return False
    
    def get_server(self, server_id: str) -> Optional[Dict]:
        """Get server data."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM servers WHERE server_id = ?', (server_id,))
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
                UPDATE servers SET name = ? WHERE server_id = ?
            ''', (name, server_id))
    
    # Channel operations
    def create_channel(self, channel_id: str, server_id: str, name: str, channel_type: str = 'text') -> bool:
        """Create a new channel."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO channels (channel_id, server_id, name, type)
                    VALUES (?, ?, ?, ?)
                ''', (channel_id, server_id, name, channel_type))
                return True
        except sqlite3.IntegrityError:
            return False
    
    def get_server_channels(self, server_id: str) -> List[Dict]:
        """Get all channels for a server."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT * FROM channels WHERE server_id = ? ORDER BY channel_id
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
                    VALUES (?, ?)
                ''', (server_id, username))
                return True
        except sqlite3.IntegrityError:
            return False
    
    def get_server_members(self, server_id: str) -> List[Dict]:
        """Get all members of a server."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT * FROM server_members WHERE server_id = ?
            ''', (server_id,))
            return [dict(row) for row in cursor.fetchall()]
    
    def get_user_servers(self, username: str) -> List[str]:
        """Get all servers a user is a member of."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT server_id FROM server_members WHERE username = ?
            ''', (username,))
            return [row[0] for row in cursor.fetchall()]
    
    def update_member_permissions(self, server_id: str, username: str, permissions: Dict[str, bool]):
        """Update member permissions."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE server_members 
                SET can_create_channel = ?, can_edit_channel = ?, can_delete_channel = ?
                WHERE server_id = ? AND username = ?
            ''', (
                1 if permissions.get('can_create_channel', False) else 0,
                1 if permissions.get('can_edit_channel', False) else 0,
                1 if permissions.get('can_delete_channel', False) else 0,
                server_id, username
            ))
    
    # Message operations
    def save_message(self, username: str, content: str, context_type: str, context_id: Optional[str] = None) -> int:
        """Save a message and return its ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO messages (username, content, timestamp, context_type, context_id)
                VALUES (?, ?, ?, ?, ?)
            ''', (username, content, datetime.now().isoformat(), context_type, context_id))
            return cursor.lastrowid
    
    def get_messages(self, context_type: str, context_id: Optional[str] = None, limit: int = 100) -> List[Dict]:
        """Get messages for a context."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT * FROM messages 
                WHERE context_type = ? AND context_id = ?
                ORDER BY timestamp DESC
                LIMIT ?
            ''', (context_type, context_id, limit))
            # Reverse to get chronological order
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
                    VALUES (?, ?, 'pending', ?, ?)
                ''', (user1, user2, requester, datetime.now().isoformat()))
                return True
        except sqlite3.IntegrityError:
            return False
    
    def accept_friend_request(self, requester: str, accepter: str) -> bool:
        """Accept a friend request."""
        user1, user2 = sorted([requester, accepter])
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE friendships 
                SET status = 'accepted'
                WHERE user1 = ? AND user2 = ? AND status = 'pending'
            ''', (user1, user2))
            return cursor.rowcount > 0
    
    def remove_friendship(self, user_a: str, user_b: str):
        """Remove a friendship or friend request."""
        user1, user2 = sorted([user_a, user_b])
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                DELETE FROM friendships WHERE user1 = ? AND user2 = ?
            ''', (user1, user2))
    
    def get_friends(self, username: str) -> List[str]:
        """Get all friends of a user."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT CASE 
                    WHEN user1 = ? THEN user2 
                    ELSE user1 
                END as friend
                FROM friendships 
                WHERE (user1 = ? OR user2 = ?) AND status = 'accepted'
            ''', (username, username, username))
            return [row[0] for row in cursor.fetchall()]
    
    def get_friend_requests_sent(self, username: str) -> List[str]:
        """Get pending friend requests sent by user."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT CASE 
                    WHEN user1 = ? THEN user2 
                    ELSE user1 
                END as other_user
                FROM friendships 
                WHERE requester = ? AND status = 'pending'
            ''', (username, username))
            return [row[0] for row in cursor.fetchall()]
    
    def get_friend_requests_received(self, username: str) -> List[str]:
        """Get pending friend requests received by user."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT requester
                FROM friendships 
                WHERE (user1 = ? OR user2 = ?) AND requester != ? AND status = 'pending'
            ''', (username, username, username))
            return [row[0] for row in cursor.fetchall()]
    
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
                    VALUES (?, ?, ?, ?)
                ''', (dm_id, sorted_users[0], sorted_users[1], datetime.now().isoformat()))
                return True
        except sqlite3.IntegrityError:
            return False
    
    def get_dm(self, user1: str, user2: str) -> Optional[str]:
        """Get DM ID for two users."""
        sorted_users = sorted([user1, user2])
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT dm_id FROM direct_messages 
                WHERE user1 = ? AND user2 = ?
            ''', (sorted_users[0], sorted_users[1]))
            row = cursor.fetchone()
            if row:
                return row[0]
            return None
    
    def get_user_dms(self, username: str) -> List[Dict]:
        """Get all DMs for a user."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT dm_id, user1, user2 FROM direct_messages 
                WHERE user1 = ? OR user2 = ?
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
                    VALUES (?, ?, ?, ?, ?)
                ''', (code, creator, code_type, server_id, datetime.now().isoformat()))
                return True
        except sqlite3.IntegrityError:
            return False
    
    def get_invite_code(self, code: str) -> Optional[Dict]:
        """Get invite code data."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM invite_codes WHERE code = ?', (code,))
            row = cursor.fetchone()
            if row:
                return dict(row)
            return None
    
    def delete_invite_code(self, code: str):
        """Delete an invite code."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM invite_codes WHERE code = ?', (code,))
    
    def get_server_invite_codes(self, server_id: str) -> Dict[str, str]:
        """Get all invite codes for a server."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT code, creator FROM invite_codes 
                WHERE server_id = ? AND code_type = 'server'
            ''', (server_id,))
            return {row[0]: row[1] for row in cursor.fetchall()}
