# SSO & SCIM Implementation Plan

## Overview

Add enterprise authentication capabilities with OIDC, SAML, and LDAP support, plus SCIM 2.0 provisioning for Okta, Google Workspace, and Microsoft EntraID. The system will support both password and SSO authentication, allow existing users to link SSO identities, use LDAP for user synchronization (not direct bind), and enable SCIM provisioning independently of the chosen auth method.

**License Requirements**: SSO and SCIM features are restricted to **Standard, Elite, and Off the Walls** license tiers only (not available in Community or Lite editions).

## Implementation Steps

### 1. License Enforcement - Define Feature Flags

**Files to modify:**
- `server/license_validator.py`
- `LICENSING.md`

**Changes:**
- Add `scim` feature flag to `DEFAULT_FEATURES` dict in `license_validator.py` with value `False` (note: `sso` already exists at line 32-40)
- Update tier feature matrix in `LICENSING.md` (lines 10-28) to show `scim` feature availability matching SSO (No for Community/Lite, Yes for Standard/Elite/Off the Walls)
- Verify `check_feature_access("sso")` and `check_feature_access("scim")` functions at line 426-428 work correctly

**Expected outcome:**
- License system properly gates SSO and SCIM features
- Documentation clearly shows which tiers include SSO/SCIM

---

### 2. Database Schema Extensions

**Files to modify:**
- `server/database.py`

**Changes:**

#### Add columns to `admin_settings` table (around line 207-232):
```sql
-- SSO Configuration
sso_enabled BOOLEAN DEFAULT FALSE
sso_provider VARCHAR(50)  -- 'oidc', 'saml', 'ldap'

-- OIDC Settings
oidc_issuer TEXT
oidc_client_id VARCHAR(255)
oidc_client_secret TEXT  -- Encrypted
oidc_redirect_uri TEXT

-- SAML Settings
saml_entity_id VARCHAR(255)
saml_sso_url TEXT
saml_x509_cert TEXT
saml_slo_url TEXT

-- LDAP Settings
ldap_server_url TEXT
ldap_bind_dn TEXT
ldap_bind_password TEXT  -- Encrypted
ldap_user_base_dn TEXT
ldap_user_filter TEXT
ldap_sync_interval_hours INTEGER DEFAULT 24
ldap_attr_username VARCHAR(100) DEFAULT 'uid'
ldap_attr_email VARCHAR(100) DEFAULT 'mail'
ldap_attr_displayname VARCHAR(100) DEFAULT 'displayName'

-- SCIM Configuration
scim_enabled BOOLEAN DEFAULT FALSE
scim_base_url TEXT
scim_auth_token TEXT  -- Encrypted
```

#### Create new `sso_identities` table:
```sql
CREATE TABLE sso_identities (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) REFERENCES users(username) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL,  -- 'oidc', 'saml', 'ldap'
    external_id VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    UNIQUE(provider, external_id)
);
CREATE INDEX idx_sso_identities_username ON sso_identities(username);
CREATE INDEX idx_sso_identities_provider_external ON sso_identities(provider, external_id);
```

#### Create new `scim_tokens` table:
```sql
CREATE TABLE scim_tokens (
    id SERIAL PRIMARY KEY,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used TIMESTAMP,
    created_by VARCHAR(255) REFERENCES users(username)
);
```

#### Modify `users` table (line 49-75):
- Change `password_hash VARCHAR(255) NOT NULL` to `password_hash VARCHAR(255)` (allow NULL for SSO-only users)

#### Add migration logic:
- Add `init_database()` migration logic following existing patterns around line 300
- Handle backward compatibility for existing installations

**Expected outcome:**
- Database schema supports SSO identity mapping
- Admin settings can store SSO/SCIM configuration
- SCIM tokens can be managed independently

---

### 3. Backend Dependencies & Utilities

**Files to modify:**
- `server/requirements.txt`
- `server/sso_utils.py` (new file)
- `server/encryption_utils.py`

