# Licensing System Research for Decentra

## Executive Summary

This document provides comprehensive research on implementing a licensing system for Decentra, a self-hosted Discord-like chat application. The research covers different implementation approaches, compares solutions, and provides actionable recommendations for the fastest and most effective implementation.

**Recommended Solution**: Hybrid approach combining offline license validation with optional online verification, using JWT-based license keys and database-backed feature management.

---

## Table of Contents

1. [Requirements Analysis](#requirements-analysis)
2. [Licensing System Approaches](#licensing-system-approaches)
3. [Detailed Comparison of Solutions](#detailed-comparison-of-solutions)
4. [Recommended Implementation](#recommended-implementation)
5. [Feature Lockdown Implementation](#feature-lockdown-implementation)
6. [Integration with Decentra](#integration-with-decentra)
7. [Security Considerations](#security-considerations)
8. [Implementation Timeline](#implementation-timeline)
9. [Additional Resources](#additional-resources)

---

## Requirements Analysis

Based on the issue description, the licensing system must support:

### Core Requirements

1. **License Key Validation**: Verify that a license key is legitimate and not expired
2. **Registration Tracking**: Identify who the license is registered to (individual/organization)
3. **Feature Enablement**: Enable or disable features based on license tier
4. **Limit Enforcement**: Apply usage limits (users, servers, storage, etc.) based on license
5. **Feature Lockdown**: Prevent access to premium features without valid license

### Decentra-Specific Context

- **Self-Hosted Application**: Users deploy Decentra on their own infrastructure
- **Python Backend**: Server runs on Python with PostgreSQL database
- **React Frontend**: Modern web interface built with React and TypeScript
- **Existing Auth**: Username/password authentication already implemented
- **Data Encryption**: Application already uses Fernet encryption for sensitive data
- **Multi-Tenant Capable**: Supports multiple users, servers, and channels per deployment

---

## Licensing System Approaches

### 1. Offline License Key Validation (Recommended for Self-Hosted)

**Description**: License keys contain encoded information (license tier, expiration, user info) signed with a private key. Validation happens locally without requiring internet connectivity.

**How It Works**:
- Generate license keys as signed JWT tokens or encrypted strings
- License contains: tier, expiration date, organization name, feature flags, limits
- Server validates signature using public key embedded in application
- No external API calls needed for basic validation

**Pros**:
- ✅ Works in air-gapped/offline environments (critical for self-hosted)
- ✅ Fast validation (no network latency)
- ✅ Simple deployment (no license server needed)
- ✅ Privacy-friendly (no data sent to external servers)
- ✅ Reliable (no dependency on external services)

**Cons**:
- ❌ Cannot revoke licenses remotely without updates
- ❌ Harder to track active usage/analytics
- ❌ License keys could be shared between deployments
- ❌ Requires secure key distribution mechanism

**Best For**: Self-hosted applications like Decentra where customers control infrastructure

---

### 2. Online License Validation

**Description**: License keys are validated against a centralized license server via API calls.

**How It Works**:
- Customer enters license key in application
- Application sends validation request to license server
- License server checks key validity, expiration, feature entitlements
- Server returns allowed features and limits
- Periodic re-validation (heartbeat) to detect revocations

**Pros**:
- ✅ Real-time license revocation capability
- ✅ Accurate usage analytics and telemetry
- ✅ Prevents license key sharing (device fingerprinting)
- ✅ Can enforce concurrent usage limits
- ✅ Easy to update license terms dynamically

**Cons**:
- ❌ Requires internet connectivity (deal-breaker for many self-hosted users)
- ❌ Additional infrastructure costs (license server)
- ❌ Privacy concerns (phone home behavior)
- ❌ Single point of failure (if license server down, app may not work)
- ❌ Added complexity in deployment

**Best For**: SaaS applications or when strong anti-piracy measures are required

---

### 3. Hardware-Based Licensing (Node-Locked)

**Description**: License keys are tied to specific hardware characteristics of the deployment server.

**How It Works**:
- Generate license key based on server hardware identifiers (MAC address, CPU ID, etc.)
- License only valid on that specific hardware
- Prevents license from being used on multiple servers

**Pros**:
- ✅ Prevents license sharing across different servers
- ✅ No ongoing network requirements
- ✅ Strong anti-piracy protection

**Cons**:
- ❌ Poor user experience (licenses break on hardware changes)
- ❌ Difficult to handle VM migrations, Docker deployments
- ❌ Customer support burden (hardware upgrades require new licenses)
- ❌ Not suitable for containerized deployments like Decentra

**Best For**: Traditional server applications with stable hardware, not containerized apps

---

### 4. Floating/Concurrent License Model

**Description**: Licenses allow a specific number of concurrent users/sessions rather than unlimited access.

**How It Works**:
- License specifies max concurrent users (e.g., 25 concurrent users)
- License server tracks active sessions
- New sessions require checking out a license slot
- Sessions release license slot when disconnected

**Pros**:
- ✅ Flexible for organizations (users can share license pool)
- ✅ Better value proposition for customers
- ✅ Accurate usage tracking

**Cons**:
- ❌ Requires online license server
- ❌ Complex implementation (session management, heartbeats)
- ❌ Poor UX when license pool exhausted
- ❌ Not ideal for self-hosted where organization controls all access

**Best For**: Enterprise software with large user pools sharing licenses

---

### 5. Time-Based Subscription Model

**Description**: Licenses grant access for a specific time period (monthly/yearly subscriptions).

**How It Works**:
- License key includes expiration timestamp
- Application checks if current date is before expiration
- Expired licenses disable premium features
- Renewal requires new license key

**Pros**:
- ✅ Recurring revenue model
- ✅ Simple to implement (just check date)
- ✅ Works offline (if expiration is in license key)
- ✅ Natural upgrade/renewal path

**Cons**:
- ❌ Requires time-sync (system clock manipulation risk)
- ❌ License management overhead for customers
- ❌ Customer resistance to subscriptions for self-hosted

**Best For**: SaaS models or managed services

---

### 6. Feature-Based Licensing Tiers

**Description**: Different license tiers unlock different feature sets (Free, Pro, Enterprise).

**How It Works**:
- License key specifies which tier customer purchased
- Application loads feature flags based on tier
- Each tier has predefined capabilities and limits
- Can combine with time-based expiration

**Tiers Example**:
- **Community (Free)**: Unlimited users, 5 servers, text chat only
- **Professional**: Unlimited servers, voice chat, file uploads up to 100MB
- **Enterprise**: All features, unlimited storage, SSO, audit logs, priority support

**Pros**:
- ✅ Clear value proposition for customers
- ✅ Easy to understand and market
- ✅ Simple implementation (if/else based on tier)
- ✅ Natural upsell path

**Cons**:
- ❌ Less flexible than per-feature pricing
- ❌ May bundle features customers don't need
- ❌ Requires careful tier design

**Best For**: Most commercial software products

---

### 7. Usage-Based Licensing

**Description**: License limits based on measurable usage metrics (users, storage, messages, etc.).

**How It Works**:
- License specifies limits: max users, max servers, max storage, etc.
- Application enforces limits in real-time
- Exceeding limits either blocks new resources or requires upgrade
- Usage tracking stored in database

**Metrics for Decentra**:
- Number of registered users
- Number of servers
- Number of channels per server
- Storage space used (attachments)
- Messages per month
- Voice chat minutes

**Pros**:
- ✅ Fair pricing (pay for what you use)
- ✅ Granular control over resources
- ✅ Clear upgrade triggers
- ✅ Prevents abuse/over-provisioning

**Cons**:
- ❌ Complex metering implementation
- ❌ Customer uncertainty about costs
- ❌ Requires monitoring infrastructure
- ❌ Potential for surprise overages

**Best For**: Cloud services, metered SaaS

---

### 8. Hybrid Approach (Recommended)

**Description**: Combines offline validation with optional online verification for best of both worlds.

**How It Works**:
1. **Primary**: Offline JWT-based license key validation
2. **Optional**: Periodic online check for updates/revocation (grace period if offline)
3. **Feature Management**: Database-backed feature flags and limits
4. **Activation**: One-time online activation, then offline validation

**Implementation Flow**:
```
1. Customer enters license key
2. Application validates signature offline (immediate)
3. Optionally contacts license server for activation/verification
4. License details stored in encrypted database
5. Feature flags loaded from database on startup
6. Periodic background check for license updates (non-blocking)
```

**Pros**:
- ✅ Works offline (best for self-hosted)
- ✅ Optional revocation/updates capability
- ✅ Privacy-friendly (minimal phone home)
- ✅ Flexible deployment (works with or without internet)
- ✅ Can track adoption metrics (opt-in)
- ✅ Balanced security and usability

**Cons**:
- ❌ More complex than pure offline
- ❌ Requires implementing both validation methods
- ❌ License server still needed (but non-critical)

**Best For**: Self-hosted applications like Decentra that want optional cloud features

---

## Detailed Comparison of Solutions

| Approach | Implementation Complexity | Self-Hosted Friendly | Anti-Piracy | Flexibility | Recommended for Decentra |
|----------|--------------------------|---------------------|-------------|-------------|-------------------------|
| **Offline Validation** | ⭐⭐ Low | ✅ Excellent | ⚠️ Medium | ⭐⭐⭐ Good | ✅ **Yes** |
| **Online Validation** | ⭐⭐⭐ Medium | ❌ Poor | ✅ Excellent | ⭐⭐⭐⭐ Very Good | ⚠️ Only as optional |
| **Hardware-Based** | ⭐⭐⭐ Medium | ⚠️ Fair | ✅ Excellent | ⭐ Poor | ❌ No (Docker conflicts) |
| **Floating License** | ⭐⭐⭐⭐ High | ❌ Poor | ✅ Excellent | ⭐⭐⭐⭐ Very Good | ❌ No (too complex) |
| **Time-Based** | ⭐ Very Low | ✅ Good | ⚠️ Medium | ⭐⭐ Fair | ⚠️ As component |
| **Feature Tiers** | ⭐⭐ Low | ✅ Excellent | N/A | ⭐⭐⭐ Good | ✅ **Yes** |
| **Usage-Based** | ⭐⭐⭐⭐ High | ⭐⭐ Fair | ⚠️ Medium | ⭐⭐⭐⭐ Very Good | ⚠️ As component |
| **Hybrid** | ⭐⭐⭐ Medium | ✅ Excellent | ⭐⭐⭐ Good | ⭐⭐⭐⭐ Very Good | ✅ **Best Choice** |

---

## Recommended Implementation

### Recommended Solution: Hybrid Offline-First Licensing

For Decentra, the **Hybrid Approach** is recommended, combining:
1. **Offline JWT-based license validation** (primary)
2. **Feature tier system** (Community/Pro/Enterprise)
3. **Usage-based limits** (users, servers, storage)
4. **Optional online verification** (for license updates)

### Why This Approach?

1. **Self-Hosted First**: Works completely offline, respecting customer infrastructure
2. **Simple Deployment**: No external dependencies for core functionality
3. **Flexible Monetization**: Supports both feature tiers and usage limits
4. **Future-Proof**: Can add online features later without breaking offline mode
5. **Fast Implementation**: Leverages existing auth, encryption, and database infrastructure

---

## Feature Lockdown Implementation

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Decentra Application                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         License Management Module                     │  │
│  │  - Load license from database                         │  │
│  │  - Validate JWT signature                             │  │
│  │  - Parse license claims (tier, limits, expiration)   │  │
│  │  - Cache license details in memory                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                         ↓                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Feature Gate System                           │  │
│  │  - Check feature availability before operations       │  │
│  │  - Enforce limits (user count, servers, etc.)         │  │
│  │  - Return appropriate errors for locked features      │  │
│  └──────────────────────────────────────────────────────┘  │
│                         ↓                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Application Features                          │  │
│  │  - Server creation (gated)                            │  │
│  │  - Voice chat (gated)                                 │  │
│  │  - File uploads (gated + size limits)                 │  │
│  │  - User registration (gated by user limit)            │  │
│  │  - Advanced features (SSO, audit logs, etc.)          │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 1. License Key Format (JWT-Based)

**Structure**: Use JSON Web Tokens (JWT) for license keys

```python
# License payload (claims)
{
    "iss": "Decentra",                    # Issuer
    "sub": "customer@company.com",        # Subject (licensee)
    "org": "ACME Corporation",            # Organization name
    "tier": "enterprise",                 # License tier
    "exp": 1735689600,                    # Expiration timestamp
    "iat": 1704153600,                    # Issued at timestamp
    "features": {
        "voice_chat": true,               # Feature flags
        "file_uploads": true,
        "sso": true,
        "audit_logs": true,
        "custom_branding": true
    },
    "limits": {
        "max_users": 500,                 # Resource limits
        "max_servers": 100,
        "max_storage_gb": 1000,
        "max_file_size_mb": 100
    },
    "license_id": "LIC-2024-XXXX",        # Unique license ID
    "version": "1.0"                      # License format version
}
```

**Signed JWT Example**:
```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJEZWNlbnRyYSIsInN1YiI6ImN1c3RvbWVyQGNvbXBhbnkuY29tIiwib3JnIjoiQUNNRSBDb3Jwb3JhdGlvbiIsInRpZXIiOiJlbnRlcnByaXNlIiwiZXhwIjoxNzM1Njg5NjAwLCJmZWF0dXJlcyI6eyJ2b2ljZV9jaGF0Ijp0cnVlLCJmaWxlX3VwbG9hZHMiOnRydWV9LCJsaW1pdHMiOnsibWF4X3VzZXJzIjo1MDB9fQ.signature
```

**Why JWT?**
- Industry standard, well-supported libraries
- Self-contained (no database lookup for validation)
- Cryptographically signed (prevents tampering)
- Readable (base64 encoded, can inspect without private key)
- Supports expiration natively

---

### 2. License Storage in Database

**New Database Table**: `licenses`

```sql
CREATE TABLE licenses (
    id SERIAL PRIMARY KEY,
    license_key TEXT NOT NULL UNIQUE,           -- Full JWT license key
    license_id TEXT NOT NULL UNIQUE,            -- License ID from JWT
    organization_name TEXT NOT NULL,            -- Organization name
    licensee_email TEXT NOT NULL,               -- Licensed to (email)
    tier TEXT NOT NULL,                         -- community|professional|enterprise
    activated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP,                       -- NULL for perpetual licenses
    is_active BOOLEAN DEFAULT true,             -- Can be deactivated
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    -- Parsed from JWT for easy querying
    features JSONB NOT NULL,                    -- Feature flags
    limits JSONB NOT NULL                       -- Resource limits
);

-- Index for fast lookups
CREATE INDEX idx_licenses_active ON licenses(is_active);
CREATE INDEX idx_licenses_expires_at ON licenses(expires_at);
```

**Why Store in Database?**
- Persist license across restarts
- Support multiple licenses (multi-tenant scenarios)
- Easy updates/revocation
- Audit trail of license changes
- Performance (avoid re-parsing JWT on every request)

---

### 3. License Validation Module

**File**: `server/license_manager.py`

```python
import jwt
import json
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from database import Database

class LicenseManager:
    """Manages license validation and feature gating"""
    
    # Public key for JWT verification (RSA)
    # In production, load from secure configuration
    PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
    ... (your RSA public key) ...
    -----END PUBLIC KEY-----"""
    
    def __init__(self, db: Database):
        self.db = db
        self._cached_license: Optional[Dict[str, Any]] = None
        self._cache_timestamp: Optional[datetime] = None
        
    def validate_license_key(self, license_key: str) -> Dict[str, Any]:
        """
        Validate license key JWT signature and expiration.
        Returns decoded license claims if valid, raises exception otherwise.
        """
        try:
            # Decode and verify JWT
            payload = jwt.decode(
                license_key,
                self.PUBLIC_KEY,
                algorithms=["RS256"],
                options={
                    "verify_signature": True,
                    "verify_exp": True,      # Check expiration
                    "require": ["iss", "sub", "tier", "features", "limits"]
                }
            )
            
            # Verify issuer
            if payload.get("iss") != "Decentra":
                raise ValueError("Invalid license issuer")
            
            return payload
            
        except jwt.ExpiredSignatureError:
            raise ValueError("License has expired")
        except jwt.InvalidSignatureError:
            raise ValueError("Invalid license signature")
        except Exception as e:
            raise ValueError(f"Invalid license key: {str(e)}")
    
    async def activate_license(self, license_key: str) -> Dict[str, Any]:
        """
        Activate a new license key.
        Validates the key and stores it in the database.
        """
        # Validate the license key
        payload = self.validate_license_key(license_key)
        
        # Check if license already activated
        existing = await self.db.get_license_by_id(payload.get("license_id"))
        if existing:
            raise ValueError("License already activated")
        
        # Store in database
        license_data = {
            "license_key": license_key,
            "license_id": payload.get("license_id"),
            "organization_name": payload.get("org"),
            "licensee_email": payload.get("sub"),
            "tier": payload.get("tier"),
            "expires_at": datetime.fromtimestamp(payload["exp"], tz=timezone.utc) if "exp" in payload else None,
            "features": json.dumps(payload.get("features", {})),
            "limits": json.dumps(payload.get("limits", {}))
        }
        
        await self.db.activate_license(license_data)
        
        # Clear cache
        self._cached_license = None
        
        return payload
    
    async def get_active_license(self) -> Optional[Dict[str, Any]]:
        """
        Get the currently active license.
        Uses caching to avoid database hits on every request.
        """
        # Check cache (5 minute TTL)
        now = datetime.now(timezone.utc)
        if self._cached_license and self._cache_timestamp:
            age = (now - self._cache_timestamp).total_seconds()
            if age < 300:  # 5 minutes
                return self._cached_license
        
        # Load from database
        license_record = await self.db.get_active_license()
        
        if not license_record:
            # No license activated, return default (community tier)
            self._cached_license = self._get_default_license()
        else:
            # Validate expiration
            if license_record["expires_at"]:
                if now > license_record["expires_at"]:
                    # License expired, return default
                    self._cached_license = self._get_default_license()
                else:
                    self._cached_license = license_record
            else:
                # Perpetual license
                self._cached_license = license_record
        
        self._cache_timestamp = now
        return self._cached_license
    
    def _get_default_license(self) -> Dict[str, Any]:
        """Return default free tier license"""
        return {
            "tier": "community",
            "features": {
                "voice_chat": False,
                "file_uploads": False,
                "sso": False,
                "audit_logs": False,
                "custom_branding": False
            },
            "limits": {
                "max_users": None,          # Unlimited users in free tier
                "max_servers": 5,            # Limited servers
                "max_storage_gb": 1,         # 1 GB storage
                "max_file_size_mb": 5        # 5 MB per file
            }
        }
    
    async def is_feature_enabled(self, feature_name: str) -> bool:
        """Check if a feature is enabled in the current license"""
        license_data = await self.get_active_license()
        return license_data.get("features", {}).get(feature_name, False)
    
    async def get_limit(self, limit_name: str) -> Optional[int]:
        """Get the value of a resource limit"""
        license_data = await self.get_active_license()
        return license_data.get("limits", {}).get(limit_name)
    
    async def check_limit(self, limit_name: str, current_value: int) -> bool:
        """
        Check if current usage is within limits.
        Returns True if within limit, False if exceeded.
        """
        limit = await self.get_limit(limit_name)
        if limit is None:
            return True  # Unlimited
        return current_value < limit
```

---

### 4. Feature Gates

**Decorator Pattern for Feature Gating**

```python
from functools import wraps
from typing import Callable

def require_feature(feature_name: str):
    """Decorator to gate endpoints/functions behind feature flags"""
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(self, *args, **kwargs):
            # Get license manager from server instance
            license_mgr = self.license_manager
            
            if not await license_mgr.is_feature_enabled(feature_name):
                raise PermissionError(
                    f"Feature '{feature_name}' requires a license upgrade"
                )
            
            return await func(self, *args, **kwargs)
        return wrapper
    return decorator

def require_within_limit(limit_name: str, get_current_value: Callable):
    """Decorator to enforce resource limits"""
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(self, *args, **kwargs):
            license_mgr = self.license_manager
            
            # Get current usage
            current = await get_current_value(self)
            
            # Check against limit
            if not await license_mgr.check_limit(limit_name, current):
                limit_value = await license_mgr.get_limit(limit_name)
                raise PermissionError(
                    f"Resource limit exceeded: {limit_name} (max: {limit_value})"
                )
            
            return await func(self, *args, **kwargs)
        return wrapper
    return decorator
```

**Usage in Server Code**:

```python
class DecentraServer:
    def __init__(self):
        self.license_manager = LicenseManager(self.db)
    
    @require_feature("voice_chat")
    async def join_voice_channel(self, user, channel_id):
        """Join a voice channel - requires voice_chat feature"""
        # Implementation...
        pass
    
    @require_feature("file_uploads")
    async def upload_file(self, user, file_data):
        """Upload a file - requires file_uploads feature"""
        # Check file size limit too
        max_size_mb = await self.license_manager.get_limit("max_file_size_mb")
        if file_data.size > max_size_mb * 1024 * 1024:
            raise ValueError(f"File too large. Max size: {max_size_mb} MB")
        
        # Implementation...
        pass
    
    @require_within_limit("max_servers", lambda self: self.db.count_servers())
    async def create_server(self, user, server_name):
        """Create a new server - enforces server limit"""
        # Implementation...
        pass
    
    async def register_user(self, username, password):
        """Register new user - enforces user limit"""
        # Check user limit
        current_users = await self.db.count_users()
        if not await self.license_manager.check_limit("max_users", current_users):
            max_users = await self.license_manager.get_limit("max_users")
            raise PermissionError(
                f"User limit reached ({max_users} users). Please upgrade your license."
            )
        
        # Implementation...
        pass
```

---

### 5. Frontend Integration

**License Status Display**

```typescript
// src/types/license.ts
export interface License {
    tier: 'community' | 'professional' | 'enterprise';
    organization: string;
    licensee: string;
    expiresAt?: string;
    features: {
        voiceChat: boolean;
        fileUploads: boolean;
        sso: boolean;
        auditLogs: boolean;
        customBranding: boolean;
    };
    limits: {
        maxUsers?: number;
        maxServers?: number;
        maxStorageGb?: number;
        maxFileSizeMb?: number;
    };
}

// src/api/license.ts
export async function getLicenseStatus(): Promise<License> {
    const response = await fetch('/api/license/status');
    return response.json();
}

export async function activateLicense(licenseKey: string): Promise<void> {
    const response = await fetch('/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: licenseKey })
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message);
    }
}
```

**License Activation UI**:

```tsx
// src/components/LicenseActivation.tsx
import { useState } from 'react';

export function LicenseActivation() {
    const [licenseKey, setLicenseKey] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    
    const handleActivate = async () => {
        try {
            await activateLicense(licenseKey);
            setSuccess(true);
            setError('');
        } catch (err) {
            setError(err.message);
            setSuccess(false);
        }
    };
    
    return (
        <div className="license-activation">
            <h2>Activate License</h2>
            <textarea
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                placeholder="Paste your license key here..."
                rows={5}
            />
            <button onClick={handleActivate}>Activate License</button>
            
            {error && <div className="error">{error}</div>}
            {success && <div className="success">License activated successfully!</div>}
        </div>
    );
}
```

**Feature Gating in UI**:

```tsx
// src/components/FeatureGate.tsx
interface FeatureGateProps {
    feature: keyof License['features'];
    children: React.ReactNode;
    fallback?: React.ReactNode;
}

export function FeatureGate({ feature, children, fallback }: FeatureGateProps) {
    const { license } = useLicense();
    
    if (!license.features[feature]) {
        return fallback || (
            <div className="upgrade-prompt">
                <p>This feature requires a license upgrade.</p>
                <button>Upgrade to Pro</button>
            </div>
        );
    }
    
    return <>{children}</>;
}

// Usage
<FeatureGate feature="voiceChat">
    <VoiceChannelList />
</FeatureGate>
```

---

### 6. API Endpoints

Add new license management endpoints to `server/api.py`:

```python
from aiohttp import web
from license_manager import LicenseManager

class LicenseAPI:
    def __init__(self, license_manager: LicenseManager):
        self.license_manager = license_manager
    
    async def get_license_status(self, request):
        """GET /api/license/status - Get current license information"""
        try:
            license_data = await self.license_manager.get_active_license()
            
            # Return public license info (hide sensitive data)
            return web.json_response({
                "tier": license_data["tier"],
                "organization": license_data.get("organization_name", "Community"),
                "expires_at": license_data.get("expires_at").isoformat() if license_data.get("expires_at") else None,
                "features": license_data["features"],
                "limits": license_data["limits"]
            })
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)
    
    async def activate_license(self, request):
        """POST /api/license/activate - Activate a new license key"""
        # Only admin can activate license (first user)
        username = request.headers.get("X-Username")
        if not await self.is_admin(username):
            return web.json_response({"error": "Unauthorized"}, status=403)
        
        try:
            data = await request.json()
            license_key = data.get("license_key")
            
            if not license_key:
                return web.json_response({"error": "License key required"}, status=400)
            
            # Activate the license
            payload = await self.license_manager.activate_license(license_key)
            
            return web.json_response({
                "message": "License activated successfully",
                "tier": payload["tier"],
                "organization": payload["org"]
            })
            
        except ValueError as e:
            return web.json_response({"error": str(e)}, status=400)
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)
    
    async def get_usage_stats(self, request):
        """GET /api/license/usage - Get current resource usage"""
        try:
            # Get current usage metrics
            stats = {
                "users": await self.db.count_users(),
                "servers": await self.db.count_servers(),
                "storage_gb": await self.db.get_total_storage_usage(),
            }
            
            # Get limits
            license_data = await self.license_manager.get_active_license()
            limits = license_data["limits"]
            
            # Calculate percentages
            usage = {}
            for key, current_value in stats.items():
                limit_key = f"max_{key}"
                limit_value = limits.get(limit_key)
                
                usage[key] = {
                    "current": current_value,
                    "limit": limit_value,
                    "unlimited": limit_value is None,
                    "percentage": (current_value / limit_value * 100) if limit_value else 0
                }
            
            return web.json_response(usage)
            
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)
```

---

### 7. Database Migration

Add migration to create licenses table and update database.py:

```python
# In database.py - Add to schema initialization

LICENSES_TABLE = """
CREATE TABLE IF NOT EXISTS licenses (
    id SERIAL PRIMARY KEY,
    license_key TEXT NOT NULL UNIQUE,
    license_id TEXT NOT NULL UNIQUE,
    organization_name TEXT NOT NULL,
    licensee_email TEXT NOT NULL,
    tier TEXT NOT NULL,
    activated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    features JSONB NOT NULL,
    limits JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_licenses_active ON licenses(is_active);
CREATE INDEX IF NOT EXISTS idx_licenses_expires_at ON licenses(expires_at);
"""

async def activate_license(self, license_data: dict):
    """Store activated license in database"""
    async with self.pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO licenses (
                license_key, license_id, organization_name, licensee_email,
                tier, expires_at, features, limits
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """, 
            license_data["license_key"],
            license_data["license_id"],
            license_data["organization_name"],
            license_data["licensee_email"],
            license_data["tier"],
            license_data["expires_at"],
            license_data["features"],
            license_data["limits"]
        )

async def get_active_license(self):
    """Get the currently active license"""
    async with self.pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT * FROM licenses 
            WHERE is_active = true 
            ORDER BY activated_at DESC 
            LIMIT 1
        """)
        return dict(row) if row else None

async def count_users(self) -> int:
    """Count total registered users"""
    async with self.pool.acquire() as conn:
        result = await conn.fetchval("SELECT COUNT(*) FROM users")
        return result or 0

async def count_servers(self) -> int:
    """Count total servers"""
    async with self.pool.acquire() as conn:
        result = await conn.fetchval("SELECT COUNT(*) FROM servers")
        return result or 0
```

---

## Integration with Decentra

### Step-by-Step Implementation Plan

#### Phase 1: Core Infrastructure (Week 1)

1. **Create License Manager Module**
   - Add `server/license_manager.py` with LicenseManager class
   - Implement JWT validation using PyJWT library
   - Add caching mechanism

2. **Database Schema**
   - Add licenses table to `database.py`
   - Create migration script
   - Add license query methods

3. **Generate RSA Key Pair**
   - Generate private key for signing licenses (keep secure!)
   - Embed public key in application for validation

#### Phase 2: Feature Gates (Week 2)

1. **Implement Decorators**
   - Add `@require_feature` decorator
   - Add `@require_within_limit` decorator
   - Add error handling for license violations

2. **Gate Existing Features**
   - Voice chat endpoints
   - File upload endpoints
   - Server creation
   - User registration limits

3. **Add Usage Tracking**
   - Implement `count_users()`, `count_servers()`, etc.
   - Add storage usage tracking

#### Phase 3: API & Admin UI (Week 2-3)

1. **License API Endpoints**
   - `GET /api/license/status`
   - `POST /api/license/activate`
   - `GET /api/license/usage`

2. **Admin Panel Integration**
   - Add license activation page
   - Show current license status
   - Display usage metrics vs limits

3. **Frontend Feature Gates**
   - Create `<FeatureGate>` component
   - Hide/disable premium features in UI
   - Show upgrade prompts

#### Phase 4: License Generation Tool (Week 3)

1. **License Generator Script**
   - CLI tool to generate license keys
   - Input: tier, organization, expiration, limits
   - Output: Signed JWT license key

2. **License Management Portal** (Optional)
   - Web portal for generating licenses
   - Customer database
   - Analytics dashboard

#### Phase 5: Testing & Documentation (Week 4)

1. **Unit Tests**
   - Test license validation
   - Test feature gates
   - Test limit enforcement

2. **Integration Tests**
   - Test full activation flow
   - Test expired license handling
   - Test upgrade scenarios

3. **Documentation**
   - Admin guide for license activation
   - Customer guide for purchasing/activating
   - API documentation

---

## Security Considerations

### 1. Private Key Protection

**Critical**: The RSA private key used to sign licenses must be kept absolutely secure.

**Best Practices**:
- Store private key in secure vault (AWS KMS, HashiCorp Vault, etc.)
- Never commit to version control
- Use separate keys for production vs development
- Rotate keys periodically
- Implement key access logging

### 2. License Key Distribution

**Challenges**:
- Prevent license key sharing/piracy
- Secure delivery to customers

**Solutions**:
- Email licenses to verified customer emails only
- Use customer portal with authentication
- Include customer-specific information in license (email, org name)
- Consider hardware fingerprinting (optional, for higher tiers)

### 3. Offline Validation Security

**Risks**:
- System clock manipulation to extend licenses
- License key sharing between deployments

**Mitigations**:
- Use NTP time verification when possible
- Log license activations (for later analysis)
- Optional phone-home for analytics (non-blocking)
- Include deployment fingerprint in license (optional)

### 4. License Tampering

**Protections Already in Place**:
- JWT signature prevents license modification
- Public key validation ensures authenticity
- Encrypted database storage (Decentra already has this)

**Additional Measures**:
- Code obfuscation (optional, limited effectiveness)
- Integrity checks on license manager module
- Rate limiting on activation API

### 5. Database Security

**Current Decentra Protections**:
- PostgreSQL with authentication
- Data encryption at rest (Fernet)
- Environment variable configuration

**License-Specific**:
- Encrypt license_key column (already using Fernet)
- Audit log for license changes
- Restrict database access to admin users only

---

## Implementation Timeline

### Fast Track (4 Weeks)

**Week 1: Foundation**
- Days 1-2: Create license_manager.py, implement JWT validation
- Days 3-4: Add database schema, implement license storage
- Day 5: Generate RSA keys, test basic validation

**Week 2: Feature Gates**
- Days 1-2: Implement decorators, gate voice chat
- Days 3-4: Gate file uploads, add usage tracking
- Day 5: Test all feature gates, handle errors

**Week 3: API & UI**
- Days 1-2: Create license API endpoints
- Days 3-4: Build admin UI for license activation
- Day 5: Frontend feature gates and upgrade prompts

**Week 4: Testing & Launch**
- Days 1-2: Write unit and integration tests
- Day 3: Create license generator CLI tool
- Days 4-5: Documentation, deployment guide

### Minimal Viable Product (1-2 Weeks)

For fastest implementation, focus on:

**Week 1**:
1. Basic offline license validation (JWT)
2. Single tier system (Free vs Pro)
3. License activation API endpoint
4. Admin UI for entering license key

**Week 2**:
1. Feature gates for 1-2 key features (e.g., voice chat)
2. Simple usage limit (e.g., max servers)
3. Basic error messages for license violations

**Defer to Later**:
- Multiple tiers (start with 2)
- Complex usage tracking
- Online verification
- License generator portal

---

## Additional Resources

### Recommended Libraries

**Python (Backend)**:
- `PyJWT` - JWT encoding/decoding (already great)
- `cryptography` - RSA key generation (Decentra already has this)
- `python-dateutil` - Date/time handling

**TypeScript (Frontend)**:
- `jwt-decode` - Decode JWT client-side for display (don't validate!)
- No additional dependencies needed

### Reference Implementations

**Open Source Examples**:
1. **Sentry** - Usage-based licensing for self-hosted
   - GitHub: getsentry/sentry
   - Uses feature flags + usage metering

2. **GitLab** - Tiered licensing for self-hosted
   - Different editions (CE, EE)
   - License file based

3. **Discourse** - Community vs Enterprise licensing
   - Feature flags in Ruby
   - Self-hosted friendly

**Commercial Solutions** (inspiration only):
- Keygen - License management API
- Cryptlex - Software licensing platform
- LicenseSpring - Cloud-based licensing

### Security Standards

- **ISO/IEC 19770-1**: Software asset management
- **NIST SP 800-57**: Key management recommendations
- **OWASP**: Secure coding practices

### Testing License Keys (for Development)

Generate test licenses for development:

```bash
# Install PyJWT
pip install pyjwt cryptography

# Python script to generate test license
python3 <<EOF
import jwt
from datetime import datetime, timedelta
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.backends import default_backend

# Generate RSA key pair (for testing only!)
private_key = rsa.generate_private_key(
    public_exponent=65537,
    key_size=2048,
    backend=default_backend()
)

public_key = private_key.public_key()

# Create license payload
payload = {
    "iss": "Decentra",
    "sub": "test@example.com",
    "org": "Test Organization",
    "tier": "enterprise",
    "exp": int((datetime.now() + timedelta(days=365)).timestamp()),
    "features": {
        "voice_chat": True,
        "file_uploads": True,
        "sso": True
    },
    "limits": {
        "max_users": 1000,
        "max_servers": 100
    },
    "license_id": "TEST-2024-001"
}

# Sign the license
license_key = jwt.encode(payload, private_key, algorithm="RS256")

print("License Key:")
print(license_key)
print("\nPublic Key (for validation):")
print(public_key.public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo
).decode())
EOF
```

---

## Appendix: License Tier Recommendations

### Suggested Tiers for Decentra

#### **Community (Free)**
- **Target**: Personal use, small groups, hobbyists
- **Users**: Unlimited
- **Servers**: 5
- **Features**: 
  - ✅ Text chat
  - ✅ Direct messages
  - ✅ Basic notifications
  - ❌ Voice chat
  - ❌ File uploads
- **Storage**: 1 GB
- **Support**: Community forums
- **Price**: Free

#### **Professional ($99/year or $299 perpetual)**
- **Target**: Small teams, communities, small businesses
- **Users**: Up to 100
- **Servers**: 50
- **Features**:
  - ✅ All Community features
  - ✅ Voice chat (unlimited)
  - ✅ File uploads (25 MB per file)
  - ✅ Email notifications
  - ✅ Rich embeds
  - ❌ SSO
  - ❌ Audit logs
- **Storage**: 100 GB
- **Support**: Email support
- **Price**: $99/year or $299 one-time

#### **Enterprise ($499/year or $1,499 perpetual)**
- **Target**: Large organizations, businesses with compliance needs
- **Users**: Unlimited
- **Servers**: Unlimited
- **Features**:
  - ✅ All Professional features
  - ✅ File uploads (100 MB per file)
  - ✅ Single Sign-On (SSO)
  - ✅ Audit logs
  - ✅ Custom branding
  - ✅ Advanced permissions
  - ✅ Priority support
  - ✅ Custom integrations
- **Storage**: Unlimited
- **Support**: Priority email + optional phone support
- **Price**: $499/year or $1,499 one-time

---

## Conclusion

### Summary

For Decentra, the recommended licensing approach is:

1. **Offline-first JWT-based license validation** - Works in air-gapped environments
2. **Three-tier model** (Community/Professional/Enterprise) - Clear value proposition
3. **Feature flags + usage limits** - Flexible enforcement
4. **PostgreSQL-backed license storage** - Leverages existing infrastructure
5. **Admin-activated licenses** - Simple activation flow

### Fastest Path to Implementation

1. **Week 1**: License validation + database
2. **Week 2**: Feature gates for voice chat and file uploads
3. **Week 3**: Admin UI for activation + frontend gates
4. **Week 4**: Testing and documentation

**Time to Market**: 4 weeks for full implementation, 2 weeks for MVP

### Key Takeaways

✅ **Self-hosted First**: Offline validation is critical for Decentra's use case  
✅ **Simple is Better**: JWT-based licensing is industry-standard and easy to implement  
✅ **Leverage Existing Stack**: Use PostgreSQL, Python, encryption already in place  
✅ **User-Friendly**: One-time activation, works offline, no ongoing phone-home  
✅ **Future-Proof**: Can add online features later without breaking existing deployments  

### Next Steps

1. Review this research with stakeholders
2. Decide on final tier structure and pricing
3. Generate RSA key pair for production use
4. Begin implementation following Phase 1 timeline
5. Create license generator tool for sales/distribution

---

## Questions & Clarifications

If you have questions about any aspect of this research or need clarification on implementation details, please refer to:

- **Security**: See [SECURITY.md](SECURITY.md) in the repository
- **Database**: See `server/database.py` for existing patterns
- **API**: See `server/api.py` and [API.md](API.md) for endpoint examples
- **Encryption**: See `server/encryption_utils.py` for Fernet usage

---

*Research compiled: February 2026*  
*Version: 1.0*  
*Author: Decentra Licensing Research Team*
