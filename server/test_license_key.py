#!/usr/bin/env python3
"""Test script to validate a license key"""

import base64
import json
import os
import sys

# Read license key from environment variable or stdin
license_key = os.environ.get('LICENSE_KEY')
if not license_key:
    if sys.stdin.isatty():
        print("Please provide a license key:")
        print("  Option 1: Set LICENSE_KEY environment variable")
        print("  Option 2: Pipe the key via stdin: echo 'key' | python test_license_key.py")
        print("  Option 3: Pass as command line argument")
        print()
        if len(sys.argv) > 1:
            license_key = sys.argv[1]
        else:
            sys.exit(1)
    else:
        license_key = sys.stdin.read().strip()

if not license_key:
    print("Error: No license key provided")
    sys.exit(1)

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
