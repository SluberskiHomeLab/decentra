#!/usr/bin/env python3
"""
Test script to verify message encryption in database
"""

import os
import sys

# Set test encryption key before importing modules that need it
if 'DECENTRA_ENCRYPTION_KEY' not in os.environ:
    os.environ['DECENTRA_ENCRYPTION_KEY'] = 'test-encryption-key-for-message-encryption-tests'

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from database import Database
from encryption_utils import get_encryption_manager
import bcrypt

def hash_password(password):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def test_message_encryption():
    print("Testing Message Encryption")
    print("=" * 50)
    
    # Use PostgreSQL test database
    test_db_url = os.getenv('TEST_DATABASE_URL', 'postgresql://decentra:decentra@localhost:5432/decentra_test')
    
    db = Database(test_db_url)
    print("✓ Database created successfully")
    
    # Create test users
    print("\nTest 1: Creating test users...")
    assert db.create_user("alice", hash_password("password123")), "Failed to create alice"
    assert db.create_user("bob", hash_password("password456")), "Failed to create bob"
    print("✓ Test users created")
    
    # Create server and channel for testing
    print("\nTest 2: Creating server and channel...")
    assert db.create_server("server_1", "Test Server", "alice"), "Failed to create server"
    assert db.create_channel("channel_1", "server_1", "general", "text"), "Failed to create channel"
    assert db.add_server_member("server_1", "bob"), "Failed to add bob to server"
    print("✓ Server and channel created")
    
    # Create DM for testing
    print("\nTest 3: Creating DM...")
    assert db.add_friend_request("alice", "bob"), "Failed to add friend request"
    assert db.accept_friend_request("alice", "bob"), "Failed to accept friend request"
    assert db.create_dm("dm_1", "alice", "bob"), "Failed to create DM"
    print("✓ DM created")
    
    # Test 4: Save and retrieve encrypted DM messages
    print("\nTest 4: Testing DM message encryption...")
    test_message_dm = "This is a secret DM message that should be encrypted!"
    msg_id = db.save_message("alice", test_message_dm, "dm", "dm_1")
    assert msg_id > 0, "Failed to save DM message"
    print(f"✓ DM message saved with ID {msg_id}")
    
    # Verify message is encrypted in database
    encryption_manager = get_encryption_manager()
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT content FROM messages WHERE id = %s', (msg_id,))
        result = cursor.fetchone()
        stored_content = result['content']
        
        # The stored content should NOT be the plain text
        assert stored_content != test_message_dm, "Message not encrypted in database!"
        print(f"✓ Message is encrypted in database (not plain text)")
        
        # The stored content should be decryptable
        decrypted = encryption_manager.decrypt(stored_content)
        assert decrypted == test_message_dm, "Failed to decrypt message"
        print(f"✓ Encrypted message can be decrypted correctly")
    
    # Retrieve messages through get_messages (should auto-decrypt)
    messages = db.get_messages("dm", "dm_1", 10)
    assert len(messages) == 1, "DM message not found"
    assert messages[0]['content'] == test_message_dm, "Decrypted message content mismatch"
    print(f"✓ get_messages returns decrypted content: '{messages[0]['content']}'")
    
    # Test 5: Save and retrieve encrypted server messages
    print("\nTest 5: Testing server message encryption...")
    test_message_server = "This is a server message that should be encrypted!"
    msg_id = db.save_message("bob", test_message_server, "server", "server_1/channel_1")
    assert msg_id > 0, "Failed to save server message"
    print(f"✓ Server message saved with ID {msg_id}")
    
    # Verify message is encrypted in database
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT content FROM messages WHERE id = %s', (msg_id,))
        result = cursor.fetchone()
        stored_content = result['content']
        
        # The stored content should NOT be the plain text
        assert stored_content != test_message_server, "Server message not encrypted in database!"
        print(f"✓ Server message is encrypted in database")
        
        # The stored content should be decryptable
        decrypted = encryption_manager.decrypt(stored_content)
        assert decrypted == test_message_server, "Failed to decrypt server message"
        print(f"✓ Encrypted server message can be decrypted correctly")
    
    # Retrieve messages through get_messages
    messages = db.get_messages("server", "server_1/channel_1", 10)
    assert len(messages) == 1, "Server message not found"
    assert messages[0]['content'] == test_message_server, "Decrypted server message content mismatch"
    print(f"✓ get_messages returns decrypted server content: '{messages[0]['content']}'")
    
    # Test 6: Verify new user can read server message history
    print("\nTest 6: Testing new user can read server message history...")
    # Add more messages to the server channel
    db.save_message("alice", "First message", "server", "server_1/channel_1")
    db.save_message("bob", "Second message", "server", "server_1/channel_1")
    db.save_message("alice", "Third message", "server", "server_1/channel_1")
    
    # Create a new user and add them to the server
    assert db.create_user("charlie", hash_password("password789")), "Failed to create charlie"
    assert db.add_server_member("server_1", "charlie"), "Failed to add charlie to server"
    print("✓ New user 'charlie' added to server")
    
    # Charlie should be able to read all message history
    messages = db.get_messages("server", "server_1/channel_1", 100)
    assert len(messages) >= 4, "Not all messages retrieved"
    
    # Verify all messages are decrypted correctly
    expected_messages = [
        test_message_server,
        "First message",
        "Second message",
        "Third message"
    ]
    for i, expected in enumerate(expected_messages):
        assert messages[i]['content'] == expected, f"Message {i} content mismatch"
    print(f"✓ New user can read all {len(messages)} encrypted messages in server history")
    
    # Test 7: Test multiple DM messages
    print("\nTest 7: Testing multiple encrypted DM messages...")
    db.save_message("alice", "Hey Bob!", "dm", "dm_1")
    db.save_message("bob", "Hi Alice!", "dm", "dm_1")
    db.save_message("alice", "How are you?", "dm", "dm_1")
    
    dm_messages = db.get_messages("dm", "dm_1", 100)
    assert len(dm_messages) >= 4, "Not all DM messages retrieved"
    
    # Verify the last 3 messages are correct
    expected_dm_messages = [
        "Hey Bob!",
        "Hi Alice!",
        "How are you?"
    ]
    last_three_messages = dm_messages[-3:]
    for i, expected in enumerate(expected_dm_messages):
        assert last_three_messages[i]['content'] == expected, f"DM message {i} content mismatch"
    print(f"✓ All {len(dm_messages)} DM messages encrypted and decrypted correctly")
    
    # Test 8: Test special characters and unicode
    print("\nTest 8: Testing encryption with special characters and unicode...")
    special_message = "Hello! 👋 This has émojis 🎉 and spëcial çharacters: !@#$%^&*()_+-=[]{}|;:',.<>?/~`"
    db.save_message("alice", special_message, "dm", "dm_1")
    
    messages = db.get_messages("dm", "dm_1", 1)
    assert messages[0]['content'] == special_message, "Special characters not handled correctly"
    print(f"✓ Special characters and unicode encrypted/decrypted correctly")
    
    # Test 9: Test empty and whitespace messages
    print("\nTest 9: Testing edge cases...")
    edge_cases = [
        "",  # Empty string
        " ",  # Single space
        "   ",  # Multiple spaces
        "\n",  # Newline
        "\t",  # Tab
    ]
    
    for edge_case in edge_cases:
        db.save_message("alice", edge_case, "dm", "dm_1")
        messages = db.get_messages("dm", "dm_1", 1)
        assert messages[0]['content'] == edge_case, f"Edge case '{repr(edge_case)}' not handled correctly"
    print(f"✓ Edge cases (empty, whitespace) handled correctly")
    
    print("\n" + "=" * 50)
    print("All encryption tests passed! ✓")
    print("Messages are properly encrypted in database and decrypted on retrieval.")
    print("New users can read server message history as expected.")

if __name__ == "__main__":
    test_message_encryption()
