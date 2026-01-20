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
from encryption_utils import get_encryption_manager


class Database:
    """Database handler for persistent storage."""
    
    def __init__(self, db_url: str = None):
        """Initialize database connection."""
        # Use environment variable or provided URL
        self.db_url = db_url or os.getenv('DATABASE_URL', 
            'postgresql://decentra:decentra@localhost:5432/decentra')
        # Initialize encryption manager for message encryption
        # Uses a shared encryption key for all messages to allow new users
        # to read server message history when they join
        self.encryption_manager = get_encryption_manager()
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
                            avatar_data TEXT,
                            notification_mode VARCHAR(50) DEFAULT 'all',
                            email VARCHAR(255),
                            email_verified BOOLEAN DEFAULT FALSE,
                            bio TEXT DEFAULT '',
                            status_message VARCHAR(100) DEFAULT ''
                        )
                    ''')
                    
                    # Servers table
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS servers (
                            server_id VARCHAR(255) PRIMARY KEY,
                            name VARCHAR(255) NOT NULL,
                            owner VARCHAR(255) NOT NULL,
                            icon VARCHAR(255) DEFAULT '🏠',
                            icon_type VARCHAR(50) DEFAULT 'emoji',
                            icon_data TEXT,
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
                    
                    # Admin settings table
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS admin_settings (
                            id INTEGER PRIMARY KEY DEFAULT 1,
                            server_name VARCHAR(255) DEFAULT 'Decentra',
                            server_description TEXT DEFAULT 'A decentralized chat platform',
                            custom_invite_link VARCHAR(255) DEFAULT '',
                            allow_registration BOOLEAN DEFAULT TRUE,
                            require_invite BOOLEAN DEFAULT FALSE,
                            max_message_length INTEGER DEFAULT 2000,
                            max_file_size_mb INTEGER DEFAULT 10,
                            allowed_file_types TEXT DEFAULT 'image/png,image/jpeg,image/gif,image/webp',
                            max_servers_per_user INTEGER DEFAULT 100,
                            max_channels_per_server INTEGER DEFAULT 50,
                            max_members_per_server INTEGER DEFAULT 1000,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            CHECK (id = 1)
                        )
                    ''')
                    
                    # Insert default settings if table is empty
                    cursor.execute('''
                        INSERT INTO admin_settings (id) 
                        VALUES (1) 
                        ON CONFLICT (id) DO NOTHING
                    ''')
                    
                    # Server roles table
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS server_roles (
                            role_id VARCHAR(255) PRIMARY KEY,
                            server_id VARCHAR(255) NOT NULL,
                            name VARCHAR(255) NOT NULL,
                            color VARCHAR(7) DEFAULT '#99AAB5',
                            position INTEGER DEFAULT 0,
                            permissions JSONB DEFAULT '{}',
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
                        )
                    ''')
                    
                    # User roles junction table
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS user_roles (
                            server_id VARCHAR(255) NOT NULL,
                            username VARCHAR(255) NOT NULL,
                            role_id VARCHAR(255) NOT NULL,
                            PRIMARY KEY (server_id, username, role_id),
                            FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
                            FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
                            FOREIGN KEY (role_id) REFERENCES server_roles(role_id) ON DELETE CASCADE
                        )
                    ''')
                    
                    # Email verification codes table
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS email_verification_codes (
                            email VARCHAR(255) NOT NULL,
                            code VARCHAR(10) NOT NULL,
                            username VARCHAR(255) NOT NULL,
                            created_at TIMESTAMP NOT NULL,
                            expires_at TIMESTAMP NOT NULL,
                            PRIMARY KEY (email, username)
                        )
                    ''')
                    
                    # Custom emojis table
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS custom_emojis (
                            emoji_id VARCHAR(255) PRIMARY KEY,
                            server_id VARCHAR(255) NOT NULL,
                            name VARCHAR(100) NOT NULL,
                            image_data TEXT NOT NULL,
                            uploader VARCHAR(255) NOT NULL,
                            created_at TIMESTAMP NOT NULL,
                            FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
                            FOREIGN KEY (uploader) REFERENCES users(username) ON DELETE CASCADE,
                            UNIQUE (server_id, name)
                        )
                    ''')
                    
                    # Message reactions table
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS message_reactions (
                            message_id INTEGER NOT NULL,
                            username VARCHAR(255) NOT NULL,
                            emoji VARCHAR(255) NOT NULL,
                            emoji_type VARCHAR(50) DEFAULT 'standard',
                            created_at TIMESTAMP NOT NULL,
                            PRIMARY KEY (message_id, username, emoji),
                            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
                            FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
                        )
                    ''')
                    
                    # Create index for faster reaction retrieval
                    cursor.execute('''
                        CREATE INDEX IF NOT EXISTS idx_reactions_message 
                        ON message_reactions(message_id)
                    ''')
                    
                    # Message attachments table
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS message_attachments (
                            attachment_id VARCHAR(255) PRIMARY KEY,
                            message_id INTEGER NOT NULL,
                            filename VARCHAR(255) NOT NULL,
                            content_type VARCHAR(100) NOT NULL,
                            file_size INTEGER NOT NULL,
                            file_data TEXT NOT NULL,
                            uploaded_at TIMESTAMP NOT NULL,
                            FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
                        )
                    ''')
                    
                    # Create index for faster attachment retrieval
                    cursor.execute('''
                        CREATE INDEX IF NOT EXISTS idx_attachments_message 
                        ON message_attachments(message_id)
                    ''')
                    
                    # Add notification_mode column if it doesn't exist (migration)
                    cursor.execute('''
                        DO $$ 
                        BEGIN
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'users' AND column_name = 'notification_mode'
                            ) THEN
                                ALTER TABLE users ADD COLUMN notification_mode VARCHAR(50) DEFAULT 'all';
                            END IF;
                        END $$;
                    ''')
                    
                    # Add email columns if they don't exist (migration)
                    cursor.execute('''
                        DO $$ 
                        BEGIN
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'users' AND column_name = 'email'
                            ) THEN
                                ALTER TABLE users ADD COLUMN email VARCHAR(255);
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'users' AND column_name = 'email_verified'
                            ) THEN
                                ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;
                            END IF;
                        END $$;
                    ''')
                    
                    # Add SMTP settings columns if they don't exist (migration)
                    cursor.execute('''
                        DO $$ 
                        BEGIN
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'admin_settings' AND column_name = 'smtp_enabled'
                            ) THEN
                                ALTER TABLE admin_settings ADD COLUMN smtp_enabled BOOLEAN DEFAULT FALSE;
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'admin_settings' AND column_name = 'smtp_host'
                            ) THEN
                                ALTER TABLE admin_settings ADD COLUMN smtp_host VARCHAR(255) DEFAULT '';
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'admin_settings' AND column_name = 'smtp_port'
                            ) THEN
                                ALTER TABLE admin_settings ADD COLUMN smtp_port INTEGER DEFAULT 587;
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'admin_settings' AND column_name = 'smtp_username'
                            ) THEN
                                ALTER TABLE admin_settings ADD COLUMN smtp_username VARCHAR(255) DEFAULT '';
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'admin_settings' AND column_name = 'smtp_password'
                            ) THEN
                                ALTER TABLE admin_settings ADD COLUMN smtp_password VARCHAR(255) DEFAULT '';
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'admin_settings' AND column_name = 'smtp_from_email'
                            ) THEN
                                ALTER TABLE admin_settings ADD COLUMN smtp_from_email VARCHAR(255) DEFAULT '';
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'admin_settings' AND column_name = 'smtp_from_name'
                            ) THEN
                                ALTER TABLE admin_settings ADD COLUMN smtp_from_name VARCHAR(255) DEFAULT 'Decentra';
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'admin_settings' AND column_name = 'smtp_use_tls'
                            ) THEN
                                ALTER TABLE admin_settings ADD COLUMN smtp_use_tls BOOLEAN DEFAULT TRUE;
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'admin_settings' AND column_name = 'require_email_verification'
                            ) THEN
                                ALTER TABLE admin_settings ADD COLUMN require_email_verification BOOLEAN DEFAULT FALSE;
                            END IF;
                        END $$;
                    ''')
                    
                    # Add server icon columns if they don't exist (migration)
                    cursor.execute('''
                        DO $$ 
                        BEGIN
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'servers' AND column_name = 'icon'
                            ) THEN
                                ALTER TABLE servers ADD COLUMN icon VARCHAR(255) DEFAULT '🏠';
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'servers' AND column_name = 'icon_type'
                            ) THEN
                                ALTER TABLE servers ADD COLUMN icon_type VARCHAR(50) DEFAULT 'emoji';
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'servers' AND column_name = 'icon_data'
                            ) THEN
                                ALTER TABLE servers ADD COLUMN icon_data TEXT;
                            END IF;
                        END $$;
                    ''')
                    
                    # Add announcement columns if they don't exist (migration)
                    cursor.execute('''
                        DO $$ 
                        BEGIN
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'admin_settings' AND column_name = 'announcement_enabled'
                            ) THEN
                                ALTER TABLE admin_settings ADD COLUMN announcement_enabled BOOLEAN DEFAULT FALSE;
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'admin_settings' AND column_name = 'announcement_message'
                            ) THEN
                                ALTER TABLE admin_settings ADD COLUMN announcement_message TEXT DEFAULT '';
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'admin_settings' AND column_name = 'announcement_duration_minutes'
                            ) THEN
                                ALTER TABLE admin_settings ADD COLUMN announcement_duration_minutes INTEGER DEFAULT 60;
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'admin_settings' AND column_name = 'announcement_set_at'
                            ) THEN
                                ALTER TABLE admin_settings ADD COLUMN announcement_set_at TIMESTAMP;
                            END IF;
                        END $$;
                    ''')
                    
                    # Add bio and status_message columns if they don't exist (migration)
                    cursor.execute('''
                        DO $$ 
                        BEGIN
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'users' AND column_name = 'bio'
                            ) THEN
                                ALTER TABLE users ADD COLUMN bio TEXT DEFAULT '';
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'users' AND column_name = 'status_message'
                            ) THEN
                                ALTER TABLE users ADD COLUMN status_message VARCHAR(100) DEFAULT '';
                            END IF;
                        END $$;
                    ''')
                    
                    # Add message edit/delete tracking columns if they don't exist (migration)
                    cursor.execute('''
                        DO $$ 
                        BEGIN
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'messages' AND column_name = 'edited_at'
                            ) THEN
                                ALTER TABLE messages ADD COLUMN edited_at TIMESTAMP;
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'messages' AND column_name = 'deleted'
                            ) THEN
                                ALTER TABLE messages ADD COLUMN deleted BOOLEAN DEFAULT FALSE;
                            END IF;
                        END $$;
                    ''')
                    
                    # Add message permission columns to server_members if they don't exist (migration)
                    cursor.execute('''
                        DO $$ 
                        BEGIN
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'server_members' AND column_name = 'can_edit_messages'
                            ) THEN
                                ALTER TABLE server_members ADD COLUMN can_edit_messages BOOLEAN DEFAULT FALSE;
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'server_members' AND column_name = 'can_delete_messages'
                            ) THEN
                                ALTER TABLE server_members ADD COLUMN can_delete_messages BOOLEAN DEFAULT FALSE;
                            END IF;
                        END $$;
                    ''')
                    
                    # Add file attachment settings columns if they don't exist (migration)
                    cursor.execute('''
                        DO $$ 
                        BEGIN
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'admin_settings' AND column_name = 'allow_file_attachments'
                            ) THEN
                                ALTER TABLE admin_settings ADD COLUMN allow_file_attachments BOOLEAN DEFAULT TRUE;
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'admin_settings' AND column_name = 'max_attachment_size_mb'
                            ) THEN
                                ALTER TABLE admin_settings ADD COLUMN max_attachment_size_mb INTEGER DEFAULT 10;
                            END IF;
                            IF NOT EXISTS (
                                SELECT 1 FROM information_schema.columns 
                                WHERE table_name = 'admin_settings' AND column_name = 'attachment_retention_days'
                            ) THEN
                                ALTER TABLE admin_settings ADD COLUMN attachment_retention_days INTEGER DEFAULT 0;
                            END IF;
                        END $$;
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
    def create_user(self, username: str, password_hash: str, email: str = None, email_verified: bool = False) -> bool:
        """Create a new user."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO users (username, password_hash, created_at, email, email_verified)
                    VALUES (%s, %s, %s, %s, %s)
                ''', (username, password_hash, datetime.now(), email, email_verified))
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
    
    def get_user_by_email(self, email: str) -> Optional[Dict]:
        """Get user data by email address."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM users WHERE email = %s', (email,))
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
    
    def update_notification_mode(self, username: str, notification_mode: str):
        """Update user notification mode."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE users 
                SET notification_mode = %s
                WHERE username = %s
            ''', (notification_mode, username))
    
    def update_user_profile(self, username: str, bio: str = None, status_message: str = None):
        """Update user profile bio and/or status message."""
        if bio is None and status_message is None:
            return  # Nothing to update
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            if bio is not None and status_message is not None:
                cursor.execute('''
                    UPDATE users 
                    SET bio = %s, status_message = %s
                    WHERE username = %s
                ''', (bio, status_message, username))
            elif bio is not None:
                cursor.execute('''
                    UPDATE users 
                    SET bio = %s
                    WHERE username = %s
                ''', (bio, username))
            elif status_message is not None:
                cursor.execute('''
                    UPDATE users 
                    SET status_message = %s
                    WHERE username = %s
                ''', (status_message, username))
    
    def verify_user_email(self, username: str) -> bool:
        """Mark user's email as verified."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    UPDATE users 
                    SET email_verified = TRUE
                    WHERE username = %s
                ''', (username,))
                return cursor.rowcount > 0
        except Exception:
            return False
    
    def create_email_verification_code(self, email: str, username: str, code: str, expires_at: datetime) -> bool:
        """Create or update an email verification code."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                # Delete any existing code for this email/username combination
                cursor.execute('''
                    DELETE FROM email_verification_codes 
                    WHERE email = %s AND username = %s
                ''', (email, username))
                
                # Insert new code
                cursor.execute('''
                    INSERT INTO email_verification_codes (email, code, username, created_at, expires_at)
                    VALUES (%s, %s, %s, %s, %s)
                ''', (email, code, username, datetime.now(), expires_at))
                return True
        except Exception:
            return False
    
    def get_email_verification_code(self, email: str, username: str) -> Optional[Dict]:
        """Get email verification code for a user."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT * FROM email_verification_codes 
                WHERE email = %s AND username = %s AND expires_at > %s
            ''', (email, username, datetime.now()))
            row = cursor.fetchone()
            if row:
                return dict(row)
            return None
    
    def delete_email_verification_code(self, email: str, username: str) -> bool:
        """Delete an email verification code."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    DELETE FROM email_verification_codes 
                    WHERE email = %s AND username = %s
                ''', (email, username))
                return True
        except Exception:
            return False
    
    def cleanup_expired_verification_codes(self):
        """Remove expired verification codes."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    DELETE FROM email_verification_codes 
                    WHERE expires_at <= %s
                ''', (datetime.now(),))
        except Exception as e:
            # Log and suppress cleanup errors to avoid impacting callers
            print(f"Error cleaning up expired verification codes: {e}")
    
    def get_first_user(self) -> Optional[str]:
        """Get the first user (admin) username."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT username FROM users 
                ORDER BY created_at ASC 
                LIMIT 1
            ''')
            row = cursor.fetchone()
            if row:
                return row['username']
            return None
    
    # Admin settings operations
    def get_admin_settings(self) -> Dict:
        """Get admin settings from database with decrypted SMTP password."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM admin_settings WHERE id = 1')
            row = cursor.fetchone()
            if row:
                settings = dict(row)
                # Remove internal fields
                settings.pop('id', None)
                settings.pop('created_at', None)
                settings.pop('updated_at', None)
                
                # Decrypt SMTP password if present
                if settings.get('smtp_password'):
                    try:
                        encryption_manager = get_encryption_manager()
                        settings['smtp_password'] = encryption_manager.decrypt(settings['smtp_password'])
                    except RuntimeError as e:
                        print(f"Error decrypting SMTP password: {e}")
                        # Return empty password if decryption fails with key mismatch
                        settings['smtp_password'] = ''
                
                return settings
            return {}
    
    def update_admin_settings(self, settings: Dict) -> bool:
        """Update admin settings in database with encrypted SMTP password."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                
                # Build dynamic UPDATE query from settings dict
                set_clauses = []
                values = []
                for key, value in settings.items():
                    if key not in ['id', 'created_at', 'updated_at']:
                        # Encrypt SMTP password before storing
                        if key == 'smtp_password' and value:
                            try:
                                encryption_manager = get_encryption_manager()
                                value = encryption_manager.encrypt(value)
                            except RuntimeError as e:
                                print(f"Error encrypting SMTP password: {e}")
                                # Return False to indicate save failure
                                return False
                        
                        set_clauses.append(f"{key} = %s")
                        values.append(value)
                
                # Add updated_at timestamp
                set_clauses.append("updated_at = CURRENT_TIMESTAMP")
                
                if set_clauses:
                    query = f"UPDATE admin_settings SET {', '.join(set_clauses)} WHERE id = 1"
                    cursor.execute(query, values)
                    return True
                return False
        except Exception as e:
            print(f"Error updating admin settings: {e}")
            return False
    
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
    
    def update_server_icon(self, server_id: str, icon: str, icon_type: str, icon_data: Optional[str] = None) -> bool:
        """Update server icon.
        
        Returns:
            bool: True if the server was updated, False if no rows were affected
            or if a database error occurred.
        """
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    UPDATE servers 
                    SET icon = %s, icon_type = %s, icon_data = %s
                    WHERE server_id = %s
                ''', (icon, icon_type, icon_data, server_id))
                return cursor.rowcount > 0
        except psycopg2.Error:
            return False
    
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
                SET can_create_channel = %s, can_edit_channel = %s, can_delete_channel = %s,
                    can_edit_messages = %s, can_delete_messages = %s
                WHERE server_id = %s AND username = %s
            ''', (
                permissions.get('can_create_channel', False),
                permissions.get('can_edit_channel', False),
                permissions.get('can_delete_channel', False),
                permissions.get('can_edit_messages', False),
                permissions.get('can_delete_messages', False),
                server_id, username
            ))
    
    # Role operations
    def create_role(self, role_id: str, server_id: str, name: str, color: str,
                    position: int = 0, permissions: Dict = None) -> bool:
        """Create a new server role."""
        try:
            if permissions is None:
                permissions = {}
            
            print(f"[DB] Attempting to create role: id={role_id}, server={server_id}, name={name}", flush=True)
            
            with self.get_connection() as conn:
                cursor = conn.cursor()
                print(f"[DB] Executing INSERT for role {role_id}", flush=True)
                cursor.execute('''
                    INSERT INTO server_roles (role_id, server_id, name, color, position, permissions)
                    VALUES (%s, %s, %s, %s, %s, %s)
                ''', (role_id, server_id, name, color, position, json.dumps(permissions)))
                print(f"[DB] INSERT executed successfully", flush=True)
                return True
        except psycopg2.IntegrityError as e:
            print(f"IntegrityError creating role: {e}", flush=True)
            return False
        except Exception as e:
            print(f"Error creating role: {e}", flush=True)
            import traceback
            traceback.print_exc()
            return False
    
    def get_server_roles(self, server_id: str) -> List[Dict]:
        """Get all roles for a server."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT role_id, server_id, name, color, position, permissions, created_at
                FROM server_roles
                WHERE server_id = %s
                ORDER BY position DESC
            ''', (server_id,))
            roles = []
            for row in cursor.fetchall():
                role = dict(row)
                # Parse JSON permissions
                if isinstance(role['permissions'], str):
                    role['permissions'] = json.loads(role['permissions'])
                roles.append(role)
            return roles
    
    def get_role(self, role_id: str) -> Optional[Dict]:
        """Get a specific role."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT role_id, server_id, name, color, position, permissions, created_at
                FROM server_roles
                WHERE role_id = %s
            ''', (role_id,))
            row = cursor.fetchone()
            if row:
                role = dict(row)
                if isinstance(role['permissions'], str):
                    role['permissions'] = json.loads(role['permissions'])
                return role
            return None
    
    def update_role(self, role_id: str, name: str = None, color: str = None, 
                    position: int = None, permissions: Dict = None) -> bool:
        """Update a role."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                updates = []
                values = []
                
                if name is not None:
                    updates.append("name = %s")
                    values.append(name)
                if color is not None:
                    updates.append("color = %s")
                    values.append(color)
                if position is not None:
                    updates.append("position = %s")
                    values.append(position)
                if permissions is not None:
                    updates.append("permissions = %s")
                    values.append(json.dumps(permissions))
                
                if updates:
                    values.append(role_id)
                    query = f"UPDATE server_roles SET {', '.join(updates)} WHERE role_id = %s"
                    cursor.execute(query, values)
                    return True
                return False
        except Exception as e:
            print(f"Error updating role: {e}")
            return False
    
    def delete_role(self, role_id: str) -> bool:
        """Delete a role."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('DELETE FROM server_roles WHERE role_id = %s', (role_id,))
                return True
        except Exception as e:
            print(f"Error deleting role: {e}")
            return False
    
    def assign_role(self, server_id: str, username: str, role_id: str) -> bool:
        """Assign a role to a user."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO user_roles (server_id, username, role_id)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (server_id, username, role_id) DO NOTHING
                ''', (server_id, username, role_id))
                return True
        except Exception as e:
            print(f"Error assigning role: {e}")
            return False
    
    def remove_role_from_user(self, server_id: str, username: str, role_id: str) -> bool:
        """Remove a role from a user."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    DELETE FROM user_roles
                    WHERE server_id = %s AND username = %s AND role_id = %s
                ''', (server_id, username, role_id))
                return True
        except Exception as e:
            print(f"Error removing role: {e}")
            return False
    
    def get_user_roles(self, server_id: str, username: str) -> List[Dict]:
        """Get all roles assigned to a user in a server."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT r.role_id, r.server_id, r.name, r.color, r.position, r.permissions
                FROM server_roles r
                JOIN user_roles ur ON r.role_id = ur.role_id
                WHERE ur.server_id = %s AND ur.username = %s
                ORDER BY r.position DESC
            ''', (server_id, username))
            roles = []
            for row in cursor.fetchall():
                role = dict(row)
                if isinstance(role['permissions'], str):
                    role['permissions'] = json.loads(role['permissions'])
                roles.append(role)
            return roles
    
    def get_role_members(self, role_id: str) -> List[str]:
        """Get all users assigned to a role."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT username FROM user_roles WHERE role_id = %s
            ''', (role_id,))
            return [row['username'] for row in cursor.fetchall()]
    
    # Message operations
    def save_message(self, username: str, content: str, context_type: str, context_id: Optional[str] = None) -> int:
        """Save a message and return its ID. Message content is encrypted before storage."""
        # Encrypt message content before storing
        try:
            encrypted_content = self.encryption_manager.encrypt(content)
        except RuntimeError as e:
            # Re-raise with additional context about the message save operation
            raise RuntimeError(f"Failed to save message: encryption error - {e}") from e
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO messages (username, content, timestamp, context_type, context_id)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
            ''', (username, encrypted_content, datetime.now(), context_type, context_id))
            result = cursor.fetchone()
            return result['id']
    
    def get_messages(self, context_type: str, context_id: Optional[str] = None, limit: int = 100) -> List[Dict]:
        """Get messages for a context. Message content is decrypted before returning."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT m.id, m.username, m.content, 
                       m.timestamp::text as timestamp,
                       m.context_type, m.context_id,
                       m.edited_at::text as edited_at,
                       m.deleted,
                       u.avatar, u.avatar_type, u.avatar_data
                FROM messages m
                LEFT JOIN users u ON m.username = u.username
                WHERE m.context_type = %s AND m.context_id = %s
                ORDER BY m.timestamp DESC
                LIMIT %s
            ''', (context_type, context_id, limit))
            # Decrypt message content and reverse to get chronological order
            messages = []
            for row in reversed(cursor.fetchall()):
                msg = dict(row)
                # Decrypt the message content
                msg['content'] = self.encryption_manager.decrypt(msg['content'])
                messages.append(msg)
            return messages
    
    def edit_message(self, message_id: int, new_content: str) -> bool:
        """Edit a message. Returns True if successful, False otherwise."""
        try:
            encrypted_content = self.encryption_manager.encrypt(new_content)
        except RuntimeError as e:
            raise RuntimeError(f"Failed to edit message: encryption error - {e}") from e
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE messages 
                SET content = %s, edited_at = %s
                WHERE id = %s AND deleted = FALSE
            ''', (encrypted_content, datetime.now(), message_id))
            return cursor.rowcount > 0
    
    def delete_message(self, message_id: int) -> bool:
        """Mark a message as deleted. Returns True if successful, False if already deleted or not found."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE messages 
                SET deleted = TRUE, content = %s
                WHERE id = %s AND deleted = FALSE
            ''', (self.encryption_manager.encrypt('[Message deleted]'), message_id))
            return cursor.rowcount > 0
    
    def get_message(self, message_id: int) -> Optional[Dict]:
        """Get a single message by ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT m.id, m.username, m.content, 
                       m.timestamp::text as timestamp,
                       m.context_type, m.context_id,
                       m.edited_at::text as edited_at,
                       m.deleted
                FROM messages m
                WHERE m.id = %s
            ''', (message_id,))
            row = cursor.fetchone()
            if row:
                msg = dict(row)
                # Decrypt the message content
                msg['content'] = self.encryption_manager.decrypt(msg['content'])
                return msg
            return None
    
    # Message attachment operations
    def save_attachment(self, attachment_id: str, message_id: int, filename: str, 
                       content_type: str, file_size: int, file_data: str) -> bool:
        """Save a file attachment for a message."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO message_attachments 
                (attachment_id, message_id, filename, content_type, file_size, file_data, uploaded_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            ''', (attachment_id, message_id, filename, content_type, file_size, file_data, datetime.now()))
            return cursor.rowcount > 0
    
    def get_attachment(self, attachment_id: str) -> Optional[Dict]:
        """Get a file attachment by ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT attachment_id, message_id, filename, content_type, 
                       file_size, file_data, uploaded_at::text as uploaded_at
                FROM message_attachments
                WHERE attachment_id = %s
            ''', (attachment_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
    
    def get_message_attachments(self, message_id: int) -> List[Dict]:
        """Get all attachments for a message."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT attachment_id, message_id, filename, content_type, 
                       file_size, uploaded_at::text as uploaded_at
                FROM message_attachments
                WHERE message_id = %s
                ORDER BY uploaded_at ASC
            ''', (message_id,))
            return [dict(row) for row in cursor.fetchall()]
    
    def delete_old_attachments(self, days: int) -> int:
        """Delete attachments older than specified days. Returns count of deleted attachments."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                DELETE FROM message_attachments
                WHERE uploaded_at < NOW() - make_interval(days => %s)
            ''', (days,))
            return cursor.rowcount
    
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
    
    # Custom emoji operations
    def create_custom_emoji(self, emoji_id: str, server_id: str, name: str, 
                           image_data: str, uploader: str) -> bool:
        """Create a custom emoji for a server."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO custom_emojis (emoji_id, server_id, name, image_data, uploader, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                ''', (emoji_id, server_id, name, image_data, uploader, datetime.now()))
                return True
        except psycopg2.IntegrityError:
            return False
    
    def get_server_emojis(self, server_id: str) -> List[Dict]:
        """Get all custom emojis for a server."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT emoji_id, name, image_data, uploader, created_at::text as created_at
                FROM custom_emojis
                WHERE server_id = %s
                ORDER BY created_at ASC
            ''', (server_id,))
            return [dict(row) for row in cursor.fetchall()]
    
    def get_custom_emoji(self, emoji_id: str) -> Optional[Dict]:
        """Get a specific custom emoji."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT emoji_id, server_id, name, image_data, uploader, created_at::text as created_at
                FROM custom_emojis
                WHERE emoji_id = %s
            ''', (emoji_id,))
            result = cursor.fetchone()
            return dict(result) if result else None
    
    def delete_custom_emoji(self, emoji_id: str) -> bool:
        """Delete a custom emoji."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM custom_emojis WHERE emoji_id = %s', (emoji_id,))
            return cursor.rowcount > 0
    
    # Message reaction operations
    def add_reaction(self, message_id: int, username: str, emoji: str, emoji_type: str = 'standard') -> bool:
        """Add a reaction to a message."""
        try:
            with self.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO message_reactions (message_id, username, emoji, emoji_type, created_at)
                    VALUES (%s, %s, %s, %s, %s)
                ''', (message_id, username, emoji, emoji_type, datetime.now()))
                return True
        except psycopg2.IntegrityError:
            # Reaction already exists
            return False
    
    def remove_reaction(self, message_id: int, username: str, emoji: str) -> bool:
        """Remove a reaction from a message."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                DELETE FROM message_reactions 
                WHERE message_id = %s AND username = %s AND emoji = %s
            ''', (message_id, username, emoji))
            return cursor.rowcount > 0
    
    def get_message_reactions(self, message_id: int) -> List[Dict]:
        """Get all reactions for a message."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT username, emoji, emoji_type, created_at::text as created_at
                FROM message_reactions
                WHERE message_id = %s
                ORDER BY created_at ASC
            ''', (message_id,))
            return [dict(row) for row in cursor.fetchall()]
    
    def get_reactions_for_messages(self, message_ids: List[int]) -> Dict[int, List[Dict]]:
        """
        Get reactions for multiple messages.
        
        Args:
            message_ids: List of message IDs to get reactions for
            
        Returns:
            Dictionary mapping message IDs to lists of reaction dictionaries.
            Each reaction dict contains: username, emoji, emoji_type, created_at
            Example: {123: [{'username': 'alice', 'emoji': '👍', ...}], 124: [...]}
        """
        if not message_ids:
            return {}
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT message_id, username, emoji, emoji_type, created_at::text as created_at
                FROM message_reactions
                WHERE message_id = ANY(%s)
                ORDER BY message_id, created_at ASC
            ''', (message_ids,))
            
            # Group reactions by message_id
            reactions_by_message = {}
            for row in cursor.fetchall():
                msg_id = row['message_id']
                if msg_id not in reactions_by_message:
                    reactions_by_message[msg_id] = []
                reactions_by_message[msg_id].append({
                    'username': row['username'],
                    'emoji': row['emoji'],
                    'emoji_type': row['emoji_type'],
                    'created_at': row['created_at']
                })
            
            return reactions_by_message
