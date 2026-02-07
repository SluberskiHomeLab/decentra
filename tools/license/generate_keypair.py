#!/usr/bin/env python3
"""
RSA-2048 Key Pair Generator for Decentra Licensing

Generates a private/public key pair used to sign and verify license keys.
The private key MUST be kept secret. The public key ships with Decentra.

Usage:
    python generate_keypair.py
"""

import os
import shutil
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

KEYS_DIR = os.path.join(os.path.dirname(__file__), "keys")
PRIVATE_KEY_PATH = os.path.join(KEYS_DIR, "license_private_key.pem")
PUBLIC_KEY_PATH = os.path.join(KEYS_DIR, "license_public_key.pem")
SERVER_PUBLIC_KEY_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "server", "license_public_key.pem"
)


def generate_keypair():
    os.makedirs(KEYS_DIR, exist_ok=True)

    if os.path.exists(PRIVATE_KEY_PATH):
        print(f"Private key already exists at {PRIVATE_KEY_PATH}")
        print("Delete it first if you want to regenerate.")
        return

    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    with open(PRIVATE_KEY_PATH, "wb") as f:
        f.write(private_pem)

    public_key = private_key.public_key()
    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    with open(PUBLIC_KEY_PATH, "wb") as f:
        f.write(public_pem)

    # Copy public key to server directory
    shutil.copy2(PUBLIC_KEY_PATH, SERVER_PUBLIC_KEY_PATH)

    print("Key pair generated successfully!")
    print(f"  Private key: {PRIVATE_KEY_PATH}  (KEEP SECRET!)")
    print(f"  Public key:  {PUBLIC_KEY_PATH}")
    print(f"  Copied to:   {SERVER_PUBLIC_KEY_PATH}")


if __name__ == "__main__":
    generate_keypair()
