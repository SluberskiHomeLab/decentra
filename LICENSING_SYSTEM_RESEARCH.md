# Decentra Licensing System Implementation Guide

## Executive Summary

This document outlines the research and recommendations for implementing a licensing system in Decentra, a self-hosted Discord-like chat application. The licensing system needs to validate license keys, verify registration, enable/disable features, and enforce limits.

**Recommended Approach:** Hybrid offline/online licensing with RSA-2048 cryptographic validation and feature flag-based lockdown.

---

## Table of Contents

1. [Overview](#overview)
2. [Licensing Implementation Approaches](#licensing-implementation-approaches)
3. [Detailed Comparison](#detailed-comparison)
4. [Recommended Solution](#recommended-solution)
5. [Feature Lockdown Implementation](#feature-lockdown-implementation)
6. [Implementation Roadmap](#implementation-roadmap)
7. [Security Considerations](#security-considerations)
8. [References](#references)

---

## Overview

### Current Tech Stack
- **Frontend:** React + TypeScript + Vite + Tailwind CSS + Zustand
- **Backend:** Python (asyncio + websockets + aiohttp)
- **Database:** PostgreSQL
- **Deployment:** Docker containerized

### Licensing Requirements
1. **License Key Validation:** Verify license keys are genuine and not tampered with
2. **User Registration:** Track who the license is registered to
3. **Feature Enablement:** Enable/disable features based on license tier
4. **Limit Enforcement:** Set and enforce limits (users, servers, channels, etc.)
5. **Self-Hosted Compatibility:** Must work in air-gapped/offline environments

---

## Licensing Implementation Approaches

### 1. Cloud-Based Licensing-as-a-Service (LaaS)

**Description:** Third-party cloud services that handle license generation, validation, and management.

**Popular Solutions:**
- **Cryptolens** - Full-featured LaaS platform with Python SDK
- **Keygen** - Modern fair-source licensing API
- **LicenseSpring** - Enterprise licensing platform
- **SafeGuard LM** - Traditional license manager

**How It Works:**
1. Generate license keys through provider dashboard
2. Application makes API calls to validate licenses
3. Provider returns license status, features, and limits
4. Supports offline validation with cached licenses

**Pros:**
- ✅ Quick implementation (hours to days)
- ✅ Professionally maintained infrastructure
- ✅ Built-in analytics and reporting dashboards
- ✅ Advanced features (floating licenses, node-locking, usage-based)
- ✅ Payment gateway integration
- ✅ Automatic key generation and delivery

**Cons:**
- ❌ Monthly/per-license costs ($29-$299+/month)
- ❌ Dependency on third-party service
- ❌ Privacy concerns (license validation sends data externally)
- ❌ Not ideal for self-hosted/privacy-focused applications
- ❌ Requires internet connectivity (except cached mode)
- ❌ Vendor lock-in

**Best For:** SaaS products, cloud-first applications, teams wanting turnkey solutions

---

### 2. Self-Hosted Open Source Solutions

**Description:** Open-source licensing servers you host on your own infrastructure.

**Popular Solutions:**
- **Keygen CE (Community Edition)** - Free self-hosted version of Keygen
- **python-licensing** - Simple Python licensing with decorator support
- **Flexera FlexNet** - Enterprise-grade self-hosted

**How It Works:**
1. Deploy licensing server on your infrastructure
2. Generate keys through admin interface
3. Application validates against your server
4. Full control over data and infrastructure

**Pros:**
- ✅ No recurring licensing costs (only infrastructure)
- ✅ Full control and data privacy
- ✅ Customizable to specific needs
- ✅ Aligns with self-hosted ethos of Decentra
- ✅ Transparent and auditable

**Cons:**
- ❌ Setup and maintenance overhead
- ❌ You handle security updates
- ❌ Requires server infrastructure
- ❌ Less polished than commercial solutions
- ❌ Limited documentation/support
- ❌ Still requires online connectivity

**Best For:** Organizations with DevOps resources, privacy-focused products

---

### 3. Offline RSA/Ed25519 Cryptographic Validation

**Description:** Generate cryptographically signed license keys that can be validated offline using public key cryptography.

**How It Works:**
1. **Key Generation (Your Server):**
   - Create RSA-2048 (or Ed25519) key pair
   - Keep private key secure on generation server
   - Embed public key in application

2. **License Creation:**
   - Encode license data: `{email, features, expiry, limits}`
   - Sign with private key using RSA/Ed25519
   - Combine data + signature = license key

3. **Validation (Client Application):**
   - Parse license key to extract data and signature
   - Verify signature using embedded public key
   - Check expiration and limits
   - Enable features accordingly

**Pros:**
- ✅ Works 100% offline (no "phone home" required)
- ✅ Perfect for air-gapped environments
- ✅ No external dependencies or costs
- ✅ Cryptographically secure (RSA-2048/Ed25519)
- ✅ Simple implementation
- ✅ Full control and privacy
- ✅ Aligns perfectly with self-hosted ethos
- ✅ No vendor lock-in

**Cons:**
- ❌ No automatic revocation (must check expiry dates)
- ❌ Manual key generation process
- ❌ No built-in analytics dashboard
- ❌ You build the generation UI
- ❌ Public key embedded in code (can be extracted, but can't forge keys)

**Best For:** Self-hosted applications, offline/air-gapped deployments, privacy-focused products, desktop apps

---

### 4. Simple Key-Format Validation (NOT RECOMMENDED)

**Description:** Generate keys using specific patterns (e.g., checksums, specific formats) and validate format only.

**Example:** `XXXX-XXXX-XXXX-XXXX` with last segment as checksum

**Pros:**
- ✅ Extremely simple to implement
- ✅ No cryptography required

**Cons:**
- ❌ Easily reverse-engineered
- ❌ Keygens can be created quickly
- ❌ No security - pattern leaks over time
- ❌ Can't encode license information
- ❌ Professional pirates bypass in hours

**Best For:** Proof-of-concepts only, NOT production use

---

## Detailed Comparison

| Feature | Cloud LaaS | Self-Hosted OSS | Offline Crypto | Simple Pattern |
|---------|------------|-----------------|----------------|----------------|
| **Setup Time** | 1-2 hours | 1-3 days | 2-5 days | 30 minutes |
| **Ongoing Cost** | $29-299+/mo | Infrastructure only | $0 | $0 |
| **Security** | Excellent | Good-Excellent | Excellent | Poor |
| **Offline Support** | Cached only | No | Yes (100%) | Yes |
| **Privacy** | Low | High | Highest | High |
| **Self-Hosted Fit** | Poor | Good | Excellent | N/A |
| **Maintenance** | None | Medium | Low | Low |
| **Feature Control** | Advanced | Good | DIY | None |
| **Revocation** | Instant | Instant | Via expiry only | None |
| **Analytics** | Built-in | Basic | DIY | None |
| **Vendor Lock-in** | High | Low | None | None |

---

## Recommended Solution

### ✅ **Hybrid Offline/Online Cryptographic Licensing**

For Decentra, I recommend implementing a **hybrid offline cryptographic licensing system** with optional online validation for enhanced features.

### Why This Approach?

1. **Aligns with Self-Hosted Philosophy:** Users can run completely offline
2. **No External Dependencies:** No third-party services required
3. **Privacy First:** No data sent to external servers
4. **Cost Effective:** No recurring licensing fees
5. **Cryptographically Secure:** RSA-2048 is NSA-approved encryption
6. **Flexible:** Support both online validation (for floating licenses) and offline

### Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│          License Generation Server (You)            │
│  ┌────────────────────────────────────────────┐    │
│  │  Web Admin Dashboard                        │    │
│  │  - Create licenses                          │    │
│  │  - Set features/limits                      │    │
│  │  - Track customers                          │    │
│  └────────────────────────────────────────────┘    │
│                     ↓                               │
│  ┌────────────────────────────────────────────┐    │
│  │  License Generator                          │    │
│  │  - Encode license data (JSON)               │    │
│  │  - Sign with RSA-2048 private key           │    │
│  │  - Generate base64 license string           │    │
│  └────────────────────────────────────────────┘    │
│                                                     │
│  🔐 Private Key (Keep Secure!)                     │
└─────────────────────────────────────────────────────┘
                     ↓
        License Key Delivered to Customer
                     ↓
┌─────────────────────────────────────────────────────┐
│          Decentra Application (Customer)            │
│  ┌────────────────────────────────────────────┐    │
│  │  License Validator                          │    │
│  │  - Parse license key                        │    │
│  │  - Verify signature with public key         │    │
│  │  - Check expiration                         │    │
│  │  - Extract features/limits                  │    │
│  └────────────────────────────────────────────┘    │
│                     ↓                               │
│  ┌────────────────────────────────────────────┐    │
│  │  Feature Flag Manager                       │    │
│  │  - Enable/disable features                  │    │
│  │  - Enforce limits                           │    │
│  │  - Cache license info                       │    │
│  └────────────────────────────────────────────┘    │
│                                                     │
│  🔓 Public Key (Embedded in App)                   │
└─────────────────────────────────────────────────────┘
```

### License Key Structure

```json
{
  "license_id": "LIC-2026-12345",
  "customer": {
    "name": "John Doe",
    "email": "john@example.com",
    "company": "Acme Corp"
  },
  "tier": "elite",
  "features": {
    "voice_chat": true,
    "file_uploads": true,
    "webhooks": true,
    "custom_emojis": true,
    "audit_logs": true,
    "sso": true,
    "video_quality": "1440p",
    "screensharing_quality": "1440p"
  },
  "limits": {
    "max_users": -1,
    "max_servers": -1,
    "max_channels_per_server": -1,
    "max_file_size_mb": -1,
    "max_messages_history": -1,
    "storage_gb": 512
  },
  "issued_at": "2026-02-06T00:00:00Z",
  "expires_at": "2027-02-06T00:00:00Z",
  "signature": "BASE64_RSA_SIGNATURE_HERE"
}
```

### Hosting Plan Tiers Overview

The following table outlines the specific limits and features for each licensing tier:

| Feature | Community | Lite | Standard | Elite | Off the Walls |
|---|---|---|---|---|---|
| **Max Users** | 30 | 50 | 80 | Unlimited | Unlimited |
| **Max Servers** | 2 | 5 | 8 | Unlimited | Unlimited |
| **Channels per Server** | 30 | 50 | 150 | Unlimited | Unlimited |
| **Max File Size** | 10 MB | 30 MB | 100 MB | Unlimited | Unlimited |
| **Message History** | Unlimited | Unlimited | Unlimited | Unlimited | Unlimited |
| **Voice Chat** | Yes | Yes | Yes | Yes | Yes |
| **File Uploads** | Yes | Yes | Yes | Yes | Yes |
| **Webhooks** | Yes | Yes | Yes | Yes | Yes |
| **Custom Emojis** | Yes | Yes | Yes | Yes | Yes |
| **Audit Logs** | Yes | Yes | Yes | Yes | Yes |
| **SSO** | No | No | Yes | Yes | Yes |
| **Video** | 720p | 720p | 1080p | 1440p | 4k |
| **Screensharing** | 720p | 720p | 1080p | 1440p | 4k |
| **Storage** | Up to Server* | 50GB | 150GB | 512GB | 1TB |
| **SMTP** | Yes | Yes | Yes | Yes | Yes |

*Note: For Community tier, storage is limited only by the hosting server's available resources. In the license data structure, this is represented as -2 for storage_gb (-1 means unlimited, -2 means server-dependent).

### License Tiers Example

#### Community Tier (Default - No License)
- ✅ Text messaging
- ✅ Message History: Unlimited
- ✅ Up to 30 users
- ✅ 2 servers
- ✅ 30 channels per server
- ✅ 10MB file uploads
- ✅ Voice chat (720p)
- ✅ File uploads
- ✅ Webhooks
- ✅ Custom emojis
- ✅ Audit logs
- ✅ SMTP
- ✅ Screensharing (720p)
- ✅ Storage: Up to Server*
- ❌ SSO

#### Lite Tier
- ✅ All Community features
- ✅ Up to 50 users
- ✅ 5 servers
- ✅ 50 channels per server
- ✅ 30MB file uploads
- ✅ Voice chat (720p)
- ✅ Screensharing (720p)
- ✅ Storage: 50GB
- ❌ SSO

#### Standard Tier
- ✅ All Lite features
- ✅ Up to 80 users
- ✅ 8 servers
- ✅ 150 channels per server
- ✅ 100MB file uploads
- ✅ Voice chat (1080p)
- ✅ Screensharing (1080p)
- ✅ SSO integration
- ✅ Storage: 150GB

#### Elite Tier
- ✅ All Standard features
- ✅ Unlimited users
- ✅ Unlimited servers
- ✅ Unlimited channels
- ✅ Unlimited file uploads
- ✅ Voice chat (1440p)
- ✅ Screensharing (1440p)
- ✅ Storage: 512GB
- ✅ Priority support

#### Off the Walls Tier
- ✅ All Elite features
- ✅ Unlimited users
- ✅ Unlimited servers
- ✅ Unlimited channels
- ✅ Unlimited file uploads
- ✅ Voice chat (4k)
- ✅ Screensharing (4k)
- ✅ Storage: 1TB
- ✅ Premium support

---

## Feature Lockdown Implementation

### Backend Implementation (Python)

#### 1. Create License Validator Module

**File:** `server/license_validator.py`

```python
#!/usr/bin/env python3
"""
License validation module for Decentra
Validates cryptographically signed license keys
"""

import json
import base64
from datetime import datetime, timezone
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.exceptions import InvalidSignature
from typing import Optional, Dict, Any

# Embedded public key (PEM format)
# In production, this would be your actual public key
PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
YOUR_PUBLIC_KEY_HERE
-----END PUBLIC KEY-----"""

class LicenseValidator:
    def __init__(self):
        self.public_key = serialization.load_pem_public_key(
            PUBLIC_KEY_PEM.encode('utf-8')
        )
        self._cached_license: Optional[Dict[str, Any]] = None

    def validate_license(self, license_key: str) -> Dict[str, Any]:
        """
        Validate a license key and return license data

        Returns:
            dict: License data with features and limits

        Raises:
            ValueError: If license is invalid, expired, or tampered
        """
        try:
            # Decode base64 license key
            decoded = base64.b64decode(license_key)

            # Split into data and signature
            # Format: JSON_DATA||SIGNATURE
            parts = decoded.split(b'||')
            if len(parts) != 2:
                raise ValueError("Invalid license format")

            license_data_bytes, signature = parts
            license_data = json.loads(license_data_bytes.decode('utf-8'))

            # Verify signature using RSA public key
            try:
                self.public_key.verify(
                    signature,
                    license_data_bytes,
                    padding.PSS(
                        mgf=padding.MGF1(hashes.SHA256()),
                        salt_length=padding.PSS.MAX_LENGTH
                    ),
                    hashes.SHA256()
                )
            except InvalidSignature:
                raise ValueError("License signature verification failed - tampered license")

            # Check expiration
            expires_at = datetime.fromisoformat(license_data['expires_at'].replace('Z', '+00:00'))
            if expires_at < datetime.now(timezone.utc):
                raise ValueError("License has expired")

            # Cache valid license
            self._cached_license = license_data
            return license_data

        except Exception as e:
            raise ValueError(f"License validation failed: {str(e)}")

    def get_feature_enabled(self, feature_name: str) -> bool:
        """Check if a specific feature is enabled"""
        if not self._cached_license:
            return False
        return self._cached_license.get('features', {}).get(feature_name, False)

    def get_limit(self, limit_name: str, default: int = 0) -> int:
        """Get a specific limit value (-1 means unlimited)"""
        if not self._cached_license:
            return default
        return self._cached_license.get('limits', {}).get(limit_name, default)

    def get_tier(self) -> str:
        """Get the license tier"""
        if not self._cached_license:
            return "community"
        return self._cached_license.get('tier', 'community')

    def get_customer_info(self) -> Dict[str, str]:
        """Get customer information"""
        if not self._cached_license:
            return {}
        return self._cached_license.get('customer', {})

# Global instance
license_validator = LicenseValidator()

# Default limits for community tier (no license)
DEFAULT_LIMITS = {
    'max_users': 30,
    'max_servers': 2,
    'max_channels_per_server': 30,
    'max_file_size_mb': 10,
    'max_messages_history': -1
}

DEFAULT_FEATURES = {
    'voice_chat': True,
    'file_uploads': True,
    'webhooks': True,
    'custom_emojis': True,
    'audit_logs': True,
    'sso': False,
    'smtp': True,
    'video_quality': '720p',
    'screensharing_quality': '720p'
}

def check_feature_access(feature_name: str) -> bool:
    """
    Check if a feature is accessible with current license
    Returns True if enabled, False otherwise
    """
    if license_validator._cached_license:
        return license_validator.get_feature_enabled(feature_name)
    return DEFAULT_FEATURES.get(feature_name, False)

def check_limit(limit_name: str) -> int:
    """
    Get limit value for current license
    Returns limit value (-1 for unlimited)
    """
    if license_validator._cached_license:
        return license_validator.get_limit(limit_name, DEFAULT_LIMITS.get(limit_name, 0))
    return DEFAULT_LIMITS.get(limit_name, 0)

def enforce_limit(current_count: int, limit_name: str) -> bool:
    """
    Check if current count exceeds limit
    Returns True if within limit, False if exceeded
    """
    limit = check_limit(limit_name)
    if limit == -1:  # Unlimited
        return True
    return current_count < limit
```

#### 2. Integrate into Server Code

**File:** `server/server.py` (add to existing code)

```python
from license_validator import (
    license_validator,
    check_feature_access,
    check_limit,
    enforce_limit
)
import os

# Load license from environment or file on startup
def load_license():
    """Load and validate license on server startup"""
    license_key = os.environ.get('DECENTRA_LICENSE_KEY')

    if not license_key:
        # Try loading from file
        license_file = os.path.join(
            os.path.dirname(__file__),
            '.license'
        )
        if os.path.exists(license_file):
            with open(license_file, 'r') as f:
                license_key = f.read().strip()

    if license_key:
        try:
            license_data = license_validator.validate_license(license_key)
            print(f"✅ License validated: {license_data['tier']} tier")
            print(f"   Licensed to: {license_data['customer']['name']}")
            print(f"   Expires: {license_data['expires_at']}")
            return True
        except ValueError as e:
            print(f"⚠️  License validation failed: {e}")
            print("   Running with community tier limits")
            return False
    else:
        print("ℹ️  No license found - running with community tier limits")
        return False

# Call on server startup
async def main():
    load_license()
    # ... rest of server initialization
```

#### 3. Add Feature Checks to Handlers

**Example: Voice Chat Feature Check**

```python
async def handle_voice_join(websocket, data):
    """Handle voice channel join request"""

    # Check if voice chat feature is enabled
    if not check_feature_access('voice_chat'):
        await send_error(websocket, "Voice chat requires a Lite or higher tier license")
        return

    # Proceed with voice chat logic
    # ...
```

**Example: Server Creation Limit**

```python
async def handle_create_server(websocket, data):
    """Handle server creation request"""
    user_id = data.get('user_id')

    # Get current server count for user
    current_servers = await db.get_user_server_count(user_id)

    # Check if within limit
    if not enforce_limit(current_servers, 'max_servers'):
        max_allowed = check_limit('max_servers')
        await send_error(
            websocket,
            f"Server limit reached ({max_allowed}). Upgrade to create more servers."
        )
        return

    # Create server
    # ...
```

**Example: File Upload Size Check**

```python
async def handle_file_upload(websocket, data):
    """Handle file upload"""
    file_size_mb = len(data.get('file_data', '')) / (1024 * 1024)
    max_size = check_limit('max_file_size_mb')

    if file_size_mb > max_size:
        await send_error(
            websocket,
            f"File size ({file_size_mb:.1f}MB) exceeds limit ({max_size}MB). "
            f"Upgrade to increase file size limit."
        )
        return

    # Process upload
    # ...
```

#### 4. Add License Management API Endpoints

**File:** `server/api.py` (add to existing routes)

```python
async def handle_license_info(request):
    """GET /api/license - Get current license information"""
    license_info = {
        'tier': license_validator.get_tier(),
        'customer': license_validator.get_customer_info(),
        'features': {
            'voice_chat': check_feature_access('voice_chat'),
            'file_uploads': check_feature_access('file_uploads'),
            'webhooks': check_feature_access('webhooks'),
            'custom_emojis': check_feature_access('custom_emojis'),
            'audit_logs': check_feature_access('audit_logs'),
            'sso': check_feature_access('sso')
        },
        'limits': {
            'max_users': check_limit('max_users'),
            'max_servers': check_limit('max_servers'),
            'max_channels_per_server': check_limit('max_channels_per_server'),
            'max_file_size_mb': check_limit('max_file_size_mb'),
            'max_messages_history': check_limit('max_messages_history')
        }
    }
    return web.json_response(license_info)

async def handle_license_update(request):
    """POST /api/license - Update license key"""
    data = await request.json()
    license_key = data.get('license_key', '')

    try:
        license_data = license_validator.validate_license(license_key)

        # Save to file
        license_file = os.path.join(
            os.path.dirname(__file__),
            '.license'
        )
        with open(license_file, 'w') as f:
            f.write(license_key)

        return web.json_response({
            'success': True,
            'message': 'License updated successfully',
            'tier': license_data['tier']
        })
    except ValueError as e:
        return web.json_response({
            'success': False,
            'error': str(e)
        }, status=400)

# Add routes
def setup_api_routes(app):
    # ... existing routes
    app.router.add_get('/api/license', handle_license_info)
    app.router.add_post('/api/license', handle_license_update)
```

### Frontend Implementation (React + TypeScript)

#### 1. Create License Context

**File:** `frontend/src/contexts/LicenseContext.tsx`

```typescript
import React, { createContext, useContext, useState, useEffect } from 'react';

interface LicenseFeatures {
  voice_chat: boolean;
  file_uploads: boolean;
  webhooks: boolean;
  custom_emojis: boolean;
  audit_logs: boolean;
  sso: boolean;
}

interface LicenseLimits {
  max_users: number;
  max_servers: number;
  max_channels_per_server: number;
  max_file_size_mb: number;
  max_messages_history: number;
}

interface LicenseInfo {
  tier: string;
  customer: {
    name?: string;
    email?: string;
    company?: string;
  };
  features: LicenseFeatures;
  limits: LicenseLimits;
}

interface LicenseContextType {
  license: LicenseInfo | null;
  loading: boolean;
  hasFeature: (feature: keyof LicenseFeatures) => boolean;
  getLimit: (limit: keyof LicenseLimits) => number;
  isUnlimited: (limit: keyof LicenseLimits) => boolean;
  refreshLicense: () => Promise<void>;
  updateLicense: (licenseKey: string) => Promise<{ success: boolean; error?: string }>;
}

const LicenseContext = createContext<LicenseContextType | undefined>(undefined);

export const LicenseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchLicense = async () => {
    try {
      const response = await fetch('/api/license');
      const data = await response.json();
      setLicense(data);
    } catch (error) {
      console.error('Failed to fetch license info:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLicense();
  }, []);

  const hasFeature = (feature: keyof LicenseFeatures): boolean => {
    return license?.features[feature] ?? false;
  };

  const getLimit = (limit: keyof LicenseLimits): number => {
    return license?.limits[limit] ?? 0;
  };

  const isUnlimited = (limit: keyof LicenseLimits): boolean => {
    return getLimit(limit) === -1;
  };

  const refreshLicense = async () => {
    setLoading(true);
    await fetchLicense();
  };

  const updateLicense = async (licenseKey: string) => {
    try {
      const response = await fetch('/api/license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: licenseKey })
      });
      const data = await response.json();

      if (data.success) {
        await refreshLicense();
        return { success: true };
      } else {
        return { success: false, error: data.error };
      }
    } catch (error) {
      return { success: false, error: 'Failed to update license' };
    }
  };

  return (
    <LicenseContext.Provider
      value={{
        license,
        loading,
        hasFeature,
        getLimit,
        isUnlimited,
        refreshLicense,
        updateLicense
      }}
    >
      {children}
    </LicenseContext.Provider>
  );
};

export const useLicense = () => {
  const context = useContext(LicenseContext);
  if (!context) {
    throw new Error('useLicense must be used within LicenseProvider');
  }
  return context;
};
```

#### 2. Feature-Gated Components

**File:** `frontend/src/components/FeatureGate.tsx`

```typescript
import React from 'react';
import { useLicense } from '../contexts/LicenseContext';

interface FeatureGateProps {
  feature: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export const FeatureGate: React.FC<FeatureGateProps> = ({
  feature,
  fallback = null,
  children
}) => {
  const { hasFeature } = useLicense();

  if (!hasFeature(feature as any)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

// Upgrade prompt component
export const UpgradePrompt: React.FC<{ feature: string }> = ({ feature }) => {
  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
      <div className="flex items-center">
        <span className="text-yellow-600 mr-2">🔒</span>
        <div>
          <h3 className="font-semibold text-yellow-800">
            {feature} requires an upgrade
          </h3>
          <p className="text-sm text-yellow-700">
            This feature is available in Standard, Elite, and Off the Walls tiers.
          </p>
          <button className="mt-2 px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700">
            View Plans
          </button>
        </div>
      </div>
    </div>
  );
};
```

#### 3. Usage Examples

**Example: Conditional Voice Chat Button**

```typescript
import { FeatureGate, UpgradePrompt } from './components/FeatureGate';

function VoiceChannelList() {
  return (
    <div>
      <h2>Voice Channels</h2>
      <FeatureGate
        feature="voice_chat"
        fallback={<UpgradePrompt feature="Voice Chat" />}
      >
        <VoiceChannelComponent />
      </FeatureGate>
    </div>
  );
}
```

**Example: Server Creation Limit Check**

```typescript
import { useLicense } from '../contexts/LicenseContext';

function CreateServerButton() {
  const { getLimit, isUnlimited } = useLicense();
  const [currentServerCount, setCurrentServerCount] = useState(0);

  const maxServers = getLimit('max_servers');
  const canCreate = isUnlimited('max_servers') || currentServerCount < maxServers;

  return (
    <button
      onClick={handleCreateServer}
      disabled={!canCreate}
      className={!canCreate ? 'opacity-50 cursor-not-allowed' : ''}
    >
      Create Server
      {!canCreate && (
        <span className="text-xs block">
          Limit reached ({currentServerCount}/{maxServers})
        </span>
      )}
    </button>
  );
}
```

**Example: License Info Display**

```typescript
import { useLicense } from '../contexts/LicenseContext';

function LicenseInfoPanel() {
  const { license, loading } = useLicense();

  if (loading) return <div>Loading license info...</div>;

  return (
    <div className="bg-gray-100 p-4 rounded">
      <h3 className="font-bold">License Information</h3>
      <div className="mt-2">
        <p><strong>Tier:</strong> {license?.tier || 'Community'}</p>
        {license?.customer.name && (
          <p><strong>Licensed to:</strong> {license.customer.name}</p>
        )}
        <div className="mt-3">
          <h4 className="font-semibold">Features:</h4>
          <ul className="list-disc list-inside">
            <li>Voice Chat: {license?.features.voice_chat ? '✅' : '❌'}</li>
            <li>Custom Emojis: {license?.features.custom_emojis ? '✅' : '❌'}</li>
            <li>Webhooks: {license?.features.webhooks ? '✅' : '❌'}</li>
            <li>SSO: {license?.features.sso ? '✅' : '❌'}</li>
          </ul>
        </div>
        <div className="mt-3">
          <h4 className="font-semibold">Limits:</h4>
          <ul className="list-disc list-inside">
            <li>Max Users: {license?.limits.max_users === -1 ? 'Unlimited' : license?.limits.max_users}</li>
            <li>Max Servers: {license?.limits.max_servers === -1 ? 'Unlimited' : license?.limits.max_servers}</li>
            <li>File Size: {license?.limits.max_file_size_mb}MB</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
```

### License Generation Server

You'll need a separate tool/server to generate license keys. This should NOT be part of Decentra itself.

**File:** `license_generator.py` (separate repository/server)

```python
#!/usr/bin/env python3
"""
License Key Generator for Decentra
Run this on your secure server to generate license keys
"""

import json
import base64
from datetime import datetime, timedelta, timezone
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.backends import default_backend

def generate_keypair():
    """Generate RSA-2048 key pair (run once, save keys securely)"""
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
        backend=default_backend()
    )

    # Save private key (KEEP THIS SECRET!)
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )
    with open('license_private_key.pem', 'wb') as f:
        f.write(private_pem)

    # Save public key (embed this in Decentra)
    public_key = private_key.public_key()
    public_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    )
    with open('license_public_key.pem', 'wb') as f:
        f.write(public_pem)

    print("✅ Key pair generated!")
    print(f"   Private key: license_private_key.pem (KEEP SECRET!)")
    print(f"   Public key: license_public_key.pem (embed in Decentra)")

def create_license(
    customer_name: str,
    customer_email: str,
    tier: str,
    duration_days: int = 365,
    company: str = ""
):
    """Generate a license key"""

    # Load private key
    with open('license_private_key.pem', 'rb') as f:
        private_key = serialization.load_pem_private_key(
            f.read(),
            password=None,
            backend=default_backend()
        )

    # Define features and limits based on tier
    # Note: -1 means unlimited, -2 means server-dependent (for storage_gb)
    tier_config = {
        'community': {
            'features': {
                'voice_chat': True,
                'file_uploads': True,
                'webhooks': True,
                'custom_emojis': True,
                'audit_logs': True,
                'sso': False,
                'smtp': True,
                'video_quality': '720p',
                'screensharing_quality': '720p'
            },
            'limits': {
                'max_users': 30,
                'max_servers': 2,
                'max_channels_per_server': 30,
                'max_file_size_mb': 10,
                'max_messages_history': -1,
                'storage_gb': -2
            }
        },
        'lite': {
            'features': {
                'voice_chat': True,
                'file_uploads': True,
                'webhooks': True,
                'custom_emojis': True,
                'audit_logs': True,
                'sso': False,
                'smtp': True,
                'video_quality': '720p',
                'screensharing_quality': '720p'
            },
            'limits': {
                'max_users': 50,
                'max_servers': 5,
                'max_channels_per_server': 50,
                'max_file_size_mb': 30,
                'max_messages_history': -1,
                'storage_gb': 50
            }
        },
        'standard': {
            'features': {
                'voice_chat': True,
                'file_uploads': True,
                'webhooks': True,
                'custom_emojis': True,
                'audit_logs': True,
                'sso': True,
                'smtp': True,
                'video_quality': '1080p',
                'screensharing_quality': '1080p'
            },
            'limits': {
                'max_users': 80,
                'max_servers': 8,
                'max_channels_per_server': 150,
                'max_file_size_mb': 100,
                'max_messages_history': -1,
                'storage_gb': 150
            }
        },
        'elite': {
            'features': {
                'voice_chat': True,
                'file_uploads': True,
                'webhooks': True,
                'custom_emojis': True,
                'audit_logs': True,
                'sso': True,
                'smtp': True,
                'video_quality': '1440p',
                'screensharing_quality': '1440p'
            },
            'limits': {
                'max_users': -1,
                'max_servers': -1,
                'max_channels_per_server': -1,
                'max_file_size_mb': -1,
                'max_messages_history': -1,
                'storage_gb': 512
            }
        },
        'off_the_walls': {
            'features': {
                'voice_chat': True,
                'file_uploads': True,
                'webhooks': True,
                'custom_emojis': True,
                'audit_logs': True,
                'sso': True,
                'smtp': True,
                'video_quality': '4k',
                'screensharing_quality': '4k'
            },
            'limits': {
                'max_users': -1,
                'max_servers': -1,
                'max_channels_per_server': -1,
                'max_file_size_mb': -1,
                'max_messages_history': -1,
                'storage_gb': 1024
            }
        }
    }

    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=duration_days)

    # Create license data
    license_data = {
        'license_id': f"LIC-{now.strftime('%Y%m%d')}-{hash(customer_email) % 100000:05d}",
        'customer': {
            'name': customer_name,
            'email': customer_email,
            'company': company
        },
        'tier': tier,
        'features': tier_config[tier]['features'],
        'limits': tier_config[tier]['limits'],
        'issued_at': now.isoformat(),
        'expires_at': expires.isoformat()
    }

    # Serialize to JSON
    license_json = json.dumps(license_data, separators=(',', ':'))
    license_bytes = license_json.encode('utf-8')

    # Sign with private key
    signature = private_key.sign(
        license_bytes,
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=padding.PSS.MAX_LENGTH
        ),
        hashes.SHA256()
    )

    # Combine and encode
    license_package = license_bytes + b'||' + signature
    license_key = base64.b64encode(license_package).decode('utf-8')

    return license_key, license_data

if __name__ == '__main__':
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == 'generate-keypair':
        generate_keypair()
    else:
        # Example: Generate a license
        license_key, license_info = create_license(
            customer_name="John Doe",
            customer_email="john@example.com",
            company="Acme Corp",
            tier="elite",
            duration_days=365
        )

        print("\n" + "="*60)
        print("LICENSE KEY GENERATED")
        print("="*60)
        print(f"\nCustomer: {license_info['customer']['name']}")
        print(f"Email: {license_info['customer']['email']}")
        print(f"Tier: {license_info['tier']}")
        print(f"Expires: {license_info['expires_at']}")
        print(f"\nLicense Key:")
        print("-"*60)
        print(license_key)
        print("-"*60)
        print("\nProvide this key to the customer.")
        print("="*60 + "\n")
```

**Usage:**

```bash
# 1. Generate key pair (run once)
python license_generator.py generate-keypair

# 2. Edit the script to create licenses
# 3. Run to generate license keys
python license_generator.py
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

1. **Setup License Infrastructure**
   - [ ] Generate RSA-2048 key pair
   - [ ] Store private key securely (encrypted)
   - [ ] Embed public key in application
   - [ ] Create license_validator.py module
   - [ ] Write unit tests for validator

2. **Backend Integration**
   - [ ] Add license loading on startup
   - [ ] Implement /api/license endpoint
   - [ ] Add environment variable support
   - [ ] Test validation with sample licenses

### Phase 2: Feature Lockdown (Week 2-3)

3. **Identify Features to Lock**
   - [ ] Voice chat
   - [ ] Custom emojis
   - [ ] Webhooks (if implemented)
   - [ ] SSO (if implemented)
   - [ ] Audit logs (if implemented)

4. **Implement Backend Checks**
   - [ ] Add feature checks to handlers
   - [ ] Implement limit enforcement
   - [ ] Add error messages for locked features
   - [ ] Test each feature gate

5. **Define Limits**
   - [ ] Max users
   - [ ] Max servers per user
   - [ ] Max channels per server
   - [ ] File upload size limits
   - [ ] Message history retention

### Phase 3: Frontend Integration (Week 3-4)

6. **License Context**
   - [ ] Create LicenseProvider
   - [ ] Implement useLicense hook
   - [ ] Add license API calls
   - [ ] Handle loading states

7. **UI Components**
   - [ ] FeatureGate component
   - [ ] UpgradePrompt component
   - [ ] License info panel
   - [ ] License activation form

8. **Feature Gates**
   - [ ] Gate voice chat UI
   - [ ] Gate custom emoji UI
   - [ ] Show upgrade prompts
   - [ ] Display current limits

### Phase 4: License Management (Week 4-5)

9. **Generation Tools**
   - [ ] Create license_generator.py
   - [ ] Build admin web interface (optional)
   - [ ] Implement tier configurations
   - [ ] Test key generation

10. **Customer Management**
    - [ ] Track license assignments
    - [ ] Generate renewal reminders
    - [ ] Create license FAQ docs

### Phase 5: Testing & Documentation (Week 5-6)

11. **Comprehensive Testing**
    - [ ] Test each tier configuration
    - [ ] Test expired licenses
    - [ ] Test tampered licenses
    - [ ] Test offline validation
    - [ ] Load testing with limits

12. **Documentation**
    - [ ] Write installation guide
    - [ ] Document tier features
    - [ ] Create customer FAQ
    - [ ] Internal admin guide

### Phase 6: Deployment (Week 6)

13. **Production Preparation**
    - [ ] Secure private key storage
    - [ ] Setup license generation server
    - [ ] Create backup procedures
    - [ ] Setup monitoring

14. **Launch**
    - [ ] Deploy updated Decentra
    - [ ] Test end-to-end flow
    - [ ] Create marketing materials
    - [ ] Announce licensing tiers

---

## Security Considerations

### ✅ Strong Security Practices

1. **Private Key Security**
   - Store private key on encrypted, air-gapped system
   - Never commit private key to version control
   - Use HSM (Hardware Security Module) for enterprise
   - Rotate keys annually

2. **Public Key Embedding**
   - It's OK to embed public key in code (can't forge signatures)
   - Consider code obfuscation for additional protection
   - Use binary embedding rather than plaintext

3. **License Validation**
   - Always verify signature before trusting license data
   - Check expiration dates
   - Validate JSON structure
   - Rate-limit validation attempts

4. **Transmission Security**
   - Deliver licenses via HTTPS only
   - Encourage customers to store in encrypted files
   - Support environment variables for automation

### ⚠️ Known Limitations

1. **Reversing Public Key**
   - Attackers can extract public key from binary
   - Can't prevent this, but they still can't forge licenses

2. **Code Modification**
   - Determined attackers can patch out license checks
   - Accept this as cost of self-hosted software
   - Honest customers won't do this

3. **License Sharing**
   - Can't prevent customers from sharing license files
   - Use short expiration periods (annual renewals)
   - Track via support/update access (optional)

4. **No Instant Revocation**
   - Offline licenses can't be revoked instantly
   - Use expiration dates as natural revocation
   - For critical revocations, release patch update

### 🛡️ Mitigation Strategies

1. **Code Obfuscation** (Optional)
   - Use PyArmor for Python obfuscation
   - Makes patching harder (but not impossible)
   - Balance security vs. debuggability

2. **Update Mechanism**
   - Tie updates to valid licenses
   - Expired licenses work but don't get updates
   - Incentivizes renewals

3. **Support Access**
   - Link support to license validation
   - Premium support for Elite and Off the Walls tiers
   - Community support for Community tier

4. **Optional Online Validation**
   - Add optional "phone home" for analytics
   - Track installation counts
   - Detect shared licenses
   - Must work if offline too (graceful degradation)

---

## Cost-Benefit Analysis

### Implementation Costs

| Approach | Setup Time | Development Cost | Ongoing Costs | Annual Cost |
|----------|-----------|------------------|---------------|-------------|
| **Cryptographic (Recommended)** | 2-3 weeks | $5,000-$10,000 | $0/mo (self-managed) | ~$0 |
| **Cloud LaaS (Cryptolens)** | 3-5 days | $2,000-$4,000 | $29-$299/mo | $348-$3,588 |
| **Self-Hosted OSS (Keygen CE)** | 1-2 weeks | $3,000-$7,000 | Infrastructure ($20-50/mo) | $240-$600 |
| **Simple Pattern** | 2-3 days | $500-$1,500 | $0/mo | $0 |

*Development cost estimates assume contractor rate of $100-150/hr*

### ROI Considerations

For Decentra's self-hosted model:

1. **Privacy alignment:** Users who self-host value privacy
   - Cloud LaaS sends license data to third parties ❌
   - Cryptographic offline validation = 100% private ✅

2. **Zero recurring costs:** Cryptographic approach has no monthly fees
   - Save $348-$3,588/year vs. cloud solutions
   - ROI achieved after ~2-4 months

3. **Offline compatibility:** Critical for self-hosted deployments
   - Many installations in air-gapped environments
   - Only cryptographic approach works 100% offline

4. **Brand alignment:** Shows commitment to decentralization
   - "Decentralized" in name, but using centralized licensing service? ❌
   - Fully offline licensing aligns with brand ✅

**Recommendation:** Invest in cryptographic offline licensing despite higher initial cost. Long-term savings and philosophical alignment justify the investment.

---

## Alternative: Hybrid Online/Offline

For maximum flexibility, implement both:

1. **Primary: Offline Cryptographic Validation**
   - Works 100% offline
   - No external dependencies
   - Core licensing mechanism

2. **Optional: Online Validation**
   - Check for license updates/revocations
   - Track installation analytics
   - Enable floating licenses (optional feature)
   - Graceful degradation if offline

**Implementation:**
- Try online validation first
- Fall back to offline if unavailable
- Cache online results (24hr)
- Never block on online check failure

```python
async def validate_license_hybrid(license_key: str) -> Dict:
    """Try online validation, fall back to offline"""
    try:
        # Try online validation (with 5s timeout)
        online_result = await validate_online(license_key, timeout=5)
        return online_result
    except (TimeoutError, ConnectionError):
        # Fall back to offline validation
        return validate_offline(license_key)
```

This gives you:
- ✅ Works offline (primary requirement)
- ✅ Optional online features (analytics, revocation)
- ✅ No single point of failure
- ✅ Best of both worlds

---

## Frequently Asked Questions

### Q: Can't users just patch out the license checks?

**A:** Yes, technically determined users can modify the code to bypass checks. This is an inherent limitation of self-hosted software. However:
- Most customers are honest and will purchase licenses
- Those who would crack software likely wouldn't pay anyway
- Focus on making purchasing easy and valuable
- Consider it "free marketing" - if they love it cracked, they might buy licenses later

### Q: What about hardware locking (node-locking)?

**A:** Hardware locking ties a license to specific hardware (MAC address, CPU ID, etc.). While possible, it's problematic for Docker-based applications:
- Docker containers have ephemeral MAC addresses
- Complicates legitimate migrations/upgrades
- Frustrates honest customers
- Not recommended for Decentra

Consider optional hardware locking for "Enterprise Plus" tier if needed.

### Q: How do I prevent license sharing?

**A:** You can't fully prevent sharing in offline systems. Mitigation strategies:
1. Short expiration periods (annual renewals)
2. Tie updates to valid licenses
3. Link support access to license validation
4. Optional online check for floating license limits
5. Audit clauses in license agreement
6. Focus on value delivery over restriction

### Q: Should I obfuscate the code?

**A:** Optional and situational:
- **Python:** PyArmor can obfuscate .py files
- **Benefits:** Makes patching harder
- **Drawbacks:** Complicates debugging, may break tools
- **Recommendation:** Start without obfuscation, add later if piracy becomes significant issue

### Q: What about subscription vs. perpetual licenses?

**A:** Both are possible:

**Annual Subscription (Recommended):**
- Set expiration to 1 year from issue
- Generates recurring revenue
- Forces periodic validation
- Natural upgrade opportunities

**Perpetual License:**
- No expiration date (or very far future: 2099)
- One-time payment
- Include "maintenance" period for updates
- Consider "maintenance renewals"

### Q: How do I handle license transfers?

**A:** Implement a license transfer policy:
1. Customer requests transfer via support
2. You invalidate old license (track in database)
3. Generate new license for new customer/server
4. Optional: Charge transfer fee

### Q: What if private key is compromised?

**A:** Key rotation procedure:
1. Generate new RSA key pair
2. Release Decentra update with new public key
3. Invalidate all old licenses
4. Re-issue licenses signed with new key
5. Notify customers of update requirement

This is rare but important to plan for.

### Q: Can I use Ed25519 instead of RSA?

**A:** Yes! Ed25519 is excellent:
- **Faster:** Sign/verify operations
- **Smaller:** Keys and signatures
- **Modern:** More modern cryptography
- **Secure:** 128-bit security level

Example: Replace RSA code with Ed25519:

```python
from cryptography.hazmat.primitives.asymmetric import ed25519

# Generate key pair
private_key = ed25519.Ed25519PrivateKey.generate()
public_key = private_key.public_key()

# Sign
signature = private_key.sign(data)

# Verify
public_key.verify(signature, data)
```

Both RSA-2048 and Ed25519 are cryptographically secure. Choose based on familiarity and tooling.

---

## Conclusion

For Decentra, I strongly recommend implementing **offline RSA/Ed25519 cryptographic licensing** with optional hybrid online validation. This approach:

✅ **Aligns with self-hosted philosophy** - No external dependencies
✅ **Ensures privacy** - No data sent to third parties
✅ **Works offline** - Perfect for air-gapped deployments
✅ **Cryptographically secure** - NSA-grade encryption
✅ **Zero recurring costs** - No monthly licensing fees
✅ **Full control** - You own the entire stack
✅ **Flexible licensing tiers** - Community, Lite, Standard, Elite, Off the Walls
✅ **Feature-rich limits** - Users, servers, channels, file sizes

While the initial implementation takes 4-6 weeks, the long-term benefits far outweigh the upfront investment. This approach future-proofs Decentra's business model while respecting user privacy and autonomy.

**Next Steps:**
1. Review this document with your team
2. Decide on license tier structure and pricing
3. Generate RSA key pair
4. Begin Phase 1 implementation
5. Set up license generation server
6. Test thoroughly before launch

---

## References

### Research Sources

- [Generating License Keys in 2026](https://build-system.fman.io/generating-license-keys)
- [How to Generate Secure License Keys in 2026](https://keygen.sh/blog/how-to-generate-license-keys/)
- [Keygen Offline Licensing Documentation](https://keygen.sh/docs/choosing-a-licensing-model/offline-licenses/)
- [How to Implement Offline Software License Validation](https://licensespring.com/blog/guide/how-to-implement-offline-software-license-validation)
- [Top 6 License Key Generator Tools in 2026](https://licensemanager.at/license-key-generator-tools/)
- [Cryptolens Python Documentation](https://github.com/Cryptolens/cryptolens-python)
- [Keygen API Repository](https://github.com/keygen-sh/keygen-api)
- [Feature Flags with Python - Harness](https://www.harness.io/blog/feature-flags-with-python)
- [Implementing Feature Flags in React - Comprehensive Guide](https://medium.com/@ignatovich.dm/implementing-feature-flags-in-react-a-comprehensive-guide-f85266265fb3)
- [Software Licensing API Example - Easy Digital Downloads](https://easydigitaldownloads.com/docs/software-licensing-api-example-using-python/)

### Additional Resources

- [Python Cryptography Library](https://cryptography.io/)
- [RSA Cryptography Explained](https://en.wikipedia.org/wiki/RSA_(cryptosystem))
- [Ed25519 Signature Scheme](https://ed25519.cr.yp.to/)
- [Feature Flag Best Practices](https://docs.getunleash.io/feature-flag-tutorials/react)

---

## Document Version

- **Version:** 1.0
- **Date:** 2026-02-06
- **Author:** Claude (Sonnet 4.5)
- **Status:** Research Complete

---

*This document provides guidance for implementing a licensing system in Decentra. Always consult with legal counsel regarding license agreements and terms of service.*
