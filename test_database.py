#!/usr/bin/env python3
"""
Simple test script to verify database persistence
"""

import os
import sys
import tempfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'server'))

from database import Database
import bcrypt

def hash_password(password):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def test_database():
    print("Testing Decentra Database Persistence")
    print("=" * 50)
    
    # Use PostgreSQL test database
    db_url = os.getenv('TEST_DATABASE_URL', 'postgresql://decentra:decentra@localhost:5432/decentra_test')
    
    db = Database(db_url)
    print("✓ Database created successfully")
    
    # Test 1: Create users
    print("\nTest 1: Creating users...")
    assert db.create_user("alice", hash_password("password123")), "Failed to create alice"
    assert db.create_user("bob", hash_password("password456")), "Failed to create bob"
    print("✓ Users created")
    
    # Test 2: Retrieve users
    print("\nTest 2: Retrieving users...")
    alice = db.get_user("alice")
    assert alice is not None, "Failed to retrieve alice"
    assert alice['username'] == "alice", "Username mismatch"
    print(f"✓ Retrieved user: {alice['username']}")
    
    # Test 3: Create server
    print("\nTest 3: Creating server...")
    assert db.create_server("server_1", "Test Server", "alice"), "Failed to create server"
    server = db.get_server("server_1")
    assert server['name'] == "Test Server", "Server name mismatch"
    assert server['owner'] == "alice", "Server owner mismatch"
    print(f"✓ Created server: {server['name']}")
    
    # Test 4: Create channel
    print("\nTest 4: Creating channel...")
    assert db.create_channel("channel_1", "server_1", "general", "text"), "Failed to create channel"
    channels = db.get_server_channels("server_1")
    assert len(channels) >= 1, "Channel not found"
    assert channels[0]['name'] == "general", "Channel name mismatch"
    print(f"✓ Created channel: {channels[0]['name']}")
    
    # Test 5: Add friend request
    print("\nTest 5: Testing friend system...")
    assert db.add_friend_request("alice", "bob"), "Failed to add friend request"
    requests = db.get_friend_requests_received("bob")
    assert "alice" in requests, "Friend request not found"
    print("✓ Friend request sent")
    
    # Test 6: Accept friend request
    assert db.accept_friend_request("alice", "bob"), "Failed to accept friend request"
    friends = db.get_friends("alice")
    assert "bob" in friends, "Bob not in alice's friends"
    friends = db.get_friends("bob")
    assert "alice" in friends, "Alice not in bob's friends"
    print("✓ Friend request accepted")
    
    # Test 7: Create direct message
    print("\nTest 7: Creating direct message...")
    assert db.create_dm("dm_1", "alice", "bob"), "Failed to create DM"
    dm_id = db.get_dm("alice", "bob")
    assert dm_id == "dm_1", "DM ID mismatch"
    print("✓ Direct message created")
    
    # Test 8: Save and retrieve messages
    print("\nTest 8: Saving and retrieving messages...")
    msg_id = db.save_message("alice", "Hello, Bob!", "dm", "dm_1")
    assert msg_id > 0, "Failed to save message"
    messages = db.get_messages("dm", "dm_1", 10)
    assert len(messages) == 1, "Message not found"
    assert messages[0]['content'] == "Hello, Bob!", "Message content mismatch"
    print(f"✓ Message saved and retrieved: '{messages[0]['content']}'")
    
    # Test 9: Create invite code
    print("\nTest 9: Creating invite code...")
    assert db.create_invite_code("ABC123", "alice", "global"), "Failed to create invite code"
    invite = db.get_invite_code("ABC123")
    assert invite is not None, "Invite code not found"
    assert invite['creator'] == "alice", "Invite creator mismatch"
    print("✓ Invite code created")
    
    # Test 10: Delete invite code
    print("\nTest 10: Deleting invite code...")
    db.delete_invite_code("ABC123")
    invite = db.get_invite_code("ABC123")
    assert invite is None, "Invite code not deleted"
    print("✓ Invite code deleted")
    
    # Test 11: Update server name
    print("\nTest 11: Updating server name...")
    db.update_server_name("server_1", "Updated Server")
    server = db.get_server("server_1")
    assert server['name'] == "Updated Server", "Server name not updated"
    print(f"✓ Server name updated to: {server['name']}")
    
    # Test 12: Server members and permissions
    print("\nTest 12: Testing server members and permissions...")
    assert db.add_server_member("server_1", "bob"), "Failed to add server member"
    members = db.get_server_members("server_1")
    member_usernames = [m['username'] for m in members]
    assert "bob" in member_usernames, "Bob not in server members"
    print("✓ Server member added")
    
    # Update permissions
    db.update_member_permissions("server_1", "bob", {
        'can_create_channel': True,
        'can_edit_channel': False,
        'can_delete_channel': False
    })
    members = db.get_server_members("server_1")
    bob_member = [m for m in members if m['username'] == "bob"][0]
    assert bob_member['can_create_channel'] == 1, "Permission not updated"
    print("✓ Member permissions updated")
    
    # Test 13: Update notification mode
    print("\nTest 13: Testing notification mode...")
    # Default should be 'all'
    alice = db.get_user("alice")
    assert alice['notification_mode'] == 'all', "Default notification mode should be 'all'"
    print("✓ Default notification mode is 'all'")
    
    # Update to 'mentions'
    db.update_notification_mode("alice", "mentions")
    alice = db.get_user("alice")
    assert alice['notification_mode'] == 'mentions', "Notification mode not updated to 'mentions'"
    print("✓ Notification mode updated to 'mentions'")
    
    # Update to 'none'
    db.update_notification_mode("alice", "none")
    alice = db.get_user("alice")
    assert alice['notification_mode'] == 'none', "Notification mode not updated to 'none'"
    print("✓ Notification mode updated to 'none'")
    
    # Update back to 'all'
    db.update_notification_mode("alice", "all")
    alice = db.get_user("alice")
    assert alice['notification_mode'] == 'all', "Notification mode not updated back to 'all'"
    print("✓ Notification mode updated back to 'all'")
    
    # Test 14: Persistence check - close and reopen database
    print("\nTest 14: Testing persistence...")
    del db  # Close database
    db = Database(db_url)  # Reopen
    
    # Verify data persists
    alice = db.get_user("alice")
    assert alice is not None, "User data lost after restart"
    assert alice['notification_mode'] == 'all', "Notification mode not persisted"
    server = db.get_server("server_1")
    assert server is not None, "Server data lost after restart"
    friends = db.get_friends("alice")
    assert "bob" in friends, "Friend data lost after restart"
    messages = db.get_messages("dm", "dm_1", 10)
    assert len(messages) == 1, "Message data lost after restart"
    print("✓ All data persisted successfully after database restart")
    
    print("\n" + "=" * 50)
    print("All tests passed! ✓")
    print("Database persistence is working correctly.")
    
if __name__ == "__main__":
    test_database()
