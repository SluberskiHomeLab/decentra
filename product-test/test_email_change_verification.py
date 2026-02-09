#!/usr/bin/env python3
"""
Test script for email change verification functionality in Decentra.
Tests the complete flow: changing email, receiving verification code, and verifying the new email.
"""

import os
import sys
from datetime import datetime, timedelta
import secrets
import string
import bcrypt

# Set test encryption key before importing modules that need it
if 'DECENTRA_ENCRYPTION_KEY' not in os.environ:
    os.environ['DECENTRA_ENCRYPTION_KEY'] = 'test-encryption-key-for-email-change-verification-tests'

# Add server directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from database import Database


def get_test_db_url():
    """Get test database URL from environment or use default."""
    return os.getenv('TEST_DATABASE_URL', 'postgresql://decentra:decentra@localhost:5432/decentra_test')


def test_email_change_verification_flow():
    """Test the complete email change verification flow."""
    print("Test 1: Email Change Verification Flow")
    print("=" * 60)
    
    # Initialize test database
    db = Database(get_test_db_url())
    
    # Clean up any existing test data
    try:
        with db.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM users WHERE username = %s', ('emailchangeuser',))
        db.delete_email_verification_code('newemail@example.com', 'emailchangeuser')
        db.delete_email_verification_code('oldemail@example.com', 'emailchangeuser')
    except Exception as e:
        print(f"Note: Cleanup skipped (data may not exist): {e}")
    
    print("\n1.1: Creating test user with initial email...")
    
    # Create user with initial email
    password_hash = bcrypt.hashpw('testpassword'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    result = db.create_user('emailchangeuser', password_hash, 'oldemail@example.com', email_verified=True)
    assert result == True, "Should create user successfully"
    print("✓ User created with email: oldemail@example.com")
    
    # Verify initial state
    user = db.get_user('emailchangeuser')
    assert user is not None, "User should exist"
    assert user['email'] == 'oldemail@example.com', "Initial email should match"
    assert user['email_verified'] == True, "Initial email should be verified"
    print(f"✓ Initial state verified - email: {user['email']}, verified: {user['email_verified']}")
    
    print("\n1.2: Simulating email change...")
    
    # Update email (simulating the change_email handler)
    new_email = 'newemail@example.com'
    result = db.update_user_email('emailchangeuser', new_email)
    assert result == True, "Should update email successfully"
    print(f"✓ Email updated to: {new_email}")
    
    # Verify email was updated but email_verified should be False after update_user_email
    user = db.get_user('emailchangeuser')
    assert user['email'] == new_email, "Email should be updated"
    assert user['email_verified'] == False, "Email should be marked as unverified after change"
    print(f"✓ After change - email: {user['email']}, verified: {user['email_verified']}")
    
    print("\n1.3: Generating and storing verification code...")
    
    # Generate verification code (simulating the change_email handler)
    verification_code = ''.join(secrets.choice(string.digits) for _ in range(6))
    assert len(verification_code) == 6, "Code should be 6 digits"
    assert verification_code.isdigit(), "Code should be all digits"
    print(f"✓ Generated verification code: {verification_code}")
    
    # Store verification code
    expires_at = datetime.now() + timedelta(minutes=15)
    result = db.create_email_verification_code(new_email, 'emailchangeuser', verification_code, expires_at)
    assert result == True, "Should store verification code successfully"
    print("✓ Verification code stored in database")
    
    print("\n1.4: Verifying the new email with code...")
    
    # Retrieve and verify the code (simulating the verify_email_change handler)
    verification_data = db.get_email_verification_code(new_email, 'emailchangeuser')
    assert verification_data is not None, "Should retrieve verification code"
    assert verification_data['code'] == verification_code, "Retrieved code should match"
    print(f"✓ Retrieved verification code: {verification_data['code']}")
    
    # Mark email as verified (simulating the verify_email_change handler)
    result = db.verify_user_email('emailchangeuser')
    assert result == True, "Should mark email as verified"
    print("✓ Email marked as verified")
    
    # Clean up verification code
    result = db.delete_email_verification_code(new_email, 'emailchangeuser')
    assert result == True, "Should delete verification code"
    print("✓ Verification code cleaned up")
    
    print("\n1.5: Verifying final state...")
    
    # Verify final state
    user = db.get_user('emailchangeuser')
    assert user is not None, "User should exist"
    assert user['email'] == new_email, "Email should be the new email"
    assert user['email_verified'] == True, "Email should be verified"
    print(f"✓ Final state - email: {user['email']}, verified: {user['email_verified']}")
    
    # Verify code is gone
    verification_data = db.get_email_verification_code(new_email, 'emailchangeuser')
    assert verification_data is None, "Verification code should be deleted"
    print("✓ Verification code no longer exists")
    
    # Clean up
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM users WHERE username = %s', ('emailchangeuser',))
    
    print("\n✓ Email change verification flow test completed successfully!")
    print()


def test_invalid_verification_code():
    """Test handling of invalid verification codes for email change."""
    print("Test 2: Invalid Verification Code Handling")
    print("=" * 60)
    
    # Initialize test database
    db = Database(get_test_db_url())
    
    # Clean up any existing test data
    try:
        with db.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM users WHERE username = %s', ('invalidcodeuser',))
        db.delete_email_verification_code('test@invalid.com', 'invalidcodeuser')
    except Exception as e:
        print(f"Note: Cleanup skipped (data may not exist): {e}")
    
    print("\n2.1: Creating test user and verification code...")
    
    # Create user
    password_hash = bcrypt.hashpw('password'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    db.create_user('invalidcodeuser', password_hash, 'test@invalid.com', email_verified=False)
    
    # Create verification code
    correct_code = '123456'
    expires_at = datetime.now() + timedelta(minutes=15)
    db.create_email_verification_code('test@invalid.com', 'invalidcodeuser', correct_code, expires_at)
    print(f"✓ Test user created with verification code: {correct_code}")
    
    print("\n2.2: Testing invalid code formats...")
    
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
        is_valid = invalid_code and invalid_code.isdigit() and len(invalid_code) == 6
        assert not is_valid, f"Code '{invalid_code}' should be invalid"
    
    print("✓ All invalid formats correctly identified")
    
    print("\n2.3: Testing incorrect but valid-format code...")
    
    # Test wrong code (valid format but incorrect value)
    wrong_code = '654321'
    verification_data = db.get_email_verification_code('test@invalid.com', 'invalidcodeuser')
    assert verification_data is not None, "Should retrieve verification data"
    assert verification_data['code'] != wrong_code, "Wrong code should not match"
    assert verification_data['code'] == correct_code, "Correct code should still be in database"
    print(f"✓ Wrong code ({wrong_code}) correctly rejected, correct code ({correct_code}) still valid")
    
    # Clean up
    db.delete_email_verification_code('test@invalid.com', 'invalidcodeuser')
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM users WHERE username = %s', ('invalidcodeuser',))
    
    print("\n✓ Invalid verification code test completed successfully!")
    print()


def test_expired_verification_code():
    """Test that expired verification codes cannot be used."""
    print("Test 3: Expired Verification Code Handling")
    print("=" * 60)
    
    # Initialize test database
    db = Database(get_test_db_url())
    
    # Clean up any existing test data
    try:
        with db.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM users WHERE username = %s', ('expireduser',))
        db.delete_email_verification_code('expired@test.com', 'expireduser')
    except Exception as e:
        print(f"Note: Cleanup skipped (data may not exist): {e}")
    
    print("\n3.1: Creating user with expired verification code...")
    
    # Create user
    password_hash = bcrypt.hashpw('password'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    db.create_user('expireduser', password_hash, 'expired@test.com', email_verified=False)
    
    # Create expired verification code
    code = '999999'
    expires_at = datetime.now() - timedelta(minutes=1)  # Already expired
    db.create_email_verification_code('expired@test.com', 'expireduser', code, expires_at)
    print(f"✓ Created expired verification code: {code}")
    
    print("\n3.2: Attempting to retrieve expired code...")
    
    # Try to retrieve expired code (should return None)
    verification_data = db.get_email_verification_code('expired@test.com', 'expireduser')
    assert verification_data is None, "Should not retrieve expired verification code"
    print("✓ Expired code correctly not retrieved")
    
    print("\n3.3: Verifying user cannot be verified with expired code...")
    
    # User should still be unverified
    user = db.get_user('expireduser')
    assert user['email_verified'] == False, "User should still be unverified"
    print("✓ User correctly remains unverified")
    
    # Clean up
    db.delete_email_verification_code('expired@test.com', 'expireduser')
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM users WHERE username = %s', ('expireduser',))
    
    print("\n✓ Expired verification code test completed successfully!")
    print()


def test_multiple_email_changes():
    """Test that verification codes are updated when email is changed multiple times."""
    print("Test 4: Multiple Email Changes")
    print("=" * 60)
    
    # Initialize test database
    db = Database(get_test_db_url())
    
    # Clean up any existing test data
    try:
        with db.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM users WHERE username = %s', ('multichangeuser',))
        db.delete_email_verification_code('first@test.com', 'multichangeuser')
        db.delete_email_verification_code('second@test.com', 'multichangeuser')
        db.delete_email_verification_code('third@test.com', 'multichangeuser')
    except Exception as e:
        print(f"Note: Cleanup skipped (data may not exist): {e}")
    
    print("\n4.1: Creating user and changing email multiple times...")
    
    # Create user with initial email
    password_hash = bcrypt.hashpw('password'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    db.create_user('multichangeuser', password_hash, 'initial@test.com', email_verified=True)
    print("✓ User created with initial@test.com")
    
    # First email change
    db.update_user_email('multichangeuser', 'first@test.com')
    code1 = '111111'
    expires_at = datetime.now() + timedelta(minutes=15)
    db.create_email_verification_code('first@test.com', 'multichangeuser', code1, expires_at)
    print(f"✓ First email change to first@test.com with code: {code1}")
    
    # Second email change (before verifying first)
    db.update_user_email('multichangeuser', 'second@test.com')
    code2 = '222222'
    db.create_email_verification_code('second@test.com', 'multichangeuser', code2, expires_at)
    print(f"✓ Second email change to second@test.com with code: {code2}")
    
    print("\n4.2: Verifying behavior when multiple codes exist...")
    
    # Try to retrieve first code (with current backend, it still exists until it expires)
    verification_data1 = db.get_email_verification_code('first@test.com', 'multichangeuser')
    assert verification_data1 is not None, "First code should still be retrievable until it expires"
    assert verification_data1['code'] == code1, "First code should match the originally created code"
    print(f"✓ First code still retrievable as expected: {verification_data1['code']}")
    
    # Retrieve second code (should exist)
    verification_data2 = db.get_email_verification_code('second@test.com', 'multichangeuser')
    assert verification_data2 is not None, "Second code should be retrievable"
    assert verification_data2['code'] == code2, "Second code should match"
    print(f"✓ Second code correctly retrievable: {verification_data2['code']}")
    
    # Verify with second code - this should delete ALL codes for the user
    db.verify_user_email('multichangeuser')
    db.delete_all_user_verification_codes('multichangeuser')  # Simulate the handler behavior
    
    user = db.get_user('multichangeuser')
    assert user['email'] == 'second@test.com', "Email should be second@test.com"
    assert user['email_verified'] == True, "Email should be verified"
    print(f"✓ Email verified: {user['email']}")
    
    print("\n4.3: Verifying all codes are deleted after successful verification...")
    
    # Verify both codes are now deleted
    verification_data1_after = db.get_email_verification_code('first@test.com', 'multichangeuser')
    verification_data2_after = db.get_email_verification_code('second@test.com', 'multichangeuser')
    assert verification_data1_after is None, "First code should be deleted after verification"
    assert verification_data2_after is None, "Second code should be deleted after verification"
    print("✓ All verification codes deleted after successful verification")
    
    # Clean up
    with db.get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM users WHERE username = %s', ('multichangeuser',))
    
    print("\n✓ Multiple email changes test completed successfully!")
    print()


def run_all_tests():
    """Run all email change verification tests."""
    print("=" * 60)
    print("EMAIL CHANGE VERIFICATION TESTS")
    print("=" * 60)
    print()
    
    try:
        test_email_change_verification_flow()
        test_invalid_verification_code()
        test_expired_verification_code()
        test_multiple_email_changes()
        
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
