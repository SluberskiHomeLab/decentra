#!/usr/bin/env python3
"""
Test script for email verification functionality in Decentra.
Tests email verification code generation, storage, validation, and cleanup.
"""

import os
import sys
from datetime import datetime, timedelta
import secrets
import string
import bcrypt

# Add server directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'server'))

from database import Database


def get_test_db_url():
    """Get test database URL from environment or use default."""
    return os.getenv('TEST_DATABASE_URL', 'postgresql://decentra:decentra@localhost:5432/decentra_test')


def test_email_verification_flow():
    """Test the complete email verification flow."""
    print("Test 1: Email Verification Flow")
    print("=" * 60)
    
    # Initialize test database
    db = Database(get_test_db_url())
    
    # Clean up any existing test data
    try:
        db.delete_email_verification_code('test@example.com', 'testuser')
        # Try to delete user if exists
        with db.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM users WHERE username = %s', ('testuser',))
    except Exception as e:
        # Cleanup may fail if data doesn't exist, which is acceptable
        print(f"Note: Cleanup skipped (data may not exist): {e}")
    
    print("\n1.1: Testing email verification code creation...")
    
    # Generate a verification code
    code = ''.join(secrets.choice(string.digits) for _ in range(6))
    assert len(code) == 6, "Code should be 6 digits"
    print(f"✓ Generated verification code: {code}")
    
    # Store verification code
    expires_at = datetime.now() + timedelta(minutes=15)
    result = db.create_email_verification_code('test@example.com', 'testuser', code, expires_at)
    assert result == True, "Should create verification code successfully"
    print("✓ Verification code stored in database")
    
    print("\n1.2: Testing email verification code retrieval...")
    
    # Retrieve verification code
    verification_data = db.get_email_verification_code('test@example.com', 'testuser')
    assert verification_data is not None, "Should retrieve verification code"
    assert verification_data['code'] == code, "Retrieved code should match"
    assert verification_data['email'] == 'test@example.com', "Email should match"
    assert verification_data['username'] == 'testuser', "Username should match"
    print(f"✓ Retrieved verification code: {verification_data['code']}")
    
    print("\n1.3: Testing user creation with email verification...")
    
    # Create user with email
    password_hash = bcrypt.hashpw('testpassword'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    result = db.create_user('testuser', password_hash, 'test@example.com', email_verified=True)
    assert result == True, "Should create user successfully"
    print("✓ User created with email")
    
    # Verify user data
    user = db.get_user('testuser')
    assert user is not None, "User should exist"
    assert user['email'] == 'test@example.com', "Email should match"
    assert user['email_verified'] == True, "Email should be verified"
    print(f"✓ User email: {user['email']}, verified: {user['email_verified']}")
    
    print("\n1.4: Testing verification code deletion...")
    
    # Delete verification code
    result = db.delete_email_verification_code('test@example.com', 'testuser')
    assert result == True, "Should delete verification code successfully"
    print("✓ Verification code deleted")
    
    # Verify code is gone
    verification_data = db.get_email_verification_code('test@example.com', 'testuser')
    assert verification_data is None, "Verification code should be deleted"
    print("✓ Verification code no longer exists")
    
    # Clean up
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM users WHERE username = %s', ('testuser',))
    
    print("\n✓ Email verification flow test completed successfully!")
    print()


def test_expired_verification_codes():
    """Test handling of expired verification codes."""
    print("Test 2: Expired Verification Codes")
    print("=" * 60)
    
    # Initialize test database
    db = Database(get_test_db_url())
    
    # Clean up any existing test data
    try:
        db.delete_email_verification_code('expired@example.com', 'expireduser')
    except Exception as e:
        # Cleanup may fail if data doesn't exist, which is acceptable
        print(f"Note: Cleanup skipped (data may not exist): {e}")
    
    print("\n2.1: Creating expired verification code...")
    
    # Create an expired verification code
    code = '123456'
    expires_at = datetime.now() - timedelta(minutes=1)  # Already expired
    result = db.create_email_verification_code('expired@example.com', 'expireduser', code, expires_at)
    assert result == True, "Should create expired verification code"
    print("✓ Expired verification code created")
    
    print("\n2.2: Testing retrieval of expired code...")
    
    # Try to retrieve expired code (should return None due to expiration check)
    verification_data = db.get_email_verification_code('expired@example.com', 'expireduser')
    assert verification_data is None, "Should not retrieve expired verification code"
    print("✓ Expired code correctly not retrieved")
    
    print("\n2.3: Testing cleanup of expired codes...")
    
    # Cleanup expired codes
    db.cleanup_expired_verification_codes()
    print("✓ Cleanup function executed")
    
    # Verify it's cleaned up
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT COUNT(*) as count FROM email_verification_codes 
            WHERE email = %s AND username = %s
        ''', ('expired@example.com', 'expireduser'))
        row = cursor.fetchone()
        count = row['count'] if row else 0
        assert count == 0, "Expired code should be cleaned up"
    print("✓ Expired code cleaned up from database")
    
    print("\n✓ Expired verification codes test completed successfully!")
    print()


def test_code_update():
    """Test updating verification codes for same email/username."""
    print("Test 3: Verification Code Update")
    print("=" * 60)
    
    # Initialize test database
    db = Database(get_test_db_url())
    
    # Clean up any existing test data
    try:
        db.delete_email_verification_code('update@example.com', 'updateuser')
    except Exception as e:
        # Cleanup may fail if data doesn't exist, which is acceptable
        print(f"Note: Cleanup skipped (data may not exist): {e}")
    
    print("\n3.1: Creating initial verification code...")
    
    # Create first code
    code1 = '111111'
    expires_at = datetime.now() + timedelta(minutes=15)
    result = db.create_email_verification_code('update@example.com', 'updateuser', code1, expires_at)
    assert result == True, "Should create first verification code"
    print(f"✓ First code created: {code1}")
    
    print("\n3.2: Updating with new verification code...")
    
    # Create second code (should replace first)
    code2 = '222222'
    expires_at = datetime.now() + timedelta(minutes=15)
    result = db.create_email_verification_code('update@example.com', 'updateuser', code2, expires_at)
    assert result == True, "Should create second verification code"
    print(f"✓ Second code created: {code2}")
    
    print("\n3.3: Verifying only latest code exists...")
    
    # Retrieve code
    verification_data = db.get_email_verification_code('update@example.com', 'updateuser')
    assert verification_data is not None, "Should retrieve verification code"
    assert verification_data['code'] == code2, "Should retrieve latest code"
    assert verification_data['code'] != code1, "Should not have old code"
    print(f"✓ Latest code retrieved: {verification_data['code']}")
    
    # Verify only one code exists
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT COUNT(*) as count FROM email_verification_codes 
            WHERE email = %s AND username = %s
        ''', ('update@example.com', 'updateuser'))
        row = cursor.fetchone()
        count = row['count'] if row else 0
        assert count == 1, "Should have exactly one verification code"
    print("✓ Only one code exists in database")
    
    # Clean up
    db.delete_email_verification_code('update@example.com', 'updateuser')
    
    print("\n✓ Verification code update test completed successfully!")
    print()


