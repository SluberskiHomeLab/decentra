# Hybrid Licensing System Implementation Guide

This document provides a complete implementation guide for adding server-based validation to Decentra's existing offline licensing system. The hybrid approach maintains offline cryptographic validation while adding periodic check-ins to a licensing server for enhanced control.

## Overview

**Current System:**
- Offline RSA-2048 signature validation
- License keys are self-contained with features, limits, and expiration
- No network dependency

**Hybrid System:**
- Keep all existing offline validation (backward compatible)
- Add periodic check-ins every 30 days to a licensing server
- Server can revoke licenses, track active installations, and enforce additional policies
- Graceful degradation when offline

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Decentra Application Startup                                │
│                                                              │
│  1. Load license key from DB/env/.license file              │
│  2. Validate RSA signature locally (existing logic)         │
│  3. Check last_license_check_at timestamp                   │
│  4. If > 30 days since last check:                          │
│     ├─ Generate instance fingerprint                        │
│     ├─ Call licensing server API                            │
│     ├─ If revoked: disable features                         │
│     ├─ If valid: update last_check timestamp                │
│     └─ If network error: allow grace period (7 days max)    │
│  5. Apply tier features and limits                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │   Licensing Server    │
                │   (VPS - Flask/FastAPI)│
                │                       │
                │  POST /api/v1/verify  │
                │  - Validate license   │
                │  - Check revocation   │
                │  - Log check-in       │
                │  - Return status      │
                └───────────────────────┘
