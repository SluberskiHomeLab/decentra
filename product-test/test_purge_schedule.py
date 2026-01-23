#!/usr/bin/env python3
"""
Test script to verify database purging schedule functionality
"""

import os
import sys

# Set test encryption key before importing modules that need it
if 'DECENTRA_ENCRYPTION_KEY' not in os.environ:
    os.environ['DECENTRA_ENCRYPTION_KEY'] = 'test-encryption-key-for-purge-tests'

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from database import Database
import bcrypt

def hash_password(password):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def test_purge_schedule():
    print("Testing Database Purging Schedule Feature")
    print("=" * 50)
    
    # Use PostgreSQL test database
    db_url = os.getenv('TEST_DATABASE_URL', 'postgresql://decentra:decentra@localhost:5432/decentra_test')
    
    db = Database(db_url)
    print("✓ Database connected successfully")
    
    # Test 1: Test DM purge schedule in admin settings
    print("\nTest 1: Testing DM purge schedule in admin settings...")
    settings = db.get_admin_settings()
    
    # Update DM purge schedule
    settings['dm_purge_schedule'] = 30
    assert db.update_admin_settings(settings), "Failed to update admin settings"
    
    # Verify the setting was saved
    updated_settings = db.get_admin_settings()
    assert updated_settings['dm_purge_schedule'] == 30, "DM purge schedule not saved correctly"
    print(f"✓ DM purge schedule set to {updated_settings['dm_purge_schedule']} days")
    
    # Test 2: Create server and test server settings
    print("\nTest 2: Testing server purge settings...")
    
    # Create test users
    db.create_user("testuser1", hash_password("password"))
    db.create_user("testuser2", hash_password("password"))
    
    # Create test server
    server_id = "test_server_1"
    db.create_server(server_id, "Test Server", "testuser1")
    print(f"✓ Created server: {server_id}")
    
    # Create channels
    channel1_id = "test_channel_1"
    channel2_id = "test_channel_2"
    db.create_channel(channel1_id, server_id, "general", "text")
    db.create_channel(channel2_id, server_id, "announcements", "text")
    print(f"✓ Created channels: {channel1_id}, {channel2_id}")
    
    # Test server settings - initially should be None or have default values
    server_settings = db.get_server_settings(server_id)
    if server_settings is None:
        print("✓ No server settings exist yet (expected)")
    
    # Update server purge settings
    db.update_server_settings(server_id, 90)
    server_settings = db.get_server_settings(server_id)
    assert server_settings is not None, "Server settings not created"
    assert server_settings['purge_schedule'] == 90, "Server purge schedule not saved correctly"
    print(f"✓ Server purge schedule set to {server_settings['purge_schedule']} days")
    
    # Test 3: Test channel exemptions
    print("\nTest 3: Testing channel exemptions...")
    
    # Exempt channel2 from purging
    db.set_channel_exemption(server_id, channel2_id, True)
    exemptions = db.get_channel_exemptions(server_id)
    assert channel2_id in exemptions, "Channel exemption not saved"
    assert channel1_id not in exemptions, "Channel1 should not be exempted"
    print(f"✓ Channel {channel2_id} exempted from purging")
    
    # Remove exemption
    db.set_channel_exemption(server_id, channel2_id, False)
    exemptions = db.get_channel_exemptions(server_id)
    assert channel2_id not in exemptions, "Channel exemption not removed"
    print(f"✓ Channel {channel2_id} exemption removed")
    
    # Test 4: Test message purging for DMs
    print("\nTest 4: Testing DM message purging...")
    
    # Create a DM
    dm_id = "test_dm_1"
    db.create_dm(dm_id, "testuser1", "testuser2")
    
    # Add messages with different timestamps
    # We can't easily manipulate timestamps in the database for testing,
    # so we'll just verify the purge function runs without errors
    db.save_message("testuser1", "Test message 1", "dm", dm_id)
    db.save_message("testuser2", "Test message 2", "dm", dm_id)
    
    # Try to purge messages older than 30 days (should delete 0 since they're new)
    deleted_count = db.purge_old_dm_messages(30)
    print(f"✓ DM purge executed, deleted {deleted_count} messages (expected 0 for new messages)")
    
    # Test 5: Test message purging for servers
    print("\nTest 5: Testing server message purging...")
    
    # Add messages to channels
    db.save_message("testuser1", "Channel 1 message", "server", f"{server_id}/{channel1_id}")
    db.save_message("testuser1", "Channel 2 message", "server", f"{server_id}/{channel2_id}")
    
    # Exempt channel2
    db.set_channel_exemption(server_id, channel2_id, True)
    exemptions = db.get_channel_exemptions(server_id)
    
    # Try to purge messages (should delete 0 for new messages)
    deleted_count = db.purge_old_server_messages(server_id, 90, exemptions)
    print(f"✓ Server purge executed, deleted {deleted_count} messages (expected 0 for new messages)")
    
    # Test 6: Test get_all_servers_with_purge_schedule
    print("\nTest 6: Testing get_all_servers_with_purge_schedule...")
    
    servers_with_schedule = db.get_all_servers_with_purge_schedule()
    assert len(servers_with_schedule) > 0, "No servers with purge schedule found"
    assert any(s['server_id'] == server_id for s in servers_with_schedule), "Test server not in list"
    print(f"✓ Found {len(servers_with_schedule)} server(s) with purge schedule")
    
    # Test 7: Test disabling purge schedules
    print("\nTest 7: Testing purge schedule disable...")
    
    # Disable server purge (set to 0)
    db.update_server_settings(server_id, 0)
    server_settings = db.get_server_settings(server_id)
    assert server_settings['purge_schedule'] == 0, "Failed to disable server purge"
    
    # Verify it's not in the active list
    servers_with_schedule = db.get_all_servers_with_purge_schedule()
    assert not any(s['server_id'] == server_id for s in servers_with_schedule), "Disabled server still in active list"
    print("✓ Server purge schedule disabled successfully")
    
    # Disable DM purge
    settings = db.get_admin_settings()
    settings['dm_purge_schedule'] = 0
    db.update_admin_settings(settings)
    updated_settings = db.get_admin_settings()
    assert updated_settings['dm_purge_schedule'] == 0, "Failed to disable DM purge"
    print("✓ DM purge schedule disabled successfully")
    
    print("\n" + "=" * 50)
    print("All purge schedule tests passed!")
    print("=" * 50)

if __name__ == '__main__':
    try:
        test_purge_schedule()
    except AssertionError as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