**Changes:**

#### Add to `requirements.txt`:
```
authlib>=1.3.0
python3-saml>=1.16.0
python-ldap>=3.4.0
scim2-models>=0.1.0
```

#### Create `server/sso_utils.py`:

Implement the following classes:

1. **OIDCProvider**
   - `initiate_login()` - Generate authorization URL
   - `handle_callback(code)` - Exchange code for tokens
   - `validate_id_token(token)` - Verify JWT signature and claims
   - `get_user_info(access_token)` - Fetch user profile
   - Check `check_feature_access("sso")` before operations

2. **SAMLProvider**
   - `initiate_login()` - Generate SAML AuthnRequest
   - `handle_assertion(saml_response)` - Parse and validate SAML assertion
   - `extract_user_attributes(assertion)` - Get user data from assertion
   - Check `check_feature_access("sso")` before operations

3. **LDAPSync**
   - `connect()` - Establish LDAP connection
   - `sync_users()` - Query LDAP directory and sync to database
   - `map_ldap_user()` - Map LDAP attributes to user schema
   - `schedule_sync()` - Background task scheduler
   - Check `check_feature_access("sso")` before operations

4. **SCIMHandler**
   - `create_user(scim_user)` - Handle SCIM user creation
   - `update_user(user_id, scim_user)` - Handle updates
   - `delete_user(user_id)` - Handle deprovisioning
   - `list_users(filter, start_index, count)` - Handle queries
   - `validate_scim_token(token)` - Check bearer token
   - Check `check_feature_access("scim")` before operations

#### Extend `encryption_utils.py`:
- Follow SMTP password encryption pattern (lines 26-48)
- Add methods to encrypt/decrypt SSO secrets

**Expected outcome:**
- All SSO providers can be configured and used
- SCIM 2.0 operations are properly handled
- Secrets are encrypted at rest

---

### 4. Backend SSO Authentication Flow

**Files to modify:**
- `server/api.py`
- `server/database.py`
- `server/server.py`

**Changes:**

#### Add REST endpoints to `api.py` (following pattern at lines 1862-1887):

1. **POST /api/auth/sso/initiate**
   ```python
   async def api_sso_initiate(request):
       # Check license
       if not check_feature_access("sso"):
           return web.json_response({
               'success': False, 
               'error': 'SSO requires Standard tier or higher'
           }, status=403)
       
       # Load SSO config from admin_settings
       # Determine provider (oidc, saml, ldap)
       # Generate authorization/SAML request URL
       # Return redirect URL
   ```

2. **GET /api/auth/sso/callback**
   ```python
   async def api_sso_callback(request):
       # Check license
       if not check_feature_access("sso"):
           return web.json_response({
               'success': False, 
               'error': 'SSO requires Standard tier or higher'
           }, status=403)
       
       # Handle OAuth code or SAML assertion
       # Validate tokens/assertions
       # Create or link user account
       # Generate Decentra JWT
       # Return token + user info
   ```

3. **POST /api/auth/sso/link**
   ```python
   async def api_sso_link(request):
       # Verify user is authenticated
       # Initiate SSO flow with linking intent
       # Store state parameter for link vs new user
   ```

#### Add to `database.py` (following pattern at lines 1222-1234):

```python
def create_or_link_sso_user(self, external_id: str, provider: str, 
                             email: str, username: str = None,
                             link_to_username: str = None) -> dict:
    """
    Create new user from SSO or link to existing user.
    
    Returns: {'username': str, 'created': bool, 'linked': bool}
    """
    # Check if external identity already exists
    # If linking to existing user, create mapping
    # If email matches existing user, offer linking
    # Otherwise create new user (password_hash = NULL)
    # Insert into sso_identities table
    # Return user info
```

#### Update `server.py`:

- Modify `verify_jwt_token()` (line 229-237) to accept SSO-generated tokens
- Add LDAP sync background task using asyncio (similar to existing background tasks)
- Schedule periodic LDAP sync based on `ldap_sync_interval_hours`

