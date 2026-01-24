#!/usr/bin/env python3
"""
Test attachment deletion functionality
"""

import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from database import Database
from datetime import datetime
import base64

def test_attachment_deletion():
    """Test creating and deleting attachments."""
    print("Testing attachment deletion...")
    
    # Use test database
    db = Database('postgresql://decentra:decentra@localhost:5432/decentra_test')
    
    try:
        # Create a test user
        username = f"test_attach_user_{datetime.now().timestamp()}"
        db.create_user(username, "test_hash")
        
        # Save a test message
        message_id = db.save_message(username, "Test message with attachment", "dm", "test_dm")
        assert message_id is not None, "Failed to save message"
        
        # Save a test attachment
        attachment_id = f"attach_{datetime.now().timestamp()}"
        test_data = base64.b64encode(b"test file data").decode()
        result = db.save_attachment(
            attachment_id, 
            message_id, 
            "test.txt", 
            "text/plain", 
            14, 
            test_data
        )
        assert result, "Failed to save attachment"
        
        # Verify attachment exists
        attachment = db.get_attachment(attachment_id)
        assert attachment is not None, "Attachment not found after creation"
        assert attachment['filename'] == "test.txt", "Attachment filename mismatch"
        
        # Delete the attachment
        delete_result = db.delete_attachment(attachment_id)
        assert delete_result, "Failed to delete attachment"
        
        # Verify attachment is gone
        attachment_after = db.get_attachment(attachment_id)
        assert attachment_after is None, "Attachment still exists after deletion"
        
        print("✓ Attachment deletion test passed")
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
    success = test_attachment_deletion()
    sys.exit(0 if success else 1)
