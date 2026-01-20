#!/usr/bin/env python3
"""
Test script to verify SSL certificate generation works correctly.
"""

import os
import sys
import ssl
from datetime import datetime, timezone

# Add server directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from ssl_utils import generate_self_signed_cert, create_ssl_context


def test_ssl_certificate_generation():
    """Test SSL certificate generation."""
    print("Testing SSL certificate generation...")
    
    # Use /tmp for test certificates
    cert_dir = '/tmp/test_decentra_certs'
    
    # Clean up any existing test certs
    if os.path.exists(cert_dir):
        import shutil
        shutil.rmtree(cert_dir)
    
    # Generate certificate
    cert_path, key_path = generate_self_signed_cert(cert_dir=cert_dir)
    
    # Verify files were created
    assert os.path.exists(cert_path), f"Certificate file not created: {cert_path}"
    assert os.path.exists(key_path), f"Key file not created: {key_path}"
    
    print(f"✓ Certificate created: {cert_path}")
    print(f"✓ Key created: {key_path}")
    
    # Verify certificate can be loaded
    from cryptography import x509
    with open(cert_path, 'rb') as f:
        cert = x509.load_pem_x509_certificate(f.read())
    
    print(f"✓ Certificate loaded successfully")
    print(f"  Subject: {cert.subject}")
    print(f"  Issuer: {cert.issuer}")
    print(f"  Valid from: {cert.not_valid_before}")
    print(f"  Valid until: {cert.not_valid_after}")
    print(f"  Serial number: {cert.serial_number}")
    
    # Verify certificate is still valid
    # Note: X.509 certificates store times as timezone-naive UTC by design.
    # We use timezone-aware datetime to ensure we're working in UTC, then
    # convert to timezone-naive for comparison with the certificate times.
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    assert cert.not_valid_after > now_utc, "Certificate has expired"
    print(f"✓ Certificate is valid")
    
    # Create SSL context
    ssl_context = create_ssl_context(cert_path, key_path)
    assert isinstance(ssl_context, ssl.SSLContext), "SSL context creation failed"
    print(f"✓ SSL context created successfully")
    
    # Test certificate reuse
    print("\nTesting certificate reuse...")
    cert_path2, key_path2 = generate_self_signed_cert(cert_dir=cert_dir)
    assert cert_path == cert_path2, "Certificate path mismatch"
    assert key_path == key_path2, "Key path mismatch"
    print(f"✓ Existing certificate reused successfully")
    
    print("\n✅ All SSL tests passed!")
    return True


if __name__ == "__main__":
    try:
        test_ssl_certificate_generation()
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
