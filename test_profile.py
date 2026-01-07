#!/usr/bin/env python3
"""
Test script to verify user profile bio and status message functionality

Note: This test requires a running PostgreSQL database. It will skip tests
if PostgreSQL is not available or if DATABASE_URL is not set.
"""

import os
import sys

# Set test encryption key before importing modules that need it
if 'DECENTRA_ENCRYPTION_KEY' not in os.environ:
    os.environ['DECENTRA_ENCRYPTION_KEY'] = 'test-encryption-key-for-profile-tests'

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'server'))

def test_profile():
    print("Testing User Profile Bio and Status Message")
    print("=" * 50)
    
    # Check if DATABASE_URL is set
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        print("⚠ Warning: DATABASE_URL not set")
        print("Skipping test (requires PostgreSQL database)")
        print("\nTo run this test, set DATABASE_URL environment variable:")
        print("  export DATABASE_URL='postgresql://user:password@host:port/database'")
        return
    
    try:
        from database import Database
        import bcrypt
        
        def hash_password(password):
            return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        
        db = Database(db_url)
        print("✓ Connected to database successfully")
    except Exception as e:
        print(f"⚠ Warning: Could not connect to database: {e}")
        print("Skipping test (requires PostgreSQL database)")
        return
    
    # Test 1: Create user and verify default profile fields
    print("\nTest 1: Creating user and checking default profile...")
    test_user = "test_profile_user_" + str(os.getpid())
    
    try:
        db.create_user(test_user, hash_password("password123"))
        user = db.get_user(test_user)
        assert user is not None, "Failed to retrieve user"
        assert user['bio'] == '', "Default bio should be empty"
        assert user['status_message'] == '', "Default status should be empty"
        print("✓ User created with empty bio and status")
        
        # Test 2: Update profile with bio and status
        print("\nTest 2: Updating profile with bio and status...")
        db.update_user_profile(test_user, 
                              bio="I love coding!", 
                              status_message="Coding away...")
        user = db.get_user(test_user)
        assert user['bio'] == "I love coding!", "Bio not updated"
        assert user['status_message'] == "Coding away...", "Status not updated"
        print(f"✓ Profile updated - Bio: '{user['bio']}', Status: '{user['status_message']}'")
        
        # Test 3: Update only bio
        print("\nTest 3: Updating only bio...")
        db.update_user_profile(test_user, bio="Updated bio")
        user = db.get_user(test_user)
        assert user['bio'] == "Updated bio", "Bio not updated"
        assert user['status_message'] == "Coding away...", "Status should remain unchanged"
        print(f"✓ Bio updated, status unchanged: '{user['status_message']}'")
        
        # Test 4: Update only status
        print("\nTest 4: Updating only status...")
        db.update_user_profile(test_user, status_message="New status")
        user = db.get_user(test_user)
        assert user['bio'] == "Updated bio", "Bio should remain unchanged"
        assert user['status_message'] == "New status", "Status not updated"
        print(f"✓ Status updated, bio unchanged: '{user['bio']}'")
        
        # Test 5: Clear profile
        print("\nTest 5: Clearing profile...")
        db.update_user_profile(test_user, bio="", status_message="")
        user = db.get_user(test_user)
        assert user['bio'] == "", "Bio not cleared"
        assert user['status_message'] == "", "Status not cleared"
        print("✓ Profile cleared successfully")
        
        # Test 6: Long bio and status
        print("\nTest 6: Testing long bio and status...")
        long_bio = "A" * 500  # Max length
        long_status = "B" * 100  # Max length
        db.update_user_profile(test_user, bio=long_bio, status_message=long_status)
        user = db.get_user(test_user)
        assert len(user['bio']) == 500, "Long bio not saved correctly"
        assert len(user['status_message']) == 100, "Long status not saved correctly"
        print("✓ Maximum length bio and status saved successfully")
        
        # Test 7: Test no-op update
        print("\nTest 7: Testing no-op update (both params None)...")
        db.update_user_profile(test_user, bio=None, status_message=None)
        user = db.get_user(test_user)
        assert len(user['bio']) == 500, "Bio should remain unchanged"
        assert len(user['status_message']) == 100, "Status should remain unchanged"
        print("✓ No-op update handled correctly")
        
        print("\n" + "=" * 50)
        print("All profile tests passed! ✓")
        print("Profile bio and status functionality is working correctly.")
        
    except AssertionError as e:
        print(f"\n✗ Test failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        # Cleanup: attempt to delete test user
        try:
            # Note: There's no delete_user method in the Database class,
            # so we'll just note that cleanup would happen here in a production test
            print(f"\nNote: Test user '{test_user}' was created and should be cleaned up manually if needed.")
        except Exception:
            pass

if __name__ == "__main__":
    test_profile()
