#!/usr/bin/env python3
"""
Bot Scopes and Intents for Decentra Bot System.

Scopes control what actions a bot can perform.
Intents control which events a bot receives via WebSocket.
"""

# ── Bot Permission Scopes ───────────────────────────────────────────────────
# Each scope is a string constant used in the bot's scopes list.
# Scopes are checked before every bot action (REST or WS).

SCOPE_READ_MESSAGES = 'READ_MESSAGES'
SCOPE_SEND_MESSAGES = 'SEND_MESSAGES'
SCOPE_MANAGE_MESSAGES = 'MANAGE_MESSAGES'       # edit/delete messages
SCOPE_READ_MEMBERS = 'READ_MEMBERS'
SCOPE_MANAGE_MEMBERS = 'MANAGE_MEMBERS'         # kick/ban
SCOPE_MANAGE_CHANNELS = 'MANAGE_CHANNELS'       # create/edit/delete channels
SCOPE_MANAGE_ROLES = 'MANAGE_ROLES'
SCOPE_ADD_REACTIONS = 'ADD_REACTIONS'
SCOPE_MANAGE_THREADS = 'MANAGE_THREADS'
SCOPE_USE_SLASH_COMMANDS = 'USE_SLASH_COMMANDS'
SCOPE_SEND_DMS = 'SEND_DMS'
SCOPE_MANAGE_SERVER = 'MANAGE_SERVER'
SCOPE_READ_VOICE_STATE = 'READ_VOICE_STATE'
SCOPE_ADMINISTRATOR = 'ADMINISTRATOR'           # all permissions

ALL_SCOPES = [
    SCOPE_READ_MESSAGES,
    SCOPE_SEND_MESSAGES,
    SCOPE_MANAGE_MESSAGES,
    SCOPE_READ_MEMBERS,
    SCOPE_MANAGE_MEMBERS,
    SCOPE_MANAGE_CHANNELS,
    SCOPE_MANAGE_ROLES,
    SCOPE_ADD_REACTIONS,
    SCOPE_MANAGE_THREADS,
    SCOPE_USE_SLASH_COMMANDS,
    SCOPE_SEND_DMS,
    SCOPE_MANAGE_SERVER,
    SCOPE_READ_VOICE_STATE,
    SCOPE_ADMINISTRATOR,
]

SCOPE_DESCRIPTIONS = {
    SCOPE_READ_MESSAGES: 'Read messages in channels the bot has access to',
    SCOPE_SEND_MESSAGES: 'Send messages to channels',
    SCOPE_MANAGE_MESSAGES: 'Edit and delete messages',
    SCOPE_READ_MEMBERS: 'View server member lists',
    SCOPE_MANAGE_MEMBERS: 'Kick and ban server members',
    SCOPE_MANAGE_CHANNELS: 'Create, edit, and delete channels',
    SCOPE_MANAGE_ROLES: 'Create, edit, and assign roles',
    SCOPE_ADD_REACTIONS: 'Add and remove reactions on messages',
    SCOPE_MANAGE_THREADS: 'Create and manage threads',
    SCOPE_USE_SLASH_COMMANDS: 'Register and respond to slash commands',
    SCOPE_SEND_DMS: 'Send direct messages to users',
    SCOPE_MANAGE_SERVER: 'Edit server settings',
    SCOPE_READ_VOICE_STATE: 'See who is in voice channels',
    SCOPE_ADMINISTRATOR: 'Full access — all permissions',
}


def has_scope(bot_scopes: list, required_scope: str) -> bool:
    """Check if a bot has a required scope (or ADMINISTRATOR)."""
    if SCOPE_ADMINISTRATOR in bot_scopes:
        return True
    return required_scope in bot_scopes


def get_effective_scopes(bot_scopes: list, server_override: list = None) -> list:
    """Get effective scopes, optionally narrowed by server override."""
    if server_override is None:
        return bot_scopes
    # Server override can only narrow, not expand
    return [s for s in bot_scopes if s in server_override]


# ── Bot Event Intents ───────────────────────────────────────────────────────
# Intents control which categories of events a bot receives via WebSocket.
# Bots declare intents at creation time. Only subscribed events are delivered.

