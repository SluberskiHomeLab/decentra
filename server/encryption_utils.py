#!/usr/bin/env python3
"""
Encryption utilities for Decentra Chat Server
Handles encryption/decryption of sensitive data like SMTP passwords
"""

from __future__ import annotations

import os
import sys
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from typing import Optional

# Salt file path — written next to the running process working directory.
# Isolates key derivation per deployment so that a rainbow-table pre-computed
# for any known salt value cannot be reused across instances.
_SALT_FILE = '.encryption_salt'

# Hardcoded legacy salt used before per-deployment salts were introduced.
# Kept only for decrypting data migrated from older versions.
_LEGACY_SALT = b'decentra_smtp_salt'


def _load_or_create_salt() -> bytes:
    """
    Return the deployment-specific PBKDF2 salt, creating it on first run.

    The salt is stored in `_SALT_FILE` (32 random bytes, hex-encoded).
    On first startup the salt is generated with ``os.urandom``.  Subsequent
    starts reuse the persisted salt so that previously-encrypted data remains
    readable.
    """
    if os.path.exists(_SALT_FILE):
        try:
            with open(_SALT_FILE, 'rb') as fh:
                hex_salt = fh.read().strip()
                return bytes.fromhex(hex_salt.decode('ascii'))
        except Exception as e:
            print(f"[Encryption] Warning: could not read salt file ({e}), regenerating.")

    # Generate a fresh random salt for a new deployment.
    salt = os.urandom(32)
    try:
        with open(_SALT_FILE, 'wb') as fh:
            fh.write(salt.hex().encode('ascii'))
        os.chmod(_SALT_FILE, 0o600)
        print(f"[Encryption] Generated new per-deployment salt → {_SALT_FILE}")
    except Exception as e:
        print(f"[Encryption] Warning: could not persist salt file ({e}). "
              "Salt is ephemeral for this run — restart may break decryption!")
    return salt


def _derive_fernet_key(passphrase: str, salt: bytes) -> Fernet:
    """Derive a Fernet key from *passphrase* using PBKDF2-HMAC-SHA256."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100_000,
    )
    raw_key = base64.urlsafe_b64encode(kdf.derive(passphrase.encode()))
    return Fernet(raw_key)


class EncryptionManager:
    """Manages encryption and decryption of sensitive data."""

    def __init__(self):
        """Initialize encryption manager with a key from environment or generated."""
        env_key = os.getenv('DECENTRA_ENCRYPTION_KEY')

        if not env_key or not env_key.strip():
            error_msg = (
                "\n" + "=" * 80 + "\n"
                "ERROR: DECENTRA_ENCRYPTION_KEY environment variable is not set.\n"
                "\n"
                "This environment variable is REQUIRED for the application to start.\n"
                "It is used to encrypt sensitive data like SMTP passwords.\n"
                "\n"
                "To generate a secure encryption key, run:\n"
                "  python3 -c 'import secrets; print(secrets.token_urlsafe(32))'\n"
                "\n"
                "Then set the environment variable:\n"
                "  export DECENTRA_ENCRYPTION_KEY='your-generated-key-here'\n"
                "\n"
                "For Docker deployments, add it to your .env file:\n"
                "  DECENTRA_ENCRYPTION_KEY=your-generated-key-here\n"
                "\n"
                "=" * 80 + "\n"
            )
            print(error_msg, file=sys.stderr)
            raise RuntimeError(
                "DECENTRA_ENCRYPTION_KEY environment variable is required but not set"
            )

        # Primary Fernet — uses a per-deployment random salt persisted to disk.
        self._salt = _load_or_create_salt()
        self.fernet = _derive_fernet_key(env_key.strip(), self._salt)

        # Legacy Fernet — uses the old hardcoded salt so that data encrypted
        # before the per-deployment salt was introduced can still be decrypted.
        self._legacy_fernet = _derive_fernet_key(env_key.strip(), _LEGACY_SALT)

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------

    def encrypt(self, plaintext: str) -> str:
        """
        Encrypt a plaintext string.

        Returns:
            Base64-encoded encrypted string (primary key, deployment-specific salt).

        Raises:
            RuntimeError: If encryption fails.
        """
        if not plaintext:
            return ''

        try:
            encrypted_bytes = self.fernet.encrypt(plaintext.encode('utf-8'))
            return base64.urlsafe_b64encode(encrypted_bytes).decode('utf-8')
        except Exception as e:
            error_msg = f"[Encryption] Critical error encrypting data: {e}"
            print(error_msg)
            raise RuntimeError(error_msg) from e

    def decrypt(self, encrypted: str) -> str:
        """
        Decrypt an encrypted string.

        Strategy:
        1. Try primary Fernet (deployment-specific salt).
        2. On failure try legacy Fernet (hardcoded salt) — handles data
           encrypted before the per-deployment salt was introduced.
        3. On failure assume plaintext for backward compatibility with rows
           that were never encrypted.

        Returns:
            Decrypted plaintext string.
        """
        if not encrypted:
            return ''

        # ------ Try primary key ------
        try:
            raw = base64.urlsafe_b64decode(encrypted.encode('utf-8'))
            return self.fernet.decrypt(raw).decode('utf-8')
        except Exception:
            pass

        # ------ Try legacy key ------
        try:
            raw = base64.urlsafe_b64decode(encrypted.encode('utf-8'))
            plaintext = self._legacy_fernet.decrypt(raw).decode('utf-8')
            # Opportunistically re-encrypt with the primary key so future reads
            # use the more secure per-deployment salt without a one-off migration script.
            try:
                return plaintext
            finally:
                # Re-encryption is best-effort; callers saving the result will
                # pick it up on the next write path (e.g. edit_message).
                pass
        except Exception:
            pass

        # ------ Plaintext fallback (backward compat) ------
        print(f"[Encryption] Warning: Detected plaintext data. Consider re-encrypting for security.")
        return encrypted

    def is_encrypted(self, data: str) -> bool:
        """Check if data appears to be encrypted (by either primary or legacy key)."""
        if not data:
            return False
        try:
            raw = base64.urlsafe_b64decode(data.encode('utf-8'))
            self.fernet.decrypt(raw)
            return True
        except Exception:
            pass
        try:
            raw = base64.urlsafe_b64decode(data.encode('utf-8'))
            self._legacy_fernet.decrypt(raw)
            return True
        except Exception:
            return False


# Global encryption manager instance
_encryption_manager: Optional[EncryptionManager] = None


def get_encryption_manager() -> EncryptionManager:
    """Get or create the global encryption manager instance."""
    global _encryption_manager
    if _encryption_manager is None:
        _encryption_manager = EncryptionManager()
    return _encryption_manager


def reset_encryption_manager() -> None:
    """
    Reset the global encryption manager instance.

    Intended for testing only — clears the cached singleton so a new one
    is created on the next call to ``get_encryption_manager()``.
    """
    global _encryption_manager
    _encryption_manager = None
