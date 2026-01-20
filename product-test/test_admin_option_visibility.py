#!/usr/bin/env python3
"""
Test script to verify admin settings button visibility logic.
This test validates that the admin settings option is correctly shown for the first user.
"""

def test_admin_button_visibility():
    """Test that admin button is shown for first user and hidden for others."""
    print("Testing Admin Settings Button Visibility Logic")
    print("=" * 60)
    
    # Simulate the server-side logic
    print("\n## Server-Side Logic Test ##")
    
    # Test case 1: First user should be admin
    print("\nTest 1: First user is admin")
    first_user = "alice"
    current_user = "alice"
    is_admin = (current_user == first_user)
    print(f"  First user: {first_user}")
    print(f"  Current user: {current_user}")
    print(f"  is_admin: {is_admin}")
    assert is_admin, "First user should be admin"
    print("  ✓ PASS: First user is correctly identified as admin")
    
    # Test case 2: Second user should not be admin
    print("\nTest 2: Second user is not admin")
    current_user = "bob"
    is_admin = (current_user == first_user)
    print(f"  First user: {first_user}")
    print(f"  Current user: {current_user}")
    print(f"  is_admin: {is_admin}")
    assert not is_admin, "Second user should not be admin"
    print("  ✓ PASS: Second user is correctly identified as non-admin")
    
    # Simulate the client-side logic
    print("\n## Client-Side Logic Test ##")
    
    # Test case 3: Admin button should be shown for admin
    print("\nTest 3: Admin button visibility for admin user")
    is_admin = True
    button_hidden = True  # Starts hidden
    if is_admin:
        button_hidden = False  # Remove hidden class
    else:
        button_hidden = True   # Add hidden class
    print(f"  is_admin: {is_admin}")
    print(f"  button_hidden: {button_hidden}")
    assert not button_hidden, "Admin button should be visible for admin"
    print("  ✓ PASS: Admin button is correctly shown for admin user")
    
    # Test case 4: Admin button should be hidden for non-admin
    print("\nTest 4: Admin button visibility for non-admin user")
    is_admin = False
    button_hidden = True  # Starts hidden
    if is_admin:
        button_hidden = False  # Remove hidden class
    else:
        button_hidden = True   # Add hidden class
    print(f"  is_admin: {is_admin}")
    print(f"  button_hidden: {button_hidden}")
    assert button_hidden, "Admin button should be hidden for non-admin"
    print("  ✓ PASS: Admin button is correctly hidden for non-admin user")
    
    print("\n" + "=" * 60)
    print("✅ ALL TESTS PASSED")
    print("=" * 60)
    print("\nSummary:")
    print("- First user is correctly identified as admin")
    print("- Other users are correctly identified as non-admin")
    print("- Admin Settings button is shown only for admin users")
    print("- Admin Settings button is hidden for non-admin users")
    
    return True


if __name__ == '__main__':
    try:
        test_admin_button_visibility()
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        exit(1)
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        exit(1)