**Expected outcome:**
- Users can authenticate via SSO providers
- JIT (Just-In-Time) user provisioning works
- Existing users can link SSO identities
- LDAP users sync automatically

---

### 5. Backend SCIM 2.0 Endpoints

**Files to modify:**
- `server/api.py`

**Changes:**

Add SCIM 2.0 endpoints following RFC 7644:

1. **GET /scim/v2/ServiceProviderConfig**
   - Return SCIM capabilities (supported features, authentication schemes)

2. **GET /scim/v2/Schemas**
   - Return supported SCIM schemas (User, Group)

3. **GET /scim/v2/ResourceTypes**
   - Return available resource types

4. **GET /scim/v2/Users**
   - List/search users with filtering
   - Support `?filter=userName eq "john"` syntax
   - Pagination with `startIndex` and `count`

5. **POST /scim/v2/Users**
   - Create new user
   - Map SCIM schema to local user schema

6. **GET /scim/v2/Users/{id}**
   - Return single user

7. **PUT /scim/v2/Users/{id}**
   - Replace user (full update)

8. **PATCH /scim/v2/Users/{id}**
   - Partial update using JSON Patch operations

9. **DELETE /scim/v2/Users/{id}**
   - Deprovision user (set inactive or delete)

**All endpoints must:**
- Check `check_feature_access("scim")` - return 403 if not licensed
- Validate SCIM bearer token from `scim_tokens` table
- Follow SCIM 2.0 response format with proper schemas

**Schema mapping:**
```
SCIM                    →  Decentra
─────────────────────────────────────
userName                →  username
emails[0].value         →  email
displayName             →  bio
active                  →  user_status
externalId              →  sso_identities.external_id
```

**Expected outcome:**
- Full SCIM 2.0 compliance for user provisioning
- Okta, Google Workspace, and EntraID can provision users
- Token-based authentication for SCIM endpoints

---

### 6. Admin Settings SSO Tab - Frontend

**Files to create/modify:**
- `frontend/src/components/admin/SSOPanel.tsx` (new)
- `frontend/src/App.tsx`

**Changes:**

#### Create `SSOPanel.tsx`:

```tsx
import { FeatureGate } from '../FeatureGate'

export function SSOPanel() {
  return (
    <FeatureGate feature="sso">
      <div className="space-y-6">
        {/* Provider Selection */}
        <div>
          <h3>Authentication Provider</h3>
          <select>
            <option value="oidc">OpenID Connect (OIDC)</option>
            <option value="saml">SAML 2.0</option>
            <option value="ldap">LDAP Sync</option>
          </select>
        </div>

        {/* OIDC Configuration */}
        {provider === 'oidc' && (
          <div className="space-y-4">
            <input placeholder="Issuer URL" />
            <input placeholder="Client ID" />
            <input type="password" placeholder="Client Secret" />
            <input value={redirectUri} disabled />
          </div>
        )}

        {/* SAML Configuration */}
        {provider === 'saml' && (
          <div className="space-y-4">
            <input placeholder="Entity ID" />
            <input placeholder="SSO URL" />
            <textarea placeholder="X.509 Certificate" />
          </div>
        )}

        {/* LDAP Configuration */}
        {provider === 'ldap' && (
          <div className="space-y-4">
            <input placeholder="Server URL (ldap://)" />
            <input placeholder="Bind DN" />
            <input type="password" placeholder="Bind Password" />
            <input placeholder="User Base DN" />
            <input placeholder="Sync Interval (hours)" type="number" />
          </div>
        )}

        {/* SCIM Section */}
        <FeatureGate feature="scim">
          <div className="border-t pt-6">
            <h3>SCIM Provisioning</h3>
            <label>
              <input type="checkbox" /> Enable SCIM 2.0
            </label>
            
            {scimEnabled && (
              <>
                <div className="bg-gray-800 p-4 rounded">
                  <p>SCIM Base URL:</p>
                  <code>{window.location.origin}/scim/v2/</code>
                </div>
                
                <button onClick={generateToken}>
                  Generate SCIM Token
                </button>
                
                {/* Provider-specific instructions */}
                <details>
                  <summary>Okta Setup</summary>
                  {/* Step-by-step Okta configuration */}
                </details>
                
                <details>
                  <summary>Google Workspace Setup</summary>
                  {/* Step-by-step Google configuration */}
                </details>
                
                <details>
                  <summary>Microsoft EntraID Setup</summary>
                  {/* Step-by-step Microsoft configuration */}
                </details>
              </>
            )}
          </div>
        </FeatureGate>
      </div>
    </FeatureGate>
  )
}
```

