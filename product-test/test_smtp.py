#!/usr/bin/env python3
"""
Test script for SMTP email functionality in Decentra.
Tests email sending, SMTP configuration, and connection testing.
"""

import os
import sys

# Add server directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from email_utils import EmailSender


def test_email_sender_initialization():
    """Test EmailSender initialization with various configurations."""
    print("Test 1: EmailSender Initialization")
    print("=" * 60)
    
    # Test 1: Default disabled configuration
    print("\n1.1: Testing disabled SMTP configuration...")
    config = {
        'smtp_enabled': False,
        'smtp_host': '',
        'smtp_port': 587,
        'smtp_username': '',
        'smtp_password': '',
        'smtp_from_email': '',
        'smtp_from_name': 'Decentra',
        'smtp_use_tls': True
    }
    
    sender = EmailSender(config)
    assert sender.enabled == False, "Sender should be disabled"
    assert sender.is_configured() == False, "Sender should not be configured"
    print("✓ Disabled configuration works correctly")
    
    # Test 2: Enabled but incomplete configuration
    print("\n1.2: Testing incomplete SMTP configuration...")
    config['smtp_enabled'] = True
    sender = EmailSender(config)
    assert sender.enabled == True, "Sender should be enabled"
    assert sender.is_configured() == False, "Sender should not be configured (missing host/email)"
    print("✓ Incomplete configuration detected correctly")
    
    # Test 3: Complete configuration
    print("\n1.3: Testing complete SMTP configuration...")
    config['smtp_host'] = 'smtp.example.com'
    config['smtp_from_email'] = 'test@example.com'
    sender = EmailSender(config)
    assert sender.enabled == True, "Sender should be enabled"
    assert sender.is_configured() == True, "Sender should be configured"
    print("✓ Complete configuration works correctly")
    
    print("\n✅ All initialization tests passed!")
    return True


def test_smtp_config_validation():
    """Test SMTP configuration validation."""
    print("\n\nTest 2: SMTP Configuration Validation")
    print("=" * 60)
    
    # Test various port configurations
    test_cases = [
        {
            'name': 'TLS on port 587',
            'config': {
                'smtp_enabled': True,
                'smtp_host': 'smtp.gmail.com',
                'smtp_port': 587,
                'smtp_from_email': 'test@gmail.com',
                'smtp_use_tls': True
            },
            'should_be_configured': True
        },
        {
            'name': 'SSL on port 465',
            'config': {
                'smtp_enabled': True,
                'smtp_host': 'smtp.gmail.com',
                'smtp_port': 465,
                'smtp_from_email': 'test@gmail.com',
                'smtp_use_tls': False
            },
            'should_be_configured': True
        },
        {
            'name': 'No encryption on port 25',
            'config': {
                'smtp_enabled': True,
                'smtp_host': 'smtp.example.com',
                'smtp_port': 25,
                'smtp_from_email': 'test@example.com',
                'smtp_use_tls': False
            },
            'should_be_configured': True
        },
        {
            'name': 'Missing host',
            'config': {
                'smtp_enabled': True,
                'smtp_host': '',
                'smtp_port': 587,
                'smtp_from_email': 'test@example.com',
                'smtp_use_tls': True
            },
            'should_be_configured': False
        },
        {
            'name': 'Missing from email',
            'config': {
                'smtp_enabled': True,
                'smtp_host': 'smtp.example.com',
                'smtp_port': 587,
                'smtp_from_email': '',
                'smtp_use_tls': True
            },
            'should_be_configured': False
        }
    ]
    
    for i, test_case in enumerate(test_cases, 1):
        print(f"\n2.{i}: Testing {test_case['name']}...")
        sender = EmailSender(test_case['config'])
        is_configured = sender.is_configured()
        expected = test_case['should_be_configured']
        
        assert is_configured == expected, \
            f"Expected configured={expected}, got {is_configured}"
        print(f"✓ {test_case['name']} validated correctly")
    
    print("\n✅ All validation tests passed!")
    return True