```

---

## Part 1: Licensing Server (Separate Repository)

### Tech Stack

- **Framework**: FastAPI (recommended) or Flask
- **Database**: PostgreSQL or SQLite
- **Deployment**: Docker on VPS (DigitalOcean, Linode, AWS)

### Server Database Schema

```sql
-- licenses table
CREATE TABLE licenses (
    id SERIAL PRIMARY KEY,
    license_key TEXT UNIQUE NOT NULL,
    license_id TEXT UNIQUE NOT NULL,  -- e.g., LIC-20260209-ABC12
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_company TEXT,
    tier TEXT NOT NULL,  -- 'lite', 'standard', 'elite', etc.
    issued_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP,
    is_revoked BOOLEAN DEFAULT FALSE,
    revoked_at TIMESTAMP,
    revocation_reason TEXT,
    max_installations INTEGER DEFAULT 1,  -- how many instances can use this
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- license_checkins table (track active installations)
CREATE TABLE license_checkins (
    id SERIAL PRIMARY KEY,
    license_id TEXT NOT NULL REFERENCES licenses(license_id),
    instance_fingerprint TEXT NOT NULL,
    instance_hostname TEXT,
    instance_platform TEXT,
    app_version TEXT,
    checked_in_at TIMESTAMP DEFAULT NOW(),
    ip_address TEXT,
    INDEX idx_license_fingerprint (license_id, instance_fingerprint),
    INDEX idx_checked_in_at (checked_in_at)
);

-- Create index for faster lookups
CREATE INDEX idx_license_key ON licenses(license_key);
CREATE INDEX idx_license_id ON licenses(license_id);
```

### API Endpoints

#### POST /api/v1/verify

**Purpose**: Verify a license and record check-in

**Request Body**:
```json
{
    "license_key": "eyJsaWNlbnNlX2lkIjoiTElDLTIw...",
    "instance_fingerprint": "sha256:a1b2c3d4e5f6...",
    "hostname": "decentra-prod-01",
    "platform": "linux",
    "app_version": "1.2.3"
}
```

**Response (200 OK)**:
```json
{
    "valid": true,
    "license_id": "LIC-20260209-ABC12",
    "tier": "standard",
    "expires_at": "2027-02-09T00:00:00Z",
    "is_revoked": false,
    "message": "License is valid"
}
```

**Response (403 Forbidden - Revoked)**:
```json
{
    "valid": false,
    "license_id": "LIC-20260209-ABC12",
    "is_revoked": true,
    "revoked_at": "2026-12-01T10:30:00Z",
    "revocation_reason": "Payment failure",
    "message": "License has been revoked"
}
```

**Response (403 Forbidden - Too Many Installations)**:
```json
{
    "valid": false,
    "license_id": "LIC-20260209-ABC12",
    "message": "Maximum installations exceeded. Allowed: 1, Active: 3"
}
```

**Response (404 Not Found)**:
```json
{
    "valid": false,
    "message": "License key not found in licensing system"
}
```

#### POST /api/v1/admin/revoke

**Purpose**: Revoke a license (admin only)

**Request Headers**:
```
Authorization: Bearer <admin_api_token>
```

**Request Body**:
```json
{
    "license_id": "LIC-20260209-ABC12",
    "reason": "Payment failure"
}
```

**Response**:
```json
{
    "success": true,
    "license_id": "LIC-20260209-ABC12",
    "revoked_at": "2026-02-09T15:30:00Z"
}
```

#### GET /api/v1/admin/licenses/{license_id}/installations

**Purpose**: View active installations for a license

**Response**:
```json
{
    "license_id": "LIC-20260209-ABC12",
    "max_installations": 1,
    "active_installations": [
        {
            "instance_fingerprint": "sha256:a1b2c3d4...",
            "hostname": "decentra-prod-01",
            "platform": "linux",
            "app_version": "1.2.3",
            "last_checkin": "2026-02-09T10:00:00Z",
            "ip_address": "203.0.113.45"
        }
    ]
}
```

### Sample FastAPI Implementation

```python
# licensing_server/main.py

from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel
from datetime import datetime, timezone
import hashlib
import os
from typing import Optional
import asyncpg

app = FastAPI(title="Decentra Licensing Server", version="1.0.0")

# Database connection
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:pass@localhost/licenses")

class VerifyRequest(BaseModel):
    license_key: str
    instance_fingerprint: str
    hostname: Optional[str] = None
    platform: Optional[str] = None
    app_version: Optional[str] = None

class RevokeRequest(BaseModel):
    license_id: str
    reason: str

async def get_db():
    return await asyncpg.connect(DATABASE_URL)

def verify_admin_token(authorization: str = Header(None)):
    """Verify admin API token"""
    expected_token = os.getenv("ADMIN_API_TOKEN")
    if not authorization or authorization != f"Bearer {expected_token}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    return True

@app.post("/api/v1/verify")
async def verify_license(request: VerifyRequest):
    """
    Verify a license and record check-in.

    This endpoint does NOT validate the RSA signature - that's done client-side.
    This endpoint checks:
    1. Does the license exist in our database?
    2. Has it been revoked?
    3. Is the installation count within limits?
    """
    conn = await get_db()

    try:
        # Extract license_id from the key (you'll need to decode base64 and parse JSON)
        # For now, we'll use the full key as lookup
        license_row = await conn.fetchrow(
            """
            SELECT license_id, tier, expires_at, is_revoked,
                   revoked_at, revocation_reason, max_installations
            FROM licenses
            WHERE license_key = $1
            """,
            request.license_key
        )

        if not license_row:
            raise HTTPException(
                status_code=404,
                detail={"valid": False, "message": "License key not found in licensing system"}
            )

        # Check if revoked
        if license_row['is_revoked']:
            raise HTTPException(
                status_code=403,
                detail={
                    "valid": False,
                    "license_id": license_row['license_id'],
                    "is_revoked": True,
                    "revoked_at": license_row['revoked_at'].isoformat(),
                    "revocation_reason": license_row['revocation_reason'],
                    "message": "License has been revoked"
                }
            )

        # Check installation count
        active_installations = await conn.fetch(
            """
            SELECT DISTINCT instance_fingerprint
            FROM license_checkins
            WHERE license_id = $1
              AND checked_in_at > NOW() - INTERVAL '60 days'
            """,
            license_row['license_id']
        )

        max_installations = license_row['max_installations']
        active_count = len(active_installations)

        # Check if this is a new installation
        is_existing = any(
            row['instance_fingerprint'] == request.instance_fingerprint
            for row in active_installations
        )

        if not is_existing and active_count >= max_installations:
            raise HTTPException(
                status_code=403,
                detail={
                    "valid": False,
                    "license_id": license_row['license_id'],
                    "message": f"Maximum installations exceeded. Allowed: {max_installations}, Active: {active_count}"
                }
            )

        # Record check-in
        await conn.execute(
            """
            INSERT INTO license_checkins
                (license_id, instance_fingerprint, instance_hostname,
                 instance_platform, app_version, checked_in_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
            """,
            license_row['license_id'],
            request.instance_fingerprint,
            request.hostname,
            request.platform,
            request.app_version
        )

        # Return success
        return {
            "valid": True,
            "license_id": license_row['license_id'],
            "tier": license_row['tier'],
            "expires_at": license_row['expires_at'].isoformat() if license_row['expires_at'] else None,
            "is_revoked": False,
            "message": "License is valid"
        }

    finally:
        await conn.close()

@app.post("/api/v1/admin/revoke")
async def revoke_license(
    request: RevokeRequest,
    _: bool = Depends(verify_admin_token)
):
    """Revoke a license (admin only)"""
    conn = await get_db()

    try:
        result = await conn.execute(
            """
            UPDATE licenses
            SET is_revoked = TRUE,
                revoked_at = NOW(),
                revocation_reason = $2,
                updated_at = NOW()
            WHERE license_id = $1
            """,
            request.license_id,
            request.reason
        )

        if result == "UPDATE 0":
            raise HTTPException(status_code=404, detail="License not found")

        return {
            "success": True,
            "license_id": request.license_id,
            "revoked_at": datetime.now(timezone.utc).isoformat()
        }

    finally:
        await conn.close()

@app.get("/api/v1/admin/licenses/{license_id}/installations")
async def get_installations(
    license_id: str,
    _: bool = Depends(verify_admin_token)
):
    """Get active installations for a license"""
    conn = await get_db()

    try:
        license_row = await conn.fetchrow(
            "SELECT max_installations FROM licenses WHERE license_id = $1",
            license_id
        )

        if not license_row:
            raise HTTPException(status_code=404, detail="License not found")

        installations = await conn.fetch(
            """
            SELECT DISTINCT ON (instance_fingerprint)
                instance_fingerprint,
                instance_hostname,
                instance_platform,
                app_version,
                checked_in_at as last_checkin,
                ip_address
            FROM license_checkins
            WHERE license_id = $1
              AND checked_in_at > NOW() - INTERVAL '60 days'
            ORDER BY instance_fingerprint, checked_in_at DESC
            """,
            license_id
        )

        return {
            "license_id": license_id,
            "max_installations": license_row['max_installations'],
            "active_installations": [
                {
                    "instance_fingerprint": row['instance_fingerprint'],
                    "hostname": row['instance_hostname'],
                    "platform": row['instance_platform'],
                    "app_version": row['app_version'],
                    "last_checkin": row['last_checkin'].isoformat(),
                    "ip_address": row['ip_address']
                }
                for row in installations
            ]
        }

    finally:
        await conn.close()

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}
```

### Deployment

**Docker Compose** (`docker-compose.yml`):
```yaml
version: '3.8'