#### Update `App.tsx` (around lines 5042-5110):

Add new tab:
```tsx
<button 
  onClick={() => setAdminSettingsTab('sso')}
  className={adminSettingsTab === 'sso' ? 'active' : ''}
>
  SSO & SCIM
</button>

{adminSettingsTab === 'sso' && <SSOPanel />}
```

Wire up WebSocket handlers for `get_admin_settings` and `save_admin_settings` to include SSO/SCIM config.

**Expected outcome:**
- Admins can configure SSO providers from UI
- SCIM can be enabled with proper documentation
- FeatureGate properly restricts access on lower tiers

---

### 7. Login Page SSO Integration - Frontend

**Files to modify:**
- `frontend/src/App.tsx`
- `frontend/src/components/SSOCallback.tsx` (new)

**Changes:**

#### Update login page (around lines 500-750):

```tsx
{ssoEnabled && ssoLicensed && (
  <button 
    onClick={handleSSOLogin}
    className="sso-button"
  >
    Sign in with SSO
  </button>
)}

{ssoEnabled && !ssoLicensed && (
  <div className="license-notice">
    SSO requires Standard tier or higher license
  </div>
)}
```

```tsx
const handleSSOLogin = async () => {
  const response = await fetch('/api/auth/sso/initiate', {
    method: 'POST'
  })
  const data = await response.json()
  
  if (data.success) {
    window.location.href = data.redirect_url
  } else {
    // Show error (license restriction, etc.)
  }
}
```

#### Create `SSOCallback.tsx`:

```tsx
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { setAuthToken, setAuthUsername } from '../auth/storage'

export function SSOCallback() {
  const navigate = useNavigate()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const samlResponse = params.get('SAMLResponse')
    
    const handleCallback = async () => {
      const response = await fetch('/api/auth/sso/callback' + window.location.search)
      const data = await response.json()
      
      if (data.success) {
        setAuthToken(data.token)
        setAuthUsername(data.username)
        navigate('/chat')
      } else {
        navigate('/login?error=' + encodeURIComponent(data.error))
      }
    }
    
    handleCallback()
  }, [])

  return <div>Processing SSO login...</div>
}
```

#### Add route (around lines 7322-7350):

```tsx
<Route path="/auth/callback" element={<SSOCallback />} />
```

**Expected outcome:**
- Users see SSO login button when enabled
- SSO flow redirects properly through IdP
- Callback handles token exchange and login

---

### 8. WebSocket Handler Updates

**Files to modify:**
- `server/server.py`

**Changes:**

#### Update `get_admin_settings` handler (lines 2493-2525):

```python
if msg.type == 'get_admin_settings':
    settings = db.get_admin_settings()
    
    # Include license feature flags
    settings['license_features'] = {
        'sso': check_feature_access('sso'),
        'scim': check_feature_access('scim')
    }
    
    # Mask secrets for non-admins
    if not is_admin:
        if settings.get('oidc_client_secret'):
            settings['oidc_client_secret'] = '***MASKED***'
        if settings.get('ldap_bind_password'):
            settings['ldap_bind_password'] = '***MASKED***'
        if settings.get('scim_auth_token'):
            settings['scim_auth_token'] = '***MASKED***'
    
    ws.send({'type': 'admin_settings', 'settings': settings})
```

