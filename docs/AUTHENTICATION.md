# Authentication & SSO Configuration Guide

Decentra supports enterprise Single Sign-On (SSO) and automated user provisioning via SCIM 2.0.
This guide covers setup for all supported identity providers.

> **License Requirement:** SSO and SCIM features require a **Standard** or higher license tier.

---

## Table of Contents

1. [Overview](#overview)
2. [OIDC (OpenID Connect)](#oidc-openid-connect)
3. [Auth0 Setup](#auth0-setup)
4. [SAML 2.0](#saml-20)
5. [LDAP Directory Sync](#ldap-directory-sync)
6. [SCIM 2.0 Provisioning](#scim-20-provisioning)
   - [Okta](#okta)
   - [Google Workspace](#google-workspace)
   - [Microsoft Entra ID](#microsoft-entra-id)
7. [Troubleshooting](#troubleshooting)

---

## Overview

### Supported Protocols

| Protocol | Use Case | Browser Login | User Sync |
|----------|----------|:------------:|:---------:|
| **OIDC** | Modern identity providers (Google, Azure AD, Keycloak) | ✅ | Via SCIM |
| **Auth0** | Auth0 tenants (OIDC preset with auto-discovery) | ✅ | Via SCIM |
| **SAML 2.0** | Enterprise IdPs (Okta, ADFS, PingFederate) | ✅ | Via SCIM |
| **LDAP** | On-premise directories (Active Directory, OpenLDAP) | ❌ (sync only) | ✅ |

### Authentication Model

- **Hybrid Auth:** Users can sign in with either a local password or SSO. Both methods work simultaneously.
- **SSO-Only Users:** Users provisioned via SSO/SCIM are created without a local password. They can only sign in through SSO.
- **One Provider Policy:** Only one SSO provider (OIDC, SAML, or LDAP) can be active at a time. SCIM provisioning works independently of the auth provider.

### Admin Configuration

1. Navigate to **Admin Settings** → **Sign-in Options** tab
2. Enable SSO and select your identity provider
3. Fill in the provider-specific configuration
4. Click **Test Connection** to verify
5. Click **Save SSO Settings**

Once saved, a **"Sign in with SSO"** button will appear on the login page.

---

## OIDC (OpenID Connect)

OpenID Connect is the recommended protocol for modern identity providers.

### Prerequisites

- An OIDC-compatible identity provider (Google, Azure AD, Keycloak, Okta, etc.)
- A registered OAuth 2.0 application/client on your IdP

### Configuration Fields

| Field | Description | Example |
|-------|-------------|---------|
| **Issuer URL** | The OIDC issuer URL (must support `/.well-known/openid-configuration`) | `https://accounts.google.com` |
| **Client ID** | OAuth 2.0 client identifier | `abc123.apps.googleusercontent.com` |
| **Client Secret** | OAuth 2.0 client secret | `GOCSPX-...` |

### Callback URL

Register this URL in your IdP as an allowed redirect/callback URI:

```
https://your-decentra-domain.com/auth/sso/callback
```

### Required OIDC Scopes

Decentra requests the following scopes:
- `openid` — Required for OIDC
- `profile` — User's display name
- `email` — User's email address

### Claims Mapping

| OIDC Claim | Decentra Field |
|------------|----------------|
| `sub` | SSO external ID (unique identifier) |
| `email` | User email |
| `name` or `preferred_username` | Display name |
| `email_verified` | Email verification status |

### Example: Google Workspace

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**
2. Create an **OAuth 2.0 Client ID** (Web application)
3. Add your callback URL to **Authorized redirect URIs**
4. Copy the Client ID and Client Secret
5. In Decentra Admin: set Issuer URL to `https://accounts.google.com`

### Example: Keycloak

1. Create a new Client in your Keycloak realm
2. Set **Client Protocol** to `openid-connect`
3. Set **Access Type** to `confidential`
4. Add the callback URL to **Valid Redirect URIs**
5. Copy the Client ID and Client Secret from the **Credentials** tab
6. In Decentra Admin: set Issuer URL to `https://keycloak.example.com/realms/your-realm`

---

## Auth0 Setup

Auth0 is configured as an OIDC preset — Decentra automatically constructs the discovery URL from your Auth0 tenant domain.

### Step-by-Step

1. **Create an Auth0 Application:**
   - Log in to [Auth0 Dashboard](https://manage.auth0.com/)
   - Go to **Applications** → **Create Application**
   - Choose **Regular Web Application**
   - Name it "Decentra"

2. **Configure Application Settings:**
   - **Allowed Callback URLs:** `https://your-decentra-domain.com/auth/sso/callback`
   - **Allowed Logout URLs:** `https://your-decentra-domain.com/login`
   - **Allowed Web Origins:** `https://your-decentra-domain.com`

3. **Copy Credentials:**
   - Note your **Domain** (e.g., `your-tenant.auth0.com`)
   - Copy the **Client ID** and **Client Secret**

4. **Configure in Decentra:**
   - Admin Settings → Sign-in Options
   - Select **Auth0 (OIDC Preset)**
   - Enter your **Auth0 Domain** (just the domain, e.g., `your-tenant.auth0.com`)
   - Enter **Client ID** and **Client Secret**
   - Test Connection and Save

### Auth0 Connections

Auth0 supports multiple upstream connections (social, enterprise, database). Configure these in Auth0's **Authentication** → **Connections** section. Decentra delegates all identity management to Auth0.

---

## SAML 2.0

SAML 2.0 is supported for enterprise identity providers that use SAML assertions.

### Configuration Fields

| Field | Description | Example |
|-------|-------------|---------|
| **SP Entity ID** | The unique identifier for Decentra as a Service Provider | `https://your-decentra-domain.com/saml/metadata` |
| **IdP SSO URL** | The IdP's Single Sign-On endpoint | `https://idp.example.com/saml2/sso` |
| **IdP Certificate** | The IdP's X.509 signing certificate (PEM format) | `-----BEGIN CERTIFICATE-----...` |

### Service Provider (SP) Details

Provide these to your IdP:

| SP Field | Value |
|----------|-------|
| **ACS URL** | `https://your-decentra-domain.com/auth/sso/callback` |
| **Entity ID** | (configured in admin settings) |
| **NameID Format** | `urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress` |
| **Binding** | HTTP-POST |

### Required SAML Attributes

| Attribute | Description |
|-----------|-------------|
| `NameID` | User's email address (primary identifier) |
| `email` or `emailaddress` | Email address |
| `displayName` or `cn` | Display name |

### Example: Okta SAML

1. In Okta Admin → **Applications** → **Create App Integration**
2. Select **SAML 2.0**
3. Set **Single sign-on URL** to your ACS URL
4. Set **Audience URI (SP Entity ID)** to your entity ID
5. Configure attribute statements:
   - `email` → `user.email`
   - `displayName` → `user.displayName`
6. Download the IdP certificate and paste it into Decentra
7. Copy the IdP SSO URL from Okta's **Sign On** tab

### Example: ADFS

1. Add a new **Relying Party Trust** in ADFS
2. Set the **Identifier** to your SP Entity ID
3. Add a SAML endpoint (POST binding) with your ACS URL
4. Configure claim rules to send NameID and email attributes
5. Export the ADFS token-signing certificate (Base-64 PEM)

---

## LDAP Directory Sync

LDAP integration in Decentra is **sync-based** — it periodically pulls user information from your LDAP directory (Active Directory, OpenLDAP, etc.) to provision and update user accounts.

> **Note:** LDAP does not provide browser-based login. Users synced via LDAP are provisioned as SSO-only users. Combine LDAP with OIDC/SAML if you need browser-based SSO.

### Configuration Fields

| Field | Description | Example |
|-------|-------------|---------|
| **Server URL** | LDAP/LDAPS server address | `ldaps://ldap.example.com:636` |
| **Bind DN** | Service account distinguished name | `cn=admin,dc=example,dc=com` |
| **Bind Password** | Service account password | `secret` |
| **User Search Base** | Base DN for user searches | `ou=users,dc=example,dc=com` |
| **User Filter** | LDAP search filter | `(objectClass=person)` |

### Attribute Mapping

| LDAP Attribute | Decentra Field |
|----------------|----------------|
| `uid` or `sAMAccountName` | Username / external ID |
| `mail` or `userPrincipalName` | Email |
| `displayName` or `cn` | Display name |

### Active Directory Example

```
Server URL:       ldaps://dc01.corp.example.com:636
Bind DN:          CN=Decentra Service,OU=Service Accounts,DC=corp,DC=example,DC=com
User Search Base: OU=Users,DC=corp,DC=example,DC=com
User Filter:      (&(objectClass=user)(objectCategory=person)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))
```

The filter above excludes disabled AD accounts.

### Security Recommendations

- Always use **LDAPS** (port 636) or **StartTLS** for encrypted connections
- Create a **dedicated service account** with read-only access
- Use the most restrictive **User Search Base** possible

---

## SCIM 2.0 Provisioning

SCIM (System for Cross-domain Identity Management) enables your identity provider to automatically:

- **Create** users when they're assigned to the Decentra app
- **Update** user attributes when they change in the directory
- **Deactivate** users when they're removed from the app
- **Sync groups** to Decentra server roles

### SCIM Configuration

1. Admin Settings → Sign-in Options → scroll to **SCIM 2.0 Provisioning**
2. Enable SCIM
3. Click **Generate New Token** — copy the token immediately (it won't be shown again)
4. Note the **SCIM Base URL** displayed in the panel

### SCIM Endpoint Reference

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/scim/v2/ServiceProviderConfig` | GET | Service provider capabilities |
| `/scim/v2/Schemas` | GET | Supported schemas |
| `/scim/v2/ResourceTypes` | GET | Available resource types |
| `/scim/v2/Users` | GET, POST | List/create users |
| `/scim/v2/Users/{id}` | GET, PUT, PATCH, DELETE | Manage individual users |
| `/scim/v2/Groups` | GET, POST | List/create groups |
| `/scim/v2/Groups/{id}` | GET, PUT, PATCH, DELETE | Manage individual groups |

All SCIM endpoints require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <your-scim-token>
```

---

### Okta

#### Step 1: Create SCIM Integration

1. In Okta Admin → **Applications** → select your Decentra app
2. Go to **General** → **App Settings**
3. Under **Provisioning**, select **SCIM**

#### Step 2: Configure Provisioning

1. Go to the **Provisioning** tab → **Integration**
2. Set:
   - **SCIM connector base URL:** `https://your-decentra-domain.com/scim/v2`
   - **Unique identifier field for users:** `userName`
   - **Authentication Mode:** HTTP Header
   - **Authorization:** Bearer token from Decentra admin panel
3. Click **Test API Credentials** to verify

#### Step 3: Enable Provisioning Features

1. Go to **Provisioning** → **To App**
2. Enable:
   - ✅ Create Users
   - ✅ Update User Attributes
   - ✅ Deactivate Users

#### Step 4: Attribute Mapping

| Okta Attribute | SCIM Attribute |
|----------------|----------------|
| `user.login` | `userName` |
| `user.email` | `emails[type eq "work"].value` |
| `user.displayName` | `displayName` |

---

### Google Workspace

#### Step 1: Pre-requisites

- Google Workspace Business or Enterprise edition
- Super Admin access to Google Admin Console

#### Step 2: Configure Auto-Provisioning

1. Go to [Google Admin Console](https://admin.google.com/) → **Apps** → **Web and mobile apps**
2. Add your Decentra SAML/OIDC app (if not already added)
3. Go to the app settings → **Auto-provisioning** → **Set up auto-provisioning**

#### Step 3: SCIM Settings

1. Set:
   - **Endpoint URL:** `https://your-decentra-domain.com/scim/v2`
   - **Authorization Header:** `Bearer <your-scim-token>`
2. Configure attribute mapping:
   - `Primary email` → `userName`
   - `First name` + `Last name` → `displayName`

#### Step 4: Enable Provisioning

1. Toggle on **Auto-provisioning**
2. Select which organizational units should be provisioned
3. Click **Save** and **Activate**

---

### Microsoft Entra ID

#### Step 1: Create Enterprise Application

1. Go to [Azure Portal](https://portal.azure.com/) → **Microsoft Entra ID** → **Enterprise Applications**
2. Click **New application** → **Create your own application**
3. Select **Integrate any other application you don't find in the gallery (Non-gallery)**
4. Name it "Decentra"

#### Step 2: Configure Provisioning

1. Go to the Decentra app → **Provisioning** → **Get started**
2. Set **Provisioning Mode** to **Automatic**
3. Under **Admin Credentials**:
   - **Tenant URL:** `https://your-decentra-domain.com/scim/v2`
   - **Secret Token:** Your SCIM bearer token from Decentra admin panel
4. Click **Test Connection** to verify

#### Step 3: Attribute Mapping

1. Go to **Provisioning** → **Mappings**
2. Click **Provision Microsoft Entra ID Users**
3. Verify mappings:

| Entra ID Attribute | SCIM Attribute |
|-------------------|----------------|
| `userPrincipalName` | `userName` |
| `mail` | `emails[type eq "work"].value` |
| `displayName` | `displayName` |
| `accountEnabled` (Switch) | `active` |

4. Click **Provision Microsoft Entra ID Groups** to enable group sync:

| Entra ID Attribute | SCIM Attribute |
|-------------------|----------------|
| `displayName` | `displayName` |
| `members` | `members` |

#### Step 4: Start Provisioning

1. Go back to **Provisioning** → **Overview**
2. Click **Start provisioning**
3. The first sync cycle may take 20–40 minutes; subsequent incremental syncs run every ~40 minutes

---

## Troubleshooting

### Common Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| "SSO requires a paid license tier" | SSO feature not enabled in your license | Upgrade to Standard tier or above |
| "OIDC discovery failed" | Can't reach the identity provider | Check Issuer URL and network/firewall settings |
| "SAML signature verification failed" | Certificate mismatch or expired | Re-download the IdP certificate |
| "LDAP connection failed" | Wrong credentials or network issue | Verify bind DN/password and server URL |
| "Sign in with SSO" button not showing | SSO not enabled in admin settings | Enable SSO in Admin Settings → Sign-in Options |
| SCIM "Invalid SCIM token" | Token mismatch or expired | Generate a new token in admin panel |

### Debug Logging

Check the server container logs for SSO-related errors:

```bash
docker compose logs -f server | grep -i "sso\|scim\|saml\|oidc\|ldap"
```

### Certificate Format (SAML)

The IdP certificate must be in PEM format:

```
-----BEGIN CERTIFICATE-----
MIIDpDCCAoygAwIBAgIGAX...
(base64-encoded certificate data)
-----END CERTIFICATE-----
```

If your IdP provides a `.cer` or `.crt` file, convert it:

```bash
openssl x509 -inform DER -in certificate.cer -out certificate.pem
```

### Testing SCIM Endpoints

You can test SCIM endpoints directly with curl:

```bash
# List users
curl -H "Authorization: Bearer YOUR_TOKEN" \
     https://your-domain.com/scim/v2/Users

# Get service provider config
curl https://your-domain.com/scim/v2/ServiceProviderConfig

# Create a user
curl -X POST -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"userName":"testuser","displayName":"Test User","emails":[{"value":"test@example.com","primary":true}]}' \
     https://your-domain.com/scim/v2/Users
```

### OIDC State Mismatch

If you see "state mismatch" errors during OIDC callback, this usually means:
- The callback URL registered in your IdP doesn't exactly match `https://your-domain.com/auth/sso/callback`
- Browser cookies or session storage were cleared between the redirect and callback
- Multiple tabs attempted SSO login simultaneously

### Password Recovery for SSO Users

SSO-only users (provisioned with no local password) cannot use the "Forgot Password" flow. To grant a local password to an SSO user, an admin can reset their password from the Users admin panel.
