#!/usr/bin/env python3
"""
Test file attachment functionality
"""

import unittest
import sys
import os
import base64

# Add server directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from database import Database


class TestFileAttachments(unittest.TestCase):
    """Test file attachment database operations."""
    
    def setUp(self):
        """Set up test database."""
        # Use test database
        db_url = os.environ.get(
            'DECENTRA_TEST_DATABASE_URL',
            'postgresql://decentra:decentra@localhost:5432/decentra_test'
        )
        self.db = Database(db_url)
        
        # Create a test user
        self.test_username = 'testuser_attachments'
        try:
            self.db.create_user(self.test_username, 'password123')
        except Exception:
            # User might already exist; ignore standard application-level errors
            pass
        
        # Create a test message
        self.message_id = self.db.save_message(
            username=self.test_username,
            content='Test message with attachments',
            context_type='global',
            context_id=None
        )
    
    def test_save_and_retrieve_attachment(self):
        """Test saving and retrieving a file attachment."""
        # Create test file data
        test_data = b'Hello, this is a test file!'
        file_data_b64 = base64.b64encode(test_data).decode('utf-8')
        
        # Save attachment
        attachment_id = 'att_test123'
        filename = 'test.txt'
        content_type = 'text/plain'
        file_size = len(test_data)
        
        success = self.db.save_attachment(
            attachment_id=attachment_id,
            message_id=self.message_id,
            filename=filename,
            content_type=content_type,
            file_size=file_size,
            file_data=file_data_b64
        )
        
        self.assertTrue(success, "Failed to save attachment")
        
        # Retrieve attachment
        attachment = self.db.get_attachment(attachment_id)
        
        self.assertIsNotNone(attachment, "Attachment not found")
        self.assertEqual(attachment['filename'], filename)
        self.assertEqual(attachment['content_type'], content_type)
        self.assertEqual(attachment['file_size'], file_size)
        self.assertEqual(attachment['message_id'], self.message_id)
        
        # Verify file data
        retrieved_data = base64.b64decode(attachment['file_data'])
        self.assertEqual(retrieved_data, test_data)
    
    def test_get_message_attachments(self):
        """Test retrieving all attachments for a message."""
        # Save multiple attachments
        for i in range(3):
            attachment_id = f'att_test_multi_{i}'
            filename = f'test_{i}.txt'
            test_data = f'Test file {i}'.encode()
            file_data_b64 = base64.b64encode(test_data).decode('utf-8')
            
            self.db.save_attachment(
                attachment_id=attachment_id,
                message_id=self.message_id,
                filename=filename,
                content_type='text/plain',
                file_size=len(test_data),
                file_data=file_data_b64
            )
        
        # Get all attachments for the message
        attachments = self.db.get_message_attachments(self.message_id)
        
        # Should have at least 3 attachments (might have more from previous test)
        self.assertGreaterEqual(len(attachments), 3)
        
        # Verify filenames
        filenames = [att['filename'] for att in attachments]
        for i in range(3):
            self.assertIn(f'test_{i}.txt', filenames)
    
    def test_admin_settings_attachment_fields(self):
        """Test that attachment-related admin settings are available."""
        settings = self.db.get_admin_settings()
        
        # Check that attachment settings exist
        self.assertIn('allow_file_attachments', settings)
        self.assertIn('max_attachment_size_mb', settings)
        self.assertIn('attachment_retention_days', settings)
        
        # Check default values
        self.assertIsInstance(settings['allow_file_attachments'], bool)
        self.assertIsInstance(settings['max_attachment_size_mb'], int)
        self.assertIsInstance(settings['attachment_retention_days'], int)
    
    def test_update_admin_settings_attachments(self):
        """Test updating attachment-related admin settings."""
        # Update settings
        new_settings = {
            'allow_file_attachments': False,
            'max_attachment_size_mb': 25,
            'attachment_retention_days': 30
        }
        
        success = self.db.update_admin_settings(new_settings)
        self.assertTrue(success, "Failed to update admin settings")
        
        # Verify settings were updated
        settings = self.db.get_admin_settings()
        self.assertEqual(settings['allow_file_attachments'], False)
        self.assertEqual(settings['max_attachment_size_mb'], 25)
        self.assertEqual(settings['attachment_retention_days'], 30)
        
        # Reset to defaults
        self.db.update_admin_settings({
            'allow_file_attachments': True,
            'max_attachment_size_mb': 10,
            'attachment_retention_days': 0
        })


if __name__ == '__main__':
    unittest.main()