services:
  licensing-api:
    build: .
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://license_user:${DB_PASSWORD}@db:5432/licenses
      - ADMIN_API_TOKEN=${ADMIN_API_TOKEN}
    depends_on:
      - db
    restart: unless-stopped

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=licenses
      - POSTGRES_USER=license_user
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - licensing-api
    restart: unless-stopped

volumes:
  postgres_data:
```

**Environment Variables** (`.env`):
```env
DB_PASSWORD=your_secure_db_password_here
ADMIN_API_TOKEN=your_secure_admin_token_here
```

---

## Part 2: Decentra Application Changes

### 2.1 Database Schema Changes

Add columns to the `admin_settings` table to track license validation:

```sql
-- Migration: Add license check-in tracking columns
ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS last_license_check_at TIMESTAMP;
ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS license_server_url TEXT DEFAULT 'https://licenses.decentra.example.com';
ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS license_check_grace_period_days INTEGER DEFAULT 7;
ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS instance_fingerprint TEXT;
```

### 2.2 Instance Fingerprinting

Create a new file: `server/instance_fingerprint.py`

```python
"""
Instance Fingerprinting

Generates a unique, stable identifier for this Decentra instance.
Uses machine ID, hostname, and installation path to create a fingerprint.
"""

import hashlib
import os
import platform
import socket
from typing import Optional

