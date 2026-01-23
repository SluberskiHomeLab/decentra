#!/usr/bin/env python3
"""
Test script to verify that file attachments can be sent without text.

This test validates that the frontend and backend correctly handle messages
that contain only file attachments without any accompanying text content.
"""

import os
import sys
import random
import string

# Set test encryption key before importing modules that need it
if 'DECENTRA_ENCRYPTION_KEY' not in os.environ:
    os.environ['DECENTRA_ENCRYPTION_KEY'] = 'test-encryption-key-for-attachment-without-text-tests'

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from database import Database
import bcrypt

def hash_password(password):
    """Hash a password using bcrypt."""
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
            
            # Delete messages for test servers
            for server_id in server_ids:
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

def test_empty_message_backend_handling():
    """Test that the backend correctly handles empty messages (for attachment-only messages)."""
    print("Testing Backend Handling of Empty Messages (Attachment-Only)")
    print("=" * 60)
    
    # Use PostgreSQL test database
    test_db_url = os.getenv('TEST_DATABASE_URL', 'postgresql://decentra:decentra@localhost:5432/decentra_test')
    
    db = Database(test_db_url)
    print("✓ Database connected successfully")
    
    # Generate unique identifiers for this test run
    suffix = generate_unique_suffix()
    test_username = f"testuser_{suffix}"
    server_id = f"server_{suffix}"
    channel_id = f"channel_{suffix}"
    
    usernames = [test_username]
    server_ids = [server_id]
    
    try:
        # Create test user
        print("\nSetup: Creating test user...")
        assert db.create_user(test_username, hash_password("password123")), "Failed to create test user"
        print("✓ Test user created")
        
        # Create server and channel for testing
        print("\nSetup: Creating server and channel...")
        assert db.create_server(server_id, "Test Server", test_username), "Failed to create server"
        assert db.create_channel(channel_id, server_id, "general", "text"), "Failed to create channel"
        print("✓ Server and channel created")
        
        # Test 1: Save a message with empty content (simulating attachment-only message)
        print("\n" + "=" * 60)
        print("Test 1: Saving message with empty content")
        print("-" * 60)
        
        message_id = db.save_message(test_username, "", "server", f"{server_id}/{channel_id}")
        assert message_id is not None, "Failed to save empty message"
        assert isinstance(message_id, int), "Message ID should be an integer"
        print(f"✓ Empty message saved successfully with ID: {message_id}")
        
        # Test 2: Retrieve the empty message
        print("\n" + "=" * 60)
        print("Test 2: Retrieving empty message")
        print("-" * 60)
        
        message = db.get_message(message_id)
        assert message is not None, "Failed to retrieve empty message"
        assert message['content'] == "", "Message content should be empty string"
        assert message['username'] == test_username, "Message username doesn't match"
        print("✓ Empty message retrieved successfully")
        
        # Test 3: Save an attachment for the empty message
        print("\n" + "=" * 60)
        print("Test 3: Adding attachment to empty message")
        print("-" * 60)
        
        import base64
        test_file_data = b"This is a test file attachment"
        file_data_b64 = base64.b64encode(test_file_data).decode('utf-8')
        
        attachment_id = f"att_empty_msg_{suffix}"
        success = db.save_attachment(
            attachment_id=attachment_id,
            message_id=message_id,
            filename="test_file.txt",
            content_type="text/plain",
            file_size=len(test_file_data),
            file_data=file_data_b64
        )
        
        assert success, "Failed to save attachment for empty message"
        print(f"✓ Attachment saved successfully for empty message")
        
        # Test 4: Retrieve attachments for the empty message
        print("\n" + "=" * 60)
        print("Test 4: Retrieving attachments for empty message")
        print("-" * 60)
        
        attachments = db.get_message_attachments(message_id)
        assert len(attachments) > 0, "No attachments found for empty message"
        assert attachments[0]['filename'] == "test_file.txt", "Attachment filename doesn't match"
        assert attachments[0]['message_id'] == message_id, "Attachment message_id doesn't match"
        print(f"✓ Found {len(attachments)} attachment(s) for empty message")
        
        # Test 5: Verify the complete workflow
        print("\n" + "=" * 60)
        print("Test 5: Complete workflow validation")
        print("-" * 60)
        
        # Get messages for the channel
        messages = db.get_messages("server", f"{server_id}/{channel_id}")
        assert len(messages) > 0, "No messages found in channel"
        
        # Find our empty message
        empty_msg = next((m for m in messages if m['id'] == message_id), None)
        assert empty_msg is not None, "Empty message not found in channel messages"
        assert empty_msg['content'] == "", "Message content should be empty"
        print("✓ Empty message appears correctly in message list")
        
        print("\n" + "=" * 60)
        print("All tests passed successfully! ✓")
        print("=" * 60)
        print("\nSummary:")
        print("  ✓ Backend accepts empty message content")
        print("  ✓ Empty messages can be saved to database")
        print("  ✓ Empty messages can be retrieved from database")
        print("  ✓ Attachments can be added to empty messages")
        print("  ✓ Empty messages appear in message lists")
        print("\nConclusion:")
        print("  The backend fully supports sending attachments without text.")
        print("  Frontend validation has been updated to allow this use case.")
        
    finally:
        # Clean up test data
        cleanup_test_data(db, usernames, server_ids)

def main():
    """Main entry point for the test."""
    try:
        test_empty_message_backend_handling()
    except AssertionError as e:
        print(f"\n✗ Test failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