#### Update `save_admin_settings` handler (lines 2526-2612):

```python
if msg.type == 'save_admin_settings':
    # Verify admin
    if not is_admin:
        ws.send({'type': 'error', 'message': 'Admin required'})
        return
    
    settings = msg.get('settings', {})
    
    # License validation
    if settings.get('sso_enabled') and not check_feature_access('sso'):
        ws.send({
            'type': 'error', 
            'message': 'SSO requires Standard tier or higher license'
        })
        return
    
    if settings.get('scim_enabled') and not check_feature_access('scim'):
        ws.send({
            'type': 'error',
            'message': 'SCIM requires Standard tier or higher license'
        })
        return
    
    # Validate only one SSO provider is enabled
    providers = [settings.get('oidc_issuer'), 
                settings.get('saml_entity_id'), 
                settings.get('ldap_server_url')]
    active_providers = sum(1 for p in providers if p)
    
    if active_providers > 1:
        ws.send({
            'type': 'error',
            'message': 'Only one SSO provider can be active'
        })
        return
    
    # Encrypt sensitive fields
    if settings.get('oidc_client_secret'):
        settings['oidc_client_secret'] = encryption_manager.encrypt(
            settings['oidc_client_secret']
        )
    
    if settings.get('ldap_bind_password'):
        settings['ldap_bind_password'] = encryption_manager.encrypt(
            settings['ldap_bind_password']
        )
    
    if settings.get('scim_auth_token'):
        settings['scim_auth_token'] = encryption_manager.encrypt(
            settings['scim_auth_token']
        )
    
    # Save to database
    db.update_admin_settings(settings)
    
    # Trigger LDAP sync if enabled
    if settings.get('sso_provider') == 'ldap' and settings.get('sso_enabled'):
        asyncio.create_task(ldap_sync.sync_users())
    
    ws.send({'type': 'admin_settings_saved'})
```

**Expected outcome:**
- Admin settings properly saved with encryption
- License checks prevent unauthorized feature use
- LDAP sync triggered when configured

---

### 9. User Settings SSO Linking

**Files to modify:**
- `frontend/src/App.tsx` (user settings section)

**Changes:**

Add "Connected Accounts" section to user profile:

```tsx
<div className="connected-accounts">
  <h3>Connected Accounts</h3>
  
  {ssoIdentities.map(identity => (
    <div key={identity.id} className="identity-card">
      <div>
        <strong>{identity.provider.toUpperCase()}</strong>
        <p>{identity.email}</p>
        <small>Last login: {identity.last_login}</small>
      </div>
      
      {(hasPassword || ssoIdentities.length > 1) && (
        <button onClick={() => unlinkIdentity(identity.id)}>
          Unlink
        </button>
      )}
    </div>
  ))}
  
  {ssoEnabled && (
    <button onClick={linkSSOAccount}>
      Link SSO Account
    </button>
  )}
</div>
```

Backend support:
- Add WebSocket message `get_sso_identities` to query `sso_identities` table
- Add WebSocket message `unlink_sso_identity` with validation
- Ensure at least one auth method remains (password or SSO)

**Expected outcome:**
- Users can see their linked SSO identities
- Users can link/unlink accounts safely
- System prevents removing last auth method

---

### 10. Documentation Creation

**Files to create:**
- `docs/AUTHENTICATION.md`

**Structure:**

