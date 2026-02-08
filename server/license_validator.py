"""
Decentra License Validator

Validates signed license keys produced by the create_license.py tool. The
module loads the RSA public key from ``license_public_key.pem`` (located next
to this file) and exposes both a class-based API (``LicenseValidator``) and
module-level convenience functions for quick checks.

If the public key file is missing the module still works -- every check simply
falls back to free-tier defaults so the server can run without a license.
"""

from __future__ import annotations

import base64
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Free-tier defaults (used when no valid license is present)
# ---------------------------------------------------------------------------

DEFAULT_FEATURES: Dict[str, bool] = {
    "voice_chat": False,
    "file_uploads": True,
    "webhooks": False,
    "custom_emojis": False,
    "audit_logs": False,
    "sso": False,
}

DEFAULT_LIMITS: Dict[str, int] = {
    "max_users": 50,
    "max_servers": 1,
    "max_channels_per_server": 10,
    "max_file_size_mb": 10,
    "max_messages_history": 10000,
}

# Path to the public key shipped with the server
_PUBLIC_KEY_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "license_public_key.pem"
)


def _load_public_key():
    """
    Attempt to load the RSA public key from disk.

    Returns ``None`` when the file does not exist so callers can gracefully
    degrade to free-tier behaviour.
    """
    if not os.path.exists(_PUBLIC_KEY_PATH):
        logger.warning(
            "License public key not found at %s -- running in free-tier mode.",
            _PUBLIC_KEY_PATH,
        )
        return None

    with open(_PUBLIC_KEY_PATH, "rb") as f:
        public_key = serialization.load_pem_public_key(f.read())
    return public_key


class LicenseValidator:
    """
    Validates and caches a Decentra license key.

    Usage::

        validator = LicenseValidator()
        result = validator.validate_license(license_key_string)
        if validator.is_valid():
            print(validator.get_tier())
    """

    def __init__(self) -> None:
        self._public_key = _load_public_key()
        self._license_data: Optional[Dict[str, Any]] = None
        self._valid: bool = False

    # ----- core validation ------------------------------------------------

    def validate_license(self, license_key: str) -> Dict[str, Any]:
        """
        Decode, verify and cache a license key.

        Returns a dict with ``"valid"`` (bool), ``"error"`` (str or None),
        and the full ``"license"`` data when valid.
        """
        self._license_data = None
        self._valid = False

        if self._public_key is None:
            return {
                "valid": False,
                "error": "Public key not available; cannot verify license.",
                "license": None,
            }

        # --- Decode base64 ------------------------------------------------
        try:
            raw = base64.b64decode(license_key)
        except Exception:
            return {
                "valid": False,
                "error": "License key is not valid base64.",
                "license": None,
            }

        # --- Split payload and signature ----------------------------------
        separator = b"||"
        # The RSA signature has a fixed length of key_size // 8 bytes.
        sig_len = self._public_key.key_size // 8
        # Ensure there is enough data for "<payload><separator><signature>".
        if len(raw) <= sig_len + len(separator):
            return {
                "valid": False,
                "error": "License key format is invalid (too short).",
                "license": None,
            }

        # The separator must appear immediately before the fixed-length signature.
        sep_index = len(raw) - sig_len - len(separator)
        if sep_index < 0 or raw[sep_index : sep_index + len(separator)] != separator:
            return {
                "valid": False,
                "error": "License key format is invalid (missing or misplaced separator).",
                "license": None,
            }

        json_bytes = raw[:sep_index]
        signature = raw[sep_index + len(separator) :]

        # --- Verify RSA-PSS signature -------------------------------------
        try:
            self._public_key.verify(
                signature,
                json_bytes,
                padding.PSS(
                    mgf=padding.MGF1(hashes.SHA256()),
                    salt_length=padding.PSS.MAX_LENGTH,
                ),
                hashes.SHA256(),
            )
        except InvalidSignature:
            return {
                "valid": False,
                "error": "License signature verification failed.",
                "license": None,
            }

        # --- Parse JSON payload -------------------------------------------
        try:
            license_data = json.loads(json_bytes.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {
                "valid": False,
                "error": "License payload is not valid JSON.",
                "license": None,
            }

        # --- Check expiration ---------------------------------------------
        expires_at_str = license_data.get("expires_at")
        if expires_at_str:
            try:
                expires_at = datetime.fromisoformat(expires_at_str)
                if expires_at.tzinfo is None:
                    expires_at = expires_at.replace(tzinfo=timezone.utc)
                if datetime.now(timezone.utc) > expires_at:
                    return {
                        "valid": False,
                        "error": "License has expired.",
                        "license": license_data,
                    }
            except (ValueError, TypeError):
                return {
                    "valid": False,
                    "error": "License expiration date is malformed.",
                    "license": None,
                }

        # --- All checks passed --------------------------------------------
        self._license_data = license_data
        self._valid = True
        return {
            "valid": True,
            "error": None,
            "license": license_data,
        }

    # ----- accessors ------------------------------------------------------

    def get_feature_enabled(self, feature_name: str) -> bool:
        """Return whether *feature_name* is enabled by the current license."""
        if self._license_data is None:
            return DEFAULT_FEATURES.get(feature_name, False)
        return self._license_data.get("features", {}).get(
            feature_name, DEFAULT_FEATURES.get(feature_name, False)
        )

    def get_limit(self, limit_name: str, default: int = 0) -> int:
        """Return the numeric limit for *limit_name*."""
        if self._license_data is None:
            return DEFAULT_LIMITS.get(limit_name, default)
        return self._license_data.get("limits", {}).get(
            limit_name, DEFAULT_LIMITS.get(limit_name, default)
        )

    def get_tier(self) -> str:
        """Return the tier string (``'free'`` when no license is loaded)."""
        if self._license_data is None:
            return "free"
        return self._license_data.get("tier", "free")

    def get_customer_info(self) -> Dict[str, str]:
        """Return the customer block or an empty dict."""
        if self._license_data is None:
            return {}
        return self._license_data.get("customer", {})

    def get_expiry(self) -> Optional[str]:
        """Return the ISO-8601 expiry string, or ``None``."""
        if self._license_data is None:
            return None
        return self._license_data.get("expires_at")

    def is_valid(self) -> bool:
        """Return ``True`` when a license has been validated successfully."""
        return self._valid

    def clear(self) -> None:
        """Remove the cached license (revert to free-tier defaults)."""
        self._license_data = None
        self._valid = False


# ---------------------------------------------------------------------------
# Global singleton
# ---------------------------------------------------------------------------

license_validator = LicenseValidator()

# ---------------------------------------------------------------------------
# Module-level convenience functions
# ---------------------------------------------------------------------------


def check_feature_access(feature_name: str) -> bool:
    """Quick check: is *feature_name* enabled by the current license?"""
    return license_validator.get_feature_enabled(feature_name)


def check_limit(limit_name: str) -> int:
    """Quick check: return the current numeric limit for *limit_name*."""
    return license_validator.get_limit(limit_name)


def enforce_limit(current_count: int, limit_name: str) -> bool:
    """
    Return ``True`` if *current_count* is within the allowed limit.

    A limit value of ``-1`` means unlimited (always returns ``True``).
    """
    limit = license_validator.get_limit(limit_name)
    if limit == -1:
        return True
    return current_count < limit
