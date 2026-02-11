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
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import aiohttp
import asyncio

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Free-tier defaults (used when no valid license is present)
# ---------------------------------------------------------------------------

DEFAULT_FEATURES: Dict[str, bool] = {
    "voice_chat": True,
    "file_uploads": True,
    "webhooks": True,
    "custom_emojis": True,
    "audit_logs": True,
    "sso": False,
}

DEFAULT_LIMITS: Dict[str, int] = {
    "max_users": 30,
    "max_servers": 2,
    "max_channels_per_server": 30,
    "max_file_size_mb": 10,
    "max_messages_history": -1,
    "video_quality": "720p",
    "screensharing_quality": "720p",
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

    Supports both offline RSA validation and online check-ins to a licensing server.

    Usage::

        validator = LicenseValidator()
        result = validator.validate_license(license_key_string)
        if validator.is_valid():
            print(validator.get_tier())
    """

    def __init__(self, license_server_url: Optional[str] = None) -> None:
        self._public_key = _load_public_key()
        self._license_data: Optional[Dict[str, Any]] = None
        self._valid: bool = False
        self._license_server_url = license_server_url or os.getenv(
            "LICENSE_SERVER_URL",
            "https://licensevalidation.decentrachat.cc"
        )

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
        # License key format: base64(json) + "." + base64(signature)
        try:
            parts = license_key.split(".")
            if len(parts) != 2:
                logger.error(f"License key has {len(parts)} parts instead of 2")
                return {
                    "valid": False,
                    "error": "License key format is invalid (missing or misplaced separator).",
                    "license": None,
                }
            
            json_bytes = base64.b64decode(parts[0])
            signature = base64.b64decode(parts[1])
            logger.info(f"Successfully decoded license key: JSON={len(json_bytes)} bytes, Signature={len(signature)} bytes")
        except Exception as e:
            logger.error(f"Base64 decode error: {e}")
            return {
                "valid": False,
                "error": "License key is not valid base64.",
                "license": None,
            }

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
        """Return the tier string (``'community'`` when no license is loaded)."""
        if self._license_data is None:
            return "community"
        return self._license_data.get("tier", "community")

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

    # ----- server check-in methods ----------------------------------------

    async def perform_server_checkin(
        self,
        license_key: str,
        instance_fingerprint: str,
        app_version: str = "1.0.0"
    ) -> Dict[str, Any]:
        """
        Contact the licensing server to verify the license.

        Returns:
            dict with keys: success (bool), valid (bool), error (str or None),
            server_response (dict or None)
        """
        from instance_fingerprint import get_platform_info

        platform_info = get_platform_info()

        payload = {
            "license_key": license_key,
            "instance_fingerprint": instance_fingerprint,
            "hostname": platform_info.get("hostname"),
            "platform": platform_info.get("platform"),
            "app_version": app_version
        }

        try:
            timeout = aiohttp.ClientTimeout(total=10)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(
                    f"{self._license_server_url}/api/v1/verify",
                    json=payload,
                    headers={"Content-Type": "application/json"}
                ) as response:
                    response_data = await response.json()

                    if response.status == 200:
                        logger.info(
                            f"License check-in successful: {response_data.get('license_id')}"
                        )
                        return {
                            "success": True,
                            "valid": True,
                            "error": None,
                            "server_response": response_data
                        }
                    elif response.status == 403:
                        # License revoked or installation limit exceeded
                        logger.warning(
                            f"License validation failed: {response_data.get('message')}"
                        )
                        return {
                            "success": True,
                            "valid": False,
                            "error": response_data.get("message"),
                            "server_response": response_data
                        }
                    elif response.status == 404:
                        # License not found in server database
                        logger.warning(
                            "License not found on licensing server (may be offline-only)"
                        )
                        return {
                            "success": True,
                            "valid": True,  # Allow offline licenses
                            "error": "License not registered on server",
                            "server_response": response_data
                        }
                    else:
                        logger.error(f"Unexpected response from license server: {response.status}")
                        return {
                            "success": False,
                            "valid": None,
                            "error": f"Server returned {response.status}",
                            "server_response": None
                        }
        except asyncio.TimeoutError:
            logger.warning("License server check-in timed out")
            return {
                "success": False,
                "valid": None,
                "error": "Connection timeout",
                "server_response": None
            }
        except aiohttp.ClientError as e:
            logger.warning(f"License server check-in failed: {e}")
            return {
                "success": False,
                "valid": None,
                "error": str(e),
                "server_response": None
            }
        except Exception as e:
            logger.error(f"Unexpected error during license check-in: {e}")
            return {
                "success": False,
                "valid": None,
                "error": str(e),
                "server_response": None
            }

    def should_perform_checkin(self, last_check_at: Optional[datetime]) -> bool:
        """
        Determine if a server check-in is needed.

        Check-in is needed if:
        - Never checked in before (last_check_at is None)
        - More than 30 days since last check-in
        """
        if last_check_at is None:
            return True

        if last_check_at.tzinfo is None:
            last_check_at = last_check_at.replace(tzinfo=timezone.utc)

        days_since_check = (datetime.now(timezone.utc) - last_check_at).days
        return days_since_check >= 30

    def is_in_grace_period(
        self,
        last_check_at: Optional[datetime],
        grace_period_days: int = 7
    ) -> bool:
        """
        Check if we're still within the grace period for failed check-ins.

        Grace period starts AFTER the 30-day check-in window expires.
        Total allowed offline time: 30 days (normal) + 7 days (grace) = 37 days
        """
        if last_check_at is None:
            # No previous check-in - we're in grace period
            return True

        if last_check_at.tzinfo is None:
            last_check_at = last_check_at.replace(tzinfo=timezone.utc)

        days_since_check = (datetime.now(timezone.utc) - last_check_at).days
        max_allowed_days = 30 + grace_period_days  # 37 days total

        return days_since_check < max_allowed_days


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
