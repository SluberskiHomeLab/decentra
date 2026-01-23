#!/usr/bin/env python3
"""
Decentra Chat Server
A simple WebSocket-based chat server for decentralized communication.
"""

import asyncio
import json
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
import jwt
import pyotp
import qrcode
import io
from database import Database
from api import setup_api_routes
from email_utils import EmailSender
from ssl_utils import generate_self_signed_cert, create_ssl_context

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


def create_message_object(username, msg_content, context, context_id, user_profile, message_key=None, message_id=None):
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
        'avatar_data': user_profile.get('avatar_data') if user_profile else None
    }
    
    # Add message ID if provided
    if message_id is not None:
        msg_obj['id'] = message_id
    
    # Add messageKey if provided (for file attachment correlation)
    if message_key:
        msg_obj['messageKey'] = message_key
    
    # Add reactions for new messages
    msg_obj['reactions'] = []
    
    return msg_obj


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


def get_profile_data(username):
    """Get profile data (bio and status) for a user."""
    user = db.get_user(username)
    if not user:
        return {'bio': '', 'status_message': ''}
    
    return {
        'bio': user.get('bio', ''),
        'status_message': user.get('status_message', '')
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
                        # Remove used invite code
                        if invite_code:
                            db.delete_invite_code(invite_code)
                    
                    # Generate JWT token for the user
                    token = generate_jwt_token(username)
                    
                    await websocket.send_str(json.dumps({
                        'type': 'auth_success',
                        'message': 'Account created successfully',
                        'token': token
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
                continue
            
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
                    # Remove used invite code
                    if pending['invite_code']:
                        db.delete_invite_code(pending['invite_code'])
                
                # Generate JWT token for the user
                token = generate_jwt_token(username)
                
                await websocket.send_str(json.dumps({
                    'type': 'auth_success',
                    'message': 'Account created successfully',
                    'token': token
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
                
                await websocket.send_str(json.dumps({
                    'type': 'auth_success',
                    'message': 'Login successful',
                    'token': token
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
                
                await websocket.send_str(json.dumps({
                    'type': 'auth_success',
                    'message': 'Token authentication successful',
                    'token': new_token
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
                        if email_sender.send_password_reset_email(
                            user['email'], 
                            user['username'], 
                            reset_token
                        ):
                            print(f"[{datetime.now().strftime('%H:%M:%S')}] Password reset email sent to {user['username']}")
                
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
                    'icon': server_data.get('icon', '🏠'),
                    'icon_type': server_data.get('icon_type', 'emoji'),
                    'icon_data': server_data.get('icon_data'),
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
                                'can_delete_channel': member.get('can_delete_channel', False),
                                'can_edit_messages': member.get('can_edit_messages', False),
                                'can_delete_messages': member.get('can_delete_messages', False)
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
        
        # Build friends list with avatars and profile data
        friends_list = []
        for friend in db.get_friends(username):
            avatar_data = get_avatar_data(friend)
            profile_data = get_profile_data(friend)
            friends_list.append({
                'username': friend,
                **avatar_data,
                **profile_data
            })
        
        # Build friend requests lists
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
        admin_settings = db.get_admin_settings()
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
            'timestamp': datetime.now(timezone.utc).isoformat()
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
                        message_key = data.get('messageKey')  # Extract messageKey for file attachment correlation
                        
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
                                        # Save message to database and get ID
                                        message_id = db.save_message(username, msg_content, 'server', context_id)
                                        
                                        # Create message object with ID and messageKey
                                        msg_obj = create_message_object(
                                            username=username,
                                            msg_content=msg_content,
                                            context=context,
                                            context_id=context_id,
                                            user_profile=user_profile,
                                            message_key=message_key,
                                            message_id=message_id
                                        )
                                        
                                        # Broadcast to server members
                                        await broadcast_to_server(server_id, json.dumps(msg_obj))
                                        print(f"[{datetime.now().strftime('%H:%M:%S')}] {username} sent message in {server_id}/{channel_id}")
                        
                        elif context == 'dm' and context_id:
                            # Direct message - verify DM exists and user is participant
                            dm_users = db.get_user_dms(username)
                            dm_ids = [dm['dm_id'] for dm in dm_users]
                            if context_id in dm_ids:
                                # Save message to database and get ID
                                message_id = db.save_message(username, msg_content, 'dm', context_id)
                                
                                # Create message object with ID and messageKey
                                msg_obj = create_message_object(
                                    username=username,
                                    msg_content=msg_content,
                                    context=context,
                                    context_id=context_id,
                                    user_profile=user_profile,
                                    message_key=message_key,
                                    message_id=message_id
                                )
                                
                                # Get participants and send to both
                                for dm in dm_users:
                                    if dm['dm_id'] == context_id:
                                        participants = [dm['user1'], dm['user2']]
                                        for participant in participants:
                                            await send_to_user(participant, json.dumps(msg_obj))
                                        break
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
                                    'icon': '🏠',
                                    'icon_type': 'emoji',
                                    'icon_data': None,
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
                            
                            # Get reactions for all messages
                            if channel_messages:
                                message_ids = [msg['id'] for msg in channel_messages]
                                reactions_map = db.get_reactions_for_messages(message_ids)
                                
                                # Add reactions to each message
                                for msg in channel_messages:
                                    msg['reactions'] = reactions_map.get(msg['id'], [])
                            
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
                            
                            # Get reactions for all messages
                            if dm_messages:
                                message_ids = [msg['id'] for msg in dm_messages]
                                reactions_map = db.get_reactions_for_messages(message_ids)
                                
                                # Add reactions to each message
                                for dm_msg in dm_messages:
                                    dm_msg['reactions'] = reactions_map.get(dm_msg['id'], [])
                            
                            await websocket.send_str(json.dumps({
                                'type': 'dm_history',
                                'dm_id': dm_id,
                                'messages': dm_messages
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
                                # Server owner can delete any message
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
                                
                                # Validate duration
                                duration = settings.get('announcement_duration_minutes')
                                if duration is None or not isinstance(duration, (int, float)):
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
                                # Get current settings to check if announcement changed
                                current_settings = db.get_admin_settings()
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
                            email_sender = EmailSender(smtp_settings)
                            
                            success, message = email_sender.test_connection()
                            
                            await websocket.send_str(json.dumps({
                                'type': 'smtp_test_result',
                                'success': success,
                                'message': message
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
                                        'icon': server.get('icon', '🏠'),
                                        'icon_type': server.get('icon_type', 'emoji'),
                                        'icon_data': server.get('icon_data'),
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
                        
                        if not has_permission(server_id, username, 'access_settings'):
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
                    
                    # Custom emoji handlers
                    elif data.get('type') == 'upload_custom_emoji':
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
                    
                    elif data.get('type') == 'start_voice_call':
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
    setup_api_routes(app, db, verify_jwt_token)
    
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