def _get_machine_id() -> Optional[str]:
    """
    Try to read a stable machine identifier.

    - Linux: /etc/machine-id or /var/lib/dbus/machine-id
    - macOS: IOPlatformUUID via ioreg
    - Windows: MachineGuid from registry
    """
    # Linux
    for path in ['/etc/machine-id', '/var/lib/dbus/machine-id']:
        if os.path.exists(path):
            try:
                with open(path, 'r') as f:
                    return f.read().strip()
            except:
                pass

    # macOS
    if platform.system() == 'Darwin':
        try:
            import subprocess
            result = subprocess.run(
                ['ioreg', '-rd1', '-c', 'IOPlatformExpertDevice'],
                capture_output=True,
                text=True,
                timeout=5
            )
            for line in result.stdout.split('\n'):
                if 'IOPlatformUUID' in line:
                    return line.split('"')[3]
        except:
            pass

    # Windows
    if platform.system() == 'Windows':
        try:
            import winreg
            key = winreg.OpenKey(
                winreg.HKEY_LOCAL_MACHINE,
                r'SOFTWARE\Microsoft\Cryptography',
                0,
                winreg.KEY_READ | winreg.KEY_WOW64_64KEY
            )
            value, _ = winreg.QueryValueEx(key, 'MachineGuid')
            winreg.CloseKey(key)
            return value
        except:
            pass

    return None

def _get_hostname() -> str:
    """Get the system hostname."""
    try:
        return socket.gethostname()
    except:
        return "unknown"

def _get_install_path() -> str:
    """Get the absolute path to the server directory."""
    return os.path.abspath(os.path.dirname(__file__))

def generate_instance_fingerprint() -> str:
    """
    Generate a stable fingerprint for this Decentra instance.

    The fingerprint is a SHA-256 hash of:
    - Machine ID (if available)
    - Hostname
    - Installation path

    Returns:
        String in format "sha256:abc123..."
    """
    components = []

    machine_id = _get_machine_id()
    if machine_id:
        components.append(f"machine_id:{machine_id}")

    components.append(f"hostname:{_get_hostname()}")
    components.append(f"install_path:{_get_install_path()}")

    # Create deterministic hash
    fingerprint_data = "|".join(components)
    hash_digest = hashlib.sha256(fingerprint_data.encode('utf-8')).hexdigest()

    return f"sha256:{hash_digest}"

def get_platform_info() -> dict:
    """Get platform information for check-in metadata."""
    return {
        "hostname": _get_hostname(),
        "platform": platform.system().lower(),
        "platform_version": platform.version(),
        "python_version": platform.python_version(),
    }