```markdown
# Authentication Guide

## Overview
Decentra supports multiple authentication methods:
- Password-based (default)
- OpenID Connect (OIDC)
- SAML 2.0
- LDAP Directory Sync

## License Requirements

⚠️ **SSO and SCIM features require Standard, Elite, or Off the Walls tier licenses.**

| Feature | Community | Lite | Standard | Elite | Off the Walls |
|---------|-----------|------|----------|-------|---------------|
| Password Auth | ✅ | ✅ | ✅ | ✅ | ✅ |
| OIDC/SAML/LDAP | ❌ | ❌ | ✅ | ✅ | ✅ |
| SCIM Provisioning | ❌ | ❌ | ✅ | ✅ | ✅ |

## Password Authentication
[Default authentication flow docs...]

## SSO Overview
[Explanation of SSO benefits, how it works...]

## OpenID Connect (OIDC) Configuration

### Prerequisites
- Standard tier or higher license
- Admin access to Decentra
- Admin access to your OIDC provider

### Supported Providers
- Google Workspace
- Microsoft EntraID (Azure AD)
- Okta
- Auth0
- Any OIDC-compliant provider

### Configuration Steps
1. Navigate to Admin Settings → SSO & SCIM
2. Select "OpenID Connect (OIDC)" as provider
3. Enter your provider details:
   - **Issuer URL**: Your OIDC provider's issuer URL
   - **Client ID**: Application client ID
   - **Client Secret**: Application client secret
   - **Redirect URI**: Auto-generated, copy this to your provider
4. Click "Save Settings"
5. Test login with "Sign in with SSO" button

### Provider-Specific Guides

#### Google Workspace
[Step-by-step with screenshots...]

#### Microsoft EntraID
[Step-by-step with screenshots...]

#### Okta
[Step-by-step with screenshots...]

## SAML 2.0 Configuration

### Configuration Steps
[Detailed SAML setup...]

### IdP Setup Guides
[Provider-specific SAML configuration...]

## LDAP Directory Sync

### Overview
Decentra uses LDAP for **directory synchronization**, not direct authentication.
Users are imported from LDAP and can authenticate with passwords managed by Decentra.

### Configuration
[LDAP setup steps, attribute mapping...]

### Sync Schedule
[How to configure sync intervals...]

## SCIM 2.0 Provisioning

### Overview
SCIM (System for Cross-domain Identity Management) allows automated user provisioning.

### Prerequisites
- Standard tier or higher license
- Admin access to Decentra and your IdP

### Setup Steps
1. Enable SCIM in Admin Settings → SSO & SCIM
2. Click "Generate SCIM Token"
3. Copy the SCIM base URL: `https://your-domain/scim/v2/`
4. Configure your IdP with the URL and token

### Supported Operations
- ✅ Create users (`POST /scim/v2/Users`)
- ✅ Read users (`GET /scim/v2/Users/{id}`)
- ✅ Update users (`PATCH /scim/v2/Users/{id}`)
- ✅ Delete users (`DELETE /scim/v2/Users/{id}`)
- ✅ Search users (`GET /scim/v2/Users?filter=...`)

### Provider Setup

#### Okta SCIM Setup
[Detailed Okta configuration...]

#### Google Workspace SCIM Setup
[Detailed Google configuration...]

#### Microsoft EntraID SCIM Setup
[Detailed Microsoft configuration...]

### SCIM Endpoint Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/scim/v2/ServiceProviderConfig` | GET | Get SCIM capabilities |
| `/scim/v2/Schemas` | GET | Get supported schemas |
| `/scim/v2/Users` | GET | List/search users |
| `/scim/v2/Users` | POST | Create user |
| `/scim/v2/Users/{id}` | GET | Get user |
| `/scim/v2/Users/{id}` | PUT | Replace user |
| `/scim/v2/Users/{id}` | PATCH | Update user |
| `/scim/v2/Users/{id}` | DELETE | Deprovision user |

### Example SCIM Request
```json
POST /scim/v2/Users
Authorization: Bearer YOUR_SCIM_TOKEN

{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "john.doe",
  "emails": [{"value": "john@company.com", "primary": true}],
  "displayName": "John Doe",
  "active": true
}
```

## User Account Linking

[How users can link existing accounts to SSO...]

## Troubleshooting

### Common Issues

**SSO button not appearing**
- Check license tier (requires Standard or higher)
- Verify SSO is enabled in admin settings
- Check browser console for errors

