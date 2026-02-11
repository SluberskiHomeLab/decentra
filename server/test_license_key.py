#!/usr/bin/env python3
"""Test script to validate a license key"""

import base64
import json

# The license key from the user
license_key = "eyJsaWNlbnNlX2lkIjoiTElDLTIwMjYwMjEwLTA4MlUzIiwiY3VzdG9tZXIiOnsibmFtZSI6IkRlY2VudHJhIFNURyIsImVtYWlsIjoibWF0dGhld0BkZWNlbnRyYWNoYXQuY2MiLCJjb21wYW55IjoiRGVjZW50cmEifSwidGllciI6Im9mZl90aGVfd2FsbHMiLCJmZWF0dXJlcyI6eyJ2b2ljZV9jaGF0Ijp0cnVlLCJmaWxlX3VwbG9hZHMiOnRydWUsIndlYmhvb2tzIjp0cnVlLCJjdXN0b21fZW1vamlzIjp0cnVlLCJhdWRpdF9sb2dzIjp0cnVlLCJzc28iOnRydWV9LCJsaW1pdHMiOnsibWF4X3VzZXJzIjotMSwibWF4X3NlcnZlcnMiOi0xLCJtYXhfY2hhbm5lbHNfcGVyX3NlcnZlciI6LTEsIm1heF9maWxlX3NpemVfbWIiOi0xLCJtYXhfbWVzc2FnZXNfaGlzdG9yeSI6LTEsInZpZGVvX3F1YWxpdHkiOiI0ayIsInNjcmVlbnNoYXJpbmdfcXVhbGl0eSI6IjRrIn0sImlzc3VlZF9hdCI6IjIwMjYtMDItMTBUMjI6NDE6NTcuNjkyMDkxKzAwOjAwIiwiZXhwaXJlc19hdCI6bnVsbH0=.h5agvATOBz5DAEb3VWR+PagP0UhEPmGp873Yc+DMYcTvOQHCW7Fp91+07MgoPG7lGCOTe3SEmKiAf+/cxzB9NLf1H6zh/c5AZPjwvRQcYpBzZ1dFh0qK7G+2s/esGKvlYuVqjbiPfTSEw6PRAeIhOZNqYUokcVu8DwqiesDOVCGrQW+t+oN1+YfmrombQtoink4UFqBgS9LLGFX+bVi4XfQ68iiiEuN4PFK+C1g/acLJUhpF4QEo+VoPD6gmQ2fwDfiOcs6uASVsMnY1lsGrxNzCN6cJv9Mxh3wrnXBzhmns2HcopxfB0HcxOdTw4jrhG3fy0hg+z2K0AhtvHrCywQ=="

print("="*70)
print("Testing License Key Format")
print("="*70)
print(f"License key length: {len(license_key)}")
print()

# Test splitting by dot
parts = license_key.split(".")
print(f"Parts after splitting by '.': {len(parts)}")
if len(parts) == 2:
    print(f"  Part 1 length: {len(parts[0])}")
    print(f"  Part 2 length: {len(parts[1])}")
    print()
    
    # Try to decode part 1 (JSON)
    try:
        json_bytes = base64.b64decode(parts[0])
        print(f"✓ Part 1 decoded successfully ({len(json_bytes)} bytes)")
        try:
            license_data = json.loads(json_bytes.decode('utf-8'))
            print(f"✓ Part 1 is valid JSON")
            print(f"  License ID: {license_data.get('license_id')}")
            print(f"  Tier: {license_data.get('tier')}")
            print(f"  Customer: {license_data.get('customer', {}).get('name')}")
            print(f"  Expires: {license_data.get('expires_at')}")
        except Exception as e:
            print(f"✗ Part 1 JSON parse failed: {e}")
    except Exception as e:
        print(f"✗ Part 1 base64 decode failed: {e}")
    print()
    
    # Try to decode part 2 (signature)
    try:
        sig_bytes = base64.b64decode(parts[1])
        print(f"✓ Part 2 decoded successfully ({len(sig_bytes)} bytes)")
        print(f"  Expected signature size for RSA-2048: 256 bytes")
        print(f"  Expected signature size for RSA-4096: 512 bytes")
    except Exception as e:
        print(f"✗ Part 2 base64 decode failed: {e}")
else:
    print(f"✗ Expected 2 parts, got {len(parts)}")
    for i, part in enumerate(parts[:5]):  # Show first 5 parts
        print(f"  Part {i+1}: {part[:50]}...")

print()
print("="*70)