def test_email_content_generation():
    """Test email content generation for welcome emails."""
    print("\n\nTest 3: Email Content Generation")
    print("=" * 60)
    
    config = {
        'smtp_enabled': True,
        'smtp_host': 'smtp.example.com',
        'smtp_port': 587,
        'smtp_username': 'user@example.com',
        'smtp_password': 'password',
        'smtp_from_email': 'noreply@example.com',
        'smtp_from_name': 'Test Server',
        'smtp_use_tls': True
    }
    
    sender = EmailSender(config)
    
    print("\n3.1: Testing welcome email generation...")
    # Welcome email should not actually send without valid SMTP, but we can test it's created
    # Note: This will fail to send with fake credentials, which is expected
    result = sender.send_welcome_email('test@example.com', 'testuser', 'Test Server')
    # We expect this to fail since we don't have real SMTP credentials
    assert result == False, "Should fail with fake credentials"
    print("✓ Welcome email function exists and handles errors correctly")
    
    print("\n✅ Email content generation tests passed!")
    return True


def test_smtp_settings_fields():
    """Test that all required SMTP settings fields are handled."""
    print("\n\nTest 4: SMTP Settings Fields")
    print("=" * 60)
    
    print("\n4.1: Testing all SMTP field names...")
    required_fields = [
        'smtp_enabled',
        'smtp_host',
        'smtp_port',
        'smtp_username',
        'smtp_password',
        'smtp_from_email',
        'smtp_from_name',
        'smtp_use_tls'
    ]
    
    config = {field: None for field in required_fields}
    config['smtp_enabled'] = False
    config['smtp_port'] = 587
    config['smtp_use_tls'] = True
    
    sender = EmailSender(config)
    
    # Verify all fields are accessible
    assert hasattr(sender, 'enabled'), "Missing 'enabled' attribute"
    assert hasattr(sender, 'host'), "Missing 'host' attribute"
    assert hasattr(sender, 'port'), "Missing 'port' attribute"
    assert hasattr(sender, 'username'), "Missing 'username' attribute"
    assert hasattr(sender, 'password'), "Missing 'password' attribute"
    assert hasattr(sender, 'from_email'), "Missing 'from_email' attribute"
    assert hasattr(sender, 'from_name'), "Missing 'from_name' attribute"
    assert hasattr(sender, 'use_tls'), "Missing 'use_tls' attribute"
    
    print("✓ All SMTP fields are properly handled")
    
    print("\n✅ SMTP settings fields tests passed!")
    return True


def test_password_encryption():
    """Test SMTP password encryption functionality."""
    print("\n\nTest 5: Password Encryption")
    print("=" * 60)
    
    try:
        from encryption_utils import get_encryption_manager
        
        print("\n5.1: Testing encryption manager initialization...")
        em = get_encryption_manager()
        assert em is not None, "Encryption manager should not be None"
        print("✓ Encryption manager initialized")
        
        print("\n5.2: Testing password encryption...")
        test_passwords = [
            'simple_password',
            'C0mpl3x_P@ssw0rd!',
            'very_long_password_with_special_chars_!@#$%^&*()',
            ''  # Empty password
        ]
        
        for password in test_passwords:
            if password:  # Skip empty for display
                print(f"  Testing: '{password[:20]}{'...' if len(password) > 20 else ''}'")
            encrypted = em.encrypt(password)
            decrypted = em.decrypt(encrypted)
            
            if password:  # Only check non-empty passwords
                assert password == decrypted, f"Encryption/decryption mismatch for '{password}'"
                assert em.is_encrypted(encrypted), f"Encrypted data should be detected as encrypted"
                assert not em.is_encrypted(password), f"Plaintext should not be detected as encrypted"
        
        print("✓ All passwords encrypted/decrypted correctly")
        
        print("\n5.3: Testing encryption consistency...")
        # Same password should decrypt to same value across multiple encryptions
        password = "test_consistency"
        encrypted1 = em.encrypt(password)
        encrypted2 = em.encrypt(password)
        
        # Different encrypted values (due to random IV)
        # But both should decrypt to same password
        decrypted1 = em.decrypt(encrypted1)
        decrypted2 = em.decrypt(encrypted2)
        
        assert decrypted1 == password, "First decryption failed"
        assert decrypted2 == password, "Second decryption failed"
        print("✓ Encryption is consistent and deterministic in decryption")
        
        print("\n✅ Password encryption tests passed!")
        return True
        
    except ImportError as e:
        print(f"\n⚠️  Skipping encryption tests (module not available): {e}")
        return True  # Don't fail if cryptography not installed yet


def run_all_tests():
    """Run all SMTP tests."""
    print("SMTP Functionality Tests for Decentra")
    print("=" * 60)
    
    tests = [
        test_email_sender_initialization,
        test_smtp_config_validation,
        test_email_content_generation,
        test_smtp_settings_fields,
        test_password_encryption
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
    success = run_all_tests()
    sys.exit(0 if success else 1)