```

### 2.3 License Validator Modifications

Modify `server/license_validator.py` to add server check-in logic:

**Add these imports at the top:**
```python
import aiohttp
import asyncio
from typing import Optional
from datetime import datetime, timedelta, timezone
```

**Add new methods to the `LicenseValidator` class:**

```python
class LicenseValidator:
    """
    Validates and caches a Decentra license key.

    Supports both offline RSA validation and online check-ins to a licensing server.
    """

    def __init__(self, db_connection=None, license_server_url: Optional[str] = None) -> None:
        self._public_key = _load_public_key()
        self._license_data: Optional[Dict[str, Any]] = None
        self._valid: bool = False
        self._db = db_connection
        self._license_server_url = license_server_url or os.getenv(
            "LICENSE_SERVER_URL",
            "https://licenses.decentra.example.com"
        )

    # ... existing validate_license method stays the same ...

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
```

### 2.4 Server Startup Logic

Modify `server/server.py` to perform license check-in on startup:

**Add this function:**

```python
async def validate_license_on_startup(db):
    """
    Validate the license on server startup.

    Performs both offline validation (RSA signature) and online check-in
    to the licensing server if needed.
    """
    from license_validator import license_validator
    from instance_fingerprint import generate_instance_fingerprint

    logger.info("Performing license validation on startup...")

    # Get license key from environment, file, or database
    license_key = await get_license_key_from_sources(db)

    if not license_key:
        logger.info("No license key found - running in Community tier")
        return

    # Step 1: Validate RSA signature offline (existing logic)
    validation_result = license_validator.validate_license(license_key)

    if not validation_result["valid"]:
        logger.warning(
            f"License validation failed: {validation_result['error']} - "
            "running in Community tier"
        )
        # Store in DB that license is invalid
        await db.execute(
            """
            UPDATE admin_settings
            SET license_tier = 'community',
                license_expires_at = NULL
            WHERE id = 1
            """
        )
        return

    logger.info(f"License signature valid - tier: {license_validator.get_tier()}")

    # Step 2: Check if we need to perform server check-in
    settings = await db.fetchrow("SELECT * FROM admin_settings WHERE id = 1")
    last_check_at = settings['last_license_check_at'] if settings else None
    grace_period_days = settings['license_check_grace_period_days'] if settings else 7
    instance_fingerprint = settings['instance_fingerprint'] if settings else None

    # Generate fingerprint if not exists
    if not instance_fingerprint:
        instance_fingerprint = generate_instance_fingerprint()
        await db.execute(
            "UPDATE admin_settings SET instance_fingerprint = $1 WHERE id = 1",
            instance_fingerprint
        )
        logger.info(f"Generated instance fingerprint: {instance_fingerprint}")

    # Check if we need to contact the server
    if license_validator.should_perform_checkin(last_check_at):
        logger.info("Performing license server check-in (30 days since last check)...")

        checkin_result = await license_validator.perform_server_checkin(
            license_key=license_key,
            instance_fingerprint=instance_fingerprint,
            app_version="1.0.0"  # Get from package.json or version file
        )

        if checkin_result["success"]:
            # Server responded
            if checkin_result["valid"]:
                # License is valid - update last check timestamp
                await db.execute(
                    """
                    UPDATE admin_settings
                    SET last_license_check_at = NOW()
                    WHERE id = 1
                    """
                )
                logger.info("License server check-in successful - license is valid")
            else:
                # License was revoked or invalid
                error_msg = checkin_result.get("error", "Unknown error")
                logger.error(
                    f"License REVOKED by server: {error_msg} - "
                    "downgrading to Community tier"
                )

                # Revoke the license locally
                await db.execute(
                    """
                    UPDATE admin_settings
                    SET license_key = NULL,
                        license_tier = 'community',
                        license_expires_at = NULL,
                        license_customer_name = NULL,
                        license_customer_email = NULL
                    WHERE id = 1
                    """
                )

                # Clear from validator
                license_validator.clear()
        else:
            # Server check-in failed (network error, timeout, etc.)
            if license_validator.is_in_grace_period(last_check_at, grace_period_days):
                days_remaining = (30 + grace_period_days) - (
                    (datetime.now(timezone.utc) - last_check_at).days
                    if last_check_at else 0
                )
                logger.warning(
                    f"License server check-in failed: {checkin_result['error']} - "
                    f"continuing with cached license (grace period: {days_remaining} days remaining)"
                )
            else:
                logger.error(
                    "License server check-in failed and grace period expired - "
                    "downgrading to Community tier"
                )

                # Grace period expired - revoke license
                await db.execute(
                    """
                    UPDATE admin_settings
                    SET license_key = NULL,
                        license_tier = 'community',
                        license_expires_at = NULL
                    WHERE id = 1
                    """
                )
                license_validator.clear()
    else:
        days_since_check = (
            (datetime.now(timezone.utc) - last_check_at).days
            if last_check_at else 0
        )
        logger.info(
            f"License server check-in not needed "
            f"({days_since_check} days since last check, threshold: 30 days)"
        )