**SCIM provisioning fails**
- Verify SCIM token is correct
- Check license tier
- Review server logs for details

**LDAP sync not working**
- Verify LDAP credentials
- Check network connectivity
- Review bind DN and base DN settings

## Security Considerations

### Token Storage
- JWT tokens stored in localStorage
- SCIM tokens encrypted at rest with Fernet cipher
- OAuth client secrets encrypted with DECENTRA_ENCRYPTION_KEY

### Admin-Only Configuration
- Only administrators can configure SSO/SCIM
- Secrets are masked for non-admin users
- SCIM tokens use bcrypt hashing

### Best Practices
- Rotate SCIM tokens regularly
- Use TLS for all SSO communication
- Limit SCIM token scope to user provisioning only
- Monitor SCIM API access logs
- Keep IdP configurations up to date

## Migration Guide

### Existing Password Users
[How to migrate to SSO while maintaining access...]

### License Downgrades
If your license is downgraded from Standard to Community/Lite:
- SSO configurations remain in database but become inactive
- Users with linked SSO identities must use password authentication
- SCIM endpoints return 403 errors
- Admin UI shows upgrade prompt

## Support
[Contact information, additional resources...]
```

**Expected outcome:**
- Comprehensive documentation for all SSO/SCIM features
- Clear license tier requirements
- Provider-specific setup guides
- Troubleshooting resources

---

### 11. Testing & Migration

**Files to create:**
- `product-test/test_oidc_auth.py`
- `product-test/test_scim_provisioning.py`
- `product-test/test_sso_user_linking.py`
- `product-test/test_ldap_sync.py`
- `product-test/test_sso_license_enforcement.py`

**Backend changes:**
- Add LDAP sync scheduled job in `server.py` startup
- Handle NULL password_hash in login handler (lines 1106-1192)
- Implement SCIM token generation with bcrypt

**Test scenarios:**

1. **License enforcement tests**
   - Activate Community license, verify SSO returns 403
   - Activate Standard license, verify SSO becomes available
   - Test license downgrade behavior

2. **OIDC flow tests**
   - Mock OIDC provider responses
   - Test token exchange
   - Verify user creation
   - Test account linking

3. **SCIM tests**
   - Test all CRUD operations
   - Verify filtering and pagination
   - Test invalid token rejection
   - Test schema compliance

4. **LDAP sync tests**
   - Mock LDAP server
   - Test user import
   - Verify attribute mapping
   - Test scheduled sync

5. **Integration tests**
   - Password user links SSO identity
   - SSO user created via SCIM
   - LDAP user authenticates with password
   - Mixed authentication scenarios

**Expected outcome:**
- Comprehensive test coverage
- Automated testing for CI/CD
- Manual testing procedures documented

---

## Verification Checklist

### Manual Testing

- [ ] Activate Community license, verify SSO tab shows FeatureGate lock message
- [ ] Attempt to enable SSO via API with Community license, verify 403 error
- [ ] Activate Standard license, verify SSO tab becomes fully accessible
- [ ] Configure OIDC with test provider (Google/Auth0)
- [ ] Click "Sign in with SSO", verify redirect and callback work
- [ ] Confirm JWT token issued and user created in database
- [ ] Configure SCIM in Okta test app with Standard license
- [ ] Create user via SCIM API, verify user appears in admin users panel
- [ ] Update user attributes via SCIM PATCH, verify changes reflected
- [ ] Set up LDAP pointing to test LDAP server
- [ ] Trigger manual sync from admin panel
- [ ] Verify users imported with correct attributes
- [ ] Link existing password user to SSO identity
- [ ] Verify both login methods work
- [ ] Unlink identity, verify password login still works
- [ ] Test admin settings persistence (save OIDC config, reload page)
- [ ] Verify settings retained and secrets masked for non-admins
- [ ] Attempt authentication via SCIM endpoint with invalid token, verify 401
- [ ] Attempt to access SCIM endpoint with Lite license, verify 403
- [ ] Check AUTHENTICATION.md renders correctly with all guides
- [ ] Test graceful license downgrade (Standard → Lite)

### Automated Testing

- [ ] `test_oidc_auth.py` passes
- [ ] `test_scim_provisioning.py` passes all SCIM operations
- [ ] `test_sso_user_linking.py` passes all scenarios
- [ ] `test_ldap_sync.py` successfully syncs users
- [ ] `test_sso_license_enforcement.py` properly blocks unauthorized access
- [ ] All tests pass in CI/CD pipeline

---

## Key Design Decisions

### Hybrid Authentication
**Decision**: Support both password and SSO simultaneously  
**Rationale**: Maintains backward compatibility, allows gradual migration, provides fallback option

### User Account Linking
**Decision**: Enable existing users to link SSO identities  
**Rationale**: Prevents duplicate accounts, preserves user history and data

### LDAP Sync Model
**Decision**: Use LDAP for directory sync, not direct bind  
**Rationale**: Better offline support, improved performance, allows local password management

### SCIM Independence
**Decision**: SCIM works independently of auth method  
**Rationale**: Maximum flexibility, supports multiple deployment scenarios

### Single Provider Constraint
**Decision**: Only one SSO provider active at a time  
**Rationale**: Simplifies configuration, reduces conflict potential, easier to troubleshoot

### NULL Password Handling
**Decision**: Allow NULL password_hash for SSO-only users  
**Rationale**: Clear separation of auth methods, prevents confusion, enforces SSO usage

### Token-Based SCIM Auth
**Decision**: Dedicated SCIM bearer tokens instead of JWT reuse  
**Rationale**: SCIM 2.0 spec alignment, separate credential rotation, better security isolation

### License Tier Restriction
**Decision**: SSO/SCIM exclusive to Standard+ tiers  
**Rationale**: Premium feature positioning, enterprise use case alignment, revenue model support

### Graceful Degradation
**Decision**: Keep SSO configs in DB after downgrade, just disable  
**Rationale**: Easier re-upgrade, preserves admin work, clear communication of limitations

---

## Implementation Timeline

### Phase 1: Foundation (Week 1-2)
- Database schema migrations
- License enforcement
- Basic SSO utilities
- Admin UI framework

### Phase 2: OIDC (Week 3-4)
- OIDC provider implementation
- Login flow integration
- User creation and linking
- Testing and debugging

### Phase 3: SCIM (Week 5-6)
- SCIM endpoints
- Token management
- Provider integration testing
- Documentation

### Phase 4: SAML & LDAP (Week 7-8)
- SAML provider implementation
- LDAP sync scheduler
- Advanced features
- Comprehensive testing

### Phase 5: Polish & Documentation (Week 9-10)
- Complete documentation
- User guides per provider
- Video tutorials (optional)
- Final testing and QA

---

## Success Criteria

✅ **Functional Requirements Met**
- Users can authenticate via OIDC, SAML, or LDAP
- SCIM provisioning works with Okta, Google, Microsoft
- Account linking allows hybrid authentication
- License enforcement properly restricts features

✅ **Security Requirements Met**
- All secrets encrypted at rest
- SCIM tokens properly hashed
- Admin-only configuration enforced
- Token validation comprehensive

✅ **Documentation Complete**
- Setup guides for each provider
- Troubleshooting resources available
- Security best practices documented
- License requirements clearly stated

✅ **Testing Complete**
- 95%+ code coverage for new features
- All manual test scenarios pass
- Integration tests validate real-world usage
- Performance acceptable under load

---

## Future Enhancements

- Multiple SSO providers simultaneously
- Group/role mapping from IdP to Decentra servers
- Advanced SCIM features (group provisioning)
- SSO session management and timeout
- MFA integration with SSO
- Audit logging for SSO/SCIM operations
- Self-service account linking UI improvements
- Token refresh mechanism for long-lived sessions
