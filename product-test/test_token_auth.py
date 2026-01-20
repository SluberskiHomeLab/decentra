#!/usr/bin/env python3
"""
Test script for JWT token-based authentication.
This test verifies the token generation and verification functionality.
"""

import sys
import os
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

# Set a fixed JWT secret key for tests to ensure consistent behavior
os.environ['JWT_SECRET_KEY'] = 'test-jwt-secret-key-for-consistent-testing'

# Add server directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

# Mock the database and other dependencies to prevent connection attempts during import
sys.modules['database'] = MagicMock()
sys.modules['api'] = MagicMock()
sys.modules['email_utils'] = MagicMock()
sys.modules['ssl_utils'] = MagicMock()

def test_jwt_token_functions():
    """Test JWT token generation and verification."""
    print("Testing JWT Token Authentication")
    print("=" * 60)
    
    # Import the actual JWT helper functions from the server implementation
    from server import generate_jwt_token, verify_jwt_token
    
    # Test Case 1: Generate and verify valid token
    print("\nTest 1: Generate and verify valid token")
    username = "test_user"
    token = generate_jwt_token(username)
    print(f"  Generated token: {token[:20]}...")
    
    verified_username = verify_jwt_token(token)
    print(f"  Verified username: {verified_username}")
    assert verified_username == username, f"Username mismatch: {verified_username} != {username}"
    print("  ✓ Token generation and verification successful")
    
    # Test Case 2: Verify invalid token
    print("\nTest 2: Verify invalid token")
    invalid_token = "invalid.token.here"
    verified_username = verify_jwt_token(invalid_token)
    print(f"  Verified username: {verified_username}")
    assert verified_username is None, "Invalid token should return None"
    print("  ✓ Invalid token correctly rejected")
    
    # Test Case 3: Verify token for different users
    print("\nTest 3: Verify tokens for different users")
    user1 = "alice"
    user2 = "bob"
    token1 = generate_jwt_token(user1)
    token2 = generate_jwt_token(user2)
    
    verified1 = verify_jwt_token(token1)
    verified2 = verify_jwt_token(token2)
    
    assert verified1 == user1, f"Token 1 verification failed"
    assert verified2 == user2, f"Token 2 verification failed"
    assert verified1 != verified2, "Tokens should be different for different users"
    print(f"  User 1: {verified1}")
    print(f"  User 2: {verified2}")
    print("  ✓ Different users have different tokens")
    
    # Test Case 4: Token expiration check (this won't expire in test, just verify structure)
    print("\nTest 4: Verify token has expiration")
    
    # Import jwt for token structure inspection
    import jwt
    
    # Decode without verification to check structure
    decoded = jwt.decode(token, options={"verify_signature": False})
    assert 'exp' in decoded, "Token should have expiration field"
    assert 'iat' in decoded, "Token should have issued-at field"
    assert 'username' in decoded, "Token should have username field"
    
    # Check that expiration is in the future
    exp_time = datetime.fromtimestamp(decoded['exp'], timezone.utc)
    now = datetime.now(timezone.utc)
    assert exp_time > now, "Token expiration should be in the future"
    
    # Check that token expires in approximately 24 hours
    time_diff = exp_time - now
    expected_hours = 24
    assert time_diff.total_seconds() > (expected_hours - 1) * 3600, "Token should expire in ~24 hours"
    assert time_diff.total_seconds() < (expected_hours + 1) * 3600, "Token should expire in ~24 hours"
    
    print(f"  Token issued at: {datetime.fromtimestamp(decoded['iat'], timezone.utc)}")
    print(f"  Token expires at: {exp_time}")
    print(f"  Time until expiration: {time_diff}")
    print("  ✓ Token has proper expiration (24 hours)")
    
    # Test Case 5: Expired token
    print("\nTest 5: Verify expired token is rejected")
    # Create a token that expired 1 hour ago using the same config as server
    from server import JWT_SECRET_KEY, JWT_ALGORITHM
    now_utc = datetime.now(timezone.utc)
    expired_payload = {
        'username': 'expired_user',
        'exp': now_utc - timedelta(hours=1),
        'iat': now_utc - timedelta(hours=25)
    }
    expired_token = jwt.encode(expired_payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    verified_expired = verify_jwt_token(expired_token)
    assert verified_expired is None, "Expired token should be rejected"
    print("  ✓ Expired token correctly rejected")
    
    print("\n" + "=" * 60)
    print("✅ All JWT token authentication tests passed!")
    return True


if __name__ == '__main__':
    try:
        success = test_jwt_token_functions()
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