async def get_license_key_from_sources(db):
    """
    Get license key from environment variable, .license file, or database.
    Priority: DECENTRA_LICENSE_KEY env var > .license file > database
    """
    # 1. Check environment variable
    env_key = os.getenv("DECENTRA_LICENSE_KEY")
    if env_key:
        return env_key.strip()

    # 2. Check .license file
    license_file = os.path.join(os.path.dirname(__file__), ".license")
    if os.path.exists(license_file):
        try:
            with open(license_file, 'r') as f:
                file_key = f.read().strip()
                if file_key:
                    return file_key
        except Exception as e:
            logger.warning(f"Failed to read .license file: {e}")

    # 3. Check database
    settings = await db.fetchrow("SELECT license_key FROM admin_settings WHERE id = 1")
    if settings and settings['license_key']:
        from database import decrypt_value
        return decrypt_value(settings['license_key'])

    return None
```

**Call this function in your server startup:**

```python
async def main():
    # ... existing setup code ...

    # Initialize database
    db = await get_database_connection()

    # Validate license on startup
    await validate_license_on_startup(db)

    # ... rest of server startup ...
```

### 2.5 Admin UI Updates

Update the License Management panel in `frontend/src/components/admin/LicensePanel.tsx` to show:

- Last check-in date
- Days until next check-in required
- Grace period status (if in grace period)
- "Force Check-in Now" button

**Add to the license info display:**

```typescript
{licenseInfo.lastCheckAt && (
  <div className="license-checkin-status">
    <p>
      Last Server Check-in: {new Date(licenseInfo.lastCheckAt).toLocaleDateString()}
    </p>
    <p>
      Next Check-in: {/* Calculate 30 days from lastCheckAt */}
    </p>
    {licenseInfo.isInGracePeriod && (
      <div className="warning-banner">
        ⚠️ Unable to reach licensing server. Grace period active
        ({licenseInfo.graceDaysRemaining} days remaining)
      </div>
    )}
  </div>
)}

<button onClick={handleForceCheckin}>
  Force Check-in Now
</button>
```

**Add WebSocket handler for manual check-in:**

```python
# In server.py WebSocket handler

elif msg_type == "force_license_checkin":
    if user["id"] != admin_id:
        await websocket.send_json({
            "type": "error",
            "message": "Only admins can force license check-in"
        })
        continue

    # Perform check-in
    license_key = await get_license_key_from_sources(db)
    if not license_key:
        await websocket.send_json({
            "type": "error",
            "message": "No license key configured"
        })
        continue

    settings = await db.fetchrow("SELECT * FROM admin_settings WHERE id = 1")
    instance_fingerprint = settings['instance_fingerprint']

    checkin_result = await license_validator.perform_server_checkin(
        license_key=license_key,
        instance_fingerprint=instance_fingerprint,
        app_version="1.0.0"
    )

    if checkin_result["success"] and checkin_result["valid"]:
        await db.execute(
            "UPDATE admin_settings SET last_license_check_at = NOW() WHERE id = 1"
        )
        await websocket.send_json({
            "type": "license_checkin_success",
            "message": "License check-in successful",
            "data": checkin_result["server_response"]
        })
    else:
        await websocket.send_json({
            "type": "error",
            "message": f"License check-in failed: {checkin_result.get('error', 'Unknown error')}"
        })
