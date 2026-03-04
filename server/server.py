#!/usr/bin/env python3
"""
Decentra Chat Server
A simple WebSocket-based chat server for decentralized communication.
"""

import asyncio
import json
import logging
import websockets
from datetime import datetime, timedelta, timezone
import bcrypt
import secrets
import string
import random
import re
from aiohttp import web
import os
import base64
import hashlib
import hmac as _hmac_mod
import time
import jwt
import pyotp
import qrcode
import io
import traceback
from database import Database
from api import setup_api_routes
from email_utils import EmailSender
from ssl_utils import generate_self_signed_cert, create_ssl_context
from license_validator import license_validator, check_feature_access, check_limit, enforce_limit, DEFAULT_FEATURES, DEFAULT_LIMITS
from bot_scopes import has_scope, has_intent, get_effective_scopes, EVENT_INTENT_MAP, \
    SCOPE_SEND_MESSAGES, SCOPE_READ_MESSAGES, SCOPE_MANAGE_MESSAGES, SCOPE_ADMINISTRATOR

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# Initialize database
db = Database()

# JWT Configuration
# Generate or load a secure secret key for JWT tokens.
# In production, JWT_SECRET_KEY should be provided via environment variable or a secrets manager.
def _load_jwt_secret_key() -> str:
    """
    Load the JWT secret key from the environment or from a local secret file.

    Precedence:
    1. JWT_SECRET_KEY environment variable
    2. Secret stored in .jwt_secret_key file alongside this server script
    3. Newly generated secret, which is then persisted to the secret file
    """
    env_key = os.environ.get("JWT_SECRET_KEY")
    if env_key:
        return env_key

    secret_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".jwt_secret_key")
    try:
        with open(secret_file, "r", encoding="utf-8") as f:
            file_key = f.read().strip()
            if file_key:
                return file_key
    except FileNotFoundError:
        pass
    except OSError:
        # If the file cannot be read for any reason, fall back to generating a new key
        pass

    # Generate a new secret key and persist it for future restarts
    new_key = secrets.token_urlsafe(32)
    try:
        # Best-effort persistence; if this fails, the key will only live for this process
        with open(secret_file, "w", encoding="utf-8") as f:
            f.write(new_key)
    except OSError:
        pass

    return new_key

JWT_SECRET_KEY = _load_jwt_secret_key()
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_HOURS = 24  # Token expires after 24 hours

# ── LiveKit SFU Configuration ───────────────────────────────────────────────
# These env vars must match the keys: block in livekit.yaml.
# LIVEKIT_URL is the WebSocket URL that BROWSERS use to connect to LiveKit;
# set to wss://your-domain.com:7880 in production.
LIVEKIT_API_KEY    = os.environ.get('LIVEKIT_API_KEY', '')
LIVEKIT_API_SECRET = os.environ.get('LIVEKIT_API_SECRET', '')
LIVEKIT_URL        = os.environ.get('LIVEKIT_URL', 'ws://localhost:7880')
# ── Coturn TURN Relay ───────────────────────────────────────────────────────
# Self-hosted Coturn instance for ICE relay (both P2P DM calls and SFU fallback).
# COTURN_SECRET must match the static-auth-secret in coturn/coturn.conf.
# COTURN_URL is the TURN URI clients connect to (e.g., turn:your-domain.com:3478).
COTURN_SECRET = os.environ.get('COTURN_SECRET', '')
COTURN_URL    = os.environ.get('COTURN_URL', 'turn:localhost:3478')
COTURN_REALM  = os.environ.get('COTURN_REALM', 'decentra.local')
# ────────────────────────────────────────────────────────────────────────────

# Store pending signups temporarily (in-memory)
# Format: {username: {password_hash, email, invite_code, inviter_username}}
# NOTE: This is an in-memory store and will be cleared on server restart.
# For production environments with multiple server instances, consider using Redis or a database table.
pending_signups = {}

# Rate limiting for password reset requests (in-memory)
# Format: {identifier: [timestamp1, timestamp2, ...]}
# NOTE: This is an in-memory store and will be cleared on server restart.
# For production environments with multiple server instances, consider using Redis or a database table.
password_reset_attempts = {}
PASSWORD_RESET_MAX_ATTEMPTS = 3  # Maximum attempts per time window
PASSWORD_RESET_TIME_WINDOW = 3600  # Time window in seconds (1 hour)

# Store connected clients: {websocket: username}
clients = {}
# Store message history (deprecated - now per server/channel)
messages = []
MAX_HISTORY = 100
MAX_AVATAR_SIZE = 2 * 1024 * 1024  # 2MB

# Periodic cleanup intervals (in seconds)
CLEANUP_INTERVAL_HOURLY = 3600  # 1 hour
CLEANUP_INTERVAL_DAILY = 86400  # 24 hours

# Runtime-only data structures (not persisted)
# Store voice calls: {call_id: {participants: set(), type: 'direct'|'channel', server_id: str, channel_id: str}}
voice_calls = {}
# Store voice state: {username: {in_voice: bool, channel_id: str, server_id: str, muted: bool, video: bool, screen_sharing: bool}}
voice_states = {}
# Store voice members per channel: {server_id/channel_id: set(usernames)}
voice_members = {}
# Store soundboard play cooldowns: {username: last_play_timestamp}
soundboard_cooldowns = {}

# Typing indicators: {context_key: {username: asyncio.TimerHandle}}
typing_states: dict = {}

# Bot system: connected bot WebSocket clients
# {websocket: {bot_id, username, scopes, intents, servers}}
bot_clients = {}
# Bot rate limiting: {bot_id: {channel_id: [timestamps], 'api': [timestamps]}}
bot_rate_limits = {}

# Helper counters for IDs (load from database on startup)
server_counter = 0
channel_counter = 0
category_counter = 0
dm_counter = 0
role_counter = 0
thread_counter = 0


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
    # Map role_id to id for frontend compatibility
    if 'role_id' in serialized:
        serialized['id'] = serialized['role_id']
    # Ensure hoist field is present
    if 'hoist' not in serialized:
        serialized['hoist'] = False
    # Ensure permissions is always a dict
    perms = serialized.get('permissions', {})
    if isinstance(perms, list):
        serialized['permissions'] = {k: True for k in perms}
    return serialized


def verify_password(password, password_hash):
    """Verify a password against its hash."""
    return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))


def generate_2fa_secret():
    """Generate a new 2FA secret."""
    return pyotp.random_base32()


def generate_backup_codes(count=10):
    """Generate backup codes for 2FA."""
    codes = []
    for _ in range(count):
        # Generate 8-character alphanumeric code
        code = ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8))
        codes.append(code)
    return codes


def verify_2fa_token(secret, token):
    """Verify a 2FA token."""
    totp = pyotp.TOTP(secret)
    # Allow for 1 time step before and after for clock drift
    return totp.verify(token, valid_window=1)


def generate_qr_code_base64(username, secret, issuer_name="Decentra"):
    """Generate a QR code for 2FA setup."""
    # Create provisioning URI
    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(name=username, issuer_name=issuer_name)
    
    # Generate QR code
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(uri)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    
    # Convert to base64
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0)
    img_base64 = base64.b64encode(buffer.read()).decode()
    
    return f"data:image/png;base64,{img_base64}"


def generate_jwt_token(username):
    """Generate a JWT token for a user."""
    now = datetime.now(timezone.utc)
    payload = {
        'username': username,
        'exp': now + timedelta(hours=JWT_EXPIRATION_HOURS),
        'iat': now
    }
    token = jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    return token


def log_admin_check(username, first_user, is_admin, context=""):
    """Log admin status check with detailed type and value information.
    
    Args:
        username: Current username being checked
        first_user: The first user (admin) username from database
        is_admin: Boolean result of admin check
        context: Optional context string (e.g., "init message" or "check_admin")
    """
    prefix = f"[{datetime.now().strftime('%H:%M:%S')}]"
    context_str = f" ({context})" if context else ""
    print(f"{prefix} Admin check for {username}{context_str}: first_user={first_user}, is_admin={is_admin}")
    
    # Log detailed type and value information for debugging
    username_type = type(username).__name__
    first_user_type = type(first_user).__name__ if first_user else 'NoneType'
    print(f"{prefix} Debug{context_str}: username='{username}' (type: {username_type}), "
          f"first_user='{first_user}' (type: {first_user_type})")



def verify_jwt_token(token):
    """Verify a JWT token and return the username if valid."""
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return payload.get('username')
    except jwt.ExpiredSignatureError:
        return None  # Token has expired
    except jwt.InvalidTokenError:
        return None  # Invalid token


def generate_livekit_token(room_name: str, participant_identity: str, participant_name: str = '') -> str | None:
    """
    Generate a signed LiveKit room-join JWT for a participant.

    Returns None if LIVEKIT_API_KEY or LIVEKIT_API_SECRET are not configured,
    which means the server is running without the SFU — callers fall back to
    the existing P2P WebRTC path.
    """
    if not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        return None

    now = int(time.time())
    claims = {
        'iss': LIVEKIT_API_KEY,
        'sub': participant_identity,
        'exp': now + 3600,    # 1-hour token lifetime (hardened from 24 h)
        'nbf': now,
        'video': {
            'room': room_name,
            'roomJoin': True,
            'canPublish': True,
            'canSubscribe': True,
        },
        'metadata': json.dumps({'room': room_name}),
    }
    if participant_name:
        claims['name'] = participant_name
    return jwt.encode(claims, LIVEKIT_API_SECRET, algorithm='HS256')


def check_password_reset_rate_limit(identifier: str) -> bool:
    """
    Check if a password reset request should be allowed based on rate limiting.
    
    Args:
        identifier: Username or email requesting password reset
        
    Returns:
        True if request is allowed, False if rate limit exceeded
    """
    current_time = datetime.now(timezone.utc)
    
    # Clean up old attempts outside the time window
    if identifier in password_reset_attempts:
        password_reset_attempts[identifier] = [
            timestamp for timestamp in password_reset_attempts[identifier]
            if (current_time - timestamp).total_seconds() < PASSWORD_RESET_TIME_WINDOW
        ]
        
        # Remove empty lists to keep memory clean
        if not password_reset_attempts[identifier]:
            del password_reset_attempts[identifier]
    
    # Check if rate limit is exceeded
    attempts = password_reset_attempts.get(identifier, [])
    if len(attempts) >= PASSWORD_RESET_MAX_ATTEMPTS:
        return False
    
    # Record this attempt
    if identifier not in password_reset_attempts:
        password_reset_attempts[identifier] = []
    password_reset_attempts[identifier].append(current_time)
    
    return True


def is_valid_email(email):
    """Validate email address format using regex."""
    # Basic email format check (restrictive subset of RFC 5322; does not support all valid addresses)
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(email_pattern, email) is not None


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


def get_next_category_id():
    """Get next category ID."""
    global category_counter
    category_counter += 1
    return f"category_{category_counter}"


def get_next_role_id():
    """Get next role ID."""
    global role_counter
    role_counter += 1
    return f"role_{role_counter}"


def get_next_thread_id():
    """Get next thread ID."""
    global thread_counter
    thread_counter += 1
    return f"thread_{thread_counter}"


def get_next_dm_id():
    """Get next DM ID."""
    global dm_counter
    dm_counter += 1
    return f"dm_{dm_counter}"


def create_message_object(username, msg_content, context, context_id, user_profile, message_key=None, message_id=None, reply_data=None):
    """
    Create a message object with common fields.
    
    Args:
        username: Username of the sender
        msg_content: Message content
        context: Message context ('server', 'dm', or 'global')
        context_id: Context-specific ID (server/channel, dm_id, or None)
        user_profile: User profile dict containing avatar info
        message_key: Optional messageKey for file attachment correlation
        message_id: Optional message ID from database
        reply_data: Optional dict with reply information {id, username, content, deleted}
    
    Returns:
        Dict containing the message object
    """
    msg_obj = {
        'type': 'message',
        'username': username,
        'content': msg_content,
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'context': context,
        'context_id': context_id,
        'avatar': user_profile.get('avatar', '👤') if user_profile else '👤',
        'avatar_type': user_profile.get('avatar_type', 'emoji') if user_profile else 'emoji',
        'avatar_data': user_profile.get('avatar_data') if user_profile else None,
        'user_status': get_user_status(username)
    }
    
    # Add role color for server messages
    if context == 'server' and context_id:
        # Extract server_id from context_id (format: server_id/channel_id)
        server_id = context_id.split('/')[0] if '/' in context_id else None
        if server_id:
            role_color = get_highest_role_color(server_id, username)
            if role_color:
                msg_obj['role_color'] = role_color
    
    # Add message ID if provided
    if message_id is not None:
        msg_obj['id'] = message_id
        # Only query attachments when we know this message is associated with them
        if message_key:
            msg_obj['attachments'] = db.get_message_attachments(message_id)
        else:
            msg_obj['attachments'] = []
    
    # Add messageKey if provided (for file attachment correlation)
    if message_key:
        msg_obj['messageKey'] = message_key
    
    # Add reply data if provided
    if reply_data:
        msg_obj['reply_data'] = reply_data
    
    # Add reactions and mentions for new messages
    msg_obj['reactions'] = []
    msg_obj['mentions'] = []
    
    # Add is_bot flag if the sender is a bot
    user_record = db.get_user(username)
    if user_record and user_record.get('is_bot'):
        msg_obj['is_bot'] = True
    
    return msg_obj


def init_counters_from_db():
    """Initialize ID counters from database."""
    global server_counter, channel_counter, category_counter, dm_counter, role_counter
    
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
    
    # Get highest category ID
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT category_id FROM categories')
        category_ids = [row['category_id'] for row in cursor.fetchall()]
        if category_ids:
            max_category = max([int(c.split('_')[1]) for c in category_ids] + [0])
            category_counter = max_category
    
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

    # Get highest thread ID
    global thread_counter
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT thread_id FROM threads')
        t_ids = [row['thread_id'] for row in cursor.fetchall()]
        if t_ids:
            max_thread = max([int(t.split('_')[1]) for t in t_ids if len(t.split('_')) == 2 and t.split('_')[1].isdigit()] + [0])
            thread_counter = max_thread


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


def get_profile_data(username):
    """Get profile data (bio and status) for a user."""
    user = db.get_user(username)
    if not user:
        return {'bio': '', 'status_message': ''}
    
    return {
        'bio': user.get('bio', ''),
        'status_message': user.get('status_message', '')
    }


def get_user_status(username):
    """Get user status for a user."""
    user = db.get_user(username)
    if not user:
        return 'online'
    
    return user.get('user_status', 'online')


