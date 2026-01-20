#!/usr/bin/env python3
"""
Test script to verify custom emoji and message reaction functionality
"""

import os
import sys

# Set test encryption key before importing modules that need it
if 'DECENTRA_ENCRYPTION_KEY' not in os.environ:
    os.environ['DECENTRA_ENCRYPTION_KEY'] = 'test-encryption-key-for-emoji-reaction-tests'

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from database import Database
import bcrypt

def hash_password(password):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def test_custom_emojis_and_reactions():
    print("Testing Custom Emojis and Message Reactions")
    print("=" * 50)
    
    # Use PostgreSQL test database
    test_db_url = os.getenv('TEST_DATABASE_URL', 'postgresql://decentra:decentra@localhost:5432/decentra_test')
    
    db = Database(test_db_url)
    print("✓ Database created successfully")
    
    # Create test users
    print("\nTest 1: Creating test users...")
    assert db.create_user("alice", hash_password("password123")), "Failed to create alice"
    assert db.create_user("bob", hash_password("password456")), "Failed to create bob"
    assert db.create_user("charlie", hash_password("password789")), "Failed to create charlie"
    print("✓ Test users created")
    
    # Create server and channel for testing
    print("\nTest 2: Creating server and channel...")
    assert db.create_server("server_1", "Test Server", "alice"), "Failed to create server"
    assert db.create_channel("channel_1", "server_1", "general", "text"), "Failed to create channel"
    assert db.add_server_member("server_1", "bob"), "Failed to add bob to server"
    assert db.add_server_member("server_1", "charlie"), "Failed to add charlie to server"
    print("✓ Server and channel created")
    
    # Test 3: Create custom emojis
    print("\nTest 3: Testing custom emoji creation...")
    
    # Create a simple base64 encoded test image (1x1 red pixel PNG)
    # This is a minimal valid PNG image for testing purposes
    TEST_IMAGE_DATA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    
    # Alice uploads an emoji
    success = db.create_custom_emoji("emoji_1", "server_1", "happy_cat", TEST_IMAGE_DATA, "alice")
    assert success, "Failed to create custom emoji"
    print("✓ Custom emoji 'happy_cat' created by alice")
    
    # Bob uploads another emoji
    success = db.create_custom_emoji("emoji_2", "server_1", "party", TEST_IMAGE_DATA, "bob")
    assert success, "Failed to create second custom emoji"
    print("✓ Custom emoji 'party' created by bob")
    
    # Test duplicate emoji name (should fail)
    success = db.create_custom_emoji("emoji_3", "server_1", "happy_cat", TEST_IMAGE_DATA, "charlie")
    assert not success, "Duplicate emoji name should have failed"
    print("✓ Duplicate emoji name correctly rejected")
    
    # Test 4: Retrieve custom emojis
    print("\nTest 4: Testing custom emoji retrieval...")
    emojis = db.get_server_emojis("server_1")
    assert len(emojis) == 2, f"Expected 2 emojis, got {len(emojis)}"
    print(f"✓ Retrieved {len(emojis)} custom emojis")
    
    # Verify emoji data
    emoji_names = {e['name'] for e in emojis}
    assert 'happy_cat' in emoji_names, "happy_cat emoji not found"
    assert 'party' in emoji_names, "party emoji not found"
    print("✓ Emoji data correct")
    
    # Get specific emoji
    emoji = db.get_custom_emoji("emoji_1")
    assert emoji is not None, "Failed to get specific emoji"
    assert emoji['name'] == "happy_cat", "Emoji name mismatch"
    assert emoji['uploader'] == "alice", "Emoji uploader mismatch"
    print("✓ Individual emoji retrieval works")
    
    # Test 5: Create messages for reaction testing
    print("\nTest 5: Creating test messages...")
    msg_id_1 = db.save_message("alice", "Hello everyone!", "server", "server_1/channel_1")
    msg_id_2 = db.save_message("bob", "How are you?", "server", "server_1/channel_1")
    assert msg_id_1 > 0, "Failed to create message 1"
    assert msg_id_2 > 0, "Failed to create message 2"
    print(f"✓ Created messages with IDs {msg_id_1} and {msg_id_2}")
    
    # Test 6: Add reactions to messages
    print("\nTest 6: Testing message reactions...")
    
    # Alice reacts with standard emoji
    success = db.add_reaction(msg_id_1, "alice", "👍", "standard")
    assert success, "Failed to add reaction"
    print("✓ Alice added 👍 reaction to message 1")
    
    # Bob reacts with custom emoji
    success = db.add_reaction(msg_id_1, "bob", "emoji_1", "custom")
    assert success, "Failed to add custom emoji reaction"
    print("✓ Bob added custom emoji reaction to message 1")
    
    # Charlie also reacts
    success = db.add_reaction(msg_id_1, "charlie", "👍", "standard")
    assert success, "Failed to add charlie's reaction"
    print("✓ Charlie added 👍 reaction to message 1")
    
    # Test duplicate reaction (should fail)
    success = db.add_reaction(msg_id_1, "alice", "👍", "standard")
    assert not success, "Duplicate reaction should have failed"
    print("✓ Duplicate reaction correctly rejected")
    
    # Add reactions to second message
    success = db.add_reaction(msg_id_2, "alice", "❤️", "standard")
    assert success, "Failed to add reaction to message 2"
    print("✓ Alice added ❤️ reaction to message 2")
    
    # Test 7: Retrieve reactions
    print("\nTest 7: Testing reaction retrieval...")
    
    reactions = db.get_message_reactions(msg_id_1)
    assert len(reactions) == 3, f"Expected 3 reactions, got {len(reactions)}"
    print(f"✓ Retrieved {len(reactions)} reactions for message 1")
    
    # Verify reaction data
    usernames = {r['username'] for r in reactions}
    assert usernames == {'alice', 'bob', 'charlie'}, "Unexpected users in reactions"
    
    # Count by emoji
    emoji_counts = {}
    for r in reactions:
        key = r['emoji']
        emoji_counts[key] = emoji_counts.get(key, 0) + 1
    
    assert emoji_counts['👍'] == 2, "Expected 2 thumbs up reactions"
    assert emoji_counts['emoji_1'] == 1, "Expected 1 custom emoji reaction"
    print("✓ Reaction counts are correct")
    
    # Test bulk retrieval
    reactions_map = db.get_reactions_for_messages([msg_id_1, msg_id_2])
    assert msg_id_1 in reactions_map, "Message 1 reactions not found in bulk retrieval"
    assert msg_id_2 in reactions_map, "Message 2 reactions not found in bulk retrieval"
    assert len(reactions_map[msg_id_1]) == 3, "Wrong number of reactions for message 1"
    assert len(reactions_map[msg_id_2]) == 1, "Wrong number of reactions for message 2"
    print("✓ Bulk reaction retrieval works correctly")
    
    # Test 8: Remove reactions
    print("\nTest 8: Testing reaction removal...")
    
    success = db.remove_reaction(msg_id_1, "alice", "👍")
    assert success, "Failed to remove reaction"
    print("✓ Alice removed her 👍 reaction")
    
    reactions = db.get_message_reactions(msg_id_1)
    assert len(reactions) == 2, f"Expected 2 reactions after removal, got {len(reactions)}"
    
    usernames = {r['username'] for r in reactions}
    assert 'alice' not in usernames, "Alice's reaction still present after removal"
    print("✓ Reaction successfully removed")
    
    # Test removing non-existent reaction (should fail gracefully)
    success = db.remove_reaction(msg_id_1, "alice", "👍")
    assert not success, "Removing non-existent reaction should return False"
    print("✓ Removing non-existent reaction handled correctly")
    
    # Test 9: Delete custom emoji
    print("\nTest 9: Testing custom emoji deletion...")
    
    success = db.delete_custom_emoji("emoji_1")
    assert success, "Failed to delete custom emoji"
    print("✓ Custom emoji deleted successfully")
    
    emojis = db.get_server_emojis("server_1")
    assert len(emojis) == 1, f"Expected 1 emoji after deletion, got {len(emojis)}"
    assert emojis[0]['name'] == "party", "Wrong emoji remaining after deletion"
    print("✓ Emoji count correct after deletion")
    
    # Verify deleted emoji is gone
    emoji = db.get_custom_emoji("emoji_1")
    assert emoji is None, "Deleted emoji still retrievable"
    print("✓ Deleted emoji is no longer retrievable")
    
    # Verify reactions using deleted emoji still exist (graceful handling)
    reactions = db.get_message_reactions(msg_id_1)
    # The reaction with emoji_1 should still be in database but will need UI handling
    custom_emoji_reactions = [r for r in reactions if r['emoji_type'] == 'custom']
    assert len(custom_emoji_reactions) > 0, "Custom emoji reactions should still exist after emoji deletion"
    print("✓ Reactions with deleted emoji gracefully handled (remain in database)")
    
    # Test 10: Messages with reactions include reaction data
    print("\nTest 10: Testing message retrieval with reactions...")
    
    messages = db.get_messages("server", "server_1/channel_1", 10)
    assert len(messages) == 2, f"Expected 2 messages, got {len(messages)}"
    
    # Get reactions for these messages
    message_ids = [msg['id'] for msg in messages]
    reactions_map = db.get_reactions_for_messages(message_ids)
    
    # Verify we can attach reactions to messages
    for msg in messages:
        msg['reactions'] = reactions_map.get(msg['id'], [])
    
    # Find message 1 and verify it has reactions
    msg1 = next(m for m in messages if m['id'] == msg_id_1)
    assert 'reactions' in msg1, "Message doesn't have reactions field"
    assert len(msg1['reactions']) == 2, "Message 1 should have 2 reactions"
    print("✓ Messages successfully enriched with reaction data")
    
    print("\n" + "=" * 50)
    print("All tests passed! ✓")
    print("=" * 50)

if __name__ == "__main__":
    try:
        test_custom_emojis_and_reactions()
    except AssertionError as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
