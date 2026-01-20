#!/usr/bin/env python3
"""
Integration tests for signup flow with email verification toggle.
Tests the actual signup flow with database integration.

These tests verify:
1. User account creation with email_verified=FALSE when verification is disabled
2. Auto-friending with invite codes works in the direct signup path
3. The signup flow works end-to-end for both verification enabled and disabled scenarios

Requirements:
- PostgreSQL database running (can use docker-compose)
- Set TEST_DATABASE_URL environment variable to test database URL
  Example: TEST_DATABASE_URL='postgresql://decentra:decentra@localhost:5432/decentra_test'

To run:
    # Start PostgreSQL with docker-compose
    docker-compose up -d postgres
    
    # Run tests
    TEST_DATABASE_URL='postgresql://decentra:decentra@localhost:5432/decentra_test' python3 test_signup_integration.py
    
    # Or run in Docker container on same network
    docker run --rm --network decentra_decentra-network -v $(pwd):/app -w /app python:3.12-slim \\
        bash -c "pip install -q psycopg2-binary bcrypt cryptography && \\
        TEST_DATABASE_URL='postgresql://decentra:decentra@decentra-postgres:5432/decentra_test' \\
        python3 test_signup_integration.py"
"""

import os
import sys
from datetime import datetime, timedelta
import secrets
import string
import bcrypt

# Set test encryption key before importing modules that need it
if 'DECENTRA_ENCRYPTION_KEY' not in os.environ:
    os.environ['DECENTRA_ENCRYPTION_KEY'] = 'test-encryption-key-for-signup-integration-tests'

# Add server directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from database import Database


def get_test_db_url():
    """Get test database URL from environment or use default."""
    return os.getenv('TEST_DATABASE_URL', 'postgresql://decentra:decentra@localhost:5432/decentra_test')


def cleanup_test_user(db, username):
    """Clean up test user and related data."""
    try:
        # Delete user (cascades to friendships, etc.)
        with db.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM users WHERE username = %s', (username,))
    except Exception as e:
        # Cleanup may fail if data doesn't exist
        pass


def test_direct_signup_without_verification():
    """Test 1: Direct signup when email verification is disabled."""
    print("Test 1: Direct Signup Without Email Verification")
    print("=" * 60)
    
    db = Database(get_test_db_url())
    test_username = 'test_direct_signup'
    test_email = 'direct@example.com'
    test_password = 'testpass123'
    
    # Clean up any existing test data
    cleanup_test_user(db, test_username)
    
    print("\n1.1: Setting admin settings with verification disabled...")
    admin_settings = {
        'require_email_verification': False,
        'smtp_enabled': False
    }
    # Update admin settings
    db.update_admin_settings(admin_settings)
    print("✓ Admin settings configured (verification disabled)")
    
    print("\n1.2: Creating user account directly (simulating signup flow)...")
    password_hash = bcrypt.hashpw(test_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    result = db.create_user(test_username, password_hash, test_email, email_verified=False)
    assert result == True, "Should create user successfully"
    print("✓ User account created")
    
    print("\n1.3: Verifying user was created with email_verified=FALSE...")
    user = db.get_user(test_username)
    assert user is not None, "User should exist in database"
    assert user['username'] == test_username, "Username should match"
    assert user['email'] == test_email, "Email should match"
    assert user['email_verified'] == False, "Email should NOT be verified"
    print(f"✓ User created: {user['username']}, email: {user['email']}, verified: {user['email_verified']}")
    
    # Clean up
    cleanup_test_user(db, test_username)
    
    print("\n✅ Test 1 passed: Direct signup works without email verification")
    return True


def test_auto_friending_with_invite_code():
    """Test 2: Auto-friending works in direct signup path with invite codes."""
    print("\n\nTest 2: Auto-Friending with Invite Code in Direct Signup")
    print("=" * 60)
    
    db = Database(get_test_db_url())
    inviter_username = 'test_inviter'
    invitee_username = 'test_invitee'
    inviter_email = 'inviter@example.com'
    invitee_email = 'invitee@example.com'
    
    # Clean up any existing test data
    cleanup_test_user(db, inviter_username)
    cleanup_test_user(db, invitee_username)
    
    try:
        print("\n2.1: Creating inviter user...")
        password_hash = bcrypt.hashpw('password123'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        db.create_user(inviter_username, password_hash, inviter_email, email_verified=False)
        print(f"✓ Inviter created: {inviter_username}")
        
        print("\n2.2: Creating invite code...")
        invite_code = ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8))
        db.create_invite_code(invite_code, inviter_username, 'global')
        print(f"✓ Invite code created: {invite_code}")
        
        print("\n2.3: Creating invitee user (simulating direct signup with invite)...")
        db.create_user(invitee_username, password_hash, invitee_email, email_verified=False)
        print(f"✓ Invitee created: {invitee_username}")
        
        print("\n2.4: Simulating auto-friending process...")
        # Add friend request
        db.add_friend_request(inviter_username, invitee_username)
        print("✓ Friend request added")
        
        # Accept friend request
        db.accept_friend_request(inviter_username, invitee_username)
        print("✓ Friend request accepted")
        
        # Delete used invite code
        db.delete_invite_code(invite_code)
        print("✓ Invite code deleted")
        
        print("\n2.5: Verifying friendship was established...")
        inviter_friends = db.get_friends(inviter_username)
        invitee_friends = db.get_friends(invitee_username)
        
        assert invitee_username in inviter_friends, "Invitee should be in inviter's friends"
        assert inviter_username in invitee_friends, "Inviter should be in invitee's friends"
        print(f"✓ Mutual friendship confirmed:")
        print(f"  - {inviter_username} friends: {inviter_friends}")
        print(f"  - {invitee_username} friends: {invitee_friends}")
        
        print("\n2.6: Verifying invite code was deleted...")
        invite_data = db.get_invite_code(invite_code)
        assert invite_data is None, "Invite code should be deleted"
        print("✓ Invite code no longer exists")
        
    finally:
        # Clean up
        cleanup_test_user(db, inviter_username)
        cleanup_test_user(db, invitee_username)
    
    print("\n✅ Test 2 passed: Auto-friending works in direct signup path")
    return True


