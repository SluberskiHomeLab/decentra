#!/usr/bin/env python3
"""
License Key Creator for Decentra

Creates signed license keys using RSA-PSS + SHA256. The generated key encodes
the license metadata (customer info, tier, features, limits, dates) and a
cryptographic signature that the server can verify with the public key.

Usage:
    python create_license.py --tier professional \
        --customer-name "Acme Corp" \
        --customer-email "admin@acme.com" \
        --company "Acme Corp" \
        --duration-days 365 \
        --output-file license.key
"""

import argparse
import base64
import json
import os
import random
import string
import sys
from datetime import datetime, timedelta, timezone

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

PRIVATE_KEY_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "keys", "license_private_key.pem"
)

# ---------------------------------------------------------------------------
# Tier presets
# ---------------------------------------------------------------------------

TIER_PRESETS = {
    "free": {
        "features": {
            "voice_chat": False,
            "file_uploads": True,
            "webhooks": False,
            "custom_emojis": False,
            "audit_logs": False,
            "sso": False,
        },
        "limits": {
            "max_users": 50,
            "max_servers": 1,
            "max_channels_per_server": 10,
            "max_file_size_mb": 10,
            "max_messages_history": 10000,
        },
    },
    "professional": {
        "features": {
            "voice_chat": True,
            "file_uploads": True,
            "webhooks": True,
            "custom_emojis": True,
            "audit_logs": False,
            "sso": False,
        },
        "limits": {
            "max_users": 500,
            "max_servers": 5,
            "max_channels_per_server": 50,
            "max_file_size_mb": 100,
            "max_messages_history": -1,
        },
    },
    "enterprise": {
        "features": {
            "voice_chat": True,
            "file_uploads": True,
            "webhooks": True,
            "custom_emojis": True,
            "audit_logs": True,
            "sso": True,
        },
        "limits": {
            "max_users": -1,
            "max_servers": -1,
            "max_channels_per_server": -1,
            "max_file_size_mb": 500,
            "max_messages_history": -1,
        },
    },
}


def _generate_license_id() -> str:
    """Return a license ID in the format LIC-YYYYMMDD-XXXXX."""
    date_part = datetime.now(timezone.utc).strftime("%Y%m%d")
    random_part = "".join(random.choices(string.ascii_uppercase + string.digits, k=5))
    return f"LIC-{date_part}-{random_part}"


def _load_private_key():
    """Load the RSA private key from the PEM file."""
    if not os.path.exists(PRIVATE_KEY_PATH):
        print(
            f"ERROR: Private key not found at {PRIVATE_KEY_PATH}\n"
            "Run  python generate_keypair.py  first to create the key pair.",
            file=sys.stderr,
        )
        sys.exit(1)

    with open(PRIVATE_KEY_PATH, "rb") as f:
        private_key = serialization.load_pem_private_key(f.read(), password=None)
    return private_key


def create_license(
    customer_name: str,
    customer_email: str,
    company: str,
    tier: str,
    duration_days: int,
) -> tuple:
    """
    Build and sign a license key.

    Returns:
        (license_key_b64, license_data) -- the base64-encoded key string and
        the raw license data dict.
    """
    preset = TIER_PRESETS[tier]
    now = datetime.now(timezone.utc)

    license_data = {
        "license_id": _generate_license_id(),
        "customer": {
            "name": customer_name,
            "email": customer_email,
            "company": company,
        },
        "tier": tier,
        "features": preset["features"],
        "limits": preset["limits"],
        "issued_at": now.isoformat(),
        "expires_at": (now + timedelta(days=duration_days)).isoformat(),
    }

    json_bytes = json.dumps(license_data, separators=(",", ":")).encode("utf-8")

    private_key = _load_private_key()
    signature = private_key.sign(
        json_bytes,
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=padding.PSS.MAX_LENGTH,
        ),
        hashes.SHA256(),
    )

    # Encode payload and signature separately to avoid ambiguous byte delimiters.
    json_b64 = base64.b64encode(json_bytes).decode("ascii")
    signature_b64 = base64.b64encode(signature).decode("ascii")
    license_key = json_b64 + "." + signature_b64
    return license_key, license_data


def main():
    parser = argparse.ArgumentParser(
        description="Create a signed Decentra license key."
    )
    parser.add_argument(
        "--customer-name",
        required=True,
        help="Name of the licensed customer or organisation.",
    )
    parser.add_argument(
        "--customer-email",
        required=True,
        help="Contact email for the customer.",
    )
    parser.add_argument(
        "--company",
        default="",
        help="Company name (optional, defaults to empty string).",
    )
    parser.add_argument(
        "--tier",
        required=True,
        choices=["free", "professional", "enterprise"],
        help="License tier.",
    )
    parser.add_argument(
        "--duration-days",
        type=int,
        default=365,
        help="Number of days the license is valid (default: 365).",
    )
    parser.add_argument(
        "--output-file",
        default=None,
        help="Optional path to write the license key to a file.",
    )

    args = parser.parse_args()

    license_key, license_data = create_license(
        customer_name=args.customer_name,
        customer_email=args.customer_email,
        company=args.company,
        tier=args.tier,
        duration_days=args.duration_days,
    )

    # Print metadata
    print("=" * 60)
    print("  Decentra License Key Created")
    print("=" * 60)
    print(f"  License ID : {license_data['license_id']}")
    print(f"  Customer   : {license_data['customer']['name']}")
    print(f"  Email      : {license_data['customer']['email']}")
    print(f"  Company    : {license_data['customer']['company'] or '(none)'}")
    print(f"  Tier       : {license_data['tier']}")
    print(f"  Issued     : {license_data['issued_at']}")
    print(f"  Expires    : {license_data['expires_at']}")
    print("=" * 60)
    print()
    print("License Key:")
    print(license_key)

    if args.output_file:
        with open(args.output_file, "w", encoding="utf-8") as f:
            f.write(license_key)
        print(f"\nLicense key written to {args.output_file}")


if __name__ == "__main__":
    main()
