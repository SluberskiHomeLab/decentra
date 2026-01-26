#!/usr/bin/env python3
"""
Test invite usage tracking functionality.

Tests the new invite usage tracking feature:
1. Log invite usage when invite is used
2. Retrieve invite usage logs grouped by invite code
3. Display usage counts and user lists

Requirements:
- PostgreSQL database running (can use docker-compose)
- Set TEST_DATABASE_URL environment variable to test database URL
  Example: TEST_DATABASE_URL='postgresql://decentra:decentra@localhost:5432/decentra_test'

To run:
    # Start PostgreSQL with docker-compose
    docker compose up -d postgres
    
    # Run tests
    TEST_DATABASE_URL='postgresql://decentra:test_password_123@localhost:5432/decentra' python3 product-test/test_invite_tracking.py
"""

import os
import sys
import secrets
import string
import bcrypt
import traceback

# Set test encryption key before importing modules that need it
if 'DECENTRA_ENCRYPTION_KEY' not in os.environ:
    os.environ['DECENTRA_ENCRYPTION_KEY'] = 'test-encryption-key-for-invite-tracking-tests'

# Add server directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from database import Database


def get_test_db_url():
    """Get test database URL from environment or use default."""
    return os.getenv('TEST_DATABASE_URL', 'postgresql://decentra:test_password_123@localhost:5432/decentra')


def cleanup_test_data(db, usernames, server_ids):
    """Clean up test data."""
    try:
        with db.get_connection() as conn:
            cursor = conn.cursor()
            # Delete servers (cascades to channels, members, etc.)
            for server_id in server_ids:
                cursor.execute('DELETE FROM servers WHERE server_id = %s', (server_id,))
            # Delete users (cascades to friendships, etc.)
            for username in usernames:
                cursor.execute('DELETE FROM users WHERE username = %s', (username,))
    except Exception as e:
        # Cleanup may fail if data doesn't exist
        pass


def test_invite_usage_logging():
    """Test 1: Verify invite usage is logged when invites are used."""
    print("Test 1: Invite Usage Logging")
    print("=" * 60)
    
    db = Database(get_test_db_url())
    creator_username = 'test_creator'
    user1 = 'test_user1'
    user2 = 'test_user2'
    server_id = 'test_server_1'
    
    # Clean up any existing test data
    cleanup_test_data(db, [creator_username, user1, user2], [server_id])
    
    try:
        print("\n1.1: Creating test users...")
        password_hash = bcrypt.hashpw('password123'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        db.create_user(creator_username, password_hash, 'creator@example.com', email_verified=False)
        db.create_user(user1, password_hash, 'user1@example.com', email_verified=False)
        db.create_user(user2, password_hash, 'user2@example.com', email_verified=False)
        print(f"✓ Created users: {creator_username}, {user1}, {user2}")
        
        print("\n1.2: Creating test server...")
        db.create_server(server_id, 'Test Server', creator_username)
        print(f"✓ Server created: {server_id}")
        
        print("\n1.3: Creating invite code...")
        invite_code = ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8))
        db.create_invite_code(invite_code, creator_username, 'server', server_id)
        print(f"✓ Invite code created: {invite_code}")
        
        print("\n1.4: Logging invite usage for first user...")
        db.log_invite_usage(invite_code, user1, server_id)
        print(f"✓ Invite usage logged for {user1}")
        
        print("\n1.5: Logging invite usage for second user (same code)...")
        db.log_invite_usage(invite_code, user2, server_id)
        print(f"✓ Invite usage logged for {user2}")
        
        print("\n1.6: Retrieving invite usage logs...")
        usage_logs = db.get_server_invite_usage(server_id)
        print(f"✓ Retrieved {len(usage_logs)} usage log(s)")
        
        print("\n1.7: Verifying usage log data...")
        assert len(usage_logs) == 1, f"Should have 1 usage log entry, got {len(usage_logs)}"
        log = usage_logs[0]
        
        assert log['invite_code'] == invite_code, f"Invite code mismatch: {log['invite_code']} != {invite_code}"
        assert log['use_count'] == 2, f"Use count should be 2, got {log['use_count']}"
        assert user1 in log['users'], f"{user1} should be in users list"
        assert user2 in log['users'], f"{user2} should be in users list"
        
        print(f"✓ Verified usage log:")
        print(f"  - Invite code: {log['invite_code']}")
        print(f"  - Use count: {log['use_count']}")
        print(f"  - Users: {log['users']}")
        print(f"  - First used: {log['first_used']}")
        print(f"  - Last used: {log['last_used']}")
        
    finally:
        # Clean up
        cleanup_test_data(db, [creator_username, user1, user2], [server_id])
    
    print("\n✅ Test 1 passed: Invite usage logging works correctly")
    return True


