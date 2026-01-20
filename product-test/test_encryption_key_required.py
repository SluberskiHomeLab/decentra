#!/usr/bin/env python3
"""
Test script to verify that DECENTRA_ENCRYPTION_KEY is required
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))


class TestEncryptionKeyRequired(unittest.TestCase):
    """Test that encryption key is required for the application to start."""
    
    def setUp(self):
        """Set up test by saving and clearing the encryption key environment variable."""
        # Save the original encryption key for this test instance
        self.original_env = os.environ.get('DECENTRA_ENCRYPTION_KEY')
        
        # Remove the encryption key if it exists
        if 'DECENTRA_ENCRYPTION_KEY' in os.environ:
            del os.environ['DECENTRA_ENCRYPTION_KEY']
        
        # Clear any cached encryption manager using the public API
        from encryption_utils import reset_encryption_manager
        reset_encryption_manager()
    
    def tearDown(self):
        """Restore original environment."""
        # Restore the original encryption key
        if self.original_env is not None:
            os.environ['DECENTRA_ENCRYPTION_KEY'] = self.original_env
        elif 'DECENTRA_ENCRYPTION_KEY' in os.environ:
            del os.environ['DECENTRA_ENCRYPTION_KEY']
        
        # Clear any cached encryption manager using the public API
        from encryption_utils import reset_encryption_manager
        reset_encryption_manager()
    
    def test_encryption_key_missing_raises_error(self):
        """Test that missing encryption key raises RuntimeError."""
        # Ensure the key is not set
        self.assertNotIn('DECENTRA_ENCRYPTION_KEY', os.environ)
        
        # Import encryption_utils module
        from encryption_utils import EncryptionManager
        
        # Creating EncryptionManager should raise RuntimeError
        with self.assertRaises(RuntimeError) as context:
            EncryptionManager()
        
        # Check that the error message is informative
        error_message = str(context.exception)
        self.assertIn("DECENTRA_ENCRYPTION_KEY", error_message)
        self.assertIn("required", error_message.lower())
        
        print("✓ Test passed: EncryptionManager raises RuntimeError when key is missing")
    
    def test_encryption_key_present_succeeds(self):
        """Test that encryption works when key is present."""
        # Set a test encryption key
        os.environ['DECENTRA_ENCRYPTION_KEY'] = 'test_key_for_encryption_testing_12345'
        
        # Import encryption_utils module
        from encryption_utils import EncryptionManager
        
        # Creating EncryptionManager should succeed
        manager = EncryptionManager()
        
        # Test encryption and decryption
        test_text = "This is a test message"
        encrypted = manager.encrypt(test_text)
        decrypted = manager.decrypt(encrypted)
        
        self.assertEqual(test_text, decrypted)
        self.assertNotEqual(test_text, encrypted)
        
        print("✓ Test passed: EncryptionManager works correctly with key present")
    
    def test_get_encryption_manager_fails_without_key(self):
        """Test that get_encryption_manager() fails without key."""
        # Ensure the key is not set
        self.assertNotIn('DECENTRA_ENCRYPTION_KEY', os.environ)
        
        from encryption_utils import get_encryption_manager
        
        # Getting encryption manager should raise RuntimeError
        with self.assertRaises(RuntimeError) as context:
            get_encryption_manager()
        
        error_message = str(context.exception)
        self.assertIn("DECENTRA_ENCRYPTION_KEY", error_message)
        
        print("✓ Test passed: get_encryption_manager() raises RuntimeError when key is missing")
    
    def test_empty_encryption_key_raises_error(self):
        """Test that empty encryption key raises RuntimeError."""
        # Set encryption key to empty string
        os.environ['DECENTRA_ENCRYPTION_KEY'] = ''
        
        # Import encryption_utils module
        from encryption_utils import EncryptionManager
        
        # Creating EncryptionManager should raise RuntimeError
        with self.assertRaises(RuntimeError) as context:
            EncryptionManager()
        
        # Check that the error message is informative
        error_message = str(context.exception)
        self.assertIn("DECENTRA_ENCRYPTION_KEY", error_message)
        self.assertIn("required", error_message.lower())
        
        print("✓ Test passed: EncryptionManager raises RuntimeError when key is empty string")
    
    def test_whitespace_encryption_key_raises_error(self):
        """Test that whitespace-only encryption key raises RuntimeError."""
        # Import encryption_utils module
        from encryption_utils import EncryptionManager, reset_encryption_manager
        
        # Test various whitespace-only values
        whitespace_values = ['   ', '\t', '\n', '  \t\n  ']
        
        for whitespace_key in whitespace_values:
            # Set encryption key to whitespace-only string
            os.environ['DECENTRA_ENCRYPTION_KEY'] = whitespace_key
            
            # Reset any cached encryption manager
            reset_encryption_manager()
            
            # Creating EncryptionManager should raise RuntimeError
            with self.assertRaises(RuntimeError) as context:
                EncryptionManager()
            
            # Check that the error message is informative
            error_message = str(context.exception)
            self.assertIn("DECENTRA_ENCRYPTION_KEY", error_message)
            self.assertIn("required", error_message.lower())
        
        print("✓ Test passed: EncryptionManager raises RuntimeError when key is whitespace-only")


def main():
    """Run the tests."""
    print("Testing Encryption Key Requirement")
    print("=" * 50)
    
    # Run the tests
    suite = unittest.TestLoader().loadTestsFromTestCase(TestEncryptionKeyRequired)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    print("\n" + "=" * 50)
    if result.wasSuccessful():
        print("All encryption key requirement tests passed!")
        return 0
    else:
        print("Some tests failed!")
        return 1


if __name__ == "__main__":
    sys.exit(main())
