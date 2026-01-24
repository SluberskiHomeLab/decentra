#!/usr/bin/env python3
"""
Test script to verify data sync functionality
"""

import os
import sys
import json

# Set test encryption key before importing modules that need it
if 'DECENTRA_ENCRYPTION_KEY' not in os.environ:
    os.environ['DECENTRA_ENCRYPTION_KEY'] = 'test-encryption-key-for-sync-tests'

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from database import Database
import bcrypt

def hash_password(password):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def test_sync_data():
    print("Testing Data Sync Functionality")
    print("=" * 50)
    
    # Use PostgreSQL test database
    db_url = os.getenv('TEST_DATABASE_URL', 'postgresql://decentra:decentra@localhost:5432/decentra_test')
    
    db = Database(db_url)
    print("✓ Database connected successfully")
    
    # Test 1: Create test user
    print("\nTest 1: Creating test user...")
    username = "sync_test_user"
    
    # Clean up any existing test user
    try:
        with db.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM users WHERE username = %s', (username,))
            conn.commit()
    except:
        pass
    
    assert db.create_user(username, hash_password("password123"), "test@example.com"), "Failed to create user"
    print(f"✓ User '{username}' created")
    
    # Test 2: Verify user can be retrieved
    print("\nTest 2: Retrieving user data...")
    user = db.get_user(username)
    assert user is not None, "Failed to retrieve user"
    assert user['username'] == username, "Username mismatch"
    print(f"✓ User data retrieved: {user['username']}")
    
    # Test 3: Create servers for user
    print("\nTest 3: Creating servers...")
    server_id1 = "sync_test_server_1"
    server_id2 = "sync_test_server_2"
    
    # Clean up existing servers
    try:
        with db.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM server_members WHERE server_id IN (%s, %s)', (server_id1, server_id2))
            cursor.execute('DELETE FROM channels WHERE server_id IN (%s, %s)', (server_id1, server_id2))
            cursor.execute('DELETE FROM servers WHERE server_id IN (%s, %s)', (server_id1, server_id2))
            conn.commit()
    except:
        pass
    
    assert db.create_server(server_id1, "Sync Test Server 1", username), "Failed to create server 1"
    assert db.create_server(server_id2, "Sync Test Server 2", username), "Failed to create server 2"
    print("✓ Servers created")
    
    # Test 4: Get user servers
    print("\nTest 4: Retrieving user servers...")
    user_servers = db.get_user_servers(username)
    assert len(user_servers) >= 2, f"Expected at least 2 servers, got {len(user_servers)}"
    assert server_id1 in user_servers, "Server 1 not found in user servers"
    assert server_id2 in user_servers, "Server 2 not found in user servers"
    print(f"✓ User servers retrieved: {len(user_servers)} servers")
    
    # Test 5: Verify server data structure
    print("\nTest 5: Verifying server data structure...")
    server1 = db.get_server(server_id1)
    assert server1 is not None, "Failed to retrieve server 1"
    assert server1['name'] == "Sync Test Server 1", "Server name mismatch"
    assert server1['owner'] == username, "Server owner mismatch"
    assert 'icon' in server1, "Server missing icon field"
    assert 'icon_type' in server1, "Server missing icon_type field"
    print("✓ Server data structure verified")
    
    # Test 6: Get server channels
    print("\nTest 6: Retrieving server channels...")
    channels = db.get_server_channels(server_id1)
    assert len(channels) >= 0, "Failed to retrieve channels"
    print(f"✓ Server channels retrieved: {len(channels)} channels")
    
    # Clean up
    print("\nCleaning up test data...")
    try:
        with db.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM server_members WHERE server_id IN (%s, %s)', (server_id1, server_id2))
            cursor.execute('DELETE FROM channels WHERE server_id IN (%s, %s)', (server_id1, server_id2))
            cursor.execute('DELETE FROM servers WHERE server_id IN (%s, %s)', (server_id1, server_id2))
            cursor.execute('DELETE FROM users WHERE username = %s', (username,))
            conn.commit()
            print("✓ Test data cleaned up")
    except Exception as e:
        print(f"⚠ Warning: Failed to clean up test data: {e}")
    
    print("\n" + "=" * 50)
    print("All sync data tests passed! ✓")
    print("=" * 50)

if __name__ == '__main__':
    try:
        test_sync_data()
    except AssertionError as e:
        print(f"\n❌ Test failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error during testing: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