def build_user_servers_data(username):
    """Build server list data for a user including categories, channels and permissions."""
    user_servers = []
    user_server_ids = db.get_user_servers(username)
    
    for server_id in user_server_ids:
        server_data = db.get_server(server_id)
        if server_data:
            channels = db.get_server_channels(server_id)
            categories = db.get_server_categories(server_id)
            server_info = {
                'id': server_id,
                'name': server_data['name'],
                'owner': server_data['owner'],
                'icon': server_data.get('icon', '🏠'),
                'icon_type': server_data.get('icon_type', 'emoji'),
                'icon_data': server_data.get('icon_data'),
                'categories': [
                    {'id': cat['category_id'], 'name': cat['name'], 'position': cat.get('position', 0)}
                    for cat in categories
                ],
                'channels': [
                    {
                        'id': ch['channel_id'],
                        'name': ch['name'],
                        'type': ch.get('type', 'text'),
                        'category_id': ch.get('category_id'),
                        'position': ch.get('position', 0)
                    }
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
                            'can_delete_channel': member.get('can_delete_channel', False),
                            'can_edit_messages': member.get('can_edit_messages', False),
                            'can_delete_messages': member.get('can_delete_messages', False)
                        }
                        # Check rules_pending status
                        if not member.get('rules_accepted', True):
                            server_settings = db.get_server_settings(server_id)
                            if server_settings and server_settings.get('rules_enabled'):
                                server_info['rules_pending'] = True
                                server_info['rules_text'] = server_settings.get('rules_text', '')
                        break
            user_servers.append(server_info)
    
    return user_servers


def build_user_dms_data(username):
    """Build DM list data for a user including avatar data."""
    user_dms = []
    dm_list = db.get_user_dms(username)
    
    for dm in dm_list:
        other_user = dm['user2'] if dm['user1'] == username else dm['user1']
        avatar_data = get_avatar_data(other_user)
        user_status = get_user_status(other_user)
        user_dms.append({
            'id': dm['dm_id'],
            'username': other_user,
            **avatar_data,
            'user_status': user_status
        })
    
    return user_dms


def build_user_friends_data(username):
    """Build friends list data for a user including avatar and profile data."""
    friends_list = []
    
    for friend in db.get_friends(username):
        avatar_data = get_avatar_data(friend)
        profile_data = get_profile_data(friend)
        user_status = get_user_status(friend)
        friends_list.append({
            'username': friend,
            **avatar_data,
            **profile_data,
            'user_status': user_status
        })
    
    return friends_list


def build_friend_requests_data(username):
    """Build friend request lists for a user."""
    friend_requests_sent = []
    for requested_user in db.get_friend_requests_sent(username):
        avatar_data = get_avatar_data(requested_user)
        profile_data = get_profile_data(requested_user)
        friend_requests_sent.append({
            'username': requested_user,
            **avatar_data,
            **profile_data
        })
    
    friend_requests_received = []
    for requester_user in db.get_friend_requests_received(username):
        avatar_data = get_avatar_data(requester_user)
        profile_data = get_profile_data(requester_user)
        friend_requests_received.append({
            'username': requester_user,
            **avatar_data,
            **profile_data
        })
    
    return friend_requests_sent, friend_requests_received


def has_permission(server_id, username, permission):
    """Check if user has specific permission in a server through roles.
    Owner always has all permissions.
    Admin role always has all permissions.
    Permission can be: 'administrator', 'manage_server', 'create_invite', 'create_channel', 
                       'manage_channels', 'delete_messages', 'edit_messages', 'send_files', 
                       'ban_members', 'manage_roles', 'access_settings'
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
        perms = role.get('permissions', {})
        # Coerce legacy array format to dict
        if isinstance(perms, list):
            perms = {k: True for k in perms}
        
        # Administrator role has all permissions
        if perms.get('administrator', False):
            return True
        
        # Check if role has the requested permission
        if perms.get(permission, False):
            return True
    
    # Legacy: Check old permission system for backward compatibility
    if permission in ['can_create_channel', 'can_edit_channel', 'can_delete_channel']:
        members = db.get_server_members(server_id)
        for member in members:
            if member['username'] == username:
                return member.get(permission, False)
    
    # Default: no permission
    return False


def is_server_admin(server_id, username):
    """Check if user is a server administrator (owner or has admin role)."""
    return has_permission(server_id, username, 'administrator')


def get_highest_role_color(server_id, username):
    """Get the color of the highest role for a user in a server.
    Returns None if user has no roles or if not in a server context.
    """
    if not server_id or not username:
        return None
    
    user_roles = db.get_user_roles(server_id, username)
    if not user_roles:
        return None
    
    # Return the color of the first role (roles are ordered by position/priority)
    # If you want to implement role ordering later, the first role should be the highest
    for role in user_roles:
        color = role.get('color')
        if color:
            return color
    
    return None


def get_default_permissions():
    """Get default permissions for new server members."""
    return {
        'can_create_channel': False,
        'can_edit_channel': False,
        'can_delete_channel': False
    }


def get_admin_permissions():
    """Get all permissions for administrator role."""
    return {
        'administrator': True,
        'manage_server': True,
        'manage_channels': True,
        'manage_categories': True,
        'manage_roles': True,
        'create_invite': True,
        'ban_members': True,
        'delete_messages': True,
        'edit_messages': True,
        'send_files': True,
        'access_settings': True
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


async def broadcast_to_server(server_id, message, exclude=None, channel_id=None):
    """Broadcast a message to all members of a server, or to all users if server_id is None.
    If channel_id is provided, only members with view_channel permission for that channel receive it.
    """
    if server_id is None:
        # Broadcast to all connected users (for instance webhooks)
        tasks = []
        for client_ws, client_username in clients.items():
            if client_ws != exclude:
                tasks.append(client_ws.send_str(message))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
    else:
        # Broadcast to specific server members
        server_members_data = db.get_server_members(server_id)
        server_members = {m['username'] for m in server_members_data}
        
        tasks = []
        for client_ws, client_username in clients.items():
            if client_username in server_members and client_ws != exclude:
                # If channel_id provided, enforce view_channel permission
                if channel_id:
                    server = db.get_server(server_id)
                    # Owners always see all channels
                    if server and server['owner'] == client_username:
                        tasks.append(client_ws.send_str(message))
                        continue
                    # Check channel overrides — if any override exists, enforce
                    overrides = db.get_channel_all_overrides(channel_id)
                    if overrides:
                        if db.has_channel_permission(server_id, client_username, channel_id, 'view_channel'):
                            tasks.append(client_ws.send_str(message))
                    else:
                        # No overrides set — default allow
                        tasks.append(client_ws.send_str(message))
                else:
                    tasks.append(client_ws.send_str(message))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)



async def send_to_user(username, message):
    """Send a message to a specific user."""
    for client_ws, client_username in clients.items():
        if client_username == username:
            await client_ws.send_str(message)
            break


def check_bot_rate_limit(bot_id: str, limit_type: str, limit: int, window: int = 10, channel_id: str = None) -> tuple:
    """Check and enforce bot rate limiting.
    
    Args:
        bot_id: The bot's ID
        limit_type: 'messages' or 'api'
        limit: Maximum number of actions per window
        window: Time window in seconds (default 10 for messages, 60 for api)
        channel_id: Optional channel ID for per-channel message limits
    
    Returns:
        (allowed: bool, retry_after: float)
    """
    import time as _time
    now = _time.time()
    
    if bot_id not in bot_rate_limits:
        bot_rate_limits[bot_id] = {}
    
    key = channel_id or limit_type
    if key not in bot_rate_limits[bot_id]:
        bot_rate_limits[bot_id][key] = []
    
    # Remove timestamps outside the window
    bot_rate_limits[bot_id][key] = [t for t in bot_rate_limits[bot_id][key] if now - t < window]
    
    if len(bot_rate_limits[bot_id][key]) >= limit:
        oldest = bot_rate_limits[bot_id][key][0]
        retry_after = window - (now - oldest)
        return False, retry_after
    
    bot_rate_limits[bot_id][key].append(now)
    return True, 0


async def deliver_bot_event(event_name: str, data: dict, server_id: str = None, channel_id: str = None):
    """Deliver an event to all bot WebSocket clients that are subscribed to the intent.
    
    Args:
        event_name: The event name (e.g., 'message_create')
        data: The event payload
        server_id: The server this event belongs to (for filtering)
        channel_id: Optional channel ID
    """
    if not bot_clients:
        return
    
    event_msg = json.dumps({
        'type': 'bot_event',
        'event': event_name,
        'data': data,
        'server_id': server_id,
        'channel_id': channel_id
    })
    
    tasks = []
    for ws, bot_info in bot_clients.items():
        # Check if bot is subscribed to this event's intent
        if not has_intent(bot_info.get('intents', []), event_name):
            continue
        # Check if bot is in this server
        if server_id and server_id not in bot_info.get('servers', []):
            continue
        tasks.append(ws.send_str(event_msg))
    
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def broadcast_to_dm_participants(username, dm_id, message):
    """Broadcast a message to both participants in a DM conversation.
    
    Args:
        username: The username of the current user
        dm_id: The DM identifier
        message: The message to broadcast
    """
    user_dms = db.get_user_dms(username)
    for dm in user_dms:
        if dm['dm_id'] == dm_id:
            participants = [dm['user1'], dm['user2']]
            for participant in participants:
                await send_to_user(participant, message)
            break


async def cleanup_voice_state(username, reason=''):
    """Clean up existing voice state when switching calls/channels.
    
    Removes the user from voice_states and voice_members, and sends notifications
    to other participants (direct call peer or voice channel members).
    
    Args:
        username: The username whose state to clean up
        reason: The reason for cleanup (for notification message)
    
    Returns:
        True if cleanup was performed, False otherwise
    """
    if username not in voice_states:
        return False
    
    old_state = voice_states[username]
    
    # Notify if in direct call
    if old_state.get('direct_call_peer'):
        await send_to_user(old_state['direct_call_peer'], json.dumps({
            'type': 'direct_call_ended',
            'from': username,
            'reason': reason or 'ended'
        }))
        # Delete the voice state entry
        del voice_states[username]
        return True
    
    # Clean up if in voice channel
    elif old_state.get('server_id') and old_state.get('channel_id'):
        voice_key = f"{old_state['server_id']}/{old_state['channel_id']}"
        if voice_key in voice_members:
            voice_members[voice_key].discard(username)
        # Delete the voice state entry
        del voice_states[username]
        return True
    
    return False


def create_voice_state(direct_call_peer=None, server_id=None, channel_id=None):
    """Create a voice state dictionary with consistent structure.
    
    Args:
        direct_call_peer: Username of direct call peer (for DM calls)
        server_id: Server ID (for voice channels)
        channel_id: Channel ID (for voice channels)
    
    Returns:
        Dictionary with voice state structure
    """
    state = {
        'in_voice': True,
        'muted': False,
        'video': False,
        'screen_sharing': False,
        'showing_screen': False
    }
    
    if direct_call_peer:
        state['direct_call_peer'] = direct_call_peer
    elif server_id and channel_id:
        state['server_id'] = server_id
        state['channel_id'] = channel_id
    
    return state


async def handler(websocket):
    """Handle client connections."""
    username = None
    authenticated = False
    is_bot_connection = False
    bot_info = None
    
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
            
            # Respond to keepalive pings during auth phase
            if auth_data.get('type') == 'ping':
                await websocket.send_str(json.dumps({'type': 'pong'}))
                continue
            
            # Handle bot authentication
            if auth_data.get('type') == 'bot_auth':
                bot_token = auth_data.get('token', '')
                if not bot_token:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Bot token is required'
                    }))
                    continue
                
                # Hash the token and look up the bot
                import hashlib
                token_hash = hashlib.sha256(bot_token.encode()).hexdigest()
                bot = db.get_bot_by_token_hash(token_hash)
                
                if not bot:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Invalid bot token'
                    }))
                    continue
                
                if not bot.get('is_active', True):
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Bot is deactivated'
                    }))
                    continue
                
                # Get bot's servers
                bot_servers = db.get_bot_servers(bot['bot_id'])
                server_ids = [s['server_id'] for s in bot_servers]
                
                # Register bot connection
                username = bot['username']
                is_bot_connection = True
                bot_info = {
                    'bot_id': bot['bot_id'],
                    'username': bot['username'],
                    'scopes': bot.get('scopes', []),
                    'intents': bot.get('intents', []),
                    'servers': server_ids,
                    'rate_limit_messages': bot.get('rate_limit_messages', 30),
                    'rate_limit_api': bot.get('rate_limit_api', 120)
                }
                bot_clients[websocket] = bot_info
                clients[websocket] = username
                authenticated = True
                
                # Send bot auth success
                await websocket.send_str(json.dumps({
                    'type': 'bot_auth_success',
                    'bot_id': bot['bot_id'],
                    'name': bot['name'],
                    'username': bot['username'],
                    'servers': [{'server_id': s['server_id'], 'name': s['name']} for s in bot_servers],
                    'scopes': bot.get('scopes', []),
                    'intents': bot.get('intents', [])
                }))
                
                db.log_bot_action(bot['bot_id'], 'connected', detail={'servers': server_ids})
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Bot '{bot['name']}' ({bot['username']}) connected")
                continue
            
            # Handle signup
            if auth_data.get('type') == 'signup':
                username = auth_data.get('username', '').strip()
                password = auth_data.get('password', '')
                email = auth_data.get('email', '').strip()
                invite_code = auth_data.get('invite_code', '').strip()
                
                # Get admin settings
                admin_settings = db.get_admin_settings()
                allow_registration = admin_settings.get('allow_registration', True)
                require_invite = admin_settings.get('require_invite', False)
                require_email_verification = admin_settings.get('require_email_verification', False)
                
                # Check if registration is disabled
                if not allow_registration:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Registration is currently disabled'
                    }))
                    continue
                
                # Validation
                if not username or not password or not email:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Username, password, and email are required'
                    }))
                    continue
                
                # Email validation
                if not is_valid_email(email):
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Invalid email address format'
                    }))
                    continue
                
                if db.get_user(username):
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Username already exists'
                    }))
                    continue
                
                # Check if email is already registered
                if db.get_user_by_email(email):
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Email address already registered'
                    }))
                    continue
                
                # Check invite code requirement
                all_users = db.get_all_users()

                # Check license user limit
                if not enforce_limit(len(all_users), 'max_users'):
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': f'User limit reached ({check_limit("max_users")}). Instance admin can upgrade the license.'
                    }))
                    continue

                invite_data = db.get_invite_code(invite_code) if invite_code else None

                # Require invite if admin setting is enabled OR if users already exist (legacy behavior)
                if (require_invite or all_users) and not invite_data:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Valid invite code required'
                    }))
                    continue
                
                # Determine if email verification should be used
                email_sender = EmailSender(admin_settings)
                should_verify_email = require_email_verification and email_sender.is_configured()
                
                if should_verify_email:
                    # Email verification is enabled and SMTP is configured
                    # Generate verification code (6-digit number)
                    verification_code = ''.join(secrets.choice(string.digits) for _ in range(6))
                    
                    # Store verification code with 15 minute expiration
                    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
                    if not db.create_email_verification_code(email, username, verification_code, expires_at):
                        await websocket.send_str(json.dumps({
                            'type': 'auth_error',
                            'message': 'Failed to generate verification code'
                        }))
                        continue
                    
                    # Send verification email
                    if not email_sender.send_verification_email(email, username, verification_code):
                        await websocket.send_str(json.dumps({
                            'type': 'auth_error',
                            'message': 'Failed to send verification email. Please check SMTP settings.'
                        }))
                        db.delete_email_verification_code(email, username)
                        continue
                    
                    # Check for race condition - prevent overwriting existing pending signup
                    if username in pending_signups:
                        await websocket.send_str(json.dumps({
                            'type': 'auth_error',
                            'message': 'A signup is already in progress for this username. Please wait or use a different username.'
                        }))
                        db.delete_email_verification_code(email, username)
                        continue
                    
                    # Store signup data temporarily for verification step
                    inviter_username = invite_data['creator'] if invite_data else None
                    pending_signups[username] = {
                        'password_hash': hash_password(password),
                        'email': email,
                        'invite_code': invite_code,
                        'inviter_username': inviter_username
                    }
                    
                    await websocket.send_str(json.dumps({
                        'type': 'verification_required',
                        'message': 'Verification code sent to your email'
                    }))
                    continue
                else:
                    # Email verification is disabled or SMTP not configured - create account immediately
                    # Create user account in database (email not verified)
                    if not db.create_user(username, hash_password(password), email, email_verified=False):
                        await websocket.send_str(json.dumps({
                            'type': 'auth_error',
                            'message': 'Failed to create account'
                        }))
                        continue
                    
                    # Auto-friend inviter if signing up with invite code
                    inviter_username = invite_data['creator'] if invite_data else None
                    if inviter_username:
                        # Add mutual friendship
                        db.add_friend_request(inviter_username, username)
                        db.accept_friend_request(inviter_username, username)
                        # Log invite usage
                        if invite_code:
                            db.log_invite_usage(invite_code, username, invite_data.get('server_id'))
                            # Check if invite has reached max uses
                            max_uses = invite_data.get('max_uses')
                            if max_uses is not None:
                                current_uses = db.get_invite_usage_count(invite_code)
                                if current_uses >= max_uses:
                                    db.deactivate_invite_code(invite_code)
                    
                    # Generate JWT token for the user
                    token = generate_jwt_token(username)
                    
                    # Get user preferences
                    prefs = db.get_user_preferences(username) or {}
                    
                    await websocket.send_str(json.dumps({
                        'type': 'auth_success',
                        'message': 'Account created successfully',
                        'token': token,
                        'theme_mode': prefs.get('theme_mode', 'dark'),
                        'keybinds': prefs.get('keybinds', {})
                    }))
                    authenticated = True
                    clients[websocket] = username
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] New user registered: {username}")
                    
                    # Notify instance admin of new signup if enabled
                    admin_settings = db.get_admin_settings()
                    if admin_settings.get('notify_admin_on_signup', True):
                        first_user = db.get_first_user()
                        if first_user and first_user != username:
                            await send_to_user(first_user, json.dumps({
                                'type': 'admin_signup_notification',
                                'username': username,
                                'email': email if email else None,
                                'timestamp': datetime.now().isoformat()
                            }))
                    
                    # Notify inviter that they are now friends
                    if inviter_username:
                        new_user_avatar = get_avatar_data(username)
                        await send_to_user(inviter_username, json.dumps({
                            'type': 'friend_added',
                            'username': username,
                            **new_user_avatar
                        }))
            
            # Handle email verification
            elif auth_data.get('type') == 'verify_email':
                username = auth_data.get('username', '').strip()
                code = auth_data.get('code', '').strip()
                
                # Validate verification code format (must be exactly 6 digits)
                if not code or not code.isdigit() or len(code) != 6:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Invalid verification code format'
                    }))
                    continue
                
                # Check if we have pending signup data
                if username not in pending_signups:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'No pending signup found. Please start signup again.'
                    }))
                    continue
                
                pending = pending_signups[username]
                email = pending['email']
                
                # Verify the code
                verification_data = db.get_email_verification_code(email, username)
                if not verification_data or verification_data['code'] != code:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Invalid or expired verification code'
                    }))
                    continue
                
                # Create user account in database
                if not db.create_user(username, pending['password_hash'], email, email_verified=True):
                    # Clean up so the user can restart signup if account creation fails
                    db.delete_email_verification_code(email, username)
                    if username in pending_signups:
                        del pending_signups[username]
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Failed to create account. Please restart signup.'
                    }))
                    continue
                
                # Clean up verification code and pending signup
                db.delete_email_verification_code(email, username)
                del pending_signups[username]
                
                # Auto-friend inviter if signing up with invite code
                inviter_username = pending['inviter_username']
                if inviter_username:
                    # Add mutual friendship
                    db.add_friend_request(inviter_username, username)
                    db.accept_friend_request(inviter_username, username)
                    # Log invite usage
                    if pending['invite_code']:
                        invite_data = db.get_invite_code(pending['invite_code'])
                        if invite_data:
                            db.log_invite_usage(pending['invite_code'], username, invite_data.get('server_id'))
                            # Check if invite has reached max uses
                            max_uses = invite_data.get('max_uses')
                            if max_uses is not None:
                                current_uses = db.get_invite_usage_count(pending['invite_code'])
                                if current_uses >= max_uses:
                                    db.deactivate_invite_code(pending['invite_code'])
                
                # Generate JWT token for the user
                token = generate_jwt_token(username)
                
                # Get user preferences
                prefs = db.get_user_preferences(username) or {}
                
                await websocket.send_str(json.dumps({
                    'type': 'auth_success',
                    'message': 'Account created successfully',
                    'token': token,
                    'theme_mode': prefs.get('theme_mode', 'dark'),
                    'keybinds': prefs.get('keybinds', {})
                }))
                authenticated = True
                clients[websocket] = username
                print(f"[{datetime.now().strftime('%H:%M:%S')}] New user registered: {username}")
                
                # Notify instance admin of new signup if enabled
                admin_settings = db.get_admin_settings()
                if admin_settings.get('notify_admin_on_signup', True):
                    first_user = db.get_first_user()
                    if first_user and first_user != username:
                        await send_to_user(first_user, json.dumps({
                            'type': 'admin_signup_notification',
                            'username': username,
                            'email': email if email else None,
                            'timestamp': datetime.now().isoformat()
                        }))
                
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
                totp_code = auth_data.get('totp_code', '').strip()  # Optional 2FA code
                
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
                
                # Check if 2FA is enabled
                twofa_data = db.get_2fa_secret(username)
                if twofa_data and twofa_data.get('enabled'):
                    # 2FA is enabled, need to verify code
                    if not totp_code:
                        await websocket.send_str(json.dumps({
                            'type': '2fa_required',
                            'message': 'Two-factor authentication code required'
                        }))
                        continue
                    
                    # Validate TOTP code format (6 digits) or backup code format (8 alphanumeric)
                    if not (totp_code.isdigit() and len(totp_code) == 6) and not (totp_code.isalnum() and len(totp_code) == 8):
                        await websocket.send_str(json.dumps({
                            'type': 'auth_error',
                            'message': 'Invalid two-factor authentication code format'
                        }))
                        continue
                    
                    # Verify 2FA token or backup code
                    valid_code = False
                    if totp_code.isdigit() and len(totp_code) == 6:
                        # Try TOTP verification
                        if verify_2fa_token(twofa_data['secret'], totp_code):
                            valid_code = True
                    
                    if not valid_code and totp_code.isalnum() and len(totp_code) == 8:
                        # Try backup code
                        if db.use_backup_code(username, totp_code):
                            valid_code = True
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] User {username} used backup code for 2FA")
                    
                    if not valid_code:
                        await websocket.send_str(json.dumps({
                            'type': 'auth_error',
                            'message': 'Invalid two-factor authentication code'
                        }))
                        continue
                
                # Generate JWT token for the user
                token = generate_jwt_token(username)
                
                # Get user preferences
                prefs = db.get_user_preferences(username) or {}
                
                await websocket.send_str(json.dumps({
                    'type': 'auth_success',
                    'message': 'Login successful',
                    'token': token,
                    'theme_mode': prefs.get('theme_mode', 'dark'),
                    'keybinds': prefs.get('keybinds', {})
                }))
                authenticated = True
                clients[websocket] = username
                print(f"[{datetime.now().strftime('%H:%M:%S')}] User logged in: {username}")
            
            # Handle token-based authentication
            elif auth_data.get('type') == 'token':
                token = auth_data.get('token', '')
                
                if not token:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Token is required'
                    }))
                    continue
                
                # Verify the token and extract username
                username = verify_jwt_token(token)
                if not username:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Invalid or expired token'
                    }))
                    continue
                
                # Verify user still exists in database
                user = db.get_user(username)
                if not user:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'User not found'
                    }))
                    continue
                
                # Generate a new JWT token to refresh the session
                new_token = generate_jwt_token(username)
                
                # Get user preferences
                prefs = db.get_user_preferences(username) or {}
                
                await websocket.send_str(json.dumps({
                    'type': 'auth_success',
                    'message': 'Token authentication successful',
                    'token': new_token,
                    'theme_mode': prefs.get('theme_mode', 'dark'),
                    'keybinds': prefs.get('keybinds', {})
                }))
                authenticated = True
                clients[websocket] = username
                print(f"[{datetime.now().strftime('%H:%M:%S')}] User authenticated via token: {username}")
            
            # Handle password reset request
            elif auth_data.get('type') == 'request_password_reset':
                identifier = auth_data.get('identifier', '').strip()  # Can be username or email
                
                if not identifier:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Username or email is required'
                    }))
                    continue
                
                # Check rate limiting to prevent abuse
                if not check_password_reset_rate_limit(identifier):
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Too many password reset requests. Please try again later.'
                    }))
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Rate limit exceeded for password reset: {identifier}")
                    continue
                
                # Try to find user by username or email
                user = db.get_user(identifier)
                if not user:
                    user = db.get_user_by_email(identifier)
                
                # Always return success to prevent username/email enumeration
                if user and user.get('email'):
                    # Generate reset token
                    reset_token = secrets.token_urlsafe(32)
                    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
                    
                    # Save token to database
                    if db.create_password_reset_token(user['username'], reset_token, expires_at):
                        # Send password reset email
                        email_sender = EmailSender(db.get_admin_settings())
                        try:
                            if email_sender.send_password_reset_email(
                                user['email'], 
                                user['username'], 
                                reset_token
                            ):
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] Password reset email sent to {user['username']} at {user['email']}")
                            else:
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] Failed to send password reset email to {user['username']} at {user['email']}")
                        except Exception as e:
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] Error sending password reset email to {user['username']}: {e}")
                            traceback.print_exc()
                    else:
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] Failed to create password reset token for {user['username']}")
                else:
                    if not user:
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] Password reset requested for unknown identifier: {identifier}")
                    elif not user.get('email'):
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] User {user.get('username')} has no email address registered")
                
                # Always return success to prevent enumeration attacks
                await websocket.send_str(json.dumps({
                    'type': 'password_reset_requested',
                    'message': 'If an account exists with that email, a password reset link has been sent.'
                }))
            
            # Handle password reset validation
            elif auth_data.get('type') == 'validate_reset_token':
                token = auth_data.get('token', '').strip()
                
                if not token:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Reset token is required'
                    }))
                    continue
                
                # Get token from database
                token_data = db.get_password_reset_token(token)
                
                if not token_data:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Invalid or expired reset token'
                    }))
                    continue
                
                # Check if token is expired or used
                if token_data.get('used'):
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'This reset link has already been used'
                    }))
                    continue
                
                expires_at = datetime.fromisoformat(token_data['expires_at'])
                if datetime.now(timezone.utc) > expires_at:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'This reset link has expired'
                    }))
                    continue
                
                # Token is valid
                await websocket.send_str(json.dumps({
                    'type': 'reset_token_valid',
                    'username': token_data['username']
                }))
            
            # Handle password reset completion
            elif auth_data.get('type') == 'reset_password':
                token = auth_data.get('token', '').strip()
                new_password = auth_data.get('new_password', '')
                
                if not token or not new_password:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Token and new password are required'
                    }))
                    continue
                
                # Validate password strength
                if (
                    len(new_password) < 8
                    or not re.search(r"[a-z]", new_password)
                    or not re.search(r"[A-Z]", new_password)
                    or not re.search(r"[0-9]", new_password)
                    or not re.search(r"[^A-Za-z0-9]", new_password)
                ):
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Password must be at least 8 characters and include lowercase, uppercase, number, and special character'
                    }))
                    continue
                
                # Get and validate token
                token_data = db.get_password_reset_token(token)
                
                if not token_data or token_data.get('used'):
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Invalid or expired reset token'
                    }))
                    continue
                
                expires_at = datetime.fromisoformat(token_data['expires_at'])
                if datetime.now(timezone.utc) > expires_at:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'This reset link has expired'
                    }))
                    continue
                
                # Update password
                password_hash = hash_password(new_password)
                if db.update_user_password(token_data['username'], password_hash):
                    # Mark token as used
                    db.mark_reset_token_used(token)
                    
                    await websocket.send_str(json.dumps({
                        'type': 'password_reset_success',
                        'message': 'Password has been reset successfully'
                    }))
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Password reset for user: {token_data['username']}")
                else:
                    await websocket.send_str(json.dumps({
                        'type': 'auth_error',
                        'message': 'Failed to reset password'
                    }))
            
            else:
                await websocket.send_str(json.dumps({
                    'type': 'auth_error',
                    'message': 'Invalid authentication request'
                }))
        
        # Check if authentication was successful
        if not authenticated or not username:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Authentication failed or connection closed before completion")
            return
        
        # Send user data to authenticated client using helper functions
        try:
            user_servers = build_user_servers_data(username) or []
            user_dms = build_user_dms_data(username) or []
            friends_list = build_user_friends_data(username) or []
            friend_requests_sent, friend_requests_received = build_friend_requests_data(username)
            # Ensure friend requests are lists
            friend_requests_sent = friend_requests_sent or []
            friend_requests_received = friend_requests_received or []
            
            # Get unread counts for the user
            unread_data = db.get_unread_counts(username)
            
            # Enrich servers with unread data
            for server in user_servers:
                server_id = server['id']
                if server_id in unread_data['server_counts']:
                    server_unread = unread_data['server_counts'][server_id]
                    server['unread_count'] = server_unread['unread_count']
                    server['has_mention'] = server_unread['has_mention']
                    server['channel_unreads'] = server_unread.get('channels', {})
            
            # Enrich DMs with unread data
            for dm in user_dms:
                dm_id = dm['id']
                if dm_id in unread_data['dm_counts']:
                    dm_unread = unread_data['dm_counts'][dm_id]
                    dm['unread_count'] = dm_unread['unread_count']
                    dm['has_mention'] = dm_unread['has_mention']
            
            current_avatar = get_avatar_data(username)
            current_profile = get_profile_data(username)
            user = db.get_user(username)
            notification_mode = user.get('notification_mode', 'all') if user else 'all'
            first_user = db.get_first_user()
            is_admin = (username == first_user)
            log_admin_check(username, first_user, is_admin, context="init message")
            user_data = json.dumps({
                'type': 'init',
                'username': username,
                **current_avatar,
                **current_profile,
                'user_status': user.get('user_status', 'online') if user else 'online',
                'email': user.get('email', '') if user else '',
                'email_verified': user.get('email_verified', False) if user else False,
                'notification_mode': notification_mode,
                'is_admin': is_admin,
                'servers': user_servers,
                'dms': user_dms,
                'friends': friends_list,
                'friend_requests_sent': friend_requests_sent,
                'friend_requests_received': friend_requests_received
            })
            await websocket.send_str(user_data)
            
            # Send announcement data and server settings
            admin_settings = db.get_admin_settings() or {}
            set_at = admin_settings.get('announcement_set_at')
            announcement_data = {
                'type': 'announcement_update',
                'enabled': admin_settings.get('announcement_enabled', False),
                'message': admin_settings.get('announcement_message', ''),
                'duration_minutes': admin_settings.get('announcement_duration_minutes', 60),
                'set_at': set_at.isoformat() if set_at and hasattr(set_at, 'isoformat') else None,
                'max_message_length': admin_settings.get('max_message_length', 2000)
            }
            await websocket.send_str(json.dumps(announcement_data))
            
            # Notify others about new user joining
            join_message = json.dumps({
                'type': 'system',
                'content': f'{username} joined the chat',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })
            await broadcast(join_message, exclude=websocket)
            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} joined chat")
        except Exception as e:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] ERROR: Failed to send init message to {username}: {e}", flush=True)
            traceback.print_exc()
            # Send error message to client
            try:
                await websocket.send_str(json.dumps({
                    'type': 'error',
                    'message': 'Connection error. Please refresh the page and try again.'
                }))
            except Exception as send_error:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] ERROR: Could not send error message: {send_error}", flush=True)
            # Close connection to force client to reconnect
            await websocket.close()
            return
        
        # Handle messages from this client
        async for msg in websocket:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                    msg_type = data.get('type')
                    
                    # Respond to client-level keepalive pings immediately
                    if msg_type == 'ping':
                        await websocket.send_str(json.dumps({'type': 'pong'}))
                        continue
                    
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Received message type: {msg_type}", flush=True)
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: Full data: {data}", flush=True)
                    
                    if msg_type == 'request_password_reset':
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: MATCHED request_password_reset at top of handler!")
                    
                    # ── Slash command handling ──────────────────────────────
                    if msg_type == 'slash_command':
                        command_name = data.get('command', '').strip().lower()
                        command_args = data.get('args', {})
                        cmd_server_id = data.get('server_id', '')
                        cmd_channel_id = data.get('channel_id', '')
                        
                        if not command_name or not cmd_server_id or not cmd_channel_id:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid slash command'
                            }))
                            continue
                        
                        # Find matching slash command
                        server_commands = db.get_server_slash_commands(cmd_server_id)
                        matched_cmd = None
                        for cmd in server_commands:
                            if cmd['name'] == command_name:
                                matched_cmd = cmd
                                break
                        
                        if not matched_cmd:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': f'Unknown command: /{command_name}'
                            }))
                            continue
                        
                        # Send ack to the invoking user
                        await websocket.send_str(json.dumps({
                            'type': 'slash_command_ack',
                            'command': command_name,
                            'channel_id': cmd_channel_id,
                            'server_id': cmd_server_id
                        }))
                        
                        # Deliver event to the owning bot
                        event_data = {
                            'command': command_name,
                            'command_id': matched_cmd['command_id'],
                            'args': command_args,
                            'user': username,
                            'server_id': cmd_server_id,
                            'channel_id': cmd_channel_id
                        }
                        
                        # Send to the specific bot that owns this command
                        target_bot_id = matched_cmd['bot_id']
                        for ws, bi in bot_clients.items():
                            if bi.get('bot_id') == target_bot_id and has_intent(bi.get('intents', []), 'slash_command'):
                                await ws.send_str(json.dumps({
                                    'type': 'bot_event',
                                    'event': 'slash_command',
                                    'data': event_data,
                                    'server_id': cmd_server_id,
                                    'channel_id': cmd_channel_id
                                }))
                                break
                        
                        db.log_bot_action(target_bot_id, 'slash_command_received',
                                          server_id=cmd_server_id,
                                          detail={'command': command_name, 'user': username})
                        
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] Slash command /{command_name} invoked by {username} in {cmd_server_id}/{cmd_channel_id}")
                        continue
                    
                    if msg_type == 'message':
                        msg_content = data.get('content', '')
                        context = data.get('context', 'global')  # 'global', 'server', or 'dm'
                        context_id = data.get('context_id', None)
                        message_key = data.get('messageKey')  # Extract messageKey for file attachment correlation
                        mentions = data.get('mentions', [])  # Extract user mentions
                        role_mentions = data.get('role_mentions', [])  # Extract role mentions (list of role IDs)
                        reply_to = data.get('reply_to')  # Extract reply_to message ID
                        nonce = data.get('nonce')  # Extract nonce for delivery confirmation
                        
                        # Get admin settings and enforce max message length
                        admin_settings = db.get_admin_settings()
                        max_length = admin_settings.get('max_message_length', 2000)
                        
                        if len(msg_content) > max_length:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': f'Message exceeds maximum length of {max_length} characters'
                            }))
                            continue
                        
                        # Get user profile for avatar info
                        user_profile = db.get_user(username)
                        
                        # Fetch reply data if replying to a message
                        reply_data = None
                        replied_to_user = None
                        if reply_to:
                            original_msg = db.get_message(reply_to)
                            if original_msg:
                                reply_data = {
                                    'id': original_msg['id'],
                                    'username': original_msg['username'],
                                    'content': original_msg['content'],
                                    'deleted': original_msg.get('deleted', False)
                                }
                                replied_to_user = original_msg['username']
                        
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
                                        # Enforce send_messages permission (channel override aware)
                                        channel_overrides = db.get_channel_all_overrides(channel_id)
                                        can_send = True
                                        if channel_overrides:
                                            # Overrides exist — check explicitly
                                            can_send = db.has_channel_permission(server_id, username, channel_id, 'send_messages')
                                        if not can_send and server['owner'] != username:
                                            await websocket.send_str(json.dumps({
                                                'type': 'error',
                                                'message': 'You do not have permission to send messages in this channel'
                                            }))
                                            continue
                                        # Save message to database and get ID
                                        message_id = db.save_message(username, msg_content, 'server', context_id, reply_to)
                                        
                                        # Save mentions if any
                                        if mentions and message_id:
                                            # Filter mentions to only include server members
                                            valid_mentions = [m for m in mentions if m in member_usernames and m != username]
                                            if valid_mentions:
                                                db.add_mentions(message_id, valid_mentions)
                                                
                                                # Send mention notifications
                                                for mentioned_user in valid_mentions:
                                                    notification = {
                                                        'type': 'mention_notification',
                                                        'message_id': message_id,
                                                        'mentioned_by': username,
                                                        'content': msg_content[:100],  # First 100 chars
                                                        'context_type': 'server',
                                                        'context_id': context_id
                                                    }
                                                    await send_to_user(mentioned_user, json.dumps(notification))
                                        
                                        # Process role mentions — notify all members of each mentioned role
                                        if role_mentions and message_id:
                                            already_notified = set(valid_mentions) if mentions else set()
                                            for role_mention_id in role_mentions:
                                                role_members = db.get_role_members(role_mention_id)
                                                for role_member in role_members:
                                                    if role_member != username and role_member not in already_notified and role_member in member_usernames:
                                                        already_notified.add(role_member)
                                                        await send_to_user(role_member, json.dumps({
                                                            'type': 'role_mention_notification',
                                                            'message_id': message_id,
                                                            'mentioned_by': username,
                                                            'role_id': role_mention_id,
                                                            'content': msg_content[:100],
                                                            'context_type': 'server',
                                                            'context_id': context_id
                                                        }))
                                        
                                        # Send reply notification
                                        if reply_to and replied_to_user and replied_to_user != username:
                                            notification = {
                                                'type': 'reply_notification',
                                                'message_id': message_id,
                                                'replied_by': username,
                                                'content': msg_content[:100],  # First 100 chars
                                                'context_type': 'server',
                                                'context_id': context_id,
                                                'original_message_id': reply_to
                                            }
                                            await send_to_user(replied_to_user, json.dumps(notification))
                                        
                                        # Create message object with ID and messageKey
                                        msg_obj = create_message_object(
                                            username=username,
                                            msg_content=msg_content,
                                            context=context,
                                            context_id=context_id,
                                            user_profile=user_profile,
                                            message_key=message_key,
                                            message_id=message_id,
                                            reply_data=reply_data
                                        )
                                        
                                        # Add mentions to message object
                                        if mentions:
                                            msg_obj['mentions'] = [m for m in mentions if m in member_usernames]
                                        # Add role mentions to message object
                                        if role_mentions:
                                            msg_obj['role_mentions'] = role_mentions
                                        
                                        # Add nonce for delivery confirmation (only sender sees it)
                                        if nonce:
                                            msg_obj['nonce'] = nonce
                                        
                                        # Broadcast to server members (filtered by view_channel if overrides set)
                                        await broadcast_to_server(server_id, json.dumps(msg_obj), channel_id=channel_id)
                                        
                                        # Deliver bot event for message_create
                                        await deliver_bot_event('message_create', msg_obj, server_id=server_id, channel_id=channel_id)
                                        
                                        print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} sent message in {server_id}/{channel_id}")
                        
                        elif context == 'dm' and context_id:
                            # Direct message - verify DM exists and user is participant
                            dm_users = db.get_user_dms(username)
                            dm_ids = [dm['dm_id'] for dm in dm_users]
                            if context_id in dm_ids:
                                # Save message to database and get ID
                                message_id = db.save_message(username, msg_content, 'dm', context_id, reply_to)
                                
                                # Get DM participants
                                participants = []
                                for dm in dm_users:
                                    if dm['dm_id'] == context_id:
                                        participants = [dm['user1'], dm['user2']]
                                        break
                                
                                # Save mentions if any (only DM participants can be mentioned)
                                if mentions and message_id and participants:
                                    valid_mentions = [m for m in mentions if m in participants and m != username]
                                    if valid_mentions:
                                        db.add_mentions(message_id, valid_mentions)
                                        
                                        # Send mention notifications
                                        for mentioned_user in valid_mentions:
                                            notification = {
                                                'type': 'mention_notification',
                                                'message_id': message_id,
                                                'mentioned_by': username,
                                                'content': msg_content[:100],  # First 100 chars
                                                'context_type': 'dm',
                                                'context_id': context_id
                                            }
                                            await send_to_user(mentioned_user, json.dumps(notification))
                                
                                # Send reply notification
                                if reply_to and replied_to_user and replied_to_user != username:
                                    notification = {
                                        'type': 'reply_notification',
                                        'message_id': message_id,
                                        'replied_by': username,
                                        'content': msg_content[:100],  # First 100 chars
                                        'context_type': 'dm',
                                        'context_id': context_id,
                                        'original_message_id': reply_to
                                    }
                                    await send_to_user(replied_to_user, json.dumps(notification))
                                
                                # Create message object with ID and messageKey
                                msg_obj = create_message_object(
                                    username=username,
                                    msg_content=msg_content,
                                    context=context,
                                    context_id=context_id,
                                    user_profile=user_profile,
                                    message_key=message_key,
                                    message_id=message_id,
                                    reply_data=reply_data
                                )
                                
                                # Add mentions to message object
                                if mentions and participants:
                                    msg_obj['mentions'] = [m for m in mentions if m in participants]
                                
                                # Add nonce for delivery confirmation (only sender sees it)
                                if nonce:
                                    msg_obj['nonce'] = nonce
                                
                                # Send to both participants
                                for participant in participants:
                                    await send_to_user(participant, json.dumps(msg_obj))
                                
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] DM from {username} in {context_id}")
                        
                        else:
                            # Global chat (backward compatibility)
                            msg_obj = create_message_object(
                                username=username,
                                msg_content=msg_content,
                                context=context,
                                context_id=context_id,
                                user_profile=user_profile,
                                message_key=message_key
                            )
                            
                            messages.append(msg_obj)
                            if len(messages) > MAX_HISTORY:
                                messages.pop(0)
                            await broadcast(json.dumps(msg_obj))
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} sent global message")
                    
                    elif data.get('type') == 'create_server':
                        server_name = data.get('name', '').strip()
                        if server_name:
                            # Get admin settings for server limits
                            admin_settings = db.get_admin_settings()
                            max_servers_per_user = admin_settings.get('max_servers_per_user', 100)

                            # Apply license ceiling
                            license_max_servers = check_limit('max_servers')
                            if license_max_servers != -1:
                                max_servers_per_user = min(max_servers_per_user, license_max_servers) if max_servers_per_user > 0 else license_max_servers

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
                            
                            # Create server in database
                            db.create_server(server_id, server_name, username)
                            
                            # Create default "General" category
                            category_id = get_next_category_id()
                            db.create_category(category_id, server_id, 'General', 0)
                            
                            # Create default channels in the General category
                            text_channel_id = get_next_channel_id()
                            voice_channel_id = get_next_channel_id()
                            db.create_channel(text_channel_id, server_id, 'general', 'text', category_id, 0)
                            db.create_channel(voice_channel_id, server_id, 'voice', 'voice', category_id, 1)
                            
                            # Create default Admin role for server owner
                            admin_role_id = get_next_role_id()
                            admin_permissions = get_admin_permissions()
                            db.create_role(
                                admin_role_id,
                                server_id,
                                'Admin',
                                '#e74c3c',  # Red color for admin role
                                position=100,  # High position
                                permissions=admin_permissions
                            )
                            # Assign admin role to server owner
                            db.assign_role(server_id, username, admin_role_id)
                            
                            await websocket.send_str(json.dumps({
                                'type': 'server_created',
                                'server': {
                                    'id': server_id,
                                    'name': server_name,
                                    'owner': username,
                                    'icon': '🏠',
                                    'icon_type': 'emoji',
                                    'icon_data': None,
                                    'categories': [{
                                        'id': category_id,
                                        'name': 'General',
                                        'position': 0
                                    }],
                                    'channels': [
                                        {'id': text_channel_id, 'name': 'general', 'type': 'text', 'category_id': category_id, 'position': 0},
                                        {'id': voice_channel_id, 'name': 'voice', 'type': 'voice', 'category_id': category_id, 'position': 1}
                                    ]
                                }
                            }))
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} created server: {server_name} with Admin role")
                    
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
                            
                            # Get reactions, attachments, and mentions for all messages
                            if channel_messages:
                                message_ids = [msg['id'] for msg in channel_messages]
                                reactions_map = db.get_reactions_for_messages(message_ids)
                                mentions_map = db.get_mentions_for_messages(message_ids)
                                
                                # Add reactions, attachments, mentions, role colors, and user status to each message
                                for msg in channel_messages:
                                    msg['reactions'] = reactions_map.get(msg['id'], [])
                                    msg['attachments'] = db.get_message_attachments(msg['id'])
                                    msg['mentions'] = mentions_map.get(msg['id'], [])
                                    msg['user_status'] = get_user_status(msg['username'])
                                    # Add role color for server messages
                                    role_color = get_highest_role_color(server_id, msg['username'])
                                    if role_color:
                                        msg['role_color'] = role_color
                            
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
                            
                            # Get reactions, attachments, and mentions for all messages
                            if dm_messages:
                                message_ids = [msg['id'] for msg in dm_messages]
                                reactions_map = db.get_reactions_for_messages(message_ids)
                                mentions_map = db.get_mentions_for_messages(message_ids)
                                
                                # Add reactions, attachments, mentions, and user status to each message
                                for dm_msg in dm_messages:
                                    dm_msg['reactions'] = reactions_map.get(dm_msg['id'], [])
                                    dm_msg['attachments'] = db.get_message_attachments(dm_msg['id'])
                                    dm_msg['mentions'] = mentions_map.get(dm_msg['id'], [])
                                    dm_msg['user_status'] = get_user_status(dm_msg['username'])
                            
                            await websocket.send_str(json.dumps({
                                'type': 'dm_history',
                                'dm_id': dm_id,
                                'messages': dm_messages
                            }))

                    # ── Typing indicators ──────────────────────────────────────────
                    elif data.get('type') == 'typing_start':
                        t_context = data.get('context', 'global')
                        t_context_id = data.get('context_id')
                        ctx_key = f"{t_context}:{t_context_id}" if t_context_id else t_context

                        # Determine recipients to notify
                        if t_context == 'server' and t_context_id and '/' in t_context_id:
                            t_server_id = t_context_id.split('/')[0]
                            server_members_data = db.get_server_members(t_server_id)
                            recipients = {m['username'] for m in server_members_data} - {username}
                        elif t_context == 'dm' and t_context_id:
                            dm_list = db.get_user_dms(username)
                            recipients = set()
                            for dm in dm_list:
                                if dm['dm_id'] == t_context_id:
                                    recipients = {dm['user1'], dm['user2']} - {username}
                                    break
                        else:
                            recipients = set()

                        # Cancel existing expiry timer for this user+context
                        timer_key = (username, ctx_key)
                        if timer_key in typing_states:
                            old_handle = typing_states[timer_key]
                            if old_handle:
                                old_handle.cancel()

                        user_avatar = get_avatar_data(username)
                        typing_payload = json.dumps({
                            'type': 'user_typing',
                            'username': username,
                            'context': t_context,
                            'context_id': t_context_id,
                            **user_avatar
                        })

                        async def expire_typing(u=username, ck=ctx_key, recip=recipients,
                                                 tc=t_context, tcid=t_context_id):
                            await asyncio.sleep(5)
                            typing_states.pop((u, ck), None)
                            stop_payload = json.dumps({
                                'type': 'user_stopped_typing',
                                'username': u,
                                'context': tc,
                                'context_id': tcid
                            })
                            for r in recip:
                                await send_to_user(r, stop_payload)

                        task = asyncio.ensure_future(expire_typing())
                        typing_states[timer_key] = task

                        for r in recipients:
                            await send_to_user(r, typing_payload)

                    elif data.get('type') == 'typing_stop':
                        t_context = data.get('context', 'global')
                        t_context_id = data.get('context_id')
                        ctx_key = f"{t_context}:{t_context_id}" if t_context_id else t_context
                        timer_key = (username, ctx_key)
                        if timer_key in typing_states:
                            old_handle = typing_states.pop(timer_key, None)
                            if old_handle:
                                old_handle.cancel()
                        # Determine recipients to notify
                        if t_context == 'server' and t_context_id and '/' in t_context_id:
                            t_server_id = t_context_id.split('/')[0]
                            server_members_data = db.get_server_members(t_server_id)
                            recipients = {m['username'] for m in server_members_data} - {username}
                        elif t_context == 'dm' and t_context_id:
                            dm_list = db.get_user_dms(username)
                            recipients = set()
                            for dm in dm_list:
                                if dm['dm_id'] == t_context_id:
                                    recipients = {dm['user1'], dm['user2']} - {username}
                                    break
                        else:
                            recipients = set()
                        stop_payload = json.dumps({
                            'type': 'user_stopped_typing',
                            'username': username,
                            'context': t_context,
                            'context_id': t_context_id
                        })
                        for r in recipients:
                            await send_to_user(r, stop_payload)

                    # ── Threads ────────────────────────────────────────────────────
                    elif data.get('type') == 'create_thread':
                        s_id = data.get('server_id', '')
                        parent_msg_id = data.get('parent_message_id')
                        thread_name = data.get('name', '').strip()
                        is_private = bool(data.get('is_private', False))
                        invited_users = data.get('invited_users', [])

                        if not s_id or not thread_name:
                            await websocket.send_str(json.dumps({'type': 'error', 'message': 'server_id and name are required'}))
                            continue

                        # Verify user is member of server
                        if not db.is_server_member(username, s_id):
                            await websocket.send_str(json.dumps({'type': 'error', 'message': 'Not a server member'}))
                            continue

                        new_thread_id = get_next_thread_id()
                        if not db.create_thread(new_thread_id, s_id, parent_msg_id, thread_name, is_private, username):
                            await websocket.send_str(json.dumps({'type': 'error', 'message': 'Failed to create thread'}))
                            continue

                        # Seed thread members for private threads
                        if is_private:
                            db.add_thread_member(new_thread_id, username, username)
                            for inv_user in invited_users:
                                if db.is_server_member(inv_user, s_id):
                                    db.add_thread_member(new_thread_id, inv_user, username)
                            # Always allow admins
                            server_data = db.get_server(s_id)
                            if server_data and server_data['owner'] != username:
                                db.add_thread_member(new_thread_id, server_data['owner'], username)

                        # Derive channel_id from parent message context
                        channel_id = None
                        if parent_msg_id:
                            parent_msg = db.get_message(parent_msg_id)
                            if parent_msg and parent_msg.get('context_id') and '/' in parent_msg['context_id']:
                                channel_id = parent_msg['context_id'].split('/')[-1]

                        thread_obj = {
                            'thread_id': new_thread_id,
                            'server_id': s_id,
                            'channel_id': channel_id,
                            'parent_message_id': parent_msg_id,
                            'name': thread_name,
                            'is_private': is_private,
                            'created_by': username,
                            'is_closed': False,
                        }
                        thread_created_payload = json.dumps({'type': 'thread_created', 'thread': thread_obj})

                        if is_private:
                            members_to_notify = db.get_thread_members(new_thread_id)
                            for tuser in members_to_notify:
                                await send_to_user(tuser, thread_created_payload)
                        else:
                            await broadcast_to_server(s_id, thread_created_payload)

                        print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} created thread {new_thread_id} in {s_id}")

                    elif data.get('type') == 'close_thread':
                        t_id = data.get('thread_id', '')
                        thread = db.get_thread(t_id)
                        if not thread:
                            await websocket.send_str(json.dumps({'type': 'error', 'message': 'Thread not found'}))
                            continue

                        # Only creator or server admin/owner can close
                        s_id = thread['server_id']
                        server_data = db.get_server(s_id)
                        can_close = (thread['created_by'] == username or
                                     (server_data and server_data['owner'] == username) or
                                     has_permission(s_id, username, 'administrator'))
                        if not can_close:
                            await websocket.send_str(json.dumps({'type': 'error', 'message': 'No permission to close thread'}))
                            continue

                        db.close_thread(t_id)
                        close_payload = json.dumps({'type': 'thread_closed', 'thread_id': t_id, 'server_id': s_id})

                        if thread['is_private']:
                            for tuser in db.get_thread_members(t_id):
                                await send_to_user(tuser, close_payload)
                        else:
                            await broadcast_to_server(s_id, close_payload)

                    elif data.get('type') == 'get_thread_history':
                        t_id = data.get('thread_id', '')
                        thread = db.get_thread(t_id)
                        if not thread:
                            await websocket.send_str(json.dumps({'type': 'error', 'message': 'Thread not found'}))
                            continue

                        s_id = thread['server_id']
                        # Access check
                        if thread['is_private']:
                            if not db.is_thread_member(t_id, username):
                                # Check if admin/owner
                                server_data = db.get_server(s_id)
                                if not (server_data and server_data['owner'] == username) and not has_permission(s_id, username, 'administrator'):
                                    await websocket.send_str(json.dumps({'type': 'error', 'message': 'No access to this private thread'}))
                                    continue
                        else:
                            if not db.is_server_member(username, s_id):
                                await websocket.send_str(json.dumps({'type': 'error', 'message': 'Not a server member'}))
                                continue

                        th_messages = db.get_messages('thread', t_id, MAX_HISTORY)
                        if th_messages:
                            msg_ids = [m['id'] for m in th_messages]
                            reactions_map = db.get_reactions_for_messages(msg_ids)
                            mentions_map = db.get_mentions_for_messages(msg_ids)
                            for tm in th_messages:
                                tm['reactions'] = reactions_map.get(tm['id'], [])
                                tm['attachments'] = db.get_message_attachments(tm['id'])
                                tm['mentions'] = mentions_map.get(tm['id'], [])
                                tm['user_status'] = get_user_status(tm['username'])
                                hist_role_color = get_highest_role_color(s_id, tm['username'])
                                if hist_role_color:
                                    tm['role_color'] = hist_role_color

                        await websocket.send_str(json.dumps({
                            'type': 'thread_history',
                            'thread_id': t_id,
                            'thread': {
                                'thread_id': t_id,
                                'server_id': s_id,
                                'parent_message_id': thread['parent_message_id'],
                                'name': thread['name'],
                                'is_private': thread['is_private'],
                                'created_by': thread['created_by'],
                                'is_closed': thread['is_closed'],
                            },
                            'messages': th_messages
                        }))

                    elif data.get('type') == 'list_threads':
                        s_id = data.get('server_id', '')
                        if not db.is_server_member(username, s_id):
                            await websocket.send_str(json.dumps({'type': 'error', 'message': 'Not a server member'}))
                            continue
                        all_threads = db.get_open_threads_for_server(s_id)
                        # Filter private threads: only show those the user is a member of
                        visible = []
                        for th in all_threads:
                            if th['is_private']:
                                if db.is_thread_member(th['thread_id'], username):
                                    visible.append(th)
                                else:
                                    server_data = db.get_server(s_id)
                                    if server_data and server_data['owner'] == username:
                                        visible.append(th)
                            else:
                                visible.append(th)
                        # Serialize datetime fields
                        for th in visible:
                            if hasattr(th.get('created_at'), 'isoformat'):
                                th['created_at'] = th['created_at'].isoformat()
                        await websocket.send_str(json.dumps({'type': 'threads_list', 'server_id': s_id, 'threads': visible}))

                    elif data.get('type') == 'add_thread_member':
                        t_id = data.get('thread_id', '')
                        new_member = data.get('username', '')
                        thread = db.get_thread(t_id)
                        if not thread or not thread['is_private']:
                            await websocket.send_str(json.dumps({'type': 'error', 'message': 'Thread not found or not private'}))
                            continue
                        s_id = thread['server_id']
                        # Only thread creator or admin/owner can add members
                        server_data = db.get_server(s_id)
                        can_add = (thread['created_by'] == username or
                                   (server_data and server_data['owner'] == username) or
                                   has_permission(s_id, username, 'administrator'))
                        if not can_add:
                            await websocket.send_str(json.dumps({'type': 'error', 'message': 'No permission'}))
                            continue
                        if db.is_server_member(new_member, s_id):
                            db.add_thread_member(t_id, new_member, username)
                            await send_to_user(new_member, json.dumps({
                                'type': 'thread_created',
                                'thread': {
                                    'thread_id': t_id,
                                    'server_id': s_id,
                                    'parent_message_id': thread['parent_message_id'],
                                    'name': thread['name'],
                                    'is_private': True,
                                    'created_by': thread['created_by'],
                                    'is_closed': thread['is_closed'],
                                }}))

                    # ── Thread messages ────────────────────────────────────────────
                    elif data.get('type') == 'thread_message':
                        t_id = data.get('thread_id', '')
                        th_content = data.get('content', '').strip()
                        th_nonce = data.get('nonce')
                        thread = db.get_thread(t_id)
                        if not thread or thread['is_closed']:
                            await websocket.send_str(json.dumps({'type': 'error', 'message': 'Thread not found or closed'}))
                            continue
                        s_id = thread['server_id']
                        if not th_content:
                            continue
                        # Access check
                        if thread['is_private']:
                            if not db.is_thread_member(t_id, username):
                                await websocket.send_str(json.dumps({'type': 'error', 'message': 'No access'}))
                                continue
                        else:
                            if not db.is_server_member(username, s_id):
                                await websocket.send_str(json.dumps({'type': 'error', 'message': 'Not a server member'}))
                                continue

                        admin_settings = db.get_admin_settings()
                        max_length = admin_settings.get('max_message_length', 2000)
                        if len(th_content) > max_length:
                            await websocket.send_str(json.dumps({'type': 'error', 'message': f'Message too long (max {max_length})'}))
                            continue

                        user_profile = db.get_user(username)
                        th_msg_id = db.save_message(username, th_content, 'thread', t_id)
                        th_msg_obj = create_message_object(
                            username=username,
                            msg_content=th_content,
                            context='thread',
                            context_id=t_id,
                            user_profile=user_profile,
                            message_id=th_msg_id
                        )
                        if th_nonce:
                            th_msg_obj['nonce'] = th_nonce
                        th_msg_obj['thread_id'] = t_id
                        th_msg_obj['server_id'] = s_id
                        thread_role_color = get_highest_role_color(s_id, username)
                        if thread_role_color:
                            th_msg_obj['role_color'] = thread_role_color

                        thread_msg_payload = json.dumps(th_msg_obj)
                        if thread['is_private']:
                            for tuser in db.get_thread_members(t_id):
                                await send_to_user(tuser, thread_msg_payload)
                        else:
                            await broadcast_to_server(s_id, thread_msg_payload)

                    # ── Pin / Unpin ────────────────────────────────────────────────
                    elif data.get('type') == 'pin_message':
                        pin_msg_id = data.get('message_id')
                        if not pin_msg_id:
                            await websocket.send_str(json.dumps({'type': 'error', 'message': 'message_id required'}))
                            continue
                        message_row = db.get_message(pin_msg_id)
                        if not message_row:
                            await websocket.send_str(json.dumps({'type': 'error', 'message': 'Message not found'}))
                            continue
                        # Permission: server member can pin in server; DM participant can pin in DM
                        ctx_type = message_row['context_type']
                        ctx_id = message_row['context_id']
                        if ctx_type == 'server':
                            s_id = ctx_id.split('/')[0]
                            if not db.is_server_member(username, s_id):
                                await websocket.send_str(json.dumps({'type': 'error', 'message': 'Not a server member'}))
                                continue
                        elif ctx_type == 'dm':
                            user_dms = db.get_user_dms(username)
                            dm_ids = [d['dm_id'] for d in user_dms]
                            if ctx_id not in dm_ids:
                                await websocket.send_str(json.dumps({'type': 'error', 'message': 'Not a DM participant'}))
                                continue
                        if db.pin_message(pin_msg_id, username):
                            pin_payload = json.dumps({
                                'type': 'message_pinned',
                                'message_id': pin_msg_id,
                                'pinned_by': username,
                                'context_type': ctx_type,
                                'context_id': ctx_id
                            })
                            if ctx_type == 'server':
                                await broadcast_to_server(ctx_id.split('/')[0], pin_payload)
                            elif ctx_type == 'dm':
                                await broadcast_to_dm_participants(username, ctx_id, pin_payload)
                            else:
                                await websocket.send_str(pin_payload)

                    elif data.get('type') == 'unpin_message':
                        unpin_msg_id = data.get('message_id')
                        if not unpin_msg_id:
                            await websocket.send_str(json.dumps({'type': 'error', 'message': 'message_id required'}))
                            continue
                        message_row = db.get_message(unpin_msg_id)
                        if not message_row:
                            await websocket.send_str(json.dumps({'type': 'error', 'message': 'Message not found'}))
                            continue
                        ctx_type = message_row['context_type']
                        ctx_id = message_row['context_id']
                        if ctx_type == 'server':
                            s_id = ctx_id.split('/')[0]
                            if not db.is_server_member(username, s_id):
                                await websocket.send_str(json.dumps({'type': 'error', 'message': 'Not a server member'}))
                                continue
                        elif ctx_type == 'dm':
                            user_dms = db.get_user_dms(username)
                            dm_ids = [d['dm_id'] for d in user_dms]
                            if ctx_id not in dm_ids:
                                await websocket.send_str(json.dumps({'type': 'error', 'message': 'Not a DM participant'}))
                                continue
                        if db.unpin_message(unpin_msg_id):
                            unpin_payload = json.dumps({
                                'type': 'message_unpinned',
                                'message_id': unpin_msg_id,
                                'context_type': ctx_type,
                                'context_id': ctx_id
                            })
                            if ctx_type == 'server':
                                await broadcast_to_server(ctx_id.split('/')[0], unpin_payload)
                            elif ctx_type == 'dm':
                                await broadcast_to_dm_participants(username, ctx_id, unpin_payload)
                            else:
                                await websocket.send_str(unpin_payload)

                    elif data.get('type') == 'get_pinned_messages':
                        pin_ctx_type = data.get('context_type', '')
                        pin_ctx_id = data.get('context_id', '')
                        # Permission check
                        can_view = False
                        if pin_ctx_type == 'server':
                            s_id = pin_ctx_id.split('/')[0]
                            can_view = db.is_server_member(username, s_id)
                        elif pin_ctx_type == 'dm':
                            user_dms = db.get_user_dms(username)
                            dm_ids = [d['dm_id'] for d in user_dms]
                            can_view = pin_ctx_id in dm_ids
                        elif pin_ctx_type == 'global':
                            can_view = True
                        if not can_view:
                            await websocket.send_str(json.dumps({'type': 'error', 'message': 'No access'}))
                            continue
                        pinned = db.get_pinned_messages(pin_ctx_type, pin_ctx_id)
                        # Enrich with attachments and reactions
                        if pinned:
                            p_ids = [p['id'] for p in pinned]
                            reactions_map = db.get_reactions_for_messages(p_ids)
                            for pm in pinned:
                                pm['reactions'] = reactions_map.get(pm['id'], [])
                                pm['attachments'] = db.get_message_attachments(pm['id'])
                        await websocket.send_str(json.dumps({
                            'type': 'pinned_messages',
                            'context_type': pin_ctx_type,
                            'context_id': pin_ctx_id,
                            'messages': pinned
                        }))

                    elif data.get('type') == 'edit_message':
                        message_id = data.get('message_id')
                        new_content = data.get('content', '').strip()
                        
                        if not message_id or not new_content:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid message edit request'
                            }))
                            continue
                        
                        # Get the message
                        message = db.get_message(message_id)
                        if not message:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Message not found'
                            }))
                            continue
                        
                        # Check if message is deleted
                        if message.get('deleted'):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Cannot edit a deleted message'
                            }))
                            continue
                        
                        # Check permissions
                        can_edit = False
                        
                        # Users can always edit their own messages
                        if message['username'] == username:
                            can_edit = True
                        # Check server permissions for editing others' messages
                        elif message['context_type'] == 'server' and message['context_id']:
                            server_id = message['context_id'].split('/')[0]
                            server = db.get_server(server_id)
                            if server:
                                # Server owner can edit any message
                                if username == server['owner']:
                                    can_edit = True
                                else:
                                    # Check member permissions
                                    members = db.get_server_members(server_id)
                                    for member in members:
                                        if member['username'] == username:
                                            can_edit = member.get('can_edit_messages', False)
                                            break
                        
                        if not can_edit:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'You do not have permission to edit this message'
                            }))
                            continue
                        
                        # Enforce max message length
                        admin_settings = db.get_admin_settings()
                        max_length = admin_settings.get('max_message_length', 2000)
                        if len(new_content) > max_length:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': f'Message exceeds maximum length of {max_length} characters'
                            }))
                            continue
                        
                        # Edit the message
                        if db.edit_message(message_id, new_content):
                            # Get updated message
                            updated_message = db.get_message(message_id)
                            
                            # Broadcast the edit to relevant users
                            edit_notification = {
                                'type': 'message_edited',
                                'message_id': message_id,
                                'content': new_content,
                                'edited_at': updated_message.get('edited_at'),
                                'context_type': message['context_type'],
                                'context_id': message['context_id']
                            }
                            
                            if message['context_type'] == 'server':
                                server_id = message['context_id'].split('/')[0]
                                await broadcast_to_server(server_id, json.dumps(edit_notification))
                            elif message['context_type'] == 'dm':
                                # Send to both DM participants using helper
                                await broadcast_to_dm_participants(username, message['context_id'], json.dumps(edit_notification))
                            
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} edited message {message_id}")
                        else:
                            # Edit failed - could be due to message being deleted by another user
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Failed to edit message. The message may have been deleted.'
                            }))
                    
                    elif data.get('type') == 'delete_message':
                        message_id = data.get('message_id')
                        
                        if not message_id:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid message delete request'
                            }))
                            continue
                        
                        # Get the message
                        message = db.get_message(message_id)
                        if not message:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Message not found'
                            }))
                            continue
                        
                        # Check if message is already deleted
                        if message.get('deleted'):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Message is already deleted'
                            }))
                            continue
                        
                        # Check permissions
                        can_delete = False
                        
                        # Users can always delete their own messages
                        if message['username'] == username:
                            can_delete = True
                        # Check server permissions for deleting others' messages
                        elif message['context_type'] == 'server' and message['context_id']:
                            server_id = message['context_id'].split('/')[0]
                            server = db.get_server(server_id)
                            if server:
                                # Check if user has delete_messages permission (includes admins)
                                can_delete = has_permission(server_id, username, 'delete_messages')
                        
                        if not can_delete:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'You do not have permission to delete this message'
                            }))
                            continue
                        
                        # Delete the message
                        if db.delete_message(message_id):
                            # Broadcast the deletion to relevant users
                            delete_notification = {
                                'type': 'message_deleted',
                                'message_id': message_id,
                                'context_type': message['context_type'],
                                'context_id': message['context_id']
                            }
                            
                            if message['context_type'] == 'server':
                                server_id = message['context_id'].split('/')[0]
                                await broadcast_to_server(server_id, json.dumps(delete_notification))
                            elif message['context_type'] == 'dm':
                                # Send to both DM participants using helper
                                await broadcast_to_dm_participants(username, message['context_id'], json.dumps(delete_notification))
                            
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} deleted message {message_id}")
                        else:
                            # Delete failed - message may already be deleted
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Failed to delete message. It may already be deleted.'
                            }))
                    
                    elif data.get('type') == 'delete_attachment':
                        attachment_id = data.get('attachment_id')
                        
                        if not attachment_id:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid attachment delete request'
                            }))
                            continue
                        
                        # Get the attachment to find its message
                        attachment = db.get_attachment(attachment_id)
                        if not attachment:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Attachment not found'
                            }))
                            continue
                        
                        # Get the message to check permissions
                        message = db.get_message(attachment['message_id'])
                        if not message:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Associated message not found'
                            }))
                            continue
                        
                        # Check permissions (same logic as message deletion)
                        can_delete = False
                        
                        # Users can always delete attachments from their own messages
                        if message['username'] == username:
                            can_delete = True
                        # Check server permissions for deleting others' attachments
                        elif message['context_type'] == 'server' and message['context_id']:
                            server_id = message['context_id'].split('/')[0]
                            server = db.get_server(server_id)
                            if server:
                                # Server owner can delete any attachment
                                if username == server['owner']:
                                    can_delete = True
                                else:
                                    # Check member permissions
                                    members = db.get_server_members(server_id)
                                    for member in members:
                                        if member['username'] == username:
                                            can_delete = member.get('can_delete_messages', False)
                                            break
                        
                        if not can_delete:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'You do not have permission to delete this attachment'
                            }))
                            continue
                        
                        # Delete the attachment
                        if db.delete_attachment(attachment_id):
                            # Broadcast the deletion to relevant users
                            delete_notification = {
                                'type': 'attachment_deleted',
                                'attachment_id': attachment_id,
                                'message_id': attachment['message_id'],
                                'context_type': message['context_type'],
                                'context_id': message['context_id']
                            }
                            
                            if message['context_type'] == 'server':
                                server_id = message['context_id'].split('/')[0]
                                await broadcast_to_server(server_id, json.dumps(delete_notification))
                            elif message['context_type'] == 'dm':
                                # Send to both DM participants
                                await broadcast_to_dm_participants(username, message['context_id'], json.dumps(delete_notification))
                            
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} deleted attachment {attachment_id}")
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Failed to delete attachment'
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
                                        'is_friend': user in friends,
                                        'request_sent': user in requests_sent,
                                        'request_received': user in requests_received,
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
                                friend_profile = get_profile_data(friend_username)
                                await websocket.send_str(json.dumps({
                                    'type': 'friend_added',
                                    'username': friend_username,
                                    **friend_avatar,
                                    **friend_profile
                                }))
                                
                                # Notify the other user
                                user_avatar = get_avatar_data(username)
                                user_profile = get_profile_data(username)
                                await send_to_user(friend_username, json.dumps({
                                    'type': 'friend_added',
                                    'username': username,
                                    **user_avatar,
                                    **user_profile
                                }))
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} and {friend_username} are now friends (mutual request)")
                            else:
                                # Send friend request
                                db.add_friend_request(username, friend_username)
                                
                                friend_avatar = get_avatar_data(friend_username)
                                friend_profile = get_profile_data(friend_username)
                                await websocket.send_str(json.dumps({
                                    'type': 'friend_request_sent',
                                    'username': friend_username,
                                    **friend_avatar,
                                    **friend_profile
                                }))
                                
                                # Notify the other user
                                user_avatar = get_avatar_data(username)
                                user_profile = get_profile_data(username)
                                await send_to_user(friend_username, json.dumps({
                                    'type': 'friend_request_received',
                                    'username': username,
                                    **user_avatar,
                                    **user_profile
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
                            requester_profile = get_profile_data(requester_username)
                            await websocket.send_str(json.dumps({
                                'type': 'friend_request_approved',
                                'username': requester_username,
                                **requester_avatar,
                                **requester_profile
                            }))
                            
                            # Notify the requester
                            user_avatar = get_avatar_data(username)
                            user_profile = get_profile_data(username)
                            await send_to_user(requester_username, json.dumps({
                                'type': 'friend_request_accepted',
                                'username': username,
                                **user_avatar,
                                **user_profile
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
                            friend_profile = get_profile_data(friend_username)
                            dm_info = {
                                'type': 'dm_started',
                                'dm': {
                                    'id': dm_id,
                                    'username': friend_username,
                                    **friend_avatar,
                                    **friend_profile
                                }
                            }
                            await websocket.send_str(json.dumps(dm_info))
                            
                            # Notify the other user
                            user_avatar = get_avatar_data(username)
                            user_profile = get_profile_data(username)
                            await send_to_user(friend_username, json.dumps({
                                'type': 'dm_started',
                                'dm': {
                                    'id': dm_id,
                                    'username': username,
                                    **user_avatar,
                                    **user_profile
                                }
                            }))
                    
                    elif data.get('type') == 'mark_as_read':
                        # Mark messages as read in a specific context
                        context_type = data.get('context_type')
                        context_id = data.get('context_id')
                        
                        if context_type and context_id:
                            # Mark messages as read
                            success = db.mark_messages_as_read(username, context_type, context_id)
                            
                            if success:
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} marked messages as read in {context_type}:{context_id}")
                    
                    elif data.get('type') == 'generate_invite':
                        # Generate a new instance invite code (admin only)
                        first_user = db.get_first_user()
                        is_admin = (username == first_user)
                        
                        if not is_admin:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Only the instance administrator can generate invite codes'
                            }))
                            continue
                        
                        max_uses = data.get('max_uses')  # None = unlimited
                        description = data.get('description', '')
                        
                        invite_code = generate_invite_code()
                        db.create_invite_code(invite_code, username, 'global', max_uses=max_uses, description=description)
                        
                        await websocket.send_str(json.dumps({
                            'type': 'invite_code',
                            'code': invite_code,
                            'max_uses': max_uses,
                            'description': description,
                            'message': f'Invite code generated: {invite_code}'
                        }))
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} generated invite code: {invite_code} (max_uses: {max_uses})")
                    
                    elif data.get('type') == 'list_instance_invites':
                        # List all instance invite codes (admin only)
                        first_user = db.get_first_user()
                        is_admin = (username == first_user)
                        
                        if not is_admin:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Only the instance administrator can view invite codes'
                            }))
                            continue
                        
                        invites = db.get_instance_invite_codes()
                        
                        # Convert datetime values for JSON serialization
                        serialized_invites = []
                        for invite in invites:
                            item = dict(invite)
                            if isinstance(item.get('created_at'), datetime):
                                item['created_at'] = item['created_at'].isoformat()
                            serialized_invites.append(item)
                        
                        await websocket.send_str(json.dumps({
                            'type': 'instance_invites_list',
                            'invites': serialized_invites
                        }))
                    
                    elif data.get('type') == 'get_instance_invite_usage':
                        # Get instance invite usage logs (admin only)
                        first_user = db.get_first_user()
                        is_admin = (username == first_user)
                        
                        if not is_admin:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Only the instance administrator can view invite usage'
                            }))
                            continue
                        
                        usage_logs = db.get_instance_invite_usage()
                        
                        # Convert datetime values for JSON serialization
                        serialized_logs = []
                        for log in usage_logs:
                            item = dict(log)
                            for key in ('first_used', 'last_used'):
                                value = item.get(key)
                                if isinstance(value, datetime):
                                    item[key] = value.isoformat()
                            serialized_logs.append(item)
                        
                        await websocket.send_str(json.dumps({
                            'type': 'instance_invite_usage',
                            'usage_logs': serialized_logs
                        }))
                    
                    elif data.get('type') == 'revoke_instance_invite':
                        # Revoke (deactivate) an instance invite code (admin only)
                        first_user = db.get_first_user()
                        is_admin = (username == first_user)
                        
                        if not is_admin:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Only the instance administrator can revoke invite codes'
                            }))
                            continue
                        
                        code = data.get('code', '').strip()
                        if code:
                            db.deactivate_invite_code(code)
                            await websocket.send_str(json.dumps({
                                'type': 'invite_revoked',
                                'code': code,
                                'message': 'Invite code has been revoked'
                            }))
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} revoked instance invite: {code}")
                    
                    # Admin configuration handlers
                    elif data.get('type') == 'check_admin':
                        first_user = db.get_first_user()
                        is_admin = (username == first_user)
                        log_admin_check(username, first_user, is_admin, context="check_admin request")
                        
                        await websocket.send_str(json.dumps({
                            'type': 'admin_status',
                            'is_admin': is_admin,
                            'first_user': first_user
                        }))
                    
                    # 2FA Management handlers
                    elif data.get('type') == 'setup_2fa':
                        # Generate new 2FA secret
                        secret = generate_2fa_secret()
                        backup_codes = generate_backup_codes()
                        
                        # Save to database (not enabled yet)
                        backup_codes_str = ','.join(backup_codes)
                        if db.create_2fa_secret(username, secret, backup_codes_str):
                            # Generate QR code
                            qr_code = generate_qr_code_base64(username, secret)
                            
                            # NOTE: The raw 2FA secret is sent only for initial authenticator setup.
                            # Clients must NOT store this value and should use it solely to configure
                            # the authenticator app (e.g., via QR code generation) and then discard it.
                            await websocket.send_str(json.dumps({
                                'type': '2fa_setup',
                                'secret': secret,
                                'qr_code': qr_code,
                                'backup_codes': backup_codes,
                                'warning': 'The 2FA secret is sensitive. Do NOT store it; use it only to set up your authenticator app and then discard it.'
                            }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Failed to setup 2FA'
                            }))
                    
                    elif data.get('type') == 'verify_2fa_setup':
                        # Verify the code and enable 2FA
                        totp_code = data.get('code', '').strip()
                        
                        if not totp_code:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Verification code required'
                            }))
                            continue
                        
                        # Get the secret
                        twofa_data = db.get_2fa_secret(username)
                        if not twofa_data:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'No 2FA setup found. Please start setup again.'
                            }))
                            continue
                        
                        # Verify the code
                        if verify_2fa_token(twofa_data['secret'], totp_code):
                            # Enable 2FA
                            if db.enable_2fa(username):
                                await websocket.send_str(json.dumps({
                                    'type': '2fa_enabled',
                                    'message': 'Two-factor authentication enabled successfully'
                                }))
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] 2FA enabled for user: {username}")
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Failed to enable 2FA'
                                }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid verification code'
                            }))
                    
                    elif data.get('type') == 'disable_2fa':
                        # Require password and 2FA code to disable
                        password = data.get('password', '')
                        totp_code = data.get('code', '').strip()
                        
                        if not password:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Password required to disable 2FA'
                            }))
                            continue
                        
                        # Verify password
                        user = db.get_user(username)
                        if not user or not verify_password(password, user['password_hash']):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid password'
                            }))
                            continue
                        
                        # Verify 2FA code or backup code
                        twofa_data = db.get_2fa_secret(username)
                        if twofa_data and twofa_data.get('enabled'):
                            if not totp_code:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': '2FA code or backup code required to disable 2FA'
                                }))
                                continue
                            
                            valid_code = False
                            if verify_2fa_token(twofa_data['secret'], totp_code):
                                valid_code = True
                            elif db.use_backup_code(username, totp_code):
                                valid_code = True
                            
                            if not valid_code:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Invalid 2FA code'
                                }))
                                continue
                        
                        # Disable 2FA
                        if db.disable_2fa(username):
                            await websocket.send_str(json.dumps({
                                'type': '2fa_disabled',
                                'message': 'Two-factor authentication disabled'
                            }))
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] 2FA disabled for user: {username}")
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Failed to disable 2FA'
                            }))
                    
                    elif data.get('type') == 'get_2fa_status':
                        # Get current 2FA status
                        twofa_data = db.get_2fa_secret(username)
                        enabled = twofa_data is not None and twofa_data.get('enabled', False)
                        
                        await websocket.send_str(json.dumps({
                            'type': '2fa_status',
                            'enabled': enabled
                        }))
                    
                    elif data.get('type') == 'get_admin_settings':
                        # Load settings from database
                        settings = db.get_admin_settings()
                        
                        # Serialize datetime fields to prevent JSON encoding errors
                        set_at = settings.get('announcement_set_at')
                        if set_at and hasattr(set_at, 'isoformat'):
                            settings['announcement_set_at'] = set_at.isoformat()
                        
                        # Check if user is admin
                        first_user = db.get_first_user()
                        if username != first_user:
                            # Non-admin users get filtered settings (no sensitive data like SMTP/SSO credentials)
                            filtered_settings = {
                                'allow_file_attachments': settings.get('allow_file_attachments', True),
                                'max_attachment_size_mb': settings.get('max_attachment_size_mb', 10),
                                'max_message_length': settings.get('max_message_length', 2000),
                                'announcement_enabled': settings.get('announcement_enabled', False),
                                'announcement_message': settings.get('announcement_message', ''),
                                'announcement_duration_minutes': settings.get('announcement_duration_minutes', 60),
                                'announcement_set_at': settings.get('announcement_set_at'),
                                'sso_enabled': settings.get('sso_enabled', False),
                                'sso_provider': settings.get('sso_provider', None),
                            }
                            await websocket.send_str(json.dumps({
                                'type': 'admin_settings',
                                'settings': filtered_settings
                            }))
                        else:
                            # Admin users get all settings (mask SSO secrets with asterisks for display)
                            admin_settings = dict(settings)
                            # Mask sensitive SSO fields so they aren't leaked to the browser
                            for secret_key in ['sso_oidc_client_secret', 'sso_ldap_bind_password', 'scim_bearer_token']:
                                if admin_settings.get(secret_key):
                                    admin_settings[secret_key] = '••••••••'
                            await websocket.send_str(json.dumps({
                                'type': 'admin_settings',
                                'settings': admin_settings
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
                            
                            # Fetch current settings once — used for diffing in the license gates
                            from license_validator import check_feature_access as _check_feat, license_validator as _lv
                            current_settings = db.get_admin_settings()
                            
                            # SSO / SCIM license gate — only fires when values actually change
                            sso_fields = {'sso_enabled', 'sso_provider', 'sso_oidc_issuer_url',
                                          'sso_oidc_client_id', 'sso_oidc_client_secret', 'sso_oidc_preset',
                                          'sso_saml_entity_id', 'sso_saml_sso_url', 'sso_saml_certificate',
                                          'sso_ldap_server_url', 'sso_ldap_bind_dn', 'sso_ldap_bind_password',
                                          'sso_ldap_user_search_base', 'sso_ldap_user_filter',
                                          'scim_enabled', 'scim_bearer_token'}
                            has_sso_changes = any(
                                settings.get(k) != current_settings.get(k)
                                for k in sso_fields if k in settings
                            )
                            if has_sso_changes and not _check_feat('sso'):
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'SSO/SCIM configuration requires a paid license tier.'
                                }))
                                continue
                            
                            # Branding license gate — server name / logo require any paid tier
                            branding_fields = {'server_name', 'server_logo'}
                            has_branding_changes = any(
                                settings.get(k) != current_settings.get(k)
                                for k in branding_fields if k in settings
                            )
                            if has_branding_changes and _lv.get_tier() == 'community':
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Custom server branding requires a paid license.'
                                }))
                                continue
                            
                            # Don't overwrite secrets with the masked placeholder
                            for secret_key in ['sso_oidc_client_secret', 'sso_ldap_bind_password', 'scim_bearer_token']:
                                if settings.get(secret_key) == '••••••••':
                                    settings.pop(secret_key)
                            
                            # Server-side validation for announcement settings
                            if settings.get('announcement_enabled'):
                                # Validate message length
                                message = settings.get('announcement_message', '')
                                if len(message) > 500:
                                    await websocket.send_str(json.dumps({
                                        'type': 'error',
                                        'message': 'Announcement message cannot exceed 500 characters'
                                    }))
                                    continue
                                
                                # Validate duration — default to 60 if missing or null
                                duration = settings.get('announcement_duration_minutes') or 60
                                if not isinstance(duration, (int, float)):
                                    await websocket.send_str(json.dumps({
                                        'type': 'error',
                                        'message': 'Invalid announcement duration value'
                                    }))
                                    continue
                                
                                duration = int(duration)
                                if duration < 1 or duration > 10080:
                                    await websocket.send_str(json.dumps({
                                        'type': 'error',
                                        'message': 'Announcement duration must be between 1 and 10080 minutes'
                                    }))
                                    continue
                                
                                settings['announcement_duration_minutes'] = duration
                            
                            # If announcement is enabled and message is set, update timestamp
                            if settings.get('announcement_enabled') and settings.get('announcement_message'):
                                # Use current_settings fetched above to check if announcement changed
                                if (not current_settings.get('announcement_enabled') or 
                                    current_settings.get('announcement_message') != settings.get('announcement_message') or
                                    current_settings.get('announcement_duration_minutes') != settings.get('announcement_duration_minutes')):
                                    # Announcement was just enabled, message changed, or duration changed - reset timestamp
                                    settings['announcement_set_at'] = datetime.now(timezone.utc)
                            elif not settings.get('announcement_enabled'):
                                # Announcement disabled, clear timestamp
                                settings['announcement_set_at'] = None
                            
                            # Save settings to database
                            success = db.update_admin_settings(settings)
                            
                            if success:
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] Admin {username} updated settings: {settings}")
                                
                                # Broadcast announcement update to all connected clients
                                set_at = settings.get('announcement_set_at')
                                announcement_data = {
                                    'type': 'announcement_update',
                                    'enabled': settings.get('announcement_enabled', False),
                                    'message': settings.get('announcement_message', ''),
                                    'duration_minutes': settings.get('announcement_duration_minutes', 60),
                                    'set_at': set_at.isoformat() if set_at and hasattr(set_at, 'isoformat') else None,
                                    'max_message_length': settings.get('max_message_length', 2000)
                                }
                                
                                for client_ws in clients.keys():
                                    try:
                                        await client_ws.send_str(json.dumps(announcement_data))
                                    except Exception:
                                        pass  # Ignore errors sending to individual clients
                                
                                await websocket.send_str(json.dumps({
                                    'type': 'settings_saved',
                                    'message': 'Settings saved successfully'
                                }))
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Failed to save settings'
                                }))
                    
                    elif data.get('type') == 'test_smtp':
                        # Verify user is admin
                        first_user = db.get_first_user()
                        if username != first_user:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Access denied. Admin only.'
                            }))
                        else:
                            smtp_settings = data.get('settings', {})
                            test_email = data.get('test_email', '').strip()
                            email_sender = EmailSender(smtp_settings)
                            
                            # If test email provided, send actual test email
                            if test_email:
                                success, message = email_sender.send_test_email(test_email)
                            else:
                                # Just test connection
                                success, message = email_sender.test_connection()
                            
                            await websocket.send_str(json.dumps({
                                'type': 'smtp_test_result',
                                'success': success,
                                'message': message
                            }))
                    
                    elif data.get('type') == 'get_registered_users':
                        # Verify user is admin
                        first_user = db.get_first_user()
                        if username != first_user:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Access denied. Admin only.'
                            }))
                        else:
                            # Get all users with detailed information
                            users = db.get_all_users_detailed()
                            
                            # Convert datetime objects to ISO format strings
                            for user in users:
                                if user.get('created_at') and hasattr(user['created_at'], 'isoformat'):
                                    user['created_at'] = user['created_at'].isoformat()
                            
                            await websocket.send_str(json.dumps({
                                'type': 'registered_users',
                                'users': users
                            }))
                    
                    elif data.get('type') == 'delete_registered_user':
                        # Verify user is admin
                        first_user = db.get_first_user()
                        if username != first_user:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Access denied. Admin only.'
                            }))
                        else:
                            target_username = data.get('username', '').strip()
                            
                            # Validate username
                            if not target_username:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Username is required'
                                }))
                                continue
                            
                            # Prevent admin from deleting themselves
                            if target_username == username:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Cannot delete your own account'
                                }))
                                continue
                            
                            # Delete the user
                            success = db.delete_user_keep_messages(target_username)
                            
                            if success:
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] Admin {username} deleted user: {target_username}")
                                
                                # Close the deleted user's websocket connection if they're online
                                for client_ws, client_user in list(clients.items()):
                                    if client_user == target_username:
                                        try:
                                            await client_ws.send_str(json.dumps({
                                                'type': 'account_deleted',
                                                'message': 'Your account has been deleted by an administrator'
                                            }))
                                            await client_ws.close()
                                        except Exception:
                                            pass
                                        break
                                
                                await websocket.send_str(json.dumps({
                                    'type': 'user_deleted',
                                    'message': f'User {target_username} has been deleted',
                                    'username': target_username
                                }))
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': f'Failed to delete user {target_username}'
                                }))
                    
                    elif data.get('type') == 'sync_data':
                        # Handle request to sync/refresh user data (servers, DMs, friends)
                        # Use helper functions to build data consistently with init message
                        refreshed_servers = build_user_servers_data(username)
                        refreshed_dms = build_user_dms_data(username)
                        refreshed_friends = build_user_friends_data(username)
                        refreshed_requests_sent, refreshed_requests_received = build_friend_requests_data(username)
                        
                        # Send synced data to client
                        await websocket.send_str(json.dumps({
                            'type': 'data_synced',
                            'servers': refreshed_servers,
                            'dms': refreshed_dms,
                            'friends': refreshed_friends,
                            'friend_requests_sent': refreshed_requests_sent,
                            'friend_requests_received': refreshed_requests_received
                        }))
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] Data synced for {username}")
                    
                    # Server settings handlers
                    elif data.get('type') == 'rename_server':
                        server_id = data.get('server_id', '')
                        new_name = data.get('name', '').strip()
                        
                        server = db.get_server(server_id)
                        if server and new_name:
                            if has_permission(server_id, username, 'manage_server'):
                                old_name = server['name']
                                db.update_server_name(server_id, new_name)
                                
                                db.add_audit_log_entry(server_id, 'server_rename', actor=username,
                                                       detail={'old_name': old_name, 'new_name': new_name})

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
                                    'message': 'You do not have permission to manage server settings'
                                }))
                    
                    elif data.get('type') == 'generate_server_invite':
                        server_id = data.get('server_id', '')
                        max_uses = data.get('max_uses')  # None = unlimited
                        description = data.get('description', '')
                        
                        # Check if user has permission to create invites
                        if has_permission(server_id, username, 'create_invite'):
                            invite_code = generate_invite_code()
                            db.create_invite_code(invite_code, username, 'server', server_id, max_uses=max_uses, description=description)
                            
                            await websocket.send_str(json.dumps({
                                'type': 'server_invite_code',
                                'server_id': server_id,
                                'code': invite_code,
                                'max_uses': max_uses,
                                'description': description,
                                'message': f'Server invite code generated: {invite_code}'
                            }))
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} generated invite for server {server_id}: {invite_code} (max_uses: {max_uses})")
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'You do not have permission to create server invites'
                            }))
                    
                    elif data.get('type') == 'get_server_invite_usage':
                        server_id = data.get('server_id', '')
                        
                        # Check if user has permission to view invite usage
                        if has_permission(server_id, username, 'access_settings'):
                            usage_logs = db.get_server_invite_usage(server_id)

                            # Convert datetime values for JSON serialization.
                            serialized_logs = []
                            for log in usage_logs:
                                item = dict(log)
                                for key in ('first_used', 'last_used'):
                                    value = item.get(key)
                                    if isinstance(value, datetime):
                                        item[key] = value.isoformat()
                                serialized_logs.append(item)
                            
                            await websocket.send_str(json.dumps({
                                'type': 'server_invite_usage',
                                'server_id': server_id,
                                'usage_logs': serialized_logs
                            }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'You do not have permission to view invite usage'
                            }))
                    
                    elif data.get('type') == 'list_server_invites':
                        server_id = data.get('server_id', '')
                        
                        # Check if user has permission to view invites
                        if has_permission(server_id, username, 'access_settings'):
                            invites = db.get_server_invite_codes(server_id)
                            
                            # Convert datetime values for JSON serialization
                            serialized_invites = []
                            for invite in invites:
                                item = dict(invite)
                                if isinstance(item.get('created_at'), datetime):
                                    item['created_at'] = item['created_at'].isoformat()
                                serialized_invites.append(item)
                            
                            await websocket.send_str(json.dumps({
                                'type': 'server_invites_list',
                                'server_id': server_id,
                                'invites': serialized_invites
                            }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'You do not have permission to view server invites'
                            }))
                    
                    elif data.get('type') == 'revoke_server_invite':
                        server_id = data.get('server_id', '')
                        code = data.get('code', '').strip()
                        
                        # Check if user has permission to manage invites
                        if has_permission(server_id, username, 'access_settings'):
                            if code:
                                db.deactivate_invite_code(code)
                                await websocket.send_str(json.dumps({
                                    'type': 'server_invite_revoked',
                                    'server_id': server_id,
                                    'code': code,
                                    'message': 'Server invite code has been revoked'
                                }))
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} revoked server invite: {code}")
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'You do not have permission to revoke server invites'
                            }))
                    
                    elif data.get('type') == 'join_server_with_invite':
                        invite_code = data.get('invite_code', '').strip()
                        
                        # Find server with this invite code
                        invite_data = db.get_invite_code(invite_code)
                        if invite_data and invite_data['code_type'] == 'server':
                            server_id = invite_data['server_id']
                            server = db.get_server(server_id)
                            
                            # Check if user is banned from this server
                            if db.is_user_banned(server_id, username):
                                ban_info = db.get_user_ban_info(server_id, username)
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': f'You are banned from this server. Reason: {ban_info.get("reason", "No reason provided")}'
                                }))
                                continue
                            
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
                                
                                # Log invite usage
                                db.log_invite_usage(invite_code, username, server_id)
                                # Check if invite has reached max uses
                                max_uses = invite_data.get('max_uses')
                                if max_uses is not None:
                                    current_uses = db.get_invite_usage_count(invite_code)
                                    if current_uses >= max_uses:
                                        db.deactivate_invite_code(invite_code)
                                
                                # ── Server automation: auto-role & rules gate ──
                                server_settings = db.get_server_settings(server_id)
                                rules_pending = False
                                
                                # Auto-role assignment
                                if server_settings and server_settings.get('auto_role_id'):
                                    auto_role_id = server_settings['auto_role_id']
                                    auto_role = db.get_role(auto_role_id)
                                    if auto_role and auto_role.get('server_id') == server_id:
                                        db.assign_role(server_id, username, auto_role_id)
                                        # Notify joining user about their new role
                                        await websocket.send_str(json.dumps({
                                            'type': 'role_assigned',
                                            'server_id': server_id,
                                            'role': auto_role
                                        }))
                                        # Broadcast to other members
                                        await broadcast_to_server(server_id, json.dumps({
                                            'type': 'member_role_updated',
                                            'server_id': server_id,
                                            'username': username,
                                            'role_id': auto_role_id,
                                            'action': 'added'
                                        }), exclude=websocket)
                                        print(f"[{datetime.now().strftime('%H:%M:%S')}] Auto-assigned role {auto_role.get('name')} to {username} in server {server_id}")
                                
                                # Rules screening gate
                                if server_settings and server_settings.get('rules_enabled') and server_settings.get('rules_text', '').strip():
                                    db.set_member_rules_accepted(server_id, username, False)
                                    rules_pending = True
                                
                                # Get channels for response
                                channels = db.get_server_channels(server_id)
                                categories = db.get_server_categories(server_id)
                                server_joined_payload = {
                                    'type': 'server_joined',
                                    'server': {
                                        'id': server_id,
                                        'name': server['name'],
                                        'owner': server['owner'],
                                        'icon': server.get('icon', '🏠'),
                                        'icon_type': server.get('icon_type', 'emoji'),
                                        'icon_data': server.get('icon_data'),
                                        'channels': [
                                            {'id': ch['channel_id'], 'name': ch['name'], 'type': ch.get('type', 'text'),
                                             'category_id': ch.get('category_id'), 'position': ch.get('position', 0)}
                                            for ch in channels
                                        ],
                                        'categories': [
                                            {'id': cat['category_id'], 'name': cat['name'], 'position': cat.get('position', 0)}
                                            for cat in categories
                                        ]
                                    }
                                }
                                if rules_pending:
                                    server_joined_payload['server']['rules_pending'] = True
                                    server_joined_payload['server']['rules_text'] = server_settings.get('rules_text', '')
                                
                                await websocket.send_str(json.dumps(server_joined_payload))
                                
                                # Notify other server members
                                await broadcast_to_server(server_id, json.dumps({
                                    'type': 'member_joined',
                                    'server_id': server_id,
                                    'username': username
                                }), exclude=websocket)
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} joined server {server_id} via invite")
                                
                                db.add_audit_log_entry(server_id, 'member_join', actor=username,
                                                       target=username, detail={'invite_code': invite_code})

                                # Send welcome message if enabled
                                welcome = db.get_welcome_message(server_id)
                                if welcome and welcome['enabled'] and welcome['message']:
                                    # Get user profile for avatar
                                    user_profile = db.get_user(username)
                                    
                                    # Determine which channel to send welcome message to
                                    target_channel_id = welcome.get('channel_id')
                                    if not target_channel_id and channels:
                                        # Default to first channel if no specific channel set
                                        target_channel_id = channels[0]['channel_id']
                                    
                                    if target_channel_id:
                                        # Replace {user} placeholder with username
                                        welcome_text = welcome['message'].replace('{user}', f'@{username}')
                                        
                                        # Save welcome message to database
                                        context_id = f"{server_id}/{target_channel_id}"
                                        message_id = db.save_message('System', welcome_text, 'server', context_id, None)
                                        
                                        # Broadcast welcome message to server
                                        welcome_msg = {
                                            'type': 'message',
                                            'id': message_id,
                                            'username': 'System',
                                            'content': welcome_text,
                                            'timestamp': datetime.now().isoformat(),
                                            'context': 'server',
                                            'context_id': context_id,
                                            'avatar': '🤖',
                                            'avatar_type': 'emoji',
                                            'mentions': [username] if '{user}' in welcome['message'] else []
                                        }
                                        await broadcast_to_server(server_id, json.dumps(welcome_msg))
                                        print(f"[{datetime.now().strftime('%H:%M:%S')}] Sent welcome message to {username} in server {server_id}")
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
                    
                    elif data.get('type') == 'get_server_info_by_invite':
                        # Public endpoint to preview server info before joining (no auth required)
                        invite_code = data.get('invite_code', '').strip()
                        
                        # Find server with this invite code
                        invite_data = db.get_invite_code(invite_code)
                        if invite_data and invite_data['code_type'] == 'server':
                            server_id = invite_data['server_id']
                            server = db.get_server(server_id)
                            members = db.get_server_members(server_id)
                            
                            if server:
                                await websocket.send_str(json.dumps({
                                    'type': 'server_info_preview',
                                    'server': {
                                        'id': server_id,
                                        'name': server['name'],
                                        'icon': server.get('icon', '🏠'),
                                        'icon_type': server.get('icon_type', 'emoji'),
                                        'icon_data': server.get('icon_data'),
                                        'description': server.get('description', ''),
                                        'member_count': len(members)
                                    },
                                    'invite_code': invite_code
                                }))
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Server not found'
                                }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid or expired invite code'
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
                                        'user_status': get_user_status(member['username']),
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
                        hoist = data.get('hoist', False)
                        # Coerce array format to dict {key: True}
                        if isinstance(permissions, list):
                            permissions = {k: True for k in permissions}
                        
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
                                if db.create_role(role_id, server_id, role_name, color, position, permissions, hoist):
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
                        hoist = data.get('hoist')  # None means unchanged
                        # Coerce array format to dict {key: True}
                        if isinstance(permissions, list):
                            permissions = {k: True for k in permissions}
                        
                        role = db.get_role(role_id)
                        if role:
                            server = db.get_server(role['server_id'])
                            if server and username == server['owner']:
                                if db.update_role(role_id, role_name, color, None, permissions, hoist):
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
                        if not server:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Server not found'
                            }))
                        elif not (username == server['owner'] or has_permission(server_id, username, 'administrator')):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Only the server owner or administrators can assign roles'
                            }))
                        else:
                            role = db.get_role(role_id)
                            if not role:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Role not found'
                                }))
                            elif db.assign_role(server_id, target_username, role_id):
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
                                db.add_audit_log_entry(server_id, 'role_assign', actor=username,
                                                       target=target_username,
                                                       detail={'role_id': role_id, 'role_name': role.get('name', '')})
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Failed to assign role'
                                }))
                    
                    elif data.get('type') == 'remove_role_from_user':
                        server_id = data.get('server_id', '')
                        target_username = data.get('username', '')
                        role_id = data.get('role_id', '')
                        
                        server = db.get_server(server_id)
                        if not server:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Server not found'
                            }))
                        elif not (username == server['owner'] or has_permission(server_id, username, 'administrator')):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Only the server owner or administrators can remove roles'
                            }))
                        elif db.remove_role_from_user(server_id, target_username, role_id):
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
                            db.add_audit_log_entry(server_id, 'role_remove', actor=username,
                                                   target=target_username, detail={'role_id': role_id})
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Failed to remove role'
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
                    
                    elif data.get('type') == 'reorder_roles':
                        # Move a role up or down by one position slot
                        server_id = data.get('server_id', '')
                        role_id = data.get('role_id', '')
                        direction = data.get('direction', '')  # 'up' or 'down'
                        
                        server = db.get_server(server_id)
                        if not server or username != server['owner']:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Only the server owner can reorder roles'
                            }))
                        elif direction not in ('up', 'down'):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'direction must be up or down'
                            }))
                        else:
                            roles = sorted(db.get_server_roles(server_id), key=lambda r: r['position'])
                            idx = next((i for i, r in enumerate(roles) if r['role_id'] == role_id), None)
                            if idx is not None:
                                swap_idx = idx + 1 if direction == 'up' else idx - 1
                                if 0 <= swap_idx < len(roles):
                                    # Swap positions
                                    p1 = roles[idx]['position']
                                    p2 = roles[swap_idx]['position']
                                    db.update_role_positions(server_id, [
                                        {'role_id': roles[idx]['role_id'], 'position': p2},
                                        {'role_id': roles[swap_idx]['role_id'], 'position': p1},
                                    ])
                                    updated_roles = db.get_server_roles(server_id)
                                    await broadcast_to_server(server_id, json.dumps({
                                        'type': 'roles_reordered',
                                        'server_id': server_id,
                                        'roles': [serialize_role(r) for r in updated_roles]
                                    }))
                    
                    elif data.get('type') == 'get_channel_permissions':
                        channel_id = data.get('channel_id', '')
                        server_id = data.get('server_id', '')
                        
                        server = db.get_server(server_id)
                        if server and (username == server['owner'] or has_permission(server_id, username, 'manage_channels')):
                            overrides = db.get_channel_all_overrides(channel_id)
                            await websocket.send_str(json.dumps({
                                'type': 'channel_permissions',
                                'channel_id': channel_id,
                                'overrides': overrides
                            }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'No permission to view channel permissions'
                            }))
                    
                    elif data.get('type') == 'set_channel_role_permissions':
                        channel_id = data.get('channel_id', '')
                        role_id = data.get('role_id', '')
                        permissions = data.get('permissions', {})
                        server_id = data.get('server_id', '')
                        
                        if isinstance(permissions, list):
                            permissions = {k: True for k in permissions}
                        
                        server = db.get_server(server_id)
                        if not server or not (username == server['owner'] or has_permission(server_id, username, 'manage_channels')):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'No permission to set channel permissions'
                            }))
                        else:
                            if db.set_channel_role_permissions(channel_id, role_id, permissions):
                                overrides = db.get_channel_all_overrides(channel_id)
                                await broadcast_to_server(server_id, json.dumps({
                                    'type': 'channel_permissions_updated',
                                    'server_id': server_id,
                                    'channel_id': channel_id,
                                    'overrides': overrides
                                }))
                    
                    elif data.get('type') == 'delete_channel_role_permissions':
                        channel_id = data.get('channel_id', '')
                        role_id = data.get('role_id', '')
                        server_id = data.get('server_id', '')
                        
                        server = db.get_server(server_id)
                        if not server or not (username == server['owner'] or has_permission(server_id, username, 'manage_channels')):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'No permission to delete channel permissions'
                            }))
                        else:
                            if db.delete_channel_role_permissions(channel_id, role_id):
                                overrides = db.get_channel_all_overrides(channel_id)
                                await broadcast_to_server(server_id, json.dumps({
                                    'type': 'channel_permissions_updated',
                                    'server_id': server_id,
                                    'channel_id': channel_id,
                                    'overrides': overrides
                                }))
                    
                    elif data.get('type') == 'get_category_permissions':
                        category_id = data.get('category_id', '')
                        server_id = data.get('server_id', '')
                        
                        server = db.get_server(server_id)
                        if server and (username == server['owner'] or has_permission(server_id, username, 'manage_categories')):
                            overrides = db.get_category_all_overrides(category_id)
                            await websocket.send_str(json.dumps({
                                'type': 'category_permissions',
                                'category_id': category_id,
                                'overrides': overrides
                            }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'No permission to view category permissions'
                            }))
                    
                    elif data.get('type') == 'set_category_role_permissions':
                        category_id = data.get('category_id', '')
                        role_id = data.get('role_id', '')
                        permissions = data.get('permissions', {})
                        server_id = data.get('server_id', '')
                        
                        if isinstance(permissions, list):
                            permissions = {k: True for k in permissions}
                        
                        server = db.get_server(server_id)
                        if not server or not (username == server['owner'] or has_permission(server_id, username, 'manage_categories')):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'No permission to set category permissions'
                            }))
                        else:
                            if db.set_category_role_permissions(category_id, role_id, permissions):
                                overrides = db.get_category_all_overrides(category_id)
                                await broadcast_to_server(server_id, json.dumps({
                                    'type': 'category_permissions_updated',
                                    'server_id': server_id,
                                    'category_id': category_id,
                                    'overrides': overrides
                                }))
                    
                    # Ban management handlers
                    elif data.get('type') == 'ban_member':
                        server_id = data.get('server_id', '')
                        target_username = data.get('username', '').strip()
                        reason = data.get('reason', '').strip()
                        
                        server = db.get_server(server_id)
                        if not server:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Server not found'
                            }))
                            continue
                        
                        # Check if requester has ban_members permission
                        if not has_permission(server_id, username, 'ban_members'):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'You do not have permission to ban members'
                            }))
                            continue
                        
                        # Cannot ban the server owner
                        if target_username == server['owner']:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Cannot ban the server owner'
                            }))
                            continue
                        
                        # Cannot ban yourself
                        if target_username == username:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Cannot ban yourself'
                            }))
                            continue
                        
                        # Verify target user exists and is a member
                        if not db.get_user(target_username):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'User not found'
                            }))
                            continue
                        
                        members = db.get_server_members(server_id)
                        if target_username not in [m['username'] for m in members]:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'User is not a member of this server'
                            }))
                            continue
                        
                        # Execute the ban
                        if db.ban_user_from_server(server_id, target_username, username, reason):
                            # Notify the banned user
                            await send_to_user(target_username, json.dumps({
                                'type': 'banned_from_server',
                                'server_id': server_id,
                                'reason': reason,
                                'banned_by': username
                            }))
                            
                            # Broadcast to all server members
                            await broadcast_to_server(server_id, json.dumps({
                                'type': 'member_banned',
                                'server_id': server_id,
                                'username': target_username,
                                'banned_by': username,
                                'reason': reason
                            }))
                            
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} banned {target_username} from server {server_id}")
                            db.add_audit_log_entry(server_id, 'member_ban', actor=username,
                                                   target=target_username, detail={'reason': reason})
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Failed to ban user'
                            }))
                    
                    elif data.get('type') == 'unban_member':
                        server_id = data.get('server_id', '')
                        target_username = data.get('username', '').strip()
                        
                        server = db.get_server(server_id)
                        if not server:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Server not found'
                            }))
                            continue
                        
                        # Check if requester has ban_members permission
                        if not has_permission(server_id, username, 'ban_members'):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'You do not have permission to unban members'
                            }))
                            continue
                        
                        # Execute the unban
                        if db.unban_user_from_server(server_id, target_username):
                            # Broadcast to all server members
                            await broadcast_to_server(server_id, json.dumps({
                                'type': 'member_unbanned',
                                'server_id': server_id,
                                'username': target_username,
                                'unbanned_by': username
                            }))
                            
                            # Notify the unbanned user
                            await send_to_user(target_username, json.dumps({
                                'type': 'unbanned_from_server',
                                'server_id': server_id,
                                'unbanned_by': username
                            }))
                            
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} unbanned {target_username} from server {server_id}")
                            db.add_audit_log_entry(server_id, 'member_unban', actor=username,
                                                   target=target_username)
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Failed to unban user or user is not banned'
                            }))
                    
                    elif data.get('type') == 'get_server_bans':
                        server_id = data.get('server_id', '')
                        
                        server = db.get_server(server_id)
                        if not server:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Server not found'
                            }))
                            continue
                        
                        # Check if requester has ban_members permission
                        if not has_permission(server_id, username, 'ban_members'):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'You do not have permission to view bans'
                            }))
                            continue
                        
                        bans = db.get_server_bans(server_id)
                        await websocket.send_str(json.dumps({
                            'type': 'server_bans',
                            'server_id': server_id,
                            'bans': [{
                                'username': ban['username'],
                                'banned_by': ban['banned_by'],
                                'reason': ban['reason'],
                                'banned_at': ban['banned_at'].isoformat() if ban['banned_at'] else None
                            } for ban in bans]
                        }))
                    
                    elif data.get('type') == 'kick_member':
                        server_id = data.get('server_id', '')
                        target_username = data.get('username', '').strip()
                        reason = data.get('reason', '').strip()

                        server = db.get_server(server_id)
                        if not server:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Server not found'
                            }))
                            continue

                        if not has_permission(server_id, username, 'ban_members'):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'You do not have permission to kick members'
                            }))
                            continue

                        if target_username == server['owner']:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Cannot kick the server owner'
                            }))
                            continue

                        if target_username == username:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Cannot kick yourself'
                            }))
                            continue

                        if not db.get_user(target_username):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'User not found'
                            }))
                            continue

                        members = db.get_server_members(server_id)
                        if target_username not in [m['username'] for m in members]:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'User is not a member of this server'
                            }))
                            continue

                        if db.remove_server_member(server_id, target_username):
                            await send_to_user(target_username, json.dumps({
                                'type': 'kicked_from_server',
                                'server_id': server_id,
                                'server_name': server['name'],
                                'reason': reason,
                                'kicked_by': username
                            }))
                            await broadcast_to_server(server_id, json.dumps({
                                'type': 'member_kicked',
                                'server_id': server_id,
                                'username': target_username,
                                'kicked_by': username,
                                'reason': reason
                            }))
                            db.add_audit_log_entry(server_id, 'member_kick', actor=username,
                                                   target=target_username, detail={'reason': reason})
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} kicked {target_username} from server {server_id}")
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Failed to kick user'
                            }))

                    elif data.get('type') == 'get_server_audit_log':
                        server_id = data.get('server_id', '')

                        server = db.get_server(server_id)
                        if not server:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Server not found'
                            }))
                            continue

                        if not has_permission(server_id, username, 'access_settings'):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'You do not have permission to view the audit log'
                            }))
                            continue

                        entries = db.get_server_audit_log(server_id, limit=200)
                        await websocket.send_str(json.dumps({
                            'type': 'server_audit_log',
                            'server_id': server_id,
                            'entries': entries
                        }))

                    # Channel creation handlers
                    elif data.get('type') == 'create_channel':
                        server_id = data.get('server_id', '')
                        channel_name = data.get('name', '').strip()
                        channel_type = data.get('channel_type', 'text')  # Default to text channel
                        
                        if db.get_server(server_id) and channel_name:
                            if has_permission(server_id, username, 'create_channel') or has_permission(server_id, username, 'manage_channels'):
                                # Get admin settings for channel limits
                                admin_settings = db.get_admin_settings()
                                max_channels = admin_settings.get('max_channels_per_server', 50)

                                # Apply license ceiling
                                license_max_channels = check_limit('max_channels_per_server')
                                if license_max_channels != -1:
                                    max_channels = min(max_channels, license_max_channels) if max_channels > 0 else license_max_channels

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
                                category_id = data.get('category_id')  # Optional category assignment
                                position = data.get('position', 0)
                                
                                db.create_channel(channel_id, server_id, channel_name, channel_type, category_id, position)
                                
                                # Notify all server members
                                channel_info = json.dumps({
                                    'type': 'channel_created',
                                    'server_id': server_id,
                                    'channel': {
                                        'id': channel_id,
                                        'name': channel_name,
                                        'type': channel_type,
                                        'category_id': category_id,
                                        'position': position
                                    }
                                })
                                await broadcast_to_server(server_id, channel_info)
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} created {channel_type} channel: {channel_name}")
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'You do not have permission to create channels'
                                }))
                    
                    # Category management handlers
                    elif data.get('type') == 'create_category':
                        server_id = data.get('server_id', '')
                        category_name = data.get('name', '').strip()
                        
                        if db.get_server(server_id) and category_name:
                            if has_permission(server_id, username, 'manage_categories'):
                                category_id = get_next_category_id()
                                # Get next position (append to end)
                                categories = db.get_server_categories(server_id)
                                position = len(categories)
                                
                                db.create_category(category_id, server_id, category_name, position)
                                
                                # Notify all server members
                                category_info = json.dumps({
                                    'type': 'category_created',
                                    'server_id': server_id,
                                    'category': {
                                        'id': category_id,
                                        'name': category_name,
                                        'position': position
                                    }
                                })
                                await broadcast_to_server(server_id, category_info)
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} created category: {category_name}")
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'You do not have permission to create categories'
                                }))
                    
                    elif data.get('type') == 'update_category':
                        category_id = data.get('category_id', '')
                        category_name = data.get('name', '').strip()
                        
                        if category_name:
                            # Get server_id for the category
                            categories = []
                            with db.get_connection() as conn:
                                cursor = conn.cursor()
                                cursor.execute('SELECT server_id FROM categories WHERE category_id = %s', (category_id,))
                                row = cursor.fetchone()
                                if row:
                                    server_id = row['server_id']
                                    if has_permission(server_id, username, 'manage_categories'):
                                        db.update_category(category_id, category_name)
                                        
                                        # Notify all server members
                                        await broadcast_to_server(server_id, json.dumps({
                                            'type': 'category_updated',
                                            'server_id': server_id,
                                            'category_id': category_id,
                                            'name': category_name
                                        }))
                                        print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} updated category: {category_name}")
                                    else:
                                        await websocket.send_str(json.dumps({
                                            'type': 'error',
                                            'message': 'You do not have permission to manage categories'
                                        }))
                    
                    elif data.get('type') == 'delete_category':
                        category_id = data.get('category_id', '')
                        
                        # Get server_id for the category
                        with db.get_connection() as conn:
                            cursor = conn.cursor()
                            cursor.execute('SELECT server_id FROM categories WHERE category_id = %s', (category_id,))
                            row = cursor.fetchone()
                            if row:
                                server_id = row['server_id']
                                if has_permission(server_id, username, 'manage_categories'):
                                    db.delete_category(category_id)
                                    
                                    # Notify all server members
                                    await broadcast_to_server(server_id, json.dumps({
                                        'type': 'category_deleted',
                                        'server_id': server_id,
                                        'category_id': category_id
                                    }))
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} deleted category: {category_id}")
                                else:
                                    await websocket.send_str(json.dumps({
                                        'type': 'error',
                                        'message': 'You do not have permission to manage categories'
                                    }))
                    
                    elif data.get('type') == 'update_category_positions':
                        server_id = data.get('server_id', '')
                        positions = data.get('positions', [])  # List of {category_id, position}
                        
                        if db.get_server(server_id) and has_permission(server_id, username, 'manage_categories'):
                            # Convert to list of tuples
                            position_tuples = [(p['category_id'], p['position']) for p in positions]
                            db.update_category_positions(position_tuples)
                            
                            # Notify all server members
                            await broadcast_to_server(server_id, json.dumps({
                                'type': 'category_positions_updated',
                                'server_id': server_id,
                                'positions': positions
                            }))
                    
                    elif data.get('type') == 'update_channel_positions':
                        server_id = data.get('server_id', '')
                        positions = data.get('positions', [])  # List of {channel_id, position, category_id}
                        
                        if db.get_server(server_id) and has_permission(server_id, username, 'manage_channels'):
                            # Update positions
                            position_tuples = [(p['channel_id'], p['position']) for p in positions]
                            db.update_channel_positions(position_tuples)
                            
                            # Update category assignments if needed
                            for p in positions:
                                if 'category_id' in p:
                                    db.update_channel_category(p['channel_id'], p.get('category_id'))
                            
                            # Notify all server members
                            await broadcast_to_server(server_id, json.dumps({
                                'type': 'channel_positions_updated',
                                'server_id': server_id,
                                'positions': positions
                            }))
                    
                    elif data.get('type') == 'update_channel_category':
                        channel_id = data.get('channel_id', '')
                        category_id = data.get('category_id')  # Can be None to remove from category
                        
                        # Get server_id and current channel info
                        with db.get_connection() as conn:
                            cursor = conn.cursor()
                            cursor.execute('SELECT server_id, name, type FROM channels WHERE channel_id = %s', (channel_id,))
                            row = cursor.fetchone()
                            if row:
                                server_id = row['server_id']
                                if has_permission(server_id, username, 'manage_channels'):
                                    db.update_channel_category(channel_id, category_id)
                                    
                                    # Notify all server members
                                    await broadcast_to_server(server_id, json.dumps({
                                        'type': 'channel_category_updated',
                                        'server_id': server_id,
                                        'channel_id': channel_id,
                                        'category_id': category_id
                                    }))
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} moved channel {channel_id} to category {category_id}")
                                else:
                                    await websocket.send_str(json.dumps({
                                        'type': 'error',
                                        'message': 'You do not have permission to manage channels'
                                    }))
                    
                    elif data.get('type') == 'delete_channel':
                        channel_id = data.get('channel_id', '')
                        
                        # Get server_id for the channel
                        with db.get_connection() as conn:
                            cursor = conn.cursor()
                            cursor.execute('SELECT server_id, name FROM channels WHERE channel_id = %s', (channel_id,))
                            row = cursor.fetchone()
                            if row:
                                server_id = row['server_id']
                                channel_name = row['name']
                                if has_permission(server_id, username, 'manage_channels') or has_permission(server_id, username, 'delete_channel'):
                                    db.delete_channel(channel_id)
                                    
                                    # Notify all server members
                                    await broadcast_to_server(server_id, json.dumps({
                                        'type': 'channel_deleted',
                                        'server_id': server_id,
                                        'channel_id': channel_id
                                    }))
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} deleted channel: {channel_name}")
                                else:
                                    await websocket.send_str(json.dumps({
                                        'type': 'error',
                                        'message': 'You do not have permission to delete channels'
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

                                # Apply license ceiling
                                license_max_channels = check_limit('max_channels_per_server')
                                if license_max_channels != -1:
                                    max_channels = min(max_channels, license_max_channels) if max_channels > 0 else license_max_channels

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
                        if not check_feature_access('voice_chat'):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Voice chat requires a paid license tier.'
                            }))
                            continue

                        server_id = data.get('server_id', '')
                        channel_id = data.get('channel_id', '')
                        
                        # Verify server and channel exist and user is member
                        server = db.get_server(server_id)
                        if server:
                            members = db.get_server_members(server_id)
                            member_usernames = {m['username'] for m in members}
                            if username in member_usernames:
                                # Clean up any existing voice state (e.g., direct call)
                                await cleanup_voice_state(username, 'joined voice channel')
                                
                                # Add to voice channel (runtime tracking)
                                voice_key = f"{server_id}/{channel_id}"
                                if voice_key not in voice_members:
                                    voice_members[voice_key] = set()
                                voice_members[voice_key].add(username)
                                
                                voice_states[username] = create_voice_state(server_id=server_id, channel_id=channel_id)
                                
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
                                        'screen_sharing': member_state.get('screen_sharing', False),
                                        'showing_screen': member_state.get('showing_screen', False)
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

                                # Send voice_channel_joined directly to the joining user.
                                # Includes a LiveKit token so the client can switch to SFU
                                # mode; token is None when LiveKit is not configured.
                                room_name = f"{server_id}__{channel_id}"
                                livekit_token = generate_livekit_token(
                                    room_name, username, username
                                )
                                await websocket.send_str(json.dumps({
                                    'type': 'voice_channel_joined',
                                    'server_id': server_id,
                                    'channel_id': channel_id,
                                    'participants': [m['username'] for m in voice_members_list],
                                    'livekit_token': livekit_token,
                                    'livekit_url': LIVEKIT_URL if livekit_token else None,
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
                                            'screen_sharing': member_state.get('screen_sharing', False),
                                            'showing_screen': member_state.get('showing_screen', False)
                                        })
                                    
                                    # Notify all server members
                                    await broadcast_to_server(server_id, json.dumps({
                                        'type': 'voice_state_update',
                                        'server_id': server_id,
                                        'channel_id': channel_id,
                                        'username': username,
                                        'state': 'left',
                                        'voice_members': voice_members_list
                                    }))
                            
                            del voice_states[username]
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} left voice channel")
                    
                    elif data.get('type') == 'voice_mute':
                        muted = data.get('muted', False)
                        if username in voice_states:
                            voice_states[username]['muted'] = muted
                            state = voice_states[username]
                            
                            # Notify others in the same voice channel OR direct call peer
                            if state.get('server_id') and state.get('channel_id'):
                                # In a server voice channel
                                await broadcast_to_server(state['server_id'], json.dumps({
                                    'type': 'voice_mute_update',
                                    'username': username,
                                    'muted': muted
                                }))
                            elif state.get('direct_call_peer'):
                                # In a direct call
                                await send_to_user(state['direct_call_peer'], json.dumps({
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
                    
                    elif data.get('type') == 'update_profile':
                        # Update user profile (bio and status message)
                        bio = data.get('bio', '').strip()
                        status_message = data.get('status_message', '').strip()
                        
                        # Validate lengths
                        if len(bio) > 500:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Bio is too long. Maximum 500 characters.'
                            }))
                            continue
                        
                        if len(status_message) > 100:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Status message is too long. Maximum 100 characters.'
                            }))
                            continue
                        
                        # Update profile in database
                        db.update_user_profile(username, bio=bio, status_message=status_message)
                        
                        # Get updated user data
                        user_data = db.get_user(username)
                        profile_update = {
                            'bio': user_data.get('bio', ''),
                            'status_message': user_data.get('status_message', '')
                        }
                        
                        # Notify all friends about profile change
                        for friend_username in db.get_friends(username):
                            await send_to_user(friend_username, json.dumps({
                                'type': 'profile_update',
                                'username': username,
                                **profile_update
                            }))
                        
                        # Notify all servers the user is in
                        for server_id in db.get_user_servers(username):
                            await broadcast_to_server(server_id, json.dumps({
                                'type': 'profile_update',
                                'username': username,
                                **profile_update
                            }))
                        
                        # Confirm to the user
                        await websocket.send_str(json.dumps({
                            'type': 'profile_updated',
                            **profile_update
                        }))
                    
                    elif data.get('type') == 'change_user_status':
                        # Update user status (online, away, busy, offline)
                        user_status = data.get('user_status', 'online')
                        
                        # Validate status value
                        if user_status not in ['online', 'away', 'busy', 'offline']:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid status value'
                            }))
                            continue
                        
                        # Update status in database
                        db.update_user_status(username, user_status)
                        
                        # Notify all friends about status change
                        for friend_username in db.get_friends(username):
                            await send_to_user(friend_username, json.dumps({
                                'type': 'user_status_changed',
                                'username': username,
                                'user_status': user_status
                            }))
                        
                        # Notify all servers the user is in
                        for server_id in db.get_user_servers(username):
                            await broadcast_to_server(server_id, json.dumps({
                                'type': 'user_status_changed',
                                'username': username,
                                'user_status': user_status
                            }))
                        
                        # Confirm to the user
                        await websocket.send_str(json.dumps({
                            'type': 'user_status_changed',
                            'username': username,
                            'user_status': user_status
                        }))
                        # Validate email format
                        if not new_email or not is_valid_email(new_email):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid email address format'
                            }))
                            continue

                        # Verify password
                        user = db.get_user(username)
                        if not user or not verify_password(password, user['password_hash']):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid password'
                            }))
                            continue

                        # Check same email
                        if user.get('email') == new_email:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'New email is the same as current email'
                            }))
                            continue

                        # Attempt update
                        if db.update_user_email(username, new_email):
                            # Optionally send verification email if SMTP configured
                            admin_settings = db.get_admin_settings()
                            if admin_settings.get('require_email_verification'):
                                try:
                                    email_sender = EmailSender(admin_settings)
                                    if email_sender.is_configured():
                                        verification_code = ''.join(secrets.choice(string.digits) for _ in range(6))
                                        expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
                                        db.create_email_verification_code(new_email, username, verification_code, expires_at)
                                        email_sender.send_verification_email(new_email, username, verification_code)
                                except Exception as e:
                                    print(f"Failed to send verification email: {e}")

                            await websocket.send_str(json.dumps({
                                'type': 'email_changed',
                                'email': new_email,
                                'email_verified': False
                            }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Email address already in use'
                            }))

                    elif data.get('type') == 'verify_email_change':
                        # Handle verification of changed email
                        code = data.get('code', '').strip()
                        
                        # Validate verification code format (must be exactly 6 digits)
                        if not code or not code.isdigit() or len(code) != 6:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid verification code format'
                            }))
                            continue
                        
                        # Get user's current email
                        user = db.get_user(username)
                        if not user:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'User not found'
                            }))
                            continue
                        
                        email = user.get('email')
                        if not email:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'No email associated with this account'
                            }))
                            continue
                        
                        # Verify the code
                        verification_data = db.get_email_verification_code(email, username)
                        if not verification_data or verification_data['code'] != code:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid or expired verification code'
                            }))
                            continue
                        
                        # Mark email as verified
                        if db.verify_user_email(username):
                            # Clean up ALL verification codes for this user
                            # This prevents reuse of old codes if deletion fails
                            if not db.delete_all_user_verification_codes(username):
                                print(f"Warning: Failed to delete verification codes after email verification")
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Email verified but failed to clean up verification codes'
                                }))
                                continue
                            
                            await websocket.send_str(json.dumps({
                                'type': 'email_verified',
                                'email': email,
                                'email_verified': True
                            }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Failed to verify email'
                            }))

                    elif data.get('type') == 'change_username':
                        new_username = data.get('new_username', '').strip()
                        password = data.get('password', '')

                        # Validate
                        if not new_username:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'New username is required'
                            }))
                            continue

                        if len(new_username) > 255:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Username is too long. Maximum 255 characters.'
                            }))
                            continue

                        if new_username == username:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'New username is the same as current username'
                            }))
                            continue

                        # Check availability
                        if db.get_user(new_username):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Username already taken'
                            }))
                            continue

                        # Verify password
                        user = db.get_user(username)
                        if not user or not verify_password(password, user['password_hash']):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid password'
                            }))
                            continue

                        old_username = username
                        if db.change_username(old_username, new_username):
                            # Update in-memory state
                            clients[websocket] = new_username

                            if old_username in voice_states:
                                voice_states[new_username] = voice_states.pop(old_username)

                            for call_id, call_data in voice_calls.items():
                                if old_username in call_data.get('participants', set()):
                                    call_data['participants'].discard(old_username)
                                    call_data['participants'].add(new_username)

                            # Update session username variable
                            username = new_username

                            # Generate new JWT token
                            new_token = generate_jwt_token(new_username)

                            # Confirm to user
                            await websocket.send_str(json.dumps({
                                'type': 'username_changed',
                                'old_username': old_username,
                                'new_username': new_username,
                                'token': new_token
                            }))

                            # Broadcast to friends
                            for friend_username in db.get_friends(new_username):
                                await send_to_user(friend_username, json.dumps({
                                    'type': 'user_renamed',
                                    'old_username': old_username,
                                    'new_username': new_username
                                }))

                            # Broadcast to all servers user is in
                            for server_id in db.get_user_servers(new_username):
                                await broadcast_to_server(server_id, json.dumps({
                                    'type': 'user_renamed',
                                    'old_username': old_username,
                                    'new_username': new_username
                                }), exclude=websocket)

                            print(f"[{datetime.now().strftime('%H:%M:%S')}] Username changed: {old_username} -> {new_username}")
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Failed to change username. It may already be taken.'
                            }))

                    elif data.get('type') == 'request_password_reset':
                        # Handle password reset request from logged-in user
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: Processing password reset for authenticated user: {username}")
                        try:
                            # For authenticated users, always rate limit by their actual account
                            rate_limit_key = username
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: password reset rate_limit_key={rate_limit_key}")
                            
                            # Check rate limiting to prevent abuse
                            if not check_password_reset_rate_limit(rate_limit_key):
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Too many password reset requests. Please try again later.'
                                }))
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] Rate limit exceeded for password reset: {rate_limit_key}")
                                continue
                            
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: Rate limit passed")
                            
                            # Get user data
                            user = db.get_user(username)
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: user={user}")
                            
                            if user and user.get('email'):
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: User has email, generating token")
                                # Generate reset token
                                reset_token = secrets.token_urlsafe(32)
                                expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
                                
                                # Save token to database
                                if db.create_password_reset_token(user['username'], reset_token, expires_at):
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: Token created, sending email")
                                    # Send password reset email
                                    email_sender = EmailSender(db.get_admin_settings())
                                    try:
                                        if email_sender.send_password_reset_email(
                                            user['email'], 
                                            user['username'], 
                                            reset_token
                                        ):
                                            print(f"[{datetime.now().strftime('%H:%M:%S')}] Password reset email sent to {user['username']} at {user['email']}")
                                        else:
                                            print(f"[{datetime.now().strftime('%H:%M:%S')}] Failed to send password reset email to {user['username']} at {user['email']}")
                                    except Exception as e:
                                        print(f"[{datetime.now().strftime('%H:%M:%S')}] Error sending password reset email to {user['username']}: {e}")
                                        traceback.print_exc()
                                else:
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Failed to create password reset token for {user['username']}")
                            else:
                                if user:
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] User {username} has no email address registered")
                                else:
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] User {username} not found")
                            
                            # Always return success to prevent information leakage
                            await websocket.send_str(json.dumps({
                                'type': 'password_reset_requested',
                                'message': 'If an email is registered for your account, a password reset link has been sent.'
                            }))
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: Response sent to client")
                        except Exception as e:
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] EXCEPTION in password reset handler: {e}")
                            traceback.print_exc()
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'An error occurred processing your request.'
                            }))
                    
                    elif data.get('type') == 'change_user_status':
                        # Update user status (online, away, busy, offline)
                        user_status = data.get('user_status', 'online')
                        
                        # Validate status value
                        if user_status not in ['online', 'away', 'busy', 'offline']:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid status value'
                            }))
                            continue
                        
                        # Update status in database
                        db.update_user_status(username, user_status)
                        
                        # Notify all friends about status change
                        for friend_username in db.get_friends(username):
                            await send_to_user(friend_username, json.dumps({
                                'type': 'user_status_changed',
                                'username': username,
                                'user_status': user_status
                            }))
                        
                        # Notify all servers the user is in
                        for server_id in db.get_user_servers(username):
                            await broadcast_to_server(server_id, json.dumps({
                                'type': 'user_status_changed',
                                'username': username,
                                'user_status': user_status
                            }))
                        
                        # Confirm to the user
                        await websocket.send_str(json.dumps({
                            'type': 'user_status_changed',
                            'username': username,
                            'user_status': user_status
                        }))
                    
                    elif data.get('type') == 'update_user_preferences':
                        # Update user preferences (theme_mode and/or keybinds)
                        theme_mode = data.get('theme_mode')
                        keybinds = data.get('keybinds')
                        
                        success = True
                        error_message = None
                        
                        # Update theme if provided
                        if theme_mode is not None:
                            valid_themes = ['dark', 'light', 'high_contrast']
                            if theme_mode not in valid_themes:
                                success = False
                                error_message = f'Invalid theme mode. Must be one of: {", ".join(valid_themes)}'
                            elif not db.update_user_theme(username, theme_mode):
                                success = False
                                error_message = 'Failed to update theme mode'
                        
                        # Update keybinds if provided
                        if keybinds is not None and success:
                            # Validate keybinds structure
                            required_keys = ['push_to_talk', 'toggle_mute', 'toggle_deafen', 
                                           'toggle_video', 'toggle_screen_share', 'answer_end_call']
                            if not isinstance(keybinds, dict):
                                success = False
                                error_message = 'Keybinds must be an object'
                            elif not all(k in keybinds for k in required_keys):
                                success = False
                                error_message = f'Missing required keybind keys: {", ".join(required_keys)}'
                            elif not db.update_user_keybinds(username, keybinds):
                                success = False
                                error_message = 'Failed to update keybinds'
                        
                        if success:
                            # Get updated preferences
                            prefs = db.get_user_preferences(username)
                            await websocket.send_str(json.dumps({
                                'type': 'user_preferences_updated',
                                'theme_mode': prefs.get('theme_mode', 'dark'),
                                'keybinds': prefs.get('keybinds', {})
                            }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': error_message or 'Failed to update preferences'
                            }))
                    
                    elif data.get('type') == 'change_email':
                        new_email = data.get('new_email', '').strip()
                        password = data.get('password', '').strip()
                        
                        # Validate email format
                        if not new_email or not is_valid_email(new_email):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid email address format'
                            }))
                            continue

                        # Verify password
                        user = db.get_user(username)
                        if not user or not verify_password(password, user['password_hash']):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid password'
                            }))
                            continue

                        # Check same email
                        if user.get('email') == new_email:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'New email is the same as current email'
                            }))
                            continue

                        # Attempt update
                        if db.update_user_email(username, new_email):
                            # Optionally send verification email if SMTP configured
                            admin_settings = db.get_admin_settings()
                            if admin_settings.get('require_email_verification'):
                                try:
                                    email_sender = EmailSender(admin_settings)
                                    if email_sender.is_configured():
                                        verification_code = ''.join(secrets.choice(string.digits) for _ in range(6))
                                        expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
                                        db.create_email_verification_code(new_email, username, verification_code, expires_at)
                                        email_sender.send_verification_email(new_email, username, verification_code)
                                except Exception as e:
                                    print(f"Failed to send verification email: {e}")

                            await websocket.send_str(json.dumps({
                                'type': 'email_changed',
                                'email': new_email,
                                'email_verified': False
                            }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Email address already in use'
                            }))

                    elif data.get('type') == 'verify_email_change':
                        # Handle verification of changed email
                        code = data.get('code', '').strip()
                        
                        # Validate verification code format (must be exactly 6 digits)
                        if not code or not code.isdigit() or len(code) != 6:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid verification code format'
                            }))
                            continue
                        
                        # Get user's current email
                        user = db.get_user(username)
                        if not user:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'User not found'
                            }))
                            continue
                        
                        email = user.get('email')
                        if not email:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'No email associated with this account'
                            }))
                            continue
                        
                        # Verify the code
                        verification_data = db.get_email_verification_code(email, username)
                        if not verification_data or verification_data['code'] != code:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid or expired verification code'
                            }))
                            continue
                        
                        # Mark email as verified
                        if db.verify_user_email(username):
                            # Clean up ALL verification codes for this user
                            # This prevents reuse of old codes if deletion fails
                            if not db.delete_all_user_verification_codes(username):
                                print(f"Warning: Failed to delete verification codes after email verification")
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Email verified but failed to clean up verification codes'
                                }))
                                continue
                            
                            await websocket.send_str(json.dumps({
                                'type': 'email_verified',
                                'email': email,
                                'email_verified': True
                            }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Failed to verify email'
                            }))

                    elif data.get('type') == 'change_username':
                        new_username = data.get('new_username', '').strip()
                        password = data.get('password', '')

                        # Validate
                        if not new_username:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'New username is required'
                            }))
                            continue

                        if len(new_username) > 255:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Username is too long. Maximum 255 characters.'
                            }))
                            continue

                        if new_username == username:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'New username is the same as current username'
                            }))
                            continue

                        # Check availability
                        if db.get_user(new_username):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Username already taken'
                            }))
                            continue

                        # Verify password
                        user = db.get_user(username)
                        if not user or not verify_password(password, user['password_hash']):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid password'
                            }))
                            continue

                        old_username = username
                        if db.change_username(old_username, new_username):
                            # Update in-memory state
                            clients[websocket] = new_username

                            if old_username in voice_states:
                                voice_states[new_username] = voice_states.pop(old_username)

                            for call_id, call_data in voice_calls.items():
                                if old_username in call_data.get('participants', set()):
                                    call_data['participants'].discard(old_username)
                                    call_data['participants'].add(new_username)

                            # Update session username variable
                            username = new_username

                            # Generate new JWT token
                            new_token = generate_jwt_token(new_username)

                            # Confirm to user
                            await websocket.send_str(json.dumps({
                                'type': 'username_changed',
                                'old_username': old_username,
                                'new_username': new_username,
                                'token': new_token
                            }))

                            # Broadcast to friends
                            for friend_username in db.get_friends(new_username):
                                await send_to_user(friend_username, json.dumps({
                                    'type': 'user_renamed',
                                    'old_username': old_username,
                                    'new_username': new_username
                                }))

                            # Broadcast to all servers user is in
                            for server_id in db.get_user_servers(new_username):
                                await broadcast_to_server(server_id, json.dumps({
                                    'type': 'user_renamed',
                                    'old_username': old_username,
                                    'new_username': new_username
                                }), exclude=websocket)

                            print(f"[{datetime.now().strftime('%H:%M:%S')}] Username changed: {old_username} -> {new_username}")
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Failed to change username. It may already be taken.'
                            }))

                    elif data.get('type') == 'request_password_reset':
                        # Handle password reset request from logged-in user
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: Processing password reset for authenticated user: {username}")
                        try:
                            # For authenticated users, always rate limit by their actual account
                            rate_limit_key = username
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: password reset rate_limit_key={rate_limit_key}")
                            
                            # Check rate limiting to prevent abuse
                            if not check_password_reset_rate_limit(rate_limit_key):
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Too many password reset requests. Please try again later.'
                                }))
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] Rate limit exceeded for password reset: {rate_limit_key}")
                                continue
                            
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: Rate limit passed")
                            
                            # Get user data
                            user = db.get_user(username)
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: user={user}")
                            
                            if user and user.get('email'):
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: User has email, generating token")
                                # Generate reset token
                                reset_token = secrets.token_urlsafe(32)
                                expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
                                
                                # Save token to database
                                if db.create_password_reset_token(user['username'], reset_token, expires_at):
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: Token created, sending email")
                                    # Send password reset email
                                    email_sender = EmailSender(db.get_admin_settings())
                                    try:
                                        if email_sender.send_password_reset_email(
                                            user['email'], 
                                            user['username'], 
                                            reset_token
                                        ):
                                            print(f"[{datetime.now().strftime('%H:%M:%S')}] Password reset email sent to {user['username']} at {user['email']}")
                                        else:
                                            print(f"[{datetime.now().strftime('%H:%M:%S')}] Failed to send password reset email to {user['username']} at {user['email']}")
                                    except Exception as e:
                                        print(f"[{datetime.now().strftime('%H:%M:%S')}] Error sending password reset email to {user['username']}: {e}")
                                        traceback.print_exc()
                                else:
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Failed to create password reset token for {user['username']}")
                            else:
                                if user:
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] User {username} has no email address registered")
                                else:
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] User {username} not found")
                            
                            # Always return success to prevent information leakage
                            await websocket.send_str(json.dumps({
                                'type': 'password_reset_requested',
                                'message': 'If an email is registered for your account, a password reset link has been sent.'
                            }))
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: Response sent to client")
                        except Exception as e:
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] EXCEPTION in password reset handler: {e}")
                            traceback.print_exc()
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'An error occurred processing your request.'
                            }))
                    
                    elif data.get('type') == 'change_user_status':
                        # Update user status (online, away, busy, offline)
                        user_status = data.get('user_status', 'online')
                        
                        # Validate status value
                        if user_status not in ['online', 'away', 'busy', 'offline']:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid status value'
                            }))
                            continue
                        
                        # Update status in database
                        db.update_user_status(username, user_status)
                        
                        # Notify all friends about status change
                        for friend_username in db.get_friends(username):
                            await send_to_user(friend_username, json.dumps({
                                'type': 'user_status_changed',
                                'username': username,
                                'user_status': user_status
                            }))
                        
                        # Notify all servers the user is in
                        for server_id in db.get_user_servers(username):
                            await broadcast_to_server(server_id, json.dumps({
                                'type': 'user_status_changed',
                                'username': username,
                                'user_status': user_status
                            }))
                        
                        # Confirm to the user
                        await websocket.send_str(json.dumps({
                            'type': 'user_status_changed',
                            'username': username,
                            'user_status': user_status
                        }))
                    
                    elif data.get('type') == 'update_user_preferences':
                        # Update user preferences (theme_mode and/or keybinds)
                        theme_mode = data.get('theme_mode')
                        keybinds = data.get('keybinds')
                        
                        success = True
                        error_message = None
                        
                        # Update theme if provided
                        if theme_mode is not None:
                            valid_themes = ['dark', 'light', 'high_contrast']
                            if theme_mode not in valid_themes:
                                success = False
                                error_message = f'Invalid theme mode. Must be one of: {", ".join(valid_themes)}'
                            elif not db.update_user_theme(username, theme_mode):
                                success = False
                                error_message = 'Failed to update theme mode'
                        
                        # Update keybinds if provided
                        if keybinds is not None and success:
                            # Validate keybinds structure
                            required_keys = ['push_to_talk', 'toggle_mute', 'toggle_deafen', 
                                           'toggle_video', 'toggle_screen_share', 'answer_end_call']
                            if not isinstance(keybinds, dict):
                                success = False
                                error_message = 'Keybinds must be an object'
                            elif not all(k in keybinds for k in required_keys):
                                success = False
                                error_message = f'Missing required keybind keys: {", ".join(required_keys)}'
                            elif not db.update_user_keybinds(username, keybinds):
                                success = False
                                error_message = 'Failed to update keybinds'
                        
                        if success:
                            # Get updated preferences
                            prefs = db.get_user_preferences(username)
                            await websocket.send_str(json.dumps({
                                'type': 'user_preferences_updated',
                                'theme_mode': prefs.get('theme_mode', 'dark'),
                                'keybinds': prefs.get('keybinds', {})
                            }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': error_message or 'Failed to update preferences'
                            }))
                    
                    elif data.get('type') == 'change_email':
                        new_email = data.get('new_email', '').strip()
                        password = data.get('password', '').strip()
                        
                        # Validate email format
                        if not new_email or not is_valid_email(new_email):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid email address format'
                            }))
                            continue

                        # Verify password
                        user = db.get_user(username)
                        if not user or not verify_password(password, user['password_hash']):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid password'
                            }))
                            continue

                        # Check same email
                        if user.get('email') == new_email:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'New email is the same as current email'
                            }))
                            continue

                        # Attempt update
                        if db.update_user_email(username, new_email):
                            # Optionally send verification email if SMTP configured
                            admin_settings = db.get_admin_settings()
                            if admin_settings.get('require_email_verification'):
                                try:
                                    email_sender = EmailSender(admin_settings)
                                    if email_sender.is_configured():
                                        verification_code = ''.join(secrets.choice(string.digits) for _ in range(6))
                                        expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
                                        db.create_email_verification_code(new_email, username, verification_code, expires_at)
                                        email_sender.send_verification_email(new_email, username, verification_code)
                                except Exception as e:
                                    print(f"Failed to send verification email: {e}")

                            await websocket.send_str(json.dumps({
                                'type': 'email_changed',
                                'email': new_email,
                                'email_verified': False
                            }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Email address already in use'
                            }))

                    elif data.get('type') == 'verify_email_change':
                        # Handle verification of changed email
                        code = data.get('code', '').strip()
                        
                        # Validate verification code format (must be exactly 6 digits)
                        if not code or not code.isdigit() or len(code) != 6:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid verification code format'
                            }))
                            continue
                        
                        # Get user's current email
                        user = db.get_user(username)
                        if not user:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'User not found'
                            }))
                            continue
                        
                        email = user.get('email')
                        if not email:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'No email associated with this account'
                            }))
                            continue
                        
                        # Verify the code
                        verification_data = db.get_email_verification_code(email, username)
                        if not verification_data or verification_data['code'] != code:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid or expired verification code'
                            }))
                            continue
                        
                        # Mark email as verified
                        if db.verify_user_email(username):
                            # Clean up ALL verification codes for this user
                            # This prevents reuse of old codes if deletion fails
                            if not db.delete_all_user_verification_codes(username):
                                print(f"Warning: Failed to delete verification codes after email verification")
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Email verified but failed to clean up verification codes'
                                }))
                                continue
                            
                            await websocket.send_str(json.dumps({
                                'type': 'email_verified',
                                'email': email,
                                'email_verified': True
                            }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Failed to verify email'
                            }))

                    elif data.get('type') == 'change_username':
                        new_username = data.get('new_username', '').strip()
                        password = data.get('password', '')

                        # Validate
                        if not new_username:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'New username is required'
                            }))
                            continue

                        if len(new_username) > 255:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Username is too long. Maximum 255 characters.'
                            }))
                            continue

                        if new_username == username:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'New username is the same as current username'
                            }))
                            continue

                        # Check availability
                        if db.get_user(new_username):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Username already taken'
                            }))
                            continue

                        # Verify password
                        user = db.get_user(username)
                        if not user or not verify_password(password, user['password_hash']):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid password'
                            }))
                            continue

                        old_username = username
                        if db.change_username(old_username, new_username):
                            # Update in-memory state
                            clients[websocket] = new_username

                            if old_username in voice_states:
                                voice_states[new_username] = voice_states.pop(old_username)

                            for call_id, call_data in voice_calls.items():
                                if old_username in call_data.get('participants', set()):
                                    call_data['participants'].discard(old_username)
                                    call_data['participants'].add(new_username)

                            # Update session username variable
                            username = new_username

                            # Generate new JWT token
                            new_token = generate_jwt_token(new_username)

                            # Confirm to user
                            await websocket.send_str(json.dumps({
                                'type': 'username_changed',
                                'old_username': old_username,
                                'new_username': new_username,
                                'token': new_token
                            }))

                            # Broadcast to friends
                            for friend_username in db.get_friends(new_username):
                                await send_to_user(friend_username, json.dumps({
                                    'type': 'user_renamed',
                                    'old_username': old_username,
                                    'new_username': new_username
                                }))

                            # Broadcast to all servers user is in
                            for server_id in db.get_user_servers(new_username):
                                await broadcast_to_server(server_id, json.dumps({
                                    'type': 'user_renamed',
                                    'old_username': old_username,
                                    'new_username': new_username
                                }), exclude=websocket)

                            print(f"[{datetime.now().strftime('%H:%M:%S')}] Username changed: {old_username} -> {new_username}")
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Failed to change username. It may already be taken.'
                            }))

                    elif data.get('type') == 'request_password_reset':
                        # Handle password reset request from logged-in user
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: Processing password reset for authenticated user: {username}")
                        try:
                            # For authenticated users, always rate limit by their actual account
                            rate_limit_key = username
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: password reset rate_limit_key={rate_limit_key}")
                            
                            # Check rate limiting to prevent abuse
                            if not check_password_reset_rate_limit(rate_limit_key):
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Too many password reset requests. Please try again later.'
                                }))
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] Rate limit exceeded for password reset: {rate_limit_key}")
                                continue
                            
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: Rate limit passed")
                            
                            # Get user data
                            user = db.get_user(username)
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: user={user}")
                            
                            if user and user.get('email'):
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: User has email, generating token")
                                # Generate reset token
                                reset_token = secrets.token_urlsafe(32)
                                expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
                                
                                # Save token to database
                                if db.create_password_reset_token(user['username'], reset_token, expires_at):
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: Token created, sending email")
                                    # Send password reset email
                                    email_sender = EmailSender(db.get_admin_settings())
                                    try:
                                        if email_sender.send_password_reset_email(
                                            user['email'], 
                                            user['username'], 
                                            reset_token
                                        ):
                                            print(f"[{datetime.now().strftime('%H:%M:%S')}] Password reset email sent to {user['username']} at {user['email']}")
                                        else:
                                            print(f"[{datetime.now().strftime('%H:%M:%S')}] Failed to send password reset email to {user['username']} at {user['email']}")
                                    except Exception as e:
                                        print(f"[{datetime.now().strftime('%H:%M:%S')}] Error sending password reset email to {user['username']}: {e}")
                                        traceback.print_exc()
                                else:
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Failed to create password reset token for {user['username']}")
                            else:
                                if user:
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] User {username} has no email address registered")
                                else:
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] User {username} not found")
                            
                            # Always return success to prevent information leakage
                            await websocket.send_str(json.dumps({
                                'type': 'password_reset_requested',
                                'message': 'If an email is registered for your account, a password reset link has been sent.'
                            }))
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: Response sent to client")
                        except Exception as e:
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] EXCEPTION in password reset handler: {e}")
                            traceback.print_exc()
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'An error occurred processing your request.'
                            }))
                    
                    elif data.get('type') == 'request_password_reset':
                        # Handle password reset request from logged-in user
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: Processing password reset for authenticated user: {username}")
                        try:
                            identifier = data.get('identifier', '').strip() or username
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: identifier={identifier}")
                            
                            # Check rate limiting to prevent abuse
                            if not check_password_reset_rate_limit(identifier):
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Too many password reset requests. Please try again later.'
                                }))
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] Rate limit exceeded for password reset: {identifier}")
                                continue
                            
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: Rate limit passed")
                            
                            # Get user data
                            user = db.get_user(username)
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: user={user}")
                            
                            if user and user.get('email'):
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: User has email, generating token")
                                # Generate reset token
                                reset_token = secrets.token_urlsafe(32)
                                expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
                                
                                # Save token to database
                                if db.create_password_reset_token(user['username'], reset_token, expires_at):
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: Token created, sending email")
                                    # Send password reset email
                                    email_sender = EmailSender(db.get_admin_settings())
                                    try:
                                        if email_sender.send_password_reset_email(
                                            user['email'], 
                                            user['username'], 
                                            reset_token
                                        ):
                                            print(f"[{datetime.now().strftime('%H:%M:%S')}] Password reset email sent to {user['username']} at {user['email']}")
                                        else:
                                            print(f"[{datetime.now().strftime('%H:%M:%S')}] Failed to send password reset email to {user['username']} at {user['email']}")
                                    except Exception as e:
                                        print(f"[{datetime.now().strftime('%H:%M:%S')}] Error sending password reset email to {user['username']}: {e}")
                                        traceback.print_exc()
                                else:
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Failed to create password reset token for {user['username']}")
                            else:
                                if user:
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] User {username} has no email address registered")
                                else:
                                    print(f"[{datetime.now().strftime('%H:%M:%S')}] User {username} not found")
                            
                            # Always return success to prevent information leakage
                            await websocket.send_str(json.dumps({
                                'type': 'password_reset_requested',
                                'message': 'If an email is registered for your account, a password reset link has been sent.'
                            }))
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] DEBUG: Response sent to client")
                        except Exception as e:
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] EXCEPTION in password reset handler: {e}")
                            traceback.print_exc()
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'An error occurred processing your request.'
                            }))
                    
                    elif data.get('type') == 'set_server_icon':
                        # Update server icon (emoji or image upload)
                        server_id = data.get('server_id', '')
                        icon_type = data.get('icon_type', 'emoji')
                        
                        # Validate icon_type
                        if icon_type not in ['emoji', 'image']:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid icon type. Must be "emoji" or "image".'
                            }))
                            continue
                        
                        # Verify user has permission to change server icon
                        server = db.get_server(server_id)
                        if not server:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Server not found'
                            }))
                            continue
                        
                        if not has_permission(server_id, username, 'manage_server'):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'You do not have permission to change the server icon'
                            }))
                            continue
                        
                        # Get admin settings for file size limits
                        admin_settings = db.get_admin_settings()
                        max_file_size_mb = admin_settings.get('max_file_size_mb', 10)
                        max_file_size = max_file_size_mb * 1024 * 1024
                        
                        if icon_type == 'emoji':
                            icon = data.get('icon', '🏠').strip()
                            if not db.update_server_icon(server_id, icon, 'emoji', None):
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Failed to update server icon'
                                }))
                                continue
                        elif icon_type == 'image':
                            # Handle image upload via base64
                            icon_data = data.get('icon_data', '')
                            
                            # Validate icon_data is not empty
                            if not icon_data:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Icon image data is required'
                                }))
                                continue
                            
                            # Validate size (base64 is ~33% larger than original)
                            if len(icon_data) > max_file_size * 1.5:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': f'Icon image too large. Maximum size is {max_file_size_mb}MB.'
                                }))
                                continue
                            
                            if not db.update_server_icon(server_id, None, 'image', icon_data):
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Failed to update server icon'
                                }))
                                continue
                        
                        # Get updated server data
                        updated_server = db.get_server(server_id)
                        icon_update = {
                            'icon': updated_server.get('icon', '🏠'),
                            'icon_type': updated_server.get('icon_type', 'emoji'),
                            'icon_data': updated_server.get('icon_data')
                        }
                        
                        # Notify all server members about icon change
                        await broadcast_to_server(server_id, json.dumps({
                            'type': 'server_icon_update',
                            'server_id': server_id,
                            **icon_update
                        }))
                        
                        print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} updated icon for server {server_id}")
                    
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
                            
                            # Notify others in the same voice channel OR direct call peer
                            if state.get('server_id') and state.get('channel_id'):
                                # In a server voice channel
                                await broadcast_to_server(state['server_id'], json.dumps({
                                    'type': 'voice_video_update',
                                    'username': username,
                                    'video': video
                                }))
                            elif state.get('direct_call_peer'):
                                # In a direct call
                                await send_to_user(state['direct_call_peer'], json.dumps({
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
                            
                            # Notify others in the same voice channel OR direct call peer
                            if state.get('server_id') and state.get('channel_id'):
                                # In a server voice channel
                                await broadcast_to_server(state['server_id'], json.dumps({
                                    'type': 'voice_screen_share_update',
                                    'username': username,
                                    'screen_sharing': screen_sharing
                                }))
                            elif state.get('direct_call_peer'):
                                # In a direct call
                                await send_to_user(state['direct_call_peer'], json.dumps({
                                    'type': 'voice_screen_share_update',
                                    'username': username,
                                    'screen_sharing': screen_sharing
                                }))
                    
                    elif data.get('type') == 'switch_video_source':
                        # Forward request to switch video source to the target user,
                        # but only if both users are in the same voice channel OR direct call
                        target_user = data.get('target')
                        show_screen = data.get('show_screen', True)
                        
                        if target_user:
                            requester_state = voice_states.get(username)
                            target_state = voice_states.get(target_user)

                            # Check if in same server voice channel
                            in_same_channel = (
                                requester_state
                                and target_state
                                and requester_state.get('server_id') == target_state.get('server_id')
                                and requester_state.get('channel_id') == target_state.get('channel_id')
                            )
                            
                            # Check if in direct call with each other
                            in_direct_call = (
                                requester_state
                                and target_state
                                and requester_state.get('direct_call_peer') == target_user
                                and target_state.get('direct_call_peer') == username
                            )
                            
                            # Allow if in same channel or direct call
                            if in_same_channel or in_direct_call:
                                await send_to_user(target_user, json.dumps({
                                    'type': 'switch_video_source_request',
                                    'from': username,
                                    'show_screen': show_screen
                                }))
                            else:
                                # Reject unauthorized switch requests
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Cannot request video source switch: target user is not in the same voice channel or direct call'
                                }))
                    
                    elif data.get('type') == 'video_source_changed':
                        # Broadcast to others in voice channel OR direct call that video source has changed
                        if username in voice_states:
                            showing_screen = data.get('showing_screen', False)
                            voice_states[username]['showing_screen'] = showing_screen
                            state = voice_states[username]
                            
                            # Notify others in the same voice channel OR direct call peer
                            if state.get('server_id') and state.get('channel_id'):
                                # In a server voice channel
                                await broadcast_to_server(state['server_id'], json.dumps({
                                    'type': 'video_source_changed_update',
                                    'username': username,
                                    'showing_screen': showing_screen
                                }))
                            elif state.get('direct_call_peer'):
                                # In a direct call
                                await send_to_user(state['direct_call_peer'], json.dumps({
                                    'type': 'video_source_changed_update',
                                    'username': username,
                                    'showing_screen': showing_screen
                                }))
                    
                    # WebRTC signaling
                    elif data.get('type') == 'webrtc_offer':
                        target_user = data.get('target') or data.get('target_username')
                        offer = data.get('offer')
                        context = data.get('context', {})
                        
                        if target_user:
                            await send_to_user(target_user, json.dumps({
                                'type': 'webrtc_offer',
                                'from': username,
                                'from_username': username,
                                'offer': offer,
                                'context': context
                            }))
                    
                    elif data.get('type') == 'webrtc_answer':
                        target_user = data.get('target') or data.get('target_username')
                        answer = data.get('answer')
                        
                        if target_user:
                            await send_to_user(target_user, json.dumps({
                                'type': 'webrtc_answer',
                                'from': username,
                                'from_username': username,
                                'answer': answer
                            }))
                    
                    elif data.get('type') == 'webrtc_ice_candidate':
                        target_user = data.get('target') or data.get('target_username')
                        candidate = data.get('candidate')
                        
                        if target_user:
                            await send_to_user(target_user, json.dumps({
                                'type': 'webrtc_ice_candidate',
                                'from': username,
                                'from_username': username,
                                'candidate': candidate
                            }))
                    
                    # Custom emoji handlers
                    elif data.get('type') == 'upload_custom_emoji':
                        if not check_feature_access('custom_emojis'):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Custom emojis require a paid license tier.'
                            }))
                            continue

                        server_id = data.get('server_id', '')
                        emoji_name = data.get('name', '').strip()
                        image_data = data.get('image_data', '')
                        
                        if server_id and emoji_name and image_data:
                            # Validate emoji name pattern (alphanumeric and underscores only)
                            import re
                            if not re.match(r'^[a-zA-Z0-9_]+$', emoji_name):
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Invalid emoji name format'
                                }))
                                continue
                            
                            # Validate name length
                            if len(emoji_name) > 50:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Emoji name too long'
                                }))
                                continue
                            
                            # Validate image data format and MIME type
                            if not image_data.startswith('data:image/'):
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Invalid image format'
                                }))
                                continue
                            
                            # Check for allowed image types
                            allowed_types = ['data:image/png', 'data:image/jpeg', 'data:image/gif', 'data:image/webp']
                            if not any(image_data.startswith(t) for t in allowed_types):
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Unsupported image type'
                                }))
                                continue
                            
                            # Validate file size (256KB = 262144 bytes)
                            if ',' in image_data:
                                base64_data = image_data.split(',', 1)[1]
                                # Base64 encoding increases size by ~33%, so decode length gives approximate original size
                                estimated_size = len(base64_data) * 3 / 4
                                if estimated_size > 262144:  # 256KB
                                    await websocket.send_str(json.dumps({
                                        'type': 'error',
                                        'message': 'Image size exceeds limit'
                                    }))
                                    continue
                            
                            # Verify user is a member of the server
                            server = db.get_server(server_id)
                            if server:
                                members = db.get_server_members(server_id)
                                member_usernames = {m['username'] for m in members}
                                
                                if username in member_usernames:
                                    # Generate emoji ID
                                    emoji_id = f"emoji_{server_id}_{secrets.token_hex(8)}"
                                    
                                    # Create the custom emoji
                                    if db.create_custom_emoji(emoji_id, server_id, emoji_name, image_data, username):
                                        # Get the emoji data
                                        emoji = db.get_custom_emoji(emoji_id)
                                        
                                        # Broadcast to all server members
                                        await broadcast_to_server(server_id, json.dumps({
                                            'type': 'custom_emoji_added',
                                            'server_id': server_id,
                                            'emoji': emoji
                                        }))
                                        
                                        # Confirm to uploader
                                        await websocket.send_str(json.dumps({
                                            'type': 'emoji_upload_success',
                                            'emoji': emoji
                                        }))
                                        print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} uploaded emoji '{emoji_name}' to server {server_id}")
                                    else:
                                        await websocket.send_str(json.dumps({
                                            'type': 'error',
                                            'message': 'Failed to create emoji'
                                        }))
                                else:
                                    await websocket.send_str(json.dumps({
                                        'type': 'error',
                                        'message': 'Not authorized'
                                    }))
                    
                    elif data.get('type') == 'get_server_emojis':
                        server_id = data.get('server_id', '')
                        
                        if server_id:
                            server = db.get_server(server_id)
                            if server:
                                members = db.get_server_members(server_id)
                                member_usernames = {m['username'] for m in members}
                                
                                if username in member_usernames:
                                    emojis = db.get_server_emojis(server_id)
                                    await websocket.send_str(json.dumps({
                                        'type': 'server_emojis',
                                        'server_id': server_id,
                                        'emojis': emojis
                                    }))
                    
                    elif data.get('type') == 'delete_custom_emoji':
                        emoji_id = data.get('emoji_id', '')
                        
                        if emoji_id:
                            emoji = db.get_custom_emoji(emoji_id)
                            if emoji:
                                server = db.get_server(emoji['server_id'])
                                # Only server owner or emoji uploader can delete
                                if server and (username == server['owner'] or username == emoji['uploader']):
                                    if db.delete_custom_emoji(emoji_id):
                                        # Broadcast to all server members
                                        await broadcast_to_server(emoji['server_id'], json.dumps({
                                            'type': 'custom_emoji_deleted',
                                            'server_id': emoji['server_id'],
                                            'emoji_id': emoji_id
                                        }))
                                        
                                        await websocket.send_str(json.dumps({
                                            'type': 'emoji_delete_success',
                                            'emoji_id': emoji_id
                                        }))
                                        print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} deleted emoji {emoji_id}")
                                else:
                                    await websocket.send_str(json.dumps({
                                        'type': 'error',
                                        'message': 'You do not have permission to delete this emoji'
                                    }))
                    
                    # Soundboard handlers
                    elif data.get('type') == 'play_soundboard':
                        sound_id = data.get('sound_id', '')
                        
                        if not sound_id:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'sound_id is required'
                            }))
                            continue
                        
                        # Check if user is in a voice channel
                        if username not in voice_states:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'You must be in a voice channel to play sounds'
                            }))
                            continue
                        
                        voice_state = voice_states[username]
                        server_id = voice_state.get('server_id')
                        channel_id = voice_state.get('channel_id')
                        
                        if not server_id or not channel_id:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Invalid voice state'
                            }))
                            continue
                        
                        # Check soundboard is enabled
                        admin_settings = db.get_admin_settings()
                        if not admin_settings.get('allow_soundboard', False):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Soundboard is disabled'
                            }))
                            continue
                        
                        # Verify sound exists
                        sound = db.get_soundboard_sound(sound_id)
                        if not sound:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Sound not found'
                            }))
                            continue
                        
                        # Check cooldown (2 seconds between plays per user)
                        current_time = time.time()
                        if username in soundboard_cooldowns:
                            last_play = soundboard_cooldowns[username]
                            if current_time - last_play < 2:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Please wait before playing another sound'
                                }))
                                continue
                        
                        # Update cooldown
                        soundboard_cooldowns[username] = current_time
                        
                        # Get all members in the voice channel
                        voice_key = f"{server_id}/{channel_id}"
                        if voice_key in voice_members:
                            # Broadcast soundboard play to all voice channel participants
                            soundboard_msg = json.dumps({
                                'type': 'soundboard_play',
                                'sound_id': sound_id,
                                'sound_name': sound.get('name', ''),
                                'username': username,
                                'server_id': server_id,
                                'channel_id': channel_id,
                                'duration_ms': sound.get('duration_ms', 0)
                            })
                            
                            for participant_username in voice_members[voice_key]:
                                if participant_username in clients_by_username:
                                    for client_ws in clients_by_username[participant_username]:
                                        try:
                                            await client_ws.send_str(soundboard_msg)
                                        except Exception:
                                            pass
                            
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} played soundboard sound '{sound.get('name')}' in {channel_id}")
                    
                    # Message reaction handlers
                    elif data.get('type') == 'add_reaction':
                        message_id = data.get('message_id')
                        emoji = data.get('emoji', '')
                        emoji_type = data.get('emoji_type', 'standard')  # 'standard' or 'custom'
                        
                        if message_id and emoji:
                            # Get message to verify authorization and determine context
                            message = db.get_message(message_id)
                            if not message:
                                # Message doesn't exist, silently continue
                                continue
                            
                            # Verify user has access to the message
                            has_access = False
                            if message['context_type'] == 'server' and message['context_id']:
                                server_id = message['context_id'].split('/')[0]
                                members = db.get_server_members(server_id)
                                member_usernames = {m['username'] for m in members}
                                has_access = username in member_usernames
                            elif message['context_type'] == 'dm' and message['context_id']:
                                dm_users = db.get_user_dms(username)
                                has_access = any(dm['dm_id'] == message['context_id'] for dm in dm_users)
                            
                            if not has_access:
                                # User doesn't have access, silently continue
                                continue
                            
                            # Add the reaction
                            reaction_added = db.add_reaction(message_id, username, emoji, emoji_type)
                            
                            # Get all reactions for this message (for both new and duplicate cases)
                            reactions = db.get_message_reactions(message_id)
                            
                            reaction_update = {
                                'type': 'reaction_added',
                                'message_id': message_id,
                                'reactions': reactions
                            }
                            
                            # Broadcast to appropriate context (even for duplicates to keep clients in sync)
                            if message['context_type'] == 'server' and message['context_id']:
                                server_id = message['context_id'].split('/')[0]
                                await broadcast_to_server(server_id, json.dumps(reaction_update))
                            elif message['context_type'] == 'dm' and message['context_id']:
                                # Get DM participants
                                dm_users = db.get_user_dms(username)
                                for dm in dm_users:
                                    if dm['dm_id'] == message['context_id']:
                                        participants = [dm['user1'], dm['user2']]
                                        for participant in participants:
                                            await send_to_user(participant, json.dumps(reaction_update))
                                        break
                            
                            if reaction_added:
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} added reaction {emoji} to message {message_id}")
                    
                    elif data.get('type') == 'remove_reaction':
                        message_id = data.get('message_id')
                        emoji = data.get('emoji', '')
                        
                        if message_id and emoji:
                            # Get the message first to verify existence and access
                            message = db.get_message(message_id)
                            if not message:
                                # Message does not exist; do not reveal this to the client
                                continue

                            # For DMs, ensure the user is a participant in the DM thread
                            dm_users = None
                            if message.get('context_type') == 'dm' and message.get('context_id'):
                                dm_users = db.get_user_dms(username)
                                if not any(dm.get('dm_id') == message['context_id'] for dm in dm_users):
                                    # User is not part of this DM; do not allow reaction removal
                                    continue
                            
                            # Remove the reaction only after authorization checks
                            if db.remove_reaction(message_id, username, emoji):
                                # Get all reactions for this message
                                reactions = db.get_message_reactions(message_id)
                                
                                reaction_update = {
                                    'type': 'reaction_removed',
                                    'message_id': message_id,
                                    'reactions': reactions
                                }
                                
                                # Broadcast to appropriate context
                                if message.get('context_type') == 'server' and message.get('context_id'):
                                    server_id = message['context_id'].split('/')[0]
                                    await broadcast_to_server(server_id, json.dumps(reaction_update))
                                elif message.get('context_type') == 'dm' and message.get('context_id'):
                                    # Get DM participants (reuse if already fetched)
                                    if dm_users is None:
                                        dm_users = db.get_user_dms(username)
                                    for dm in dm_users:
                                        if dm.get('dm_id') == message['context_id']:
                                            participants = [dm.get('user1'), dm.get('user2')]
                                            for participant in participants:
                                                if participant:
                                                    await send_to_user(participant, json.dumps(reaction_update))
                                            break
                                
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} removed reaction {emoji} from message {message_id}")
                    
                    # Server purge settings handlers
                    elif data.get('type') == 'get_server_purge_settings':
                        server_id = data.get('server_id', '')
                        
                        if server_id:
                            server = db.get_server(server_id)
                            if server and username == server['owner']:
                                settings = db.get_server_settings(server_id)
                                exemptions = db.get_channel_exemptions(server_id)
                                
                                await websocket.send_str(json.dumps({
                                    'type': 'server_purge_settings',
                                    'server_id': server_id,
                                    'purge_schedule': settings['purge_schedule'] if settings else 0,
                                    'exempted_channels': exemptions
                                }))
                    
                    elif data.get('type') == 'update_server_purge_settings':
                        server_id = data.get('server_id', '')
                        purge_schedule = data.get('purge_schedule', 0)
                        exempted_channels = data.get('exempted_channels', [])
                        
                        if server_id:
                            server = db.get_server(server_id)
                            if server and username == server['owner']:
                                # Validate purge_schedule type and value
                                try:
                                    purge_schedule = int(purge_schedule)
                                except (TypeError, ValueError):
                                    await websocket.send_str(json.dumps({
                                        'type': 'error',
                                        'message': 'Invalid purge schedule type'
                                    }))
                                    continue
                                
                                valid_schedules = [0, 7, 30, 90, 180, 365]
                                if purge_schedule not in valid_schedules:
                                    await websocket.send_str(json.dumps({
                                        'type': 'error',
                                        'message': 'Invalid purge schedule value'
                                    }))
                                    continue
                                
                                # Get all channels for this server
                                channels = db.get_server_channels(server_id)
                                valid_channel_ids = {channel['channel_id'] for channel in channels}
                                
                                # Validate exempted_channels - only allow channels that belong to this server
                                validated_exemptions = [ch_id for ch_id in exempted_channels if ch_id in valid_channel_ids]
                                
                                # Update purge schedule
                                db.update_server_settings(server_id, purge_schedule)
                                
                                # Update exemptions for each channel
                                for channel in channels:
                                    channel_id = channel['channel_id']
                                    is_exempted = channel_id in validated_exemptions
                                    db.set_channel_exemption(server_id, channel_id, is_exempted)
                                
                                await websocket.send_str(json.dumps({
                                    'type': 'server_purge_settings_updated',
                                    'server_id': server_id,
                                    'purge_schedule': purge_schedule
                                }))
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} updated purge settings for server {server_id}")
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Only the server owner can update purge settings'
                                }))
                    
                    elif data.get('type') == 'get_server_automation_settings':
                        server_id = data.get('server_id', '')
                        if server_id:
                            server = db.get_server(server_id)
                            if server and has_permission(server_id, username, 'manage_server'):
                                settings = db.get_server_settings(server_id)
                                roles = db.get_server_roles(server_id)
                                await websocket.send_str(json.dumps({
                                    'type': 'server_automation_settings',
                                    'server_id': server_id,
                                    'auto_role_id': settings.get('auto_role_id') if settings else None,
                                    'rules_enabled': settings.get('rules_enabled', False) if settings else False,
                                    'rules_text': settings.get('rules_text', '') if settings else '',
                                    'roles': [{'role_id': r['role_id'], 'name': r['name'], 'color': r['color']} for r in roles]
                                }))
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Permission denied'
                                }))

                    elif data.get('type') == 'update_server_automation_settings':
                        server_id = data.get('server_id', '')
                        auto_role_id = data.get('auto_role_id') or None
                        rules_enabled = bool(data.get('rules_enabled', False))
                        rules_text = str(data.get('rules_text', '')).strip()
                        
                        if server_id:
                            server = db.get_server(server_id)
                            if server and has_permission(server_id, username, 'manage_server'):
                                # Validate auto_role_id if provided
                                if auto_role_id:
                                    role = db.get_role(auto_role_id)
                                    if not role or role.get('server_id') != server_id:
                                        await websocket.send_str(json.dumps({
                                            'type': 'error',
                                            'message': 'Invalid role selected'
                                        }))
                                        continue
                                
                                db.update_server_automation_settings(server_id, auto_role_id, rules_enabled, rules_text)
                                await websocket.send_str(json.dumps({
                                    'type': 'server_automation_settings_updated',
                                    'server_id': server_id,
                                    'auto_role_id': auto_role_id,
                                    'rules_enabled': rules_enabled,
                                    'rules_text': rules_text
                                }))
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} updated automation settings for server {server_id}")
                                
                                db.add_audit_log_entry(server_id, 'automation_settings_update', actor=username,
                                                       detail={'auto_role_id': auto_role_id, 'rules_enabled': rules_enabled})
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Only users with manage_server permission can update automation settings'
                                }))

                    elif data.get('type') == 'accept_server_rules':
                        server_id = data.get('server_id', '')
                        if server_id and db.is_server_member(server_id, username):
                            success = db.accept_server_rules(server_id, username)
                            if success:
                                await websocket.send_str(json.dumps({
                                    'type': 'rules_accepted',
                                    'server_id': server_id
                                }))
                                # Broadcast member_joined now that they've fully joined
                                await broadcast_to_server(server_id, json.dumps({
                                    'type': 'member_rules_accepted',
                                    'server_id': server_id,
                                    'username': username
                                }), exclude=websocket)
                                print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} accepted rules for server {server_id}")
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Failed to accept server rules'
                                }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'You are not a member of this server'
                            }))

                    elif data.get('type') == 'start_voice_call':
                        if not check_feature_access('voice_chat'):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Voice chat requires a paid license tier.'
                            }))
                            continue

                        # Direct voice call with a friend
                        friend_username = data.get('username', '').strip()
                        
                        # Verify mutual friendship
                        friends = set(db.get_friends(username))
                        if db.get_user(friend_username) and friend_username in friends:
                            # Clean up any existing voice state
                            await cleanup_voice_state(username, 'started new call')
                            
                            # Track direct call in voice_states for video/screen sharing
                            voice_states[username] = create_voice_state(direct_call_peer=friend_username)
                            
                            # Notify the friend about incoming call
                            await send_to_user(friend_username, json.dumps({
                                'type': 'incoming_voice_call',
                                'from': username
                            }))
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} calling {friend_username}")
                    
                    elif data.get('type') == 'accept_voice_call':
                        caller_username = data.get('from', '').strip()
                        
                        # Verify caller exists and is a friend
                        friends = set(db.get_friends(username))
                        if db.get_user(caller_username) and caller_username in friends:
                            # Clean up any existing voice state for callee
                            await cleanup_voice_state(username, 'accepted another call')
                            
                            # Clean up any existing voice state for caller (if any),
                            # but avoid cleaning up the pending call from caller -> this user,
                            # as that would send a call_ended event for the call being accepted.
                            caller_voice_state = voice_states.get(caller_username)
                            caller_direct_peer = None
                            if isinstance(caller_voice_state, dict):
                                caller_direct_peer = caller_voice_state.get('direct_call_peer')
                            
                            if caller_voice_state is not None and caller_direct_peer != username:
                                await cleanup_voice_state(caller_username, 'call accepted')
                            
                            # Track direct call in voice_states for BOTH participants
                            voice_states[username] = create_voice_state(direct_call_peer=caller_username)
                            voice_states[caller_username] = create_voice_state(direct_call_peer=username)
                            
                            await send_to_user(caller_username, json.dumps({
                                'type': 'voice_call_accepted',
                                'from': username
                            }))
                    
                    elif data.get('type') == 'reject_voice_call':
                        caller_username = data.get('from', '').strip()
                        
                        # Verify caller exists and is a friend
                        friends = set(db.get_friends(username))
                        if db.get_user(caller_username) and caller_username in friends:
                            # Clean up caller's voice state (orphaned from unanswered call)
                            if caller_username in voice_states:
                                caller_state = voice_states[caller_username]
                                # Only clean up if they're in a pending call to this user
                                if caller_state.get('direct_call_peer') == username:
                                    del voice_states[caller_username]
                            
                            await send_to_user(caller_username, json.dumps({
                                'type': 'voice_call_rejected',
                                'from': username
                            }))

                    # Automation handlers
                    elif data.get('type') == 'create_scheduled_message':
                        server_id = data.get('server_id', '')
                        channel_id = data.get('channel_id', '')
                        content = data.get('content', '').strip()
                        scheduled_for = data.get('scheduled_for', '')
                        
                        if server_id and channel_id and content and scheduled_for:
                            # Verify user has permission
                            if has_permission(server_id, username, 'send_messages'):
                                try:
                                    # Parse scheduled time
                                    scheduled_time = datetime.fromisoformat(scheduled_for.replace('Z', '+00:00'))
                                    
                                    # Create scheduled message
                                    msg_id = db.create_scheduled_message(server_id, channel_id, username, content, scheduled_time)
                                    if msg_id:
                                        await websocket.send_str(json.dumps({
                                            'type': 'scheduled_message_created',
                                            'message_id': msg_id,
                                            'server_id': server_id,
                                            'channel_id': channel_id,
                                            'scheduled_for': scheduled_time.isoformat()
                                        }))
                                    else:
                                        await websocket.send_str(json.dumps({
                                            'type': 'error',
                                            'message': 'Failed to create scheduled message'
                                        }))
                                except Exception as e:
                                    await websocket.send_str(json.dumps({
                                        'type': 'error',
                                        'message': f'Invalid scheduled time: {str(e)}'
                                    }))
                    
                    elif data.get('type') == 'get_scheduled_messages':
                        server_id = data.get('server_id', '')
                        if server_id and has_permission(server_id, username, 'manage_server'):
                            messages = db.get_scheduled_messages(server_id)
                            await websocket.send_str(json.dumps({
                                'type': 'scheduled_messages',
                                'server_id': server_id,
                                'messages': [{
                                    'id': msg['id'],
                                    'channel_id': msg['channel_id'],
                                    'username': msg['username'],
                                    'content': msg['content'],
                                    'scheduled_for': msg['scheduled_for'].isoformat(),
                                    'created_at': msg['created_at'].isoformat()
                                } for msg in messages]
                            }))
                    
                    elif data.get('type') == 'delete_scheduled_message':
                        message_id = data.get('message_id')
                        if message_id:
                            success = db.delete_scheduled_message(message_id, username)
                            if success:
                                await websocket.send_str(json.dumps({
                                    'type': 'scheduled_message_deleted',
                                    'message_id': message_id
                                }))
                            else:
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': 'Failed to delete scheduled message'
                                }))
                    
                    elif data.get('type') == 'create_poll':
                        server_id = data.get('server_id', '')
                        channel_id = data.get('channel_id', '')
                        question = data.get('question', '').strip()
                        options = data.get('options', [])
                        allow_multiple = data.get('allow_multiple', False)
                        expires_hours = data.get('expires_hours')
                        
                        if server_id and channel_id and question and len(options) >= 2:
                            if has_permission(server_id, username, 'send_messages'):
                                import secrets
                                poll_id = f"poll_{secrets.token_hex(8)}"
                                
                                expires_at = None
                                if expires_hours:
                                    expires_at = datetime.now() + timedelta(hours=expires_hours)
                                
                                success = db.create_poll(poll_id, server_id, channel_id, username, 
                                                        question, options, allow_multiple, expires_at)
                                
                                if success:
                                    # Broadcast poll to server
                                    poll_data = db.get_poll(poll_id)
                                    if poll_data:
                                        poll_data['created_at'] = poll_data['created_at'].isoformat()
                                        if poll_data.get('expires_at'):
                                            poll_data['expires_at'] = poll_data['expires_at'].isoformat()
                                        
                                        await broadcast_to_server(server_id, json.dumps({
                                            'type': 'poll_created',
                                            'poll': poll_data,
                                            'channel_id': channel_id
                                        }))
                                else:
                                    await websocket.send_str(json.dumps({
                                        'type': 'error',
                                        'message': 'Failed to create poll'
                                    }))
                    
                    elif data.get('type') == 'vote_poll':
                        poll_id = data.get('poll_id', '')
                        option_id = data.get('option_id', '')
                        
                        if poll_id and option_id:
                            success = db.vote_poll(poll_id, option_id, username)
                            if success:
                                # Get updated poll and broadcast to server
                                poll_data = db.get_poll(poll_id)
                                if poll_data:
                                    server_id = poll_data['server_id']
                                    poll_data['created_at'] = poll_data['created_at'].isoformat()
                                    if poll_data.get('expires_at'):
                                        poll_data['expires_at'] = poll_data['expires_at'].isoformat()
                                    
                                    await broadcast_to_server(server_id, json.dumps({
                                        'type': 'poll_updated',
                                        'poll': poll_data
                                    }))
                    
                    elif data.get('type') == 'close_poll':
                        poll_id = data.get('poll_id', '')
                        if poll_id:
                            success = db.close_poll(poll_id, username)
                            if success:
                                # Get poll and broadcast to server
                                poll_data = db.get_poll(poll_id)
                                if poll_data:
                                    server_id = poll_data['server_id']
                                    poll_data['created_at'] = poll_data['created_at'].isoformat()
                                    if poll_data.get('expires_at'):
                                        poll_data['expires_at'] = poll_data['expires_at'].isoformat()
                                    
                                    await broadcast_to_server(server_id, json.dumps({
                                        'type': 'poll_updated',
                                        'poll': poll_data
                                    }))
                    
                    elif data.get('type') == 'set_welcome_message':
                        server_id = data.get('server_id', '')
                        enabled = data.get('enabled', False)
                        message = data.get('message', '').strip()
                        channel_id = data.get('channel_id')
                        
                        if server_id and has_permission(server_id, username, 'manage_server'):
                            success = db.set_welcome_message(server_id, enabled, message, channel_id)
                            if success:
                                await websocket.send_str(json.dumps({
                                    'type': 'welcome_message_updated',
                                    'server_id': server_id,
                                    'enabled': enabled,
                                    'message': message,
                                    'channel_id': channel_id
                                }))
                    
                    elif data.get('type') == 'get_welcome_message':
                        server_id = data.get('server_id', '')
                        if server_id and has_permission(server_id, username, 'manage_server'):
                            welcome = db.get_welcome_message(server_id)
                            await websocket.send_str(json.dumps({
                                'type': 'welcome_message',
                                'server_id': server_id,
                                'welcome': welcome if welcome else {'enabled': False, 'message': '', 'channel_id': None}
                            }))
                    
                    elif data.get('type') == 'delete_welcome_message':
                        server_id = data.get('server_id', '')
                        if server_id and has_permission(server_id, username, 'manage_server'):
                            success = db.delete_welcome_message(server_id)
                            if success:
                                await websocket.send_str(json.dumps({
                                    'type': 'welcome_message_deleted',
                                    'server_id': server_id
                                }))
                    
                    elif data.get('type') == 'get_license_info':
                        first_user = db.get_first_user()
                        is_admin = (username == first_user)
                        license_data = {
                            'tier': license_validator.get_tier(),
                            'features': {f: license_validator.get_feature_enabled(f) for f in DEFAULT_FEATURES},
                            'limits': {l: license_validator.get_limit(l) for l in DEFAULT_LIMITS},
                            'is_admin': is_admin,
                        }
                        if is_admin:
                            customer_info = license_validator.get_customer_info()
                            if customer_info:
                                license_data['customer'] = customer_info
                            else:
                                # Fall back to the admin's own account info
                                user_data = db.get_user(username)
                                if user_data:
                                    license_data['customer'] = {
                                        'name': user_data.get('username', ''),
                                        'email': user_data.get('email', ''),
                                        'company': '',
                                    }
                            expiry = license_validator.get_expiry()
                            if expiry:
                                license_data['expires_at'] = expiry
                        await websocket.send_str(json.dumps({
                            'type': 'license_info',
                            'data': license_data
                        }))

                    elif data.get('type') == 'update_license':
                        first_user = db.get_first_user()
                        if username != first_user:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Admin access required'
                            }))
                            continue

                        license_key = data.get('license_key', '')
                        logger.info(f"Received license key update request. Key length: {len(license_key)}, First 50 chars: {license_key[:50] if license_key else 'empty'}")
                        result = license_validator.validate_license(license_key)
                        logger.info(f"License validation result: {result.get('valid')}, Error: {result.get('error')}")
                        if result.get('valid'):
                            tier = license_validator.get_tier()
                            expires_at = license_validator.get_expiry()
                            customer_info = license_validator.get_customer_info()
                            customer_name = customer_info.get('name', '')
                            customer_email = customer_info.get('email', '')
                            db.save_license_key(license_key, tier, expires_at, customer_name, customer_email)

                            broadcast_data = {
                                'tier': tier,
                                'features': {f: license_validator.get_feature_enabled(f) for f in DEFAULT_FEATURES},
                                'limits': {l: license_validator.get_limit(l) for l in DEFAULT_LIMITS},
                                'is_admin': False,
                            }
                            await broadcast(json.dumps({
                                'type': 'license_updated',
                                'data': broadcast_data
                            }))
                        else:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': result.get('error', 'Invalid license key')
                            }))

                    elif data.get('type') == 'remove_license':
                        first_user = db.get_first_user()
                        if username != first_user:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Admin access required'
                            }))
                            continue

                        license_validator.clear()
                        db.clear_license()

                        broadcast_data = {
                            'tier': 'community',
                            'features': dict(DEFAULT_FEATURES),
                            'limits': dict(DEFAULT_LIMITS),
                            'is_admin': False,
                        }
                        await broadcast(json.dumps({
                            'type': 'license_updated',
                            'data': broadcast_data
                        }))

                    elif data.get('type') == 'force_license_checkin':
                        from instance_fingerprint import generate_instance_fingerprint

                        first_user = db.get_first_user()
                        if username != first_user:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'Admin access required'
                            }))
                            continue

                        # Get license key from database
                        stored = db.get_license_key()
                        if not stored or not stored.get('license_key'):
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': 'No license key configured'
                            }))
                            continue

                        license_key = stored['license_key']

                        # Get or generate instance fingerprint
                        settings = db.get_admin_settings()
                        instance_fingerprint = settings.get('instance_fingerprint')

                        if not instance_fingerprint:
                            instance_fingerprint = generate_instance_fingerprint()
                            db.update_admin_settings({'instance_fingerprint': instance_fingerprint})

                        # Perform check-in
                        try:
                            checkin_result = await license_validator.perform_server_checkin(
                                license_key=license_key,
                                instance_fingerprint=instance_fingerprint,
                                app_version="1.0.0"
                            )

                            if checkin_result["success"] and checkin_result["valid"]:
                                # Update last check timestamp
                                db.update_admin_settings({
                                    'last_license_check_at': datetime.now(timezone.utc)
                                })

                                await websocket.send_str(json.dumps({
                                    'type': 'license_checkin_success',
                                    'message': 'License check-in successful',
                                    'data': {
                                        'license_id': checkin_result["server_response"].get('license_id'),
                                        'last_check_at': datetime.now(timezone.utc).isoformat()
                                    }
                                }))
                            elif checkin_result["success"] and not checkin_result["valid"]:
                                # License revoked
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': f'License check-in failed: {checkin_result.get("error", "Unknown error")}'
                                }))
                            else:
                                # Network error or server issue
                                await websocket.send_str(json.dumps({
                                    'type': 'error',
                                    'message': f'License check-in failed: {checkin_result.get("error", "Unknown error")}'
                                }))
                        except Exception as e:
                            await websocket.send_str(json.dumps({
                                'type': 'error',
                                'message': f'License check-in error: {str(e)}'
                            }))

                except json.JSONDecodeError:
                    print("Invalid JSON received")
                except Exception as e:
                    print(f"Error processing message: {e}")
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
        
        # Clean up bot client tracking
        if websocket in bot_clients:
            bot_info_cleanup = bot_clients[websocket]
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Bot '{bot_info_cleanup.get('username', '?')}' disconnected")
            del bot_clients[websocket]
        
        if username and authenticated:
            # Clean up voice state
            if username in voice_states:
                state = voice_states[username]
                server_id = state.get('server_id')
                channel_id = state.get('channel_id')
                direct_call_peer = state.get('direct_call_peer')
                
                if server_id and channel_id:
                    # User was in a voice channel
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
                                'screen_sharing': member_state.get('screen_sharing', False),
                                'showing_screen': member_state.get('showing_screen', False)
                            })
                        
                        # Notify all server members
                        await broadcast_to_server(server_id, json.dumps({
                            'type': 'voice_state_update',
                            'server_id': server_id,
                            'channel_id': channel_id,
                            'username': username,
                            'state': 'left',
                            'voice_members': voice_members_list
                        }))
                elif direct_call_peer:
                    # User was in a direct call - notify peer
                    await send_to_user(direct_call_peer, json.dumps({
                        'type': 'direct_call_ended',
                        'from': username,
                        'reason': 'disconnected'
                    }))
                
                del voice_states[username]
            
            # Notify others about user leaving
            leave_message = json.dumps({
                'type': 'system',
                'content': f'{username} left the chat',
                'timestamp': datetime.now(timezone.utc).isoformat()
            })
            await broadcast(leave_message)
            print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} left")


async def websocket_handler(request):
    """Handle WebSocket upgrade requests."""
    ws = web.WebSocketResponse(heartbeat=30.0)
    await ws.prepare(request)
    
    # Use the existing handler logic
    await handler(ws)
    
    return ws


async def cleanup_verification_codes_periodically():
    """Periodic task to clean up expired verification codes."""
    while True:
        try:
            await asyncio.sleep(CLEANUP_INTERVAL_HOURLY)  # Run every hour
            db.cleanup_expired_verification_codes()
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Cleaned up expired verification codes")
        except Exception as e:
            print(f"Error in periodic cleanup task: {e}")


async def cleanup_old_attachments_periodically():
    """Periodic task to clean up old attachments based on retention policy."""
    while True:
        try:
            await asyncio.sleep(CLEANUP_INTERVAL_DAILY)  # Run once per day
            admin_settings = db.get_admin_settings()
            retention_days = admin_settings.get('attachment_retention_days', 0)
            
            # Only delete if retention policy is set (> 0 days)
            if retention_days > 0:
                deleted_count = db.delete_old_attachments(retention_days)
                if deleted_count > 0:
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Cleaned up {deleted_count} old attachments (older than {retention_days} days)")
        except Exception as e:
            print(f"Error in attachment cleanup task: {e}")


async def cleanup_reset_tokens_periodically():
    """Periodic task to clean up expired password reset tokens."""
    while True:
        try:
            await asyncio.sleep(3600)  # Run every hour
            db.cleanup_expired_reset_tokens()
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Cleaned up expired reset tokens")
        except Exception as e:
            print(f"Error in reset token cleanup task: {e}")


async def cleanup_old_messages_periodically():
    """Periodic task to clean up old messages based on purge schedules."""
    while True:
        try:
            await asyncio.sleep(CLEANUP_INTERVAL_DAILY)  # Run once per day
            
            # Purge old DM messages
            admin_settings = db.get_admin_settings()
            dm_purge_days = admin_settings.get('dm_purge_schedule', 0)
            if dm_purge_days > 0:
                deleted_count = db.purge_old_dm_messages(dm_purge_days)
                if deleted_count > 0:
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Purged {deleted_count} DM messages (older than {dm_purge_days} days)")
            
            # Purge old server messages
            servers_with_schedule = db.get_all_servers_with_purge_schedule()
            for server_settings in servers_with_schedule:
                server_id = server_settings['server_id']
                purge_days = server_settings['purge_schedule']
                exempted_channels = db.get_channel_exemptions(server_id)
                
                deleted_count = db.purge_old_server_messages(server_id, purge_days, exempted_channels)
                if deleted_count > 0:
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Purged {deleted_count} messages from server {server_id} (older than {purge_days} days)")
        except Exception as e:
            print(f"Error in message purge task: {e}")


async def process_scheduled_messages():
    """Periodic task to process and send scheduled messages."""
    while True:
        try:
            await asyncio.sleep(60)  # Check every minute
            
            # Get all pending scheduled messages that are due
            pending_messages = db.get_pending_scheduled_messages()
            
            for msg in pending_messages:
                try:
                    server_id = msg['server_id']
                    channel_id = msg['channel_id']
                    username = msg['username']
                    content = msg['content']
                    context_id = f"{server_id}/{channel_id}"
                    
                    # Get user profile for avatar
                    user_profile = db.get_user(username)
                    if not user_profile:
                        # User deleted, skip this message
                        db.mark_scheduled_message_sent(msg['id'])
                        continue
                    
                    # Save message to database
                    message_id = db.save_message(username, content, 'server', context_id, None)
                    
                    # Create message object
                    msg_obj = create_message_object(
                        username=username,
                        msg_content=content,
                        context='server',
                        context_id=context_id,
                        user_profile=user_profile,
                        message_id=message_id
                    )
                    
                    # Broadcast to server
                    await broadcast_to_server(server_id, json.dumps(msg_obj))
                    
                    # Mark as sent
                    db.mark_scheduled_message_sent(msg['id'])
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Sent scheduled message {msg['id']} to {server_id}/{channel_id}")
                    
                except Exception as e:
                    print(f"Error sending scheduled message {msg.get('id')}: {e}")
                    
        except Exception as e:
            print(f"Error in scheduled message processor: {e}")


async def load_license():
    """
    Load and validate the Decentra license key at startup.

    Performs both offline validation (RSA signature) and online check-in
    to the licensing server if needed.

    Checks (in order):
    1. DECENTRA_LICENSE_KEY environment variable
    2. server/.license file
    3. Database (via db.get_license_key())
    """
    from instance_fingerprint import generate_instance_fingerprint

    print("=" * 50)
    print("License Validation")
    print("=" * 50)

    license_key = None

    # 1. Environment variable
    env_key = os.environ.get("DECENTRA_LICENSE_KEY")
    if env_key:
        license_key = env_key.strip()
        print("License key source: environment variable")

    # 2. .license file next to this script
    if not license_key:
        license_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".license")
        try:
            with open(license_file, "r", encoding="utf-8") as f:
                file_key = f.read().strip()
                if file_key:
                    license_key = file_key
                    print("License key source: .license file")
        except (FileNotFoundError, OSError):
            pass

    # 3. Database
    if not license_key:
        try:
            stored = db.get_license_key()
            if stored and stored.get('license_key'):
                license_key = stored['license_key']
                print("License key source: database")
        except Exception as e:
            print(f"Warning: failed to load license key from database: {e}")
            traceback.print_exc()

    # Validate if we found a key
    if not license_key:
        print("License: Community tier (no license key found)")
        print("=" * 50)
        return

    # Step 1: Validate RSA signature offline (existing logic)
    result = license_validator.validate_license(license_key)

    if not result.get('valid'):
        print(f"License: invalid ({result.get('error', 'unknown error')})")
        print("License: Community tier (invalid license)")
        print("=" * 50)
        # Update database to reflect invalid license
        try:
            db.update_admin_settings({
                'license_tier': 'community',
                'license_expires_at': None
            })
        except Exception as e:
            print(f"Warning: Failed to update admin settings: {e}")
        return

    tier = license_validator.get_tier()
    expiry = license_validator.get_expiry() or "never"
    print(f"License signature valid: {tier} tier (expires: {expiry})")

    # Step 2: Check if we need to perform server check-in
    try:
        settings = db.get_admin_settings()
        last_check_at = settings.get('last_license_check_at')
        
        # Ensure last_check_at is timezone-aware
        if last_check_at and last_check_at.tzinfo is None:
            last_check_at = last_check_at.replace(tzinfo=timezone.utc)
        
        grace_period_days = settings.get('license_check_grace_period_days', 7)
        instance_fingerprint = settings.get('instance_fingerprint')

        # Generate fingerprint if not exists
        if not instance_fingerprint:
            instance_fingerprint = generate_instance_fingerprint()
            db.update_admin_settings({'instance_fingerprint': instance_fingerprint})
            print(f"Generated instance fingerprint")

        # Check if we need to contact the server
        if license_validator.should_perform_checkin(last_check_at):
            print("Performing license server check-in (30 days since last check)...")

            checkin_result = await license_validator.perform_server_checkin(
                license_key=license_key,
                instance_fingerprint=instance_fingerprint,
                app_version="1.0.0"  # Get from package.json or version file
            )

            if checkin_result["success"]:
                # Server responded
                if checkin_result["valid"]:
                    # License is valid - update last check timestamp
                    db.update_admin_settings({
                        'last_license_check_at': datetime.now(timezone.utc)
                    })
                    print("✓ License server check-in successful - license is valid")
                else:
                    # License was revoked or invalid
                    error_msg = checkin_result.get("error", "Unknown error")
                    print(f"✗ License REVOKED by server: {error_msg}")
                    print("License: Community tier (license revoked)")

                    # Revoke the license locally
                    db.update_admin_settings({
                        'license_key': '',
                        'license_tier': 'community',
                        'license_expires_at': None,
                        'license_customer_name': '',
                        'license_customer_email': ''
                    })

                    # Clear from validator
                    license_validator.clear()
            else:
                # Server check-in failed (network error, timeout, etc.)
                if license_validator.is_in_grace_period(last_check_at, grace_period_days):
                    days_since = (
                        (datetime.now(timezone.utc) - last_check_at).days
                        if last_check_at else 0
                    )
                    days_remaining = (30 + grace_period_days) - days_since
                    print(
                        f"⚠ License server check-in failed: {checkin_result['error']}"
                    )
                    print(
                        f"⚠ Continuing with cached license (grace period: {days_remaining} days remaining)"
                    )
                else:
                    print(
                        "✗ License server check-in failed and grace period expired"
                    )
                    print("License: Community tier (grace period expired)")

                    # Grace period expired - revoke license
                    db.update_admin_settings({
                        'license_key': '',
                        'license_tier': 'community',
                        'license_expires_at': None
                    })
                    license_validator.clear()
        else:
            days_since_check = (
                (datetime.now(timezone.utc) - last_check_at).days
                if last_check_at else 0
            )
            print(
                f"License server check-in not needed "
                f"({days_since_check} days since last check, threshold: 30 days)"
            )

    except Exception as e:
        print(f"Warning: Failed to perform license check-in: {e}")
        traceback.print_exc()

    print("=" * 50)


async def main():
    """Start the HTTPS and WebSocket server."""
    print("Decentra Chat Server")
    print("=" * 50)
    
    # Generate or load self-signed SSL certificate
    cert_dir = os.path.join(os.path.dirname(__file__), 'certs')
    cert_path, key_path = generate_self_signed_cert(cert_dir=cert_dir)
    ssl_context = create_ssl_context(cert_path, key_path)
    
    print("Starting HTTPS server on https://0.0.0.0:8765")
    print("Starting WebSocket server on wss://0.0.0.0:8765")
    # ── Voice configuration sanity checks ────────────────────────────────────
    if not COTURN_SECRET:
        print("[WARN] COTURN_SECRET is not set — voice relay (TURN) will be disabled. "
              "Set COTURN_SECRET in your .env file.")
    if 'localhost' in LIVEKIT_URL or '127.0.0.1' in LIVEKIT_URL:
        print("[WARN] LIVEKIT_URL contains 'localhost' — browsers on other machines will "
              "not be able to reach LiveKit. Set LIVEKIT_URL to your public hostname/IP "
              "(e.g. wss://your-domain.com:7880) in production.")
    print("=" * 50)
    
    # Initialize database counters from existing data
    init_counters_from_db()
    print(f"Initialized counters from database (servers: {server_counter}, channels: {channel_counter}, dms: {dm_counter}, roles: {role_counter})")

    # Load and validate license key
    await load_license()

    # Create aiohttp application
    app = web.Application()
    app.router.add_get('/ws', websocket_handler)

    # ── Voice / ICE-server endpoint (hardened) ────────────────────────────────
    async def ice_servers_handler(request: web.Request) -> web.Response:
        """
        Return ICE server configuration with time-limited HMAC credentials.

        SECURITY CHANGES:
        - Requires a valid session token (Authorization header or ?token= param).
        - Returns ONLY the self-hosted Coturn TURN relay — no third-party STUN.
        - Generates short-lived HMAC-SHA1 credentials (RFC 8489) valid for 1 hour.
        - With iceTransportPolicy:'relay' enforced on the client, all media is
          routed through Coturn and peers never see each other's real IP addresses.
        """
        # ── Authenticate ──
        token = None
        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]
        if not token:
            token = request.query.get('token')
        if not token:
            return web.json_response({'error': 'Authentication required'}, status=401)
        user_info = verify_jwt_token(token)
        if not user_info:
            return web.json_response({'error': 'Invalid or expired token'}, status=401)

        # ── Generate time-limited Coturn HMAC credentials ──
        # Format: username = "<expiry_timestamp>:<user_id>"
        # credential = Base64(HMAC-SHA1(static_secret, username))
        # Valid for 1 hour.  Coturn validates these using use-auth-secret mode.
        # NOTE: SHA-1 is required here by the Coturn REST API / use-auth-secret
        # protocol (https://github.com/coturn/coturn/wiki/turnserver#turn-rest-api).
        # Coturn's built-in verifier uses HMAC-SHA1 regardless of OpenSSL version;
        # using any other digest will cause Coturn to reject every credential.
        # The use of SHA-1 is a hard protocol constraint, not a design choice.
        # ── Early exit when TURN relay is not configured ──
        if not COTURN_URL or not COTURN_SECRET:
            return web.json_response(
                {'error': 'TURN relay is not configured on this server — '
                          'set COTURN_SECRET and COTURN_URL environment variables.'},
                status=503,
            )

        import hmac as _hmac
        ttl = 3600  # 1 hour
        expiry = int(time.time()) + ttl
        turn_username = f'{expiry}:{user_info["username"]}'
        turn_credential = base64.b64encode(
            _hmac.new(COTURN_SECRET.encode(), turn_username.encode(), hashlib.sha1).digest()  # nosec B324
        ).decode()

        ice: list[dict] = [
            {
                'urls': COTURN_URL,
                'username': turn_username,
                'credential': turn_credential,
            },
            {
                # TURN-over-TCP — for networks that block UDP
                'urls': COTURN_URL + '?transport=tcp',
                'username': turn_username,
                'credential': turn_credential,
            },
        ]
        return web.json_response({'ice_servers': ice})

    app.router.add_get('/api/voice/ice-servers', ice_servers_handler)
    # ─────────────────────────────────────────────────────────────────────────
    setup_api_routes(app, db, verify_jwt_token, broadcast_to_server, send_to_user, get_or_create_dm, get_avatar_data, jwt_generate_func=generate_jwt_token)
    
    # Run the server with SSL
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', 8765, ssl_context=ssl_context)
    await site.start()
    
    # Start periodic cleanup tasks
    asyncio.create_task(cleanup_verification_codes_periodically())
    asyncio.create_task(cleanup_old_attachments_periodically())
    asyncio.create_task(cleanup_reset_tokens_periodically())
    asyncio.create_task(cleanup_old_messages_periodically())
    asyncio.create_task(process_scheduled_messages())
    
    print("Server started successfully!")
    print("Access the web client at https://localhost:8765")
    print(f"Database: PostgreSQL at {db.db_url}")
    print("REST API available at https://localhost:8765/api/*")
    print("\nNOTE: You may see a browser warning about the self-signed certificate.")
    print("This is normal for local development. Click 'Advanced' and proceed to continue.")
    
    # Keep running
    await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
