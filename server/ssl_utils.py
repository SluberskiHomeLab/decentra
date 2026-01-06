"""
SSL/TLS utilities for generating self-signed certificates.
"""

import os
import ssl
import ipaddress
from datetime import datetime, timedelta, timezone
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization


def generate_self_signed_cert(cert_dir='certs', cert_file='cert.pem', key_file='key.pem'):
    """
    Generate a self-signed SSL certificate for local HTTPS.
    
    Args:
        cert_dir: Directory to store certificates
        cert_file: Certificate file name
        key_file: Private key file name
    
    Returns:
        tuple: (cert_path, key_path)
    """
    # Create certs directory if it doesn't exist
    os.makedirs(cert_dir, exist_ok=True)
    
    cert_path = os.path.join(cert_dir, cert_file)
    key_path = os.path.join(cert_dir, key_file)
    
    # Check if certificate already exists and is valid
    if os.path.exists(cert_path) and os.path.exists(key_path):
        try:
            # Load existing certificate and check validity
            with open(cert_path, 'rb') as f:
                cert = x509.load_pem_x509_certificate(f.read())
                # Check if certificate is currently valid (within its validity window)
                # Note: X.509 certificates store times as timezone-naive UTC by design.
                # We use timezone-aware datetime to ensure we're working in UTC, then
                # convert to timezone-naive for comparison with the certificate times.
                now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
                if cert.not_valid_before <= now_utc <= cert.not_valid_after:
                    print(f"Using existing SSL certificate from {cert_path}")
                    print(f"Certificate valid until: {cert.not_valid_after}")
                    return cert_path, key_path
                elif cert.not_valid_after <= now_utc:
                    print("Existing certificate has expired, generating new one...")
                else:
                    print("Existing certificate is not yet valid, generating new one...")
        except Exception as e:
            print(f"Error loading existing certificate: {e}")
            print("Generating new certificate...")
    
    print("Generating new self-signed SSL certificate...")
    
    # Generate private key
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    
    # Create certificate subject
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, u"US"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, u"Local"),
        x509.NameAttribute(NameOID.LOCALITY_NAME, u"Local"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, u"Decentra"),
        x509.NameAttribute(NameOID.COMMON_NAME, u"localhost"),
    ])
    
    # Build certificate with timezone-aware datetime (converted to UTC for storage)
    now_utc = datetime.now(timezone.utc)
    cert = x509.CertificateBuilder().subject_name(
        subject
    ).issuer_name(
        issuer
    ).public_key(
        private_key.public_key()
    ).serial_number(
        x509.random_serial_number()
    ).not_valid_before(
        now_utc
    ).not_valid_after(
        # Certificate valid for 1 year
        now_utc + timedelta(days=365)
    ).add_extension(
        x509.SubjectAlternativeName([
            x509.DNSName(u"localhost"),
            x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
        ]),
        critical=False,
    ).sign(private_key, hashes.SHA256())
    
    # Write private key to file
    with open(key_path, 'wb') as f:
        f.write(private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption()
        ))
    # Restrict private key file permissions to owner read/write only
    os.chmod(key_path, 0o600)
    
    # Write certificate to file
    with open(cert_path, 'wb') as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    
    print(f"SSL certificate generated successfully!")
    print(f"Certificate: {cert_path}")
    print(f"Private key: {key_path}")
    print(f"Valid until: {cert.not_valid_after}")
    
    return cert_path, key_path


def create_ssl_context(cert_path, key_path):
    """
    Create an SSL context for HTTPS server.
    
    Args:
        cert_path: Path to certificate file
        key_path: Path to private key file
    
    Returns:
        ssl.SSLContext: Configured SSL context
    """
    ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ssl_context.load_cert_chain(cert_path, key_path)
    return ssl_context
