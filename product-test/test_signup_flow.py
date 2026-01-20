#!/usr/bin/env python3
"""
Test script for signup flow with email verification toggle.
This test simulates the signup logic without requiring a database connection.
"""

import sys
import os

# Add server directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

def test_signup_logic():
    """Test the signup decision logic for email verification."""
    print("Testing Signup Flow Logic")
    print("=" * 60)
    
    # Test Case 1: Email verification disabled, SMTP not configured
    print("\nTest 1: Email verification disabled, SMTP not configured")
    admin_settings = {
        'require_email_verification': False,
        'smtp_enabled': False,
        'smtp_host': '',
        'smtp_from_email': ''
    }
    
    # Simulate EmailSender check
    from email_utils import EmailSender
    email_sender = EmailSender(admin_settings)
    should_verify = admin_settings['require_email_verification'] and email_sender.is_configured()
    
    print(f"  require_email_verification: {admin_settings['require_email_verification']}")
    print(f"  SMTP configured: {email_sender.is_configured()}")
    print(f"  Should verify email: {should_verify}")
    assert should_verify == False, "Should NOT require verification"
    print("  ✓ User can signup without email verification")
    
    # Test Case 2: Email verification enabled, SMTP not configured
    print("\nTest 2: Email verification enabled, SMTP not configured")
    admin_settings = {
        'require_email_verification': True,
        'smtp_enabled': True,
        'smtp_host': '',  # Missing required field
        'smtp_from_email': ''  # Missing required field
    }
    
    email_sender = EmailSender(admin_settings)
    should_verify = admin_settings['require_email_verification'] and email_sender.is_configured()
    
    print(f"  require_email_verification: {admin_settings['require_email_verification']}")
    print(f"  SMTP configured: {email_sender.is_configured()}")
    print(f"  Should verify email: {should_verify}")
    assert should_verify == False, "Should NOT require verification (SMTP not configured)"
    print("  ✓ User can signup without email verification (SMTP missing config)")
    
    # Test Case 3: Email verification enabled, SMTP configured
    print("\nTest 3: Email verification enabled, SMTP configured")
    admin_settings = {
        'require_email_verification': True,
        'smtp_enabled': True,
        'smtp_host': 'smtp.example.com',
        'smtp_from_email': 'test@example.com'
    }
    
    email_sender = EmailSender(admin_settings)
    should_verify = admin_settings['require_email_verification'] and email_sender.is_configured()
    
    print(f"  require_email_verification: {admin_settings['require_email_verification']}")
    print(f"  SMTP configured: {email_sender.is_configured()}")
    print(f"  Should verify email: {should_verify}")
    assert should_verify == True, "Should require verification"
    print("  ✓ Email verification will be required")
    
    # Test Case 4: Email verification disabled, SMTP configured
    print("\nTest 4: Email verification disabled, SMTP configured")
    admin_settings = {
        'require_email_verification': False,
        'smtp_enabled': True,
        'smtp_host': 'smtp.example.com',
        'smtp_from_email': 'test@example.com'
    }
    
    email_sender = EmailSender(admin_settings)
    should_verify = admin_settings['require_email_verification'] and email_sender.is_configured()
    
    print(f"  require_email_verification: {admin_settings['require_email_verification']}")
    print(f"  SMTP configured: {email_sender.is_configured()}")
    print(f"  Should verify email: {should_verify}")
    assert should_verify == False, "Should NOT require verification (disabled by admin)"
    print("  ✓ User can signup without email verification (admin disabled it)")
    
    print("\n" + "=" * 60)
    print("✅ All signup flow logic tests passed!")
    return True


if __name__ == '__main__':
    try:
        success = test_signup_logic()
        sys.exit(0 if success else 1)
    except AssertionError as e:
        print(f"\n❌ FAIL: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
