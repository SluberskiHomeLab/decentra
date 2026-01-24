#!/usr/bin/env python3
"""
Test 2FA (Two-Factor Authentication) functionality
"""

import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from database import Database
from datetime import datetime
import pyotp
import secrets
import string

def generate_backup_codes(count=10):
    """Generate backup codes for 2FA."""
    codes = []
    for _ in range(count):
        code = ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(8))
        codes.append(code)
    return codes

def test_2fa():
    """Test 2FA setup, verification, and backup codes."""
    print("Testing 2FA functionality...")
    
    # Use test database
    db = Database('postgresql://decentra:decentra@localhost:5432/decentra_test')
    
    try:
        # Create a test user
        username = f"test_2fa_user_{datetime.now().timestamp()}"
        db.create_user(username, "test_hash")
        
        # Generate 2FA secret and backup codes
        secret = pyotp.random_base32()
        backup_codes = generate_backup_codes()
        backup_codes_str = ','.join(backup_codes)
        
        # Save 2FA secret
        result = db.create_2fa_secret(username, secret, backup_codes_str)
        assert result, "Failed to create 2FA secret"
        
        # Retrieve 2FA data
        twofa_data = db.get_2fa_secret(username)
        assert twofa_data is not None, "2FA data not found after creation"
        assert twofa_data['secret'] == secret, "Secret mismatch"
        assert not twofa_data['enabled'], "2FA should not be enabled initially"
        
        # Enable 2FA
        enable_result = db.enable_2fa(username)
        assert enable_result, "Failed to enable 2FA"
        
        # Verify 2FA is enabled
        twofa_enabled = db.get_2fa_secret(username)
        assert twofa_enabled['enabled'], "2FA should be enabled"
        
        # Test TOTP code generation and verification
        totp = pyotp.TOTP(secret)
        code = totp.now()
        assert code is not None, "Failed to generate TOTP code"
        assert totp.verify(code), "TOTP verification failed"
        
        # Test backup code usage
        test_code = backup_codes[0]
        use_result = db.use_backup_code(username, test_code)
        assert use_result, "Failed to use backup code"
        
        # Verify backup code was removed
        twofa_after = db.get_2fa_secret(username)
        remaining_codes = twofa_after['backup_codes'].split(',')
        assert test_code not in remaining_codes, "Used backup code should be removed"
        assert len(remaining_codes) == len(backup_codes) - 1, "Backup code count mismatch"
        
        # Test using the same backup code again (should fail)
        use_again = db.use_backup_code(username, test_code)
        assert not use_again, "Should not be able to reuse backup code"
        
        # Disable 2FA
        disable_result = db.disable_2fa(username)
        assert disable_result, "Failed to disable 2FA"
        
        # Verify 2FA is disabled
        twofa_disabled = db.get_2fa_secret(username)
        assert twofa_disabled is None, "2FA data should be removed after disabling"
        
        print("✓ 2FA test passed")
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
    success = test_2fa()
    sys.exit(0 if success else 1)