```

---

## Part 3: Testing

### Test Scenarios

1. **Initial Activation**
   - Install fresh instance
   - Add license key
   - Verify fingerprint is generated
   - Verify first check-in happens immediately

2. **Normal Check-in Cycle**
   - Wait 30 days (or manually set `last_license_check_at` to 31 days ago)
   - Restart server
   - Verify check-in occurs

3. **Offline Operation**
   - Disconnect from internet
   - Restart server
   - Verify grace period message appears
   - Verify features still work

4. **Grace Period Expiry**
   - Set `last_license_check_at` to 38 days ago
   - Restart with no network
   - Verify server downgrades to Community tier

5. **License Revocation**
   - Revoke license via admin API
   - Force check-in from admin UI
   - Verify immediate downgrade to Community tier

6. **Installation Limit**
   - Create license with `max_installations: 1`
   - Install on two instances with different fingerprints
   - Verify second instance is rejected

### Manual Testing Commands

```bash
# Check instance fingerprint
python -c "from server.instance_fingerprint import generate_instance_fingerprint; print(generate_instance_fingerprint())"

# Manually trigger check-in (via database)
psql decentra -c "UPDATE admin_settings SET last_license_check_at = NOW() - INTERVAL '31 days' WHERE id = 1;"

# View check-in status
psql decentra -c "SELECT last_license_check_at, instance_fingerprint FROM admin_settings WHERE id = 1;"

# Test licensing server API
curl -X POST https://your-license-server.com/api/v1/verify \
  -H "Content-Type: application/json" \
  -d '{
    "license_key": "your_license_key_here",
    "instance_fingerprint": "sha256:abc123...",
    "hostname": "test-host",
    "platform": "linux",
    "app_version": "1.0.0"
  }'
```

---

## Part 4: Security Considerations

### 1. HTTPS Required
Always use HTTPS for the licensing server to prevent man-in-the-middle attacks.

### 2. Rate Limiting
Implement rate limiting on the `/api/v1/verify` endpoint to prevent abuse:

```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@app.post("/api/v1/verify")
@limiter.limit("10/minute")  # Max 10 check-ins per minute per IP
async def verify_license(request: VerifyRequest):
    # ... existing code ...
```

### 3. License Key Privacy
Never log full license keys - only log license IDs.

### 4. Admin API Security
- Use strong, randomly generated admin API tokens
- Rotate tokens regularly
- Consider IP whitelisting for admin endpoints

### 5. Instance Fingerprint Stability
- Fingerprints should remain stable across reboots
- Don't include volatile data (IP addresses, timestamps)
- Handle hardware changes gracefully (allow re-registration)

### 6. Database Encryption
Encrypt license keys at rest in both the licensing server and application databases.

---

## Part 5: Monitoring & Logging

### Licensing Server Logs

Log these events:
- License check-ins (license_id, fingerprint, timestamp)
- Failed check-ins (invalid keys, revoked licenses)
- Admin actions (revocations, modifications)
- Suspicious activity (too many unique fingerprints, rapid check-ins)

### Application Logs

Log these events:
- License validation results (offline signature check)
- Server check-in attempts and results
- Grace period warnings
- License downgrades/upgrades

### Metrics to Track

- Active installations per license
- Check-in frequency distribution
- Grace period activations
- Revocation events
- Average time between check-ins

---

## Part 6: Migration Path

### For Existing Installations

1. **Add columns** to admin_settings (see 2.1)
2. **Deploy updated code** with hybrid validation
3. **First startup**: Generates fingerprint, performs initial check-in
4. **Populate licensing server database**: Import existing license keys

### Backward Compatibility

- Offline-only licenses (not in server DB) still work via RSA validation
- Server returns 404 for unknown licenses → app allows them (offline mode)
- No breaking changes to existing license key format

---

## Summary

This hybrid approach gives you:

✅ **Backward compatible** - existing offline licenses still work
✅ **Remote control** - revoke licenses in real-time (within 30 days)
✅ **Installation tracking** - know how many instances are active
✅ **Graceful degradation** - works offline for 37 days (30 + 7 grace)
✅ **Minimal overhead** - only contacts server every 30 days
✅ **Secure** - combines cryptographic signatures with server validation

The licensing server can be deployed independently and scaled separately from Decentra instances.