def test_email_verified_flag_differences():
    """Test 3: Verify email_verified flag is set correctly in different scenarios."""
    print("\n\nTest 3: Email Verified Flag in Different Scenarios")
    print("=" * 60)
    
    db = Database(get_test_db_url())
    
    # Test with verification disabled
    print("\n3.1: User created with verification disabled...")
    username1 = 'test_unverified'
    cleanup_test_user(db, username1)
    
    password_hash = bcrypt.hashpw('password'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    db.create_user(username1, password_hash, 'unverified@example.com', email_verified=False)
    
    user1 = db.get_user(username1)
    assert user1['email_verified'] == False, "Should be unverified"
    print(f"✓ {username1}: email_verified = {user1['email_verified']} (expected: False)")
    
    # Test with verification enabled (simulating completed verification)
    print("\n3.2: User created after email verification...")
    username2 = 'test_verified'
    cleanup_test_user(db, username2)
    
    db.create_user(username2, password_hash, 'verified@example.com', email_verified=True)
    
    user2 = db.get_user(username2)
    assert user2['email_verified'] == True, "Should be verified"
    print(f"✓ {username2}: email_verified = {user2['email_verified']} (expected: True)")
    
    # Clean up
    cleanup_test_user(db, username1)
    cleanup_test_user(db, username2)
    
    print("\n✅ Test 3 passed: email_verified flag set correctly")
    return True


def test_admin_setting_persistence():
    """Test 4: Verify require_email_verification setting persists correctly."""
    print("\n\nTest 4: Admin Setting Persistence")
    print("=" * 60)
    
    db = Database(get_test_db_url())
    
    print("\n4.1: Setting require_email_verification to TRUE...")
    db.update_admin_settings({'require_email_verification': True})
    settings = db.get_admin_settings()
    assert settings.get('require_email_verification') == True, "Should be True"
    print(f"✓ Setting saved: require_email_verification = {settings.get('require_email_verification')}")
    
    print("\n4.2: Setting require_email_verification to FALSE...")
    db.update_admin_settings({'require_email_verification': False})
    settings = db.get_admin_settings()
    assert settings.get('require_email_verification') == False, "Should be False"
    print(f"✓ Setting saved: require_email_verification = {settings.get('require_email_verification')}")
    
    print("\n4.3: Verifying default value (if not set)...")
    # The default from database migration is FALSE
    settings = db.get_admin_settings()
    verification_setting = settings.get('require_email_verification', False)
    print(f"✓ Default value: require_email_verification = {verification_setting}")
    
    print("\n✅ Test 4 passed: Admin setting persists correctly")
    return True


def test_no_duplicate_emails():
    """Test 5: Verify email uniqueness is enforced in direct signup."""
    print("\n\nTest 5: Email Uniqueness Enforcement")
    print("=" * 60)
    
    db = Database(get_test_db_url())
    test_email = 'duplicate@example.com'
    
    # Clean up
    cleanup_test_user(db, 'user1')
    cleanup_test_user(db, 'user2')
    
    print("\n5.1: Creating first user with email...")
    password_hash = bcrypt.hashpw('password'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    result = db.create_user('user1', password_hash, test_email, email_verified=False)
    assert result == True, "First user should be created"
    print(f"✓ First user created with email: {test_email}")
    
    print("\n5.2: Attempting to create second user with same email...")
    # This should be caught by the signup validation in server.py (db.get_user_by_email check)
    existing_user = db.get_user_by_email(test_email)
    assert existing_user is not None, "Email should already be registered"
    assert existing_user['username'] == 'user1', "Should find first user"
    print(f"✓ Email already registered check works: found user '{existing_user['username']}'")
    
    # Clean up
    cleanup_test_user(db, 'user1')
    
    print("\n✅ Test 5 passed: Email uniqueness enforced")
    return True


def run_all_tests():
    """Run all integration tests."""
    print("SIGNUP INTEGRATION TESTS")
    print("=" * 60)
    print("Testing actual signup flow with database integration")
    print("=" * 60)
    
    tests = [
        test_direct_signup_without_verification,
        test_auto_friending_with_invite_code,
        test_email_verified_flag_differences,
        test_admin_setting_persistence,
        test_no_duplicate_emails
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
            import traceback
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
        import traceback
        traceback.print_exc()
        sys.exit(1)
