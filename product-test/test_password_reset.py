#!/usr/bin/env python3
"""
Test password reset functionality
"""

import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from database import Database
from datetime import datetime, timedelta, timezone
import secrets

def test_password_reset():
    """Test password reset token creation and validation."""
    print("Testing password reset...")
    
    # Use test database
    db = Database('postgresql://decentra:decentra@localhost:5432/decentra_test')
    
    try:
        # Create a test user
        username = f"test_reset_user_{datetime.now().timestamp()}"
        db.create_user(username, "old_hash", email="test@example.com")
        
        # Generate and save reset token
        reset_token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
        result = db.create_password_reset_token(username, reset_token, expires_at)
        assert result, "Failed to create reset token"
        
        # Retrieve the token
        token_data = db.get_password_reset_token(reset_token)
        assert token_data is not None, "Token not found after creation"
        assert token_data['username'] == username, "Token username mismatch"
        assert not token_data['used'], "Token should not be marked as used"
        
        # Update password
        new_hash = "new_hash"
        update_result = db.update_user_password(username, new_hash)
        assert update_result, "Failed to update password"
        
        # Mark token as used
        mark_result = db.mark_reset_token_used(reset_token)
        assert mark_result, "Failed to mark token as used"
        
        # Verify token is marked as used
        used_token_data = db.get_password_reset_token(reset_token)
        assert used_token_data['used'], "Token should be marked as used"
        
        # Verify password was updated
        user = db.get_user(username)
        assert user['password_hash'] == new_hash, "Password was not updated"
        
        # Test cleanup of expired tokens
        db.cleanup_expired_reset_tokens()
        
        print("✓ Password reset test passed")
        return True
        
    except AssertionError as e:
        print(f"✗ Test failed: {e}")
        return False
    except Exception as e:
        print(f"✗ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_password_reset()
    sys.exit(0 if success else 1)
