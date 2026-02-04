#!/usr/bin/env python3
"""
Test script for server management features:
- Channel categories
- Moderation actions (kick, ban, timeout)
- Audit logs
- Role hierarchy
"""

import os
import sys
from datetime import datetime, timedelta

# Set test encryption key before importing modules that need it
if 'DECENTRA_ENCRYPTION_KEY' not in os.environ:
    os.environ['DECENTRA_ENCRYPTION_KEY'] = 'test-encryption-key-for-server-management-tests'

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from database import Database
import bcrypt

def hash_password(password):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def test_server_management():
    print("Testing Decentra Server Management Features")
    print("=" * 50)
    
    # Use PostgreSQL test database
    db_url = os.getenv('TEST_DATABASE_URL', 'postgresql://decentra:decentra@localhost:5432/decentra_test')
    
    db = Database(db_url)
    print("✓ Database created successfully")
    
    # Setup: Create test users and server
    print("\nSetup: Creating test users and server...")
    db.create_user("admin_user", hash_password("password123"))
    db.create_user("moderator_user", hash_password("password456"))
    db.create_user("regular_user", hash_password("password789"))
    db.create_user("target_user", hash_password("passwordabc"))
    
    db.create_server("test_server_1", "Test Server", "admin_user")
    db.add_server_member("test_server_1", "moderator_user")
    db.add_server_member("test_server_1", "regular_user")
    db.add_server_member("test_server_1", "target_user")
    print("✓ Test users and server created")
    
    # Test 1: Channel Categories
    print("\n" + "=" * 50)
    print("Test 1: Channel Categories")
    print("=" * 50)
    
    # Create categories
    print("\nTest 1.1: Creating categories...")
    assert db.create_category("cat_1", "test_server_1", "Text Channels", 0), "Failed to create category 1"
    assert db.create_category("cat_2", "test_server_1", "Voice Channels", 1), "Failed to create category 2"
    print("✓ Categories created")
    
    # Get categories
    print("\nTest 1.2: Retrieving categories...")
    categories = db.get_server_categories("test_server_1")
    assert len(categories) == 2, f"Expected 2 categories, got {len(categories)}"
    assert categories[0]['name'] == "Text Channels", "Category 1 name mismatch"
    assert categories[1]['name'] == "Voice Channels", "Category 2 name mismatch"
    print(f"✓ Retrieved {len(categories)} categories")
    
    # Update category
    print("\nTest 1.3: Updating category...")
    assert db.update_category("cat_1", name="Updated Text Channels"), "Failed to update category"
    updated_cat = db.get_category("cat_1")
    assert updated_cat['name'] == "Updated Text Channels", "Category name not updated"
    print("✓ Category updated")
    
    # Assign channel to category
    print("\nTest 1.4: Assigning channel to category...")
    db.create_channel("channel_1", "test_server_1", "general", "text")
    assert db.set_channel_category("channel_1", "cat_1"), "Failed to set channel category"
    channels = db.get_server_channels("test_server_1")
    channel = next((c for c in channels if c['channel_id'] == "channel_1"), None)
    assert channel is not None, "Channel not found"
    assert channel.get('category_id') == "cat_1", "Channel category not set"
    print("✓ Channel assigned to category")
    
    # Update channel position
    print("\nTest 1.5: Updating channel position...")
    assert db.update_channel_position("channel_1", 5), "Failed to update channel position"
    channels = db.get_server_channels("test_server_1")
    channel = next((c for c in channels if c['channel_id'] == "channel_1"), None)
    assert channel.get('position') == 5, "Channel position not updated"
    print("✓ Channel position updated")
    
    # Delete category
    print("\nTest 1.6: Deleting category...")
    assert db.delete_category("cat_2"), "Failed to delete category"
    categories = db.get_server_categories("test_server_1")
    assert len(categories) == 1, f"Expected 1 category after deletion, got {len(categories)}"
    print("✓ Category deleted")
    
    # Test 2: Role Hierarchy
    print("\n" + "=" * 50)
    print("Test 2: Role Hierarchy")
    print("=" * 50)
    
    # Create roles with different positions
    print("\nTest 2.1: Creating roles with hierarchy...")
    db.create_role("role_admin", "test_server_1", "Admin", "#FF0000", 100, {
        'kick_members': True,
        'ban_members': True,
        'timeout_members': True,
        'manage_roles': True,
        'manage_channels': True,
        'view_audit_log': True
    })
    db.create_role("role_mod", "test_server_1", "Moderator", "#00FF00", 50, {
        'kick_members': True,
        'timeout_members': True
    })
    db.create_role("role_member", "test_server_1", "Member", "#0000FF", 10, {})
    print("✓ Roles created with hierarchy")
    
    # Assign roles to users
    print("\nTest 2.2: Assigning roles to users...")
    db.assign_role("test_server_1", "moderator_user", "role_mod")
    db.assign_role("test_server_1", "regular_user", "role_member")
    db.assign_role("test_server_1", "target_user", "role_member")
    print("✓ Roles assigned")
    
    # Verify role positions
    print("\nTest 2.3: Verifying role hierarchy...")
    from server import get_highest_role_position, can_moderate_user
    
    # Load module dynamically to access functions
    import importlib.util
    spec = importlib.util.spec_from_file_location("server", os.path.join(os.path.dirname(__file__), '..', 'server', 'server.py'))
    server_module = importlib.util.module_from_spec(spec)
    
    # Test role positions
    roles = db.get_server_roles("test_server_1")
    admin_role = next((r for r in roles if r['name'] == "Admin"), None)
    mod_role = next((r for r in roles if r['name'] == "Moderator"), None)
    member_role = next((r for r in roles if r['name'] == "Member"), None)
    
    assert admin_role['position'] == 100, "Admin role position incorrect"
    assert mod_role['position'] == 50, "Moderator role position incorrect"
    assert member_role['position'] == 10, "Member role position incorrect"
    print("✓ Role hierarchy verified")
    
    # Test 3: Moderation Actions
    print("\n" + "=" * 50)
    print("Test 3: Moderation Actions")
    print("=" * 50)
    
    # Test kick
    print("\nTest 3.1: Testing kick functionality...")
    kick_id = db.create_moderation_action(
        "test_server_1", "kick", "target_user", "moderator_user",
        "Breaking server rules"
    )
    assert kick_id is not None, "Failed to create kick action"
    print(f"✓ Kick action created with ID: {kick_id}")
    
    # Verify kick action
    actions = db.get_active_moderation_actions("test_server_1", "target_user", "kick")
    assert len(actions) == 1, f"Expected 1 active kick action, got {len(actions)}"
    assert actions[0]['reason'] == "Breaking server rules", "Kick reason mismatch"
    print("✓ Kick action verified")
    
    # Test ban
    print("\nTest 3.2: Testing ban functionality...")
    ban_id = db.create_moderation_action(
        "test_server_1", "ban", "target_user", "moderator_user",
        "Repeated violations"
    )
    assert ban_id is not None, "Failed to create ban action"
    
    # Check if user is banned
    assert db.is_user_banned("test_server_1", "target_user"), "User should be banned"
    print("✓ Ban action created and verified")
    
    # Test unban
    print("\nTest 3.3: Testing unban functionality...")
    db.deactivate_moderation_actions_by_type("test_server_1", "target_user", "ban")
    assert not db.is_user_banned("test_server_1", "target_user"), "User should not be banned after unban"
    print("✓ Unban action verified")
    
    # Test timeout
    print("\nTest 3.4: Testing timeout functionality...")
    expires_at = datetime.now() + timedelta(minutes=10)
    timeout_id = db.create_moderation_action(
        "test_server_1", "timeout", "target_user", "moderator_user",
        "Spamming", expires_at
    )
    assert timeout_id is not None, "Failed to create timeout action"
    
    # Check if user is timed out
    assert db.is_user_timed_out("test_server_1", "target_user"), "User should be timed out"
    print("✓ Timeout action created and verified")
    
    # Test expired timeout
    print("\nTest 3.5: Testing expired timeout...")
    # Create a timeout that has already expired
    expired_time = datetime.now() - timedelta(minutes=1)
    expired_timeout_id = db.create_moderation_action(
        "test_server_1", "timeout", "regular_user", "moderator_user",
        "Test expired timeout", expired_time
    )
    assert not db.is_user_timed_out("test_server_1", "regular_user"), "Expired timeout should not be active"
    print("✓ Expired timeout correctly identified as inactive")
    
    # Remove timeout
    print("\nTest 3.6: Testing remove timeout...")
    db.deactivate_moderation_actions_by_type("test_server_1", "target_user", "timeout")
    assert not db.is_user_timed_out("test_server_1", "target_user"), "User should not be timed out after removal"
    print("✓ Timeout removal verified")
    
    # Get all moderation actions
    print("\nTest 3.7: Retrieving all moderation actions...")
    all_actions = db.get_server_moderation_actions("test_server_1", 100)
    assert len(all_actions) >= 4, f"Expected at least 4 moderation actions, got {len(all_actions)}"
    print(f"✓ Retrieved {len(all_actions)} moderation actions")
    
    # Test 4: Audit Logs
    print("\n" + "=" * 50)
    print("Test 4: Audit Logs")
    print("=" * 50)
    
    # Create audit log entries
    print("\nTest 4.1: Creating audit log entries...")
    log_id_1 = db.create_audit_log(
        "test_server_1", "member_kick", "moderator_user",
        "user", "target_user",
        {'reason': 'Test kick'}
    )
    log_id_2 = db.create_audit_log(
        "test_server_1", "member_ban", "moderator_user",
        "user", "target_user",
        {'reason': 'Test ban'}
    )
    log_id_3 = db.create_audit_log(
        "test_server_1", "category_create", "admin_user",
        "category", "cat_1",
        {'name': 'Test Category'}
    )
    
    assert log_id_1 is not None, "Failed to create audit log 1"
    assert log_id_2 is not None, "Failed to create audit log 2"
    assert log_id_3 is not None, "Failed to create audit log 3"
    print(f"✓ Created {3} audit log entries")
    
    # Retrieve all audit logs
    print("\nTest 4.2: Retrieving all audit logs...")
    logs = db.get_audit_logs("test_server_1", 100)
    assert len(logs) >= 3, f"Expected at least 3 audit logs, got {len(logs)}"
    print(f"✓ Retrieved {len(logs)} audit logs")
    
    # Retrieve filtered audit logs
    print("\nTest 4.3: Retrieving filtered audit logs...")
    kick_logs = db.get_audit_logs("test_server_1", 100, "member_kick")
    assert len(kick_logs) >= 1, f"Expected at least 1 kick log, got {len(kick_logs)}"
    assert kick_logs[0]['action_type'] == "member_kick", "Log action type mismatch"
    print(f"✓ Retrieved {len(kick_logs)} kick logs")
    
    # Verify log details
    print("\nTest 4.4: Verifying log details...")
    log = logs[0]  # Most recent log
    assert 'log_id' in log, "Log missing log_id"
    assert 'server_id' in log, "Log missing server_id"
    assert 'action_type' in log, "Log missing action_type"
    assert 'actor_username' in log, "Log missing actor_username"
    assert 'created_at' in log, "Log missing created_at"
    print("✓ Audit log structure verified")
    
    # Test 5: Server Member Removal
    print("\n" + "=" * 50)
    print("Test 5: Server Member Removal")
    print("=" * 50)
    
    print("\nTest 5.1: Removing server member...")
    initial_members = db.get_server_members("test_server_1")
    initial_count = len(initial_members)
    
    # Add a new member to remove
    db.create_user("temp_user", hash_password("temppass"))
    db.add_server_member("test_server_1", "temp_user")
    
    # Verify member was added
    members_after_add = db.get_server_members("test_server_1")
    assert len(members_after_add) == initial_count + 1, "Member not added"
    
    # Remove the member
    assert db.remove_server_member("test_server_1", "temp_user"), "Failed to remove member"
    
    # Verify member was removed
    members_after_remove = db.get_server_members("test_server_1")
    assert len(members_after_remove) == initial_count, "Member not removed"
    member_usernames = {m['username'] for m in members_after_remove}
    assert "temp_user" not in member_usernames, "Removed member still in server"
    print("✓ Server member removal verified")
    
    print("\n" + "=" * 50)
    print("All Server Management Tests Passed! ✓")
    print("=" * 50)
    
if __name__ == "__main__":
    try:
        test_server_management()
        sys.exit(0)
    except AssertionError as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
