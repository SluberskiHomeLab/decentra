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


class EncryptionManager:
    """Manages encryption and decryption of sensitive data."""
    
    def __init__(self):
        """Initialize encryption manager with a key from environment or generated."""
        # Get encryption key from environment or generate one
        self.encryption_key = self._get_or_generate_key()
        self.fernet = Fernet(self.encryption_key)
    
    def _get_or_generate_key(self) -> bytes:
        """
        Get encryption key from environment variable.
        
        The key is derived from DECENTRA_ENCRYPTION_KEY environment variable.
        This environment variable is REQUIRED for the application to start.
        
        Returns:
            bytes: Fernet encryption key
            
        Raises:
            RuntimeError: If DECENTRA_ENCRYPTION_KEY is not set
        """
        # Try to get key from environment
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
            raise RuntimeError("DECENTRA_ENCRYPTION_KEY environment variable is required but not set")
        
        # Derive a proper Fernet key from the environment variable
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b'decentra_smtp_salt',  # Fixed salt for deterministic key derivation
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(env_key.encode()))
        return key
    
    def encrypt(self, plaintext: str) -> str:
        """
        Encrypt a plaintext string.
        
        Args:
            plaintext: String to encrypt
            
        Returns:
            str: Base64-encoded encrypted string
            
        Raises:
            RuntimeError: If encryption fails
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
        
        Provides backward compatibility by detecting plaintext data and returning it as-is.
        This allows migration from plaintext to encrypted storage without breaking existing data.
        
        Args:
            encrypted: Base64-encoded encrypted string (or plaintext for backward compatibility)
            
        Returns:
            str: Decrypted plaintext string
        """
        if not encrypted:
            return ''
        
        # First check if this looks like encrypted data
        try:
            encrypted_bytes = base64.urlsafe_b64decode(encrypted.encode('utf-8'))
            decrypted_bytes = self.fernet.decrypt(encrypted_bytes)
            return decrypted_bytes.decode('utf-8')
        except Exception:
            # If decryption fails, check if it's valid base64 encrypted data
            # If not, it's likely plaintext (for backward compatibility)
            try:
                # Try to verify it's at least valid base64
                base64.urlsafe_b64decode(encrypted.encode('utf-8'))
                # If we get here, it's base64 but invalid encryption
                print(f"[Encryption] Warning: Data appears encrypted but decryption failed. Possible key mismatch.")
                raise RuntimeError("Failed to decrypt data - encryption key may have changed")
            except Exception:
                # Not valid base64, assume it's plaintext (backward compatibility)
                print(f"[Encryption] Warning: Detected plaintext data. Consider re-encrypting for security.")
                return encrypted
    
    def is_encrypted(self, data: str) -> bool:
        """
        Check if data appears to be encrypted.
        
        Args:
            data: String to check
            
        Returns:
            bool: True if data appears to be encrypted
        """
        if not data:
            return False
        
        try:
            # Try to decode as base64 and decrypt
            encrypted_bytes = base64.urlsafe_b64decode(data.encode('utf-8'))
            self.fernet.decrypt(encrypted_bytes)
            return True
        except Exception:
            return False


# Global encryption manager instance
_encryption_manager: Optional[EncryptionManager] = None


def get_encryption_manager() -> EncryptionManager:
    """
    Get or create the global encryption manager instance.
    
    Returns:
        EncryptionManager: Global encryption manager
    """
    global _encryption_manager
    if _encryption_manager is None:
        _encryption_manager = EncryptionManager()
    return _encryption_manager


def reset_encryption_manager() -> None:
    """
    Reset the global encryption manager instance.
    
    This function is intended for testing purposes only.
    It clears the cached encryption manager so that a new one
    will be created on the next call to get_encryption_manager().
    """
    global _encryption_manager
    _encryption_manager = None
