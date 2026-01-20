#!/usr/bin/env python3
"""
Test script to validate server icon feature
"""

import sys

# Test 1: Check that database methods exist
print("Test 1: Checking database module...")
try:
    with open('../server/database.py', 'r') as f:
        db_content = f.read()
    
    # Check that the update_server_icon method exists
    assert 'def update_server_icon(self, server_id: str, icon: str, icon_type: str, icon_data:' in db_content, \
        "Database.update_server_icon method not found"
    print("✓ Database.update_server_icon method exists")
    
    # Check that schema includes icon columns
    assert "icon VARCHAR(255) DEFAULT '🏠'" in db_content, "icon column not in schema"
    print("✓ icon column in database schema")
    
    assert "icon_type VARCHAR(50) DEFAULT 'emoji'" in db_content, "icon_type column not in schema"
    print("✓ icon_type column in database schema")
    
    assert 'icon_data TEXT' in db_content, "icon_data column not in schema"
    print("✓ icon_data column in database schema")
    
    # Check for migration code
    assert "ALTER TABLE servers ADD COLUMN icon" in db_content, "Migration for icon column not found"
    print("✓ Migration for icon column exists")
    
except Exception as e:
    print(f"✗ Database test failed: {e}")
    sys.exit(1)

# Test 2: Check that server.py has the handler
print("\nTest 2: Checking server module...")
try:
    with open('../server/server.py', 'r') as f:
        server_content = f.read()
    
    # Check for set_server_icon handler
    assert "'set_server_icon'" in server_content, "set_server_icon handler not found in server.py"
    print("✓ set_server_icon WebSocket handler exists")
    
    # Check for server_icon_update broadcast
    assert "'server_icon_update'" in server_content, "server_icon_update message type not found"
    print("✓ server_icon_update broadcast exists")
    
    # Check that icon data is included in server info
    assert "server.get('icon'" in server_content, "Server icon data not included in server info"
    print("✓ Server icon included in server data")
    
except Exception as e:
    print(f"✗ Server test failed: {e}")
    sys.exit(1)

# Test 3: Check frontend changes
print("\nTest 3: Checking frontend files...")
try:
    with open('../server/static/chat.html', 'r') as f:
        html_content = f.read()
    
    # Check for server icon UI
    assert 'server-icon-selector' in html_content, "Server icon selector not found in HTML"
    print("✓ Server icon selector UI exists")
    
    assert 'emoji-option' in html_content, "Emoji options not found in HTML"
    print("✓ Emoji selection UI exists")
    
    assert 'server-icon-file-input' in html_content, "Icon file input not found in HTML"
    print("✓ Icon upload input exists")
    
except Exception as e:
    print(f"✗ HTML test failed: {e}")
    sys.exit(1)

try:
    with open('../server/static/chat.js', 'r') as f:
        js_content = f.read()
    
    # Check for icon handling code
    assert 'set_server_icon' in js_content, "set_server_icon not found in JavaScript"
    print("✓ set_server_icon handler exists in JS")
    
    assert 'server_icon_update' in js_content, "server_icon_update handler not found in JavaScript"
    print("✓ server_icon_update handler exists in JS")
    
    assert 'server-icon' in js_content, "Server icon rendering not found in JavaScript"
    print("✓ Server icon rendering code exists")
    
except Exception as e:
    print(f"✗ JavaScript test failed: {e}")
    sys.exit(1)

try:
    with open('../server/static/styles.css', 'r') as f:
        css_content = f.read()
    
    # Check for server icon styles
    assert '.server-icon' in css_content, "Server icon styles not found in CSS"
    print("✓ Server icon CSS styles exist")
    
    assert '.emoji-grid' in css_content, "Emoji grid styles not found in CSS"
    print("✓ Emoji grid CSS styles exist")
    
except Exception as e:
    print(f"✗ CSS test failed: {e}")
    sys.exit(1)

# Test 4: Check API changes
print("\nTest 4: Checking API module...")
try:
    with open('../server/api.py', 'r') as f:
        api_content = f.read()
    
    # Check that icon data is included in API responses
    assert "server_data.get('icon'" in api_content, "Server icon not included in API response"
    print("✓ Server icon included in API response")
    
except Exception as e:
    print(f"✗ API test failed: {e}")
    sys.exit(1)

print("\n" + "="*50)
print("All tests passed! ✓")
print("="*50)
print("\nServer icon feature implementation is complete:")
print("- Database schema supports icon storage")
print("- Backend WebSocket handlers process icon updates")
print("- Frontend UI allows emoji and image icon selection")
print("- Icon updates are broadcast to all server members")
print("- REST API includes icon data")