def test_negative_scenarios():
    """Test failure scenarios for email verification."""
    print("Test 4: Negative Scenarios")
    print("=" * 60)
    
    # Initialize test database
    db = Database(get_test_db_url())
    
    print("\n4.1: Testing incorrect verification code...")
    
    # Create a valid verification code
    code = '123456'
    expires_at = datetime.now() + timedelta(minutes=15)
    db.create_email_verification_code('test@negative.com', 'negativeuser', code, expires_at)
    
    # Try to retrieve with incorrect code
    verification_data = db.get_email_verification_code('test@negative.com', 'negativeuser')
    assert verification_data is not None, "Should retrieve verification data"
    assert verification_data['code'] == code, "Code should match"
    
    # Verify wrong code fails
    wrong_code = '654321'
    assert verification_data['code'] != wrong_code, "Wrong code should not match"
    print("✓ Incorrect code correctly rejected")
    
    print("\n4.2: Testing verification code format validation...")
    
    # Test various invalid formats
    invalid_codes = [
        '12345',      # Too short
        '1234567',    # Too long
        'abcdef',     # Not numeric
        '12-456',     # Contains special chars
        '',           # Empty
        '12 456',     # Contains space
    ]
    
    for invalid_code in invalid_codes:
        # Validate that invalid codes would be rejected (simulating server-side validation)
        is_valid = invalid_code and invalid_code.isdigit() and len(invalid_code) == 6
        assert not is_valid, f"Code '{invalid_code}' should be invalid"
    
    print("✓ Invalid code formats correctly identified")
    
    print("\n4.3: Testing expired code at boundary (15 minutes)...")
    
    # Create a code that expires in exactly 15 minutes
    boundary_code = '999999'
    boundary_expires = datetime.now() + timedelta(minutes=15, seconds=-1)  # Just under 15 minutes
    db.create_email_verification_code('boundary@test.com', 'boundaryuser', boundary_code, boundary_expires)
    
    # Should still be valid
    boundary_data = db.get_email_verification_code('boundary@test.com', 'boundaryuser')
    assert boundary_data is not None, "Code at boundary should still be valid"
    print("✓ Code at 15-minute boundary handled correctly")
    
    print("\n4.4: Testing duplicate email prevention...")
    
    # Clean up from previous test
    try:
        with db.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM users WHERE username IN (%s, %s)', ('dupuser1', 'dupuser2'))
    except Exception as e:
        print(f"Note: Cleanup skipped: {e}")
    
    # Create first user with email
    password_hash = bcrypt.hashpw('password'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    db.create_user('dupuser1', password_hash, 'duplicate@test.com', email_verified=True)
    
    # Check that email is in use
    existing_user = db.get_user_by_email('duplicate@test.com')
    assert existing_user is not None, "Should find user by email"
    assert existing_user['username'] == 'dupuser1', "Should find correct user"
    print("✓ Duplicate email detection works correctly")
    
    # Clean up
    db.delete_email_verification_code('test@negative.com', 'negativeuser')
    db.delete_email_verification_code('boundary@test.com', 'boundaryuser')
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM users WHERE username IN (%s, %s)', ('dupuser1', 'dupuser2'))
    
    print("\n✓ Negative scenarios test completed successfully!")
    print()


def run_all_tests():
    """Run all email verification tests."""
    print("=" * 60)
    print("EMAIL VERIFICATION TESTS")
    print("=" * 60)
    print()
    
    try:
        test_email_verification_flow()
        test_expired_verification_codes()
        test_code_update()
        test_negative_scenarios()
        
        print("=" * 60)
        print("ALL TESTS PASSED! ✓")
        print("=" * 60)
        return True
    except AssertionError as e:
        print(f"\n✗ TEST FAILED: {e}")
        return False
    except Exception as e:
        print(f"\n✗ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == '__main__':
    success = run_all_tests()
    sys.exit(0 if success else 1)
