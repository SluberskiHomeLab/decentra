#!/usr/bin/env python3
"""
Test script for authentication workflow.
This test verifies that:
1. Password hashing and verification works correctly
2. JWT token generation and verification works correctly
3. Authentication logic properly rejects invalid credentials
"""

import sys
import os
from datetime import datetime, timezone, timedelta

# Set a fixed JWT secret key and encryption key for tests
os.environ['JWT_SECRET_KEY'] = 'test-jwt-secret-key-for-auth-workflow-testing'
os.environ['DECENTRA_ENCRYPTION_KEY'] = 'test-encryption-key-for-auth-workflow-testing'

# Add server directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

# Mock the database and other dependencies to prevent connection attempts during import
from unittest.mock import MagicMock
sys.modules['database'] = MagicMock()
sys.modules['api'] = MagicMock()
sys.modules['email_utils'] = MagicMock()
sys.modules['ssl_utils'] = MagicMock()

# Import authentication functions from server
from server import verify_password, hash_password, generate_jwt_token, verify_jwt_token


def test_authentication_workflow():
    """Test the authentication workflow."""
    print("Testing Authentication Workflow")
    print("=" * 60)
    
    # Test Case 1: Password hashing
    print("\nTest 1: Password hashing")
    password = 'test_password_123'
    password_hash = hash_password(password)
    assert password_hash is not None, "Password hash should not be None"
    assert password_hash != password, "Hash should be different from password"
    print("  ✓ Password hashing works")
    
    # Test Case 2: Verify correct password
    print("\nTest 2: Verify correct password")
    is_valid = verify_password(password, password_hash)
    assert is_valid, "Valid password should be accepted"
    print("  ✓ Correct password is accepted")
    
    # Test Case 3: Verify incorrect password
    print("\nTest 3: Verify incorrect password")
    is_valid = verify_password('wrong_password', password_hash)
    assert not is_valid, "Invalid password should be rejected"
    print("  ✓ Incorrect password is rejected")
    
    # Test Case 4: Test JWT token generation and verification
    print("\nTest 4: JWT token generation and verification")
    token = generate_jwt_token('test_user')
    assert token is not None, "Token generation should succeed"
    
    verified_username = verify_jwt_token(token)
    assert verified_username == 'test_user', "Token should verify to correct username"
    print("  ✓ JWT token generation and verification works")
    
    # Test Case 5: Test invalid token
    print("\nTest 5: Invalid token rejection")
    invalid_token = "invalid.token.here"
    verified_username = verify_jwt_token(invalid_token)
    assert verified_username is None, "Invalid token should be rejected"
    print("  ✓ Invalid token is rejected")
    
    # Test Case 6: Test expired token
    print("\nTest 6: Expired token rejection")
    import jwt
    from server import JWT_SECRET_KEY, JWT_ALGORITHM
    now_utc = datetime.now(timezone.utc)
    expired_payload = {
        'username': 'expired_user',
        'exp': now_utc - timedelta(hours=1),
        'iat': now_utc - timedelta(hours=25)
    }
    expired_token = jwt.encode(expired_payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    verified_username = verify_jwt_token(expired_token)
    assert verified_username is None, "Expired token should be rejected"
    print("  ✓ Expired token is rejected")
    
    # Test Case 7: Test case sensitivity
    print("\nTest 7: Password case sensitivity")
    is_valid = verify_password('TEST_PASSWORD_123', password_hash)
    assert not is_valid, "Passwords should be case-sensitive"
    print("  ✓ Passwords are case-sensitive")
    
    # Test Case 8: Test empty password
    print("\nTest 8: Empty password rejection")
    is_valid = verify_password('', password_hash)
    assert not is_valid, "Empty password should be rejected"
    print("  ✓ Empty password is rejected")
    
    print("\n" + "=" * 60)
    print("✅ All authentication workflow tests passed!")
    return True


if __name__ == '__main__':
    try:
        success = test_authentication_workflow()
        sys.exit(0 if success else 1)
    except AssertionError as e:
        print(f"\n❌ FAIL: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
