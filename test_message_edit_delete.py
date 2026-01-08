#!/usr/bin/env python3
"""
Test script to verify message edit and delete functionality
"""

import os
import sys
import random
import string

# Set test encryption key before importing modules that need it
if 'DECENTRA_ENCRYPTION_KEY' not in os.environ:
    os.environ['DECENTRA_ENCRYPTION_KEY'] = 'test-encryption-key-for-edit-delete-tests'

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'server'))

from database import Database
import bcrypt

def hash_password(password):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def generate_unique_suffix():
    """Generate a unique suffix for test data to avoid conflicts."""
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))

def cleanup_test_data(db, usernames, server_ids):
    """Clean up test data from the database."""
    print("\nCleaning up test data...")
    try:
        with db.get_connection() as conn:
            cursor = conn.cursor()
            
            # Delete messages for test servers (using exact prefix match with escape)
            for server_id in server_ids:
                # Escape special characters and match server_id followed by /
                cursor.execute("DELETE FROM messages WHERE context_id = %s OR context_id LIKE %s", 
                              (server_id, server_id + '/%'))
            
            # Delete servers (cascades to channels and server_members)
            for server_id in server_ids:
                cursor.execute('DELETE FROM servers WHERE server_id = %s', (server_id,))
            
            # Delete users (cascades to related data)
            for username in usernames:
                cursor.execute('DELETE FROM users WHERE username = %s', (username,))
            
            conn.commit()
        print("✓ Test data cleaned up")
    except Exception as e:
        print(f"⚠ Cleanup warning: {e}")

def test_message_edit_delete():
    print("Testing Message Edit and Delete Functionality")
    print("=" * 50)
    
    # Use PostgreSQL test database
    test_db_url = os.getenv('TEST_DATABASE_URL', 'postgresql://decentra:decentra@localhost:5432/decentra_test')
    
    db = Database(test_db_url)
    print("✓ Database created successfully")
    
    # Generate unique identifiers for this test run
    suffix = generate_unique_suffix()
    alice_username = f"alice_{suffix}"
    bob_username = f"bob_{suffix}"
    server_id = f"server_{suffix}"
    channel_id = f"channel_{suffix}"
    
    usernames = [alice_username, bob_username]
    server_ids = [server_id]
    
    try:
        # Create test users
        print("\nTest 1: Creating test users...")
        assert db.create_user(alice_username, hash_password("password123")), "Failed to create alice"
        assert db.create_user(bob_username, hash_password("password456")), "Failed to create bob"
        print("✓ Test users created")
        
        # Create server and channel for testing
        print("\nTest 2: Creating server and channel...")
        assert db.create_server(server_id, "Test Server", alice_username), "Failed to create server"
        assert db.create_channel(channel_id, server_id, "general", "text"), "Failed to create channel"
        assert db.add_server_member(server_id, bob_username), "Failed to add bob to server"
        print("✓ Server and channel created")
        
        # Test message creation with ID
        print("\nTest 3: Creating a message...")
        message_id = db.save_message(alice_username, "Hello, world!", "server", f"{server_id}/{channel_id}")
        assert message_id is not None, "Failed to create message"
        assert isinstance(message_id, int), "Message ID should be an integer"
        print(f"✓ Message created with ID: {message_id}")
        
        # Test message retrieval
        print("\nTest 4: Retrieving message...")
        message = db.get_message(message_id)
        assert message is not None, "Failed to retrieve message"
        assert message['content'] == "Hello, world!", "Message content doesn't match"
        assert message['username'] == alice_username, "Message username doesn't match"
        assert message['edited_at'] is None, "Message shouldn't be edited yet"
        assert message['deleted'] == False, "Message shouldn't be deleted yet"
        print("✓ Message retrieved successfully")
        
        # Test message editing
        print("\nTest 5: Editing message...")
        assert db.edit_message(message_id, "Hello, edited world!"), "Failed to edit message"
        edited_message = db.get_message(message_id)
        assert edited_message is not None, "Failed to retrieve edited message"
        assert edited_message['content'] == "Hello, edited world!", "Edited content doesn't match"
        assert edited_message['edited_at'] is not None, "Message should have edited_at timestamp"
        print("✓ Message edited successfully")
        
        # Test message deletion
        print("\nTest 6: Deleting message...")
        assert db.delete_message(message_id), "Failed to delete message"
        deleted_message = db.get_message(message_id)
        assert deleted_message is not None, "Deleted message should still exist"
        assert deleted_message['deleted'] == True, "Message should be marked as deleted"
        assert deleted_message['content'] == "[Message deleted]", "Deleted message content should be placeholder"
        print("✓ Message deleted successfully")
        
        # Test editing deleted message (should fail)
        print("\nTest 7: Attempting to edit deleted message...")
        result = db.edit_message(message_id, "This should not work")
        assert result == False, "Editing a deleted message should fail"
        print("✓ Editing deleted message correctly blocked")
        
        # Test member permissions
        print("\nTest 8: Testing member permissions...")
        members = db.get_server_members(server_id)
        assert len(members) == 2, "Should have 2 members"
        
        # Find bob's permissions
        bob_member = next((m for m in members if m['username'] == bob_username), None)
        assert bob_member is not None, "Bob should be a member"
        assert 'can_edit_messages' in bob_member, "Member should have can_edit_messages field"
        assert 'can_delete_messages' in bob_member, "Member should have can_delete_messages field"
        assert bob_member['can_edit_messages'] == False, "Bob shouldn't have edit permission by default"
        assert bob_member['can_delete_messages'] == False, "Bob shouldn't have delete permission by default"
        print("✓ Member permissions initialized correctly")
        
        # Test updating member permissions
        print("\nTest 9: Updating member permissions...")
        db.update_member_permissions(server_id, bob_username, {
            'can_create_channel': False,
            'can_edit_channel': False,
            'can_delete_channel': False,
            'can_edit_messages': True,
            'can_delete_messages': True
        })
        members = db.get_server_members(server_id)
        bob_member = next((m for m in members if m['username'] == bob_username), None)
        assert bob_member['can_edit_messages'] == True, "Bob should have edit permission"
        assert bob_member['can_delete_messages'] == True, "Bob should have delete permission"
        print("✓ Member permissions updated successfully")
        
        # Test message history with edited/deleted flags
        print("\nTest 10: Testing message history with edited/deleted flags...")
        message_id2 = db.save_message(bob_username, "Another message", "server", f"{server_id}/{channel_id}")
        db.edit_message(message_id2, "Edited by Bob")
        
        messages = db.get_messages("server", f"{server_id}/{channel_id}", 100)
        assert len(messages) == 2, "Should have 2 messages in history"
        
        # Find the messages
        msg1 = next((m for m in messages if m['id'] == message_id), None)
        msg2 = next((m for m in messages if m['id'] == message_id2), None)
        
        assert msg1 is not None, "First message should be in history"
        assert msg1['deleted'] == True, "First message should be marked as deleted"
        
        assert msg2 is not None, "Second message should be in history"
        assert msg2['content'] == "Edited by Bob", "Second message should have edited content"
        assert msg2['edited_at'] is not None, "Second message should have edited_at timestamp"
        print("✓ Message history includes edited/deleted flags")
        
        print("\n" + "=" * 50)
        print("All tests passed successfully! ✓")
        print("=" * 50)
        
    finally:
        # Clean up test data
        cleanup_test_data(db, usernames, server_ids)

if __name__ == "__main__":
    try:
        test_message_edit_delete()
    except AssertionError as e:
        print(f"\n✗ Test failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