INTENT_GUILD_MESSAGES = 'GUILD_MESSAGES'           # message create/edit/delete
INTENT_GUILD_MEMBERS = 'GUILD_MEMBERS'             # member join/leave/update
INTENT_GUILD_REACTIONS = 'GUILD_REACTIONS'          # reaction add/remove
INTENT_GUILD_CHANNELS = 'GUILD_CHANNELS'           # channel create/update/delete
INTENT_GUILD_ROLES = 'GUILD_ROLES'                 # role create/update/delete
INTENT_GUILD_VOICE_STATE = 'GUILD_VOICE_STATE'     # voice join/leave
INTENT_GUILD_THREADS = 'GUILD_THREADS'             # thread create/close
INTENT_GUILD_POLLS = 'GUILD_POLLS'                 # poll create/vote/close
INTENT_DIRECT_MESSAGES = 'DIRECT_MESSAGES'         # DM events
INTENT_SLASH_COMMANDS = 'SLASH_COMMANDS'            # slash command invocations

ALL_INTENTS = [
    INTENT_GUILD_MESSAGES,
    INTENT_GUILD_MEMBERS,
    INTENT_GUILD_REACTIONS,
    INTENT_GUILD_CHANNELS,
    INTENT_GUILD_ROLES,
    INTENT_GUILD_VOICE_STATE,
    INTENT_GUILD_THREADS,
    INTENT_GUILD_POLLS,
    INTENT_DIRECT_MESSAGES,
    INTENT_SLASH_COMMANDS,
]

INTENT_DESCRIPTIONS = {
    INTENT_GUILD_MESSAGES: 'Receive message create, edit, and delete events',
    INTENT_GUILD_MEMBERS: 'Receive member join, leave, and update events',
    INTENT_GUILD_REACTIONS: 'Receive reaction add and remove events',
    INTENT_GUILD_CHANNELS: 'Receive channel create, update, and delete events',
    INTENT_GUILD_ROLES: 'Receive role create, update, and delete events',
    INTENT_GUILD_VOICE_STATE: 'Receive voice channel join and leave events',
    INTENT_GUILD_THREADS: 'Receive thread create and close events',
    INTENT_GUILD_POLLS: 'Receive poll create, vote, and close events',
    INTENT_DIRECT_MESSAGES: 'Receive direct message events',
    INTENT_SLASH_COMMANDS: 'Receive slash command invocation events',
}

# Map event names → required intent
EVENT_INTENT_MAP = {
    'message_create': INTENT_GUILD_MESSAGES,
    'message_update': INTENT_GUILD_MESSAGES,
    'message_delete': INTENT_GUILD_MESSAGES,
    'member_join': INTENT_GUILD_MEMBERS,
    'member_leave': INTENT_GUILD_MEMBERS,
    'member_update': INTENT_GUILD_MEMBERS,
    'reaction_add': INTENT_GUILD_REACTIONS,
    'reaction_remove': INTENT_GUILD_REACTIONS,
    'channel_create': INTENT_GUILD_CHANNELS,
    'channel_update': INTENT_GUILD_CHANNELS,
    'channel_delete': INTENT_GUILD_CHANNELS,
    'role_create': INTENT_GUILD_ROLES,
    'role_update': INTENT_GUILD_ROLES,
    'role_delete': INTENT_GUILD_ROLES,
    'voice_join': INTENT_GUILD_VOICE_STATE,
    'voice_leave': INTENT_GUILD_VOICE_STATE,
    'thread_create': INTENT_GUILD_THREADS,
    'thread_close': INTENT_GUILD_THREADS,
    'poll_create': INTENT_GUILD_POLLS,
    'poll_vote': INTENT_GUILD_POLLS,
    'poll_close': INTENT_GUILD_POLLS,
    'dm_message_create': INTENT_DIRECT_MESSAGES,
    'slash_command': INTENT_SLASH_COMMANDS,
}


def has_intent(bot_intents: list, event_name: str) -> bool:
    """Check if a bot is subscribed to the intent for a given event."""
    required_intent = EVENT_INTENT_MAP.get(event_name)
    if required_intent is None:
        return False
    return required_intent in bot_intents
