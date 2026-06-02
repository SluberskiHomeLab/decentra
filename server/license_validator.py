"""
Decentra License Validator - Unlocked

All features are enabled and all limits are removed. No license key or
license server contact is required.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

# ---------------------------------------------------------------------------
# All features enabled, all limits removed
# ---------------------------------------------------------------------------

DEFAULT_FEATURES: Dict[str, bool] = {
    "voice_chat": True,
    "file_uploads": True,
    "webhooks": True,
    "custom_emojis": True,
    "audit_logs": True,
    "sso": True,
    "scim": True,
    "soundboard": True,
    "group_dms": True,
}

DEFAULT_LIMITS: Dict[str, int] = {
    "max_users": -1,
    "max_servers": -1,
    "max_channels_per_server": -1,
    "max_file_size_mb": -1,
    "max_messages_history": -1,
    "max_sounds_per_user": -1,
    "max_sound_duration_seconds": -1,
    "max_server_sounds": -1,
}

DEFAULT_QUALITIES: Dict[str, str] = {
    "video_quality": "4k",
    "screensharing_quality": "4k",
}

_TIER_ORDER = ["community", "lite", "standard", "elite", "off_the_walls"]
_TIER_FEATURE_MINIMUMS: Dict[str, str] = {}


class LicenseValidator:
    """Stub validator — always reports off_the_walls tier with all features unlocked."""

    def __init__(self, license_server_url: Optional[str] = None) -> None:
        pass

    def validate_license(self, license_key: str) -> Dict[str, Any]:
        return {"valid": True, "error": None, "license": None}

    def get_feature_enabled(self, feature_name: str) -> bool:
        return True

    def get_limit(self, limit_name: str, default: int = -1) -> int:
        return -1

    def get_quality(self, quality_name: str, default: str = "4k") -> str:
        return DEFAULT_QUALITIES.get(quality_name, "4k")

    def get_tier(self) -> str:
        return "off_the_walls"

    def get_customer_info(self) -> Dict[str, str]:
        return {}

    def get_expiry(self) -> Optional[str]:
        return None

    def is_valid(self) -> bool:
        return True

    def clear(self) -> None:
        pass

    async def perform_server_checkin(self, *args, **kwargs) -> Dict[str, Any]:
        return {"success": True, "valid": True, "error": None, "server_response": None}

    def should_perform_checkin(self, last_check_at) -> bool:
        return False

    def is_in_grace_period(self, last_check_at, grace_period_days: int = 7) -> bool:
        return True


# ---------------------------------------------------------------------------
# Global singleton
# ---------------------------------------------------------------------------

license_validator = LicenseValidator()

# ---------------------------------------------------------------------------
# Module-level convenience functions
# ---------------------------------------------------------------------------


def check_feature_access(feature_name: str) -> bool:
    return True


def check_limit(limit_name: str) -> int:
    return -1


def check_quality(quality_name: str) -> str:
    return DEFAULT_QUALITIES.get(quality_name, "4k")


def enforce_limit(current_count: int, limit_name: str) -> bool:
    return True