def test_multiple_invites_tracking():
    """Test 2: Verify tracking works with multiple different invite codes."""
    print("\n\nTest 2: Multiple Invites Tracking")
    print("=" * 60)
    
    db = Database(get_test_db_url())
    creator_username = 'test_creator2'
    user1 = 'test_user3'
    user2 = 'test_user4'
    user3 = 'test_user5'
    server_id = 'test_server_2'
    
    # Clean up any existing test data
    cleanup_test_data(db, [creator_username, user1, user2, user3], [server_id])
    
    try:
        print("\n2.1: Creating test users and server...")
        password_hash = bcrypt.hashpw('password123'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        db.create_user(creator_username, password_hash, 'creator2@example.com', email_verified=False)
        db.create_user(user1, password_hash, 'user3@example.com', email_verified=False)
        db.create_user(user2, password_hash, 'user4@example.com', email_verified=False)
        db.create_user(user3, password_hash, 'user5@example.com', email_verified=False)
        db.create_server(server_id, 'Test Server 2', creator_username)
        print(f"✓ Setup complete")
        
        print("\n2.2: Creating two different invite codes...")
        invite_code1 = ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8))
        invite_code2 = ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8))
        db.create_invite_code(invite_code1, creator_username, 'server', server_id)
        db.create_invite_code(invite_code2, creator_username, 'server', server_id)
        print(f"✓ Invite codes created: {invite_code1}, {invite_code2}")
        
        print("\n2.3: Logging usage for both invite codes...")
        db.log_invite_usage(invite_code1, user1, server_id)
        db.log_invite_usage(invite_code1, user2, server_id)
        db.log_invite_usage(invite_code2, user3, server_id)
        print(f"✓ Logged usage: {invite_code1} (2x), {invite_code2} (1x)")
        
        print("\n2.4: Retrieving and verifying usage logs...")
        usage_logs = db.get_server_invite_usage(server_id)
        print(f"✓ Retrieved {len(usage_logs)} usage log(s)")
        
        assert len(usage_logs) == 2, f"Should have 2 usage log entries, got {len(usage_logs)}"
        
        # Find logs by invite code
        log1 = next((log for log in usage_logs if log['invite_code'] == invite_code1), None)
        log2 = next((log for log in usage_logs if log['invite_code'] == invite_code2), None)
        
        assert log1 is not None, f"Missing log for {invite_code1}"
        assert log2 is not None, f"Missing log for {invite_code2}"
        
        assert log1['use_count'] == 2, f"Invite 1 should have 2 uses, got {log1['use_count']}"
        assert log2['use_count'] == 1, f"Invite 2 should have 1 use, got {log2['use_count']}"
        
        print(f"✓ Verified both invite codes tracked correctly:")
        print(f"  - {invite_code1}: {log1['use_count']} uses by {log1['users']}")
        print(f"  - {invite_code2}: {log2['use_count']} uses by {log2['users']}")
        
    finally:
        # Clean up
        cleanup_test_data(db, [creator_username, user1, user2, user3], [server_id])
    
    print("\n✅ Test 2 passed: Multiple invites tracking works correctly")
    return True


def test_empty_usage_logs():
    """Test 3: Verify empty logs are returned correctly when no invites have been used."""
    print("\n\nTest 3: Empty Usage Logs")
    print("=" * 60)
    
    db = Database(get_test_db_url())
    creator_username = 'test_creator3'
    server_id = 'test_server_3'
    
    # Clean up any existing test data
    cleanup_test_data(db, [creator_username], [server_id])
    
    try:
        print("\n3.1: Creating test server...")
        password_hash = bcrypt.hashpw('password123'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        db.create_user(creator_username, password_hash, 'creator3@example.com', email_verified=False)
        db.create_server(server_id, 'Test Server 3', creator_username)
        print(f"✓ Server created: {server_id}")
        
        print("\n3.2: Retrieving usage logs for server with no invite usage...")
        usage_logs = db.get_server_invite_usage(server_id)
        print(f"✓ Retrieved {len(usage_logs)} usage log(s)")
        
        assert len(usage_logs) == 0, f"Should have 0 usage logs, got {len(usage_logs)}"
        print(f"✓ Correctly returned empty list for server with no invite usage")
        
    finally:
        # Clean up
        cleanup_test_data(db, [creator_username], [server_id])
    
    print("\n✅ Test 3 passed: Empty usage logs handled correctly")
    return True


def run_all_tests():
    """Run all invite tracking tests."""
    print("INVITE TRACKING TESTS")
    print("=" * 60)
    print("Testing invite usage tracking functionality")
    print("=" * 60)
    
    tests = [
        test_invite_usage_logging,
        test_multiple_invites_tracking,
        test_empty_usage_logs
    ]
    
    passed = 0
    failed = 0
    
    for test in tests:
        try:
            if test():
                passed += 1
        except AssertionError as e:
            print(f"\n❌ FAIL: {e}")
            failed += 1
        except Exception as e:
            print(f"\n❌ ERROR: {e}")
            traceback.print_exc()
            failed += 1
    
    print("\n" + "=" * 60)
    print(f"Test Results: {passed} passed, {failed} failed")
    print("=" * 60)
    
    return failed == 0


if __name__ == '__main__':
    try:
        success = run_all_tests()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ FATAL ERROR: {e}")
        traceback.print_exc()
        sys.exit(1)
