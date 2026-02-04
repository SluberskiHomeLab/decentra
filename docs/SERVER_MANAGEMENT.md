# Server Management Features

This document describes the comprehensive server management features added to Decentra, including role hierarchy, channel categories, moderation tools, and audit logging.

## Table of Contents
- [Channel Categories](#channel-categories)
- [Role Hierarchy](#role-hierarchy)
- [Moderation Tools](#moderation-tools)
- [Audit Logs](#audit-logs)
- [Permissions](#permissions)
- [WebSocket API](#websocket-api)

## Channel Categories

Organize your server channels into collapsible groups for better organization.

### Features
- Create, update, and delete categories
- Assign channels to categories
- Position management for both categories and channels
- Automatic cleanup when categories are deleted (channels remain, but category association is removed)

### WebSocket API

#### Create Category
```json
{
  "type": "create_category",
  "server_id": "server_123",
  "name": "Text Channels"
}
```

Response:
```json
{
  "type": "category_created",
  "server_id": "server_123",
  "category": {
    "id": "category_abc",
    "name": "Text Channels",
    "position": 0
  }
}
```

#### Update Category
```json
{
  "type": "update_category",
  "category_id": "category_abc",
  "name": "Updated Name",
  "position": 5
}
```

#### Delete Category
```json
{
  "type": "delete_category",
  "category_id": "category_abc"
}
```

#### Get Server Categories
```json
{
  "type": "get_server_categories",
  "server_id": "server_123"
}
```

Response:
```json
{
  "type": "server_categories",
  "server_id": "server_123",
  "categories": [
    {
      "category_id": "category_abc",
      "name": "Text Channels",
      "position": 0,
      "created_at": "2024-01-15T10:30:00"
    }
  ]
}
```

#### Set Channel Category
```json
{
  "type": "set_channel_category",
  "channel_id": "channel_123",
  "category_id": "category_abc"  // or null to remove from category
}
```

## Role Hierarchy

Establish a clear hierarchy of roles to control who can moderate whom.

### How It Works
- Each role has a `position` field (higher number = higher authority)
- Server owners always have the highest authority (infinite position)
- Users can only moderate members with lower role positions
- Users cannot moderate themselves
- Server owners cannot be moderated

### Permission Checks
The system automatically checks role hierarchy for all moderation actions:
- Kick members
- Ban members
- Timeout members
- Remove timeouts/bans

### Example Hierarchy
```
Server Owner (position: ∞)
  ↓
Admin Role (position: 100)
  ↓
Moderator Role (position: 50)
  ↓
Member Role (position: 10)
  ↓
New Member Role (position: 1)
```

In this hierarchy:
- Admins can moderate Moderators and Members
- Moderators can moderate Members but not Admins
- Members cannot moderate anyone

## Moderation Tools

Comprehensive moderation actions to manage server members.

### Kick Member

Remove a user from the server. They can rejoin with an invite code.

```json
{
  "type": "kick_member",
  "server_id": "server_123",
  "username": "problematic_user",
  "reason": "Breaking server rules"
}
```

Response to kicked user:
```json
{
  "type": "kicked_from_server",
  "server_id": "server_123",
  "reason": "Breaking server rules",
  "moderator": "admin_user"
}
```

### Ban Member

Permanently ban a user from the server. They cannot rejoin even with invite codes.

```json
{
  "type": "ban_member",
  "server_id": "server_123",
  "username": "problematic_user",
  "reason": "Repeated violations"
}
```

Response to banned user:
```json
{
  "type": "banned_from_server",
  "server_id": "server_123",
  "reason": "Repeated violations",
  "moderator": "admin_user"
}
```

### Unban Member

Remove a ban to allow a user to rejoin the server.

```json
{
  "type": "unban_member",
  "server_id": "server_123",
  "username": "previously_banned_user"
}
```

### Timeout Member

Temporarily restrict a user from sending messages in the server.

```json
{
  "type": "timeout_member",
  "server_id": "server_123",
  "username": "spammer",
  "duration_minutes": 10,
  "reason": "Spamming messages"
}
```

Response to timed out user:
```json
{
  "type": "timed_out",
  "server_id": "server_123",
  "reason": "Spamming messages",
  "moderator": "moderator_user",
  "duration_minutes": 10,
  "expires_at": "2024-01-15T11:00:00"
}
```

### Remove Timeout

End a timeout early.

```json
{
  "type": "remove_timeout",
  "server_id": "server_123",
  "username": "timed_out_user"
}
```

### Get Moderation Actions

Retrieve all moderation actions for a server.

```json
{
  "type": "get_moderation_actions",
  "server_id": "server_123",
  "limit": 100
}
```

Response:
```json
{
  "type": "moderation_actions",
  "server_id": "server_123",
  "actions": [
    {
      "action_id": 1,
      "action_type": "kick",
      "target_username": "user1",
      "moderator_username": "admin",
      "reason": "Breaking rules",
      "created_at": "2024-01-15T10:30:00",
      "active": true
    }
  ]
}
```

## Audit Logs

Track all important actions taken in the server for accountability.

### What Gets Logged
- Category creation, updates, and deletion
- Channel category assignments
- Member kicks, bans, and timeouts
- Role changes (when integrated with role management)
- Any other important server changes

### Log Entry Structure
```json
{
  "log_id": 123,
  "server_id": "server_123",
  "action_type": "member_kick",
  "actor_username": "admin_user",
  "target_type": "user",
  "target_id": "kicked_user",
  "details": {
    "reason": "Breaking server rules"
  },
  "created_at": "2024-01-15T10:30:00"
}
```

### Get Audit Logs

Retrieve audit logs for a server.

```json
{
  "type": "get_audit_logs",
  "server_id": "server_123",
  "limit": 100,
  "action_type": "member_kick"  // Optional filter
}
```

Response:
```json
{
  "type": "audit_logs",
  "server_id": "server_123",
  "logs": [
    {
      "log_id": 123,
      "action_type": "member_kick",
      "actor_username": "admin_user",
      "target_type": "user",
      "target_id": "kicked_user",
      "details": {
        "reason": "Breaking server rules"
      },
      "created_at": "2024-01-15T10:30:00"
    }
  ]
}
```

### Common Action Types
- `category_create` - Category was created
- `category_update` - Category was updated
- `category_delete` - Category was deleted
- `channel_category_update` - Channel was assigned to/removed from category
- `member_kick` - Member was kicked from server
- `member_ban` - Member was banned from server
- `member_unban` - Member was unbanned
- `member_timeout` - Member was timed out
- `timeout_remove` - Member's timeout was removed

## Permissions

New permissions added for server management features:

### Moderation Permissions
- `kick_members` - Allows kicking members (respects role hierarchy)
- `ban_members` - Allows banning and unbanning members (respects role hierarchy)
- `timeout_members` - Allows timing out members and removing timeouts (respects role hierarchy)

### Channel Management Permissions
- `manage_channels` - Allows creating, editing, and deleting channels and categories

### Audit Permissions
- `view_audit_log` - Allows viewing audit logs and moderation actions

### Permission Examples

Grant moderation permissions to a role:
```json
{
  "type": "update_role",
  "role_id": "role_moderator",
  "permissions": {
    "kick_members": true,
    "timeout_members": true,
    "view_audit_log": true
  }
}
```

Grant full admin permissions:
```json
{
  "type": "update_role",
  "role_id": "role_admin",
  "permissions": {
    "kick_members": true,
    "ban_members": true,
    "timeout_members": true,
    "manage_channels": true,
    "manage_roles": true,
    "view_audit_log": true
  }
}
```

## Database Schema

### channel_categories
```sql
CREATE TABLE channel_categories (
    category_id VARCHAR(255) PRIMARY KEY,
    server_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE
);
```

### moderation_actions
```sql
CREATE TABLE moderation_actions (
    action_id SERIAL PRIMARY KEY,
    server_id VARCHAR(255) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    target_username VARCHAR(255) NOT NULL,
    moderator_username VARCHAR(255) NOT NULL,
    reason TEXT,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT TRUE,
    FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
    FOREIGN KEY (target_username) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (moderator_username) REFERENCES users(username) ON DELETE CASCADE
);
```

### audit_logs
```sql
CREATE TABLE audit_logs (
    log_id SERIAL PRIMARY KEY,
    server_id VARCHAR(255) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    actor_username VARCHAR(255) NOT NULL,
    target_type VARCHAR(50),
    target_id VARCHAR(255),
    details JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (server_id) REFERENCES servers(server_id) ON DELETE CASCADE,
    FOREIGN KEY (actor_username) REFERENCES users(username) ON DELETE CASCADE
);
```

### Changes to channels table
```sql
-- Added columns:
ALTER TABLE channels ADD COLUMN category_id VARCHAR(255);
ALTER TABLE channels ADD COLUMN position INTEGER DEFAULT 0;
ALTER TABLE channels ADD CONSTRAINT fk_channel_category 
    FOREIGN KEY (category_id) REFERENCES channel_categories(category_id) ON DELETE SET NULL;
```

## Security Considerations

1. **Role Hierarchy Enforcement**: All moderation actions check role hierarchy to prevent privilege escalation
2. **Server Owner Protection**: Server owners cannot be moderated by anyone
3. **Self-Moderation Prevention**: Users cannot moderate themselves
4. **Ban Persistence**: Banned users are checked when attempting to join servers
5. **Timeout Enforcement**: Timed-out users are prevented from sending messages
6. **Audit Trail**: All actions are logged for accountability and transparency
7. **Permission Checks**: All operations verify the user has the required permission before executing

## Best Practices

1. **Clear Role Hierarchy**: Set up a clear role hierarchy with appropriate positions
2. **Minimal Permissions**: Grant only the permissions necessary for each role
3. **Regular Audit Review**: Periodically review audit logs for unusual activity
4. **Organized Categories**: Use categories to keep channels organized and easy to navigate
5. **Document Rules**: Clearly communicate server rules and moderation policies
6. **Consistent Moderation**: Apply moderation actions fairly and consistently
7. **Timeout Before Ban**: Consider using timeouts for first offenses, bans for repeat violations

## Error Handling

Common error responses:

```json
{
  "type": "error",
  "message": "You do not have permission to kick members"
}

{
  "type": "error",
  "message": "Cannot moderate users with equal or higher roles"
}

{
  "type": "error",
  "message": "You are banned from this server"
}

{
  "type": "error",
  "message": "You are currently timed out and cannot send messages"
}
```

## Migration Notes

All new tables and columns are created automatically when the server starts with the updated code. Existing data is preserved, and new features are additive - they don't break existing functionality.

The system maintains backward compatibility with the legacy permission system while introducing the new role-based permission features.
