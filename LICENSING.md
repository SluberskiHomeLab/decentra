# Decentra Licensing System

Decentra uses an offline RSA-2048 cryptographic licensing system. The server runs in **free tier** by default with no license key required. Paid tiers unlock additional features and raise capacity limits.

## License Tiers

| | Free | Professional | Enterprise |
|---|---|---|---|
| **Max Users** | 50 | 500 | Unlimited |
| **Max Servers** | 1 | 5 | Unlimited |
| **Channels per Server** | 10 | 50 | Unlimited |
| **Max File Size** | 10 MB | 100 MB | Unlimited |
| **Message History** | 10,000 | Unlimited | Unlimited |
| **Voice Chat** | - | Yes | Yes |
| **File Uploads** | Yes | Yes | Yes |
| **Webhooks** | - | Yes | Yes |
| **Custom Emojis** | - | Yes | Yes |
| **Audit Logs** | - | - | Yes |
| **SSO** | - | - | Yes |

## Activating a License

There are three ways to provide a license key, checked in this order:

### 1. Environment Variable (recommended for Docker)

Set `DECENTRA_LICENSE_KEY` in your `.env` file or Docker environment:

```env
DECENTRA_LICENSE_KEY=eyJsaWNlbnNlX2lkIjoiTElDLTIw...
```

### 2. License File

Place the key in a file called `.license` in the `server/` directory:

```bash
echo "eyJsaWNlbnNlX2lkIjoiTElDLTIw..." > server/.license
```

### 3. Admin UI

1. Log in as the instance admin (first registered user)
2. Open **Admin Mode** in the sidebar
3. Scroll to **License Management**
4. Paste the license key and click **Activate License**

The license is stored in the database and persists across restarts.

## Removing a License

- **Admin UI**: Click **Remove License** in the License Management panel and confirm.
- **WebSocket**: Send `{"type": "remove_license"}` as an authenticated admin.
- **Manual**: Delete the `DECENTRA_LICENSE_KEY` env var and clear the DB column, then restart.

The server reverts to free-tier defaults when no valid license is present.

## How It Works

### Validation Flow

1. The server loads the RSA-2048 public key from `server/license_public_key.pem`
2. License keys are base64-encoded payloads in the format `JSON_DATA || RSA_SIGNATURE`
3. The server verifies the signature using RSA-PSS with SHA-256
4. If the signature is valid and the license has not expired, the tier's features and limits are applied
5. If validation fails (bad signature, expired, missing key), the server runs in free tier

### Enforcement Points

License limits and feature gates are enforced at these points in the backend:

| Enforcement | Location | Behavior |
|---|---|---|
| User registration | `server.py` signup handler | Rejects signup when user count reaches `max_users` |
| Server creation | `server.py` create_server handler | Caps at `min(admin_setting, license_limit)` for `max_servers` |
| Channel creation | `server.py` create_channel handler | Caps at `min(admin_setting, license_limit)` for `max_channels_per_server` |
| File upload size | `api.py` upload handler | Caps at `min(admin_setting, license_limit)` for `max_file_size_mb` |
| Voice chat | `server.py` join_voice / start_call | Blocked unless `voice_chat` feature is enabled |
| Custom emojis | `server.py` upload_custom_emoji | Blocked unless `custom_emojis` feature is enabled |

Admin settings always act as an additional ceiling -- a license cannot exceed what the admin has configured, and admin settings cannot exceed what the license allows.

### WebSocket Messages

**Outbound (client to server):**

| Message Type | Fields | Access |
|---|---|---|
| `get_license_info` | _(none)_ | Any authenticated user |
| `update_license` | `license_key: string` | Admin only |
| `remove_license` | _(none)_ | Admin only |

**Inbound (server to client):**

| Message Type | Fields | Notes |
|---|---|---|
| `license_info` | `data: { tier, features, limits, is_admin, customer?, expires_at? }` | Response to `get_license_info`. `customer` and `expires_at` only sent to admins. |
| `license_updated` | `data: { tier, features, limits, is_admin, customer?, expires_at? }` | Broadcast to all clients when license changes |
| `error` | `message: string` | Sent on invalid license key |

### Database Storage

License data is stored in the `admin_settings` table (single-row, id=1):

- `license_key` -- encrypted license key string (uses the same `encrypt_value`/`decrypt_value` pattern as other secrets)
- `license_tier` -- current tier name
- `license_expires_at` -- expiration timestamp
- `license_customer_name` / `license_customer_email` -- customer metadata

## Generating License Keys

See [tools/license/README.md](tools/license/README.md) for the key generation tooling.

Quick start:

```bash
# Generate RSA key pair (one-time setup)
cd tools/license
python generate_keypair.py

# Create a professional license valid for 1 year
python create_license.py \
    --tier professional \
    --customer-name "Acme Corp" \
    --customer-email "admin@acme.com" \
    --company "Acme Corp" \
    --duration-days 365
```

The private key (`tools/license/keys/license_private_key.pem`) must be kept secret. The public key is automatically copied to `server/license_public_key.pem` and ships with the application.

## Security

- License keys are validated entirely offline -- no external license server required
- RSA-PSS signatures with SHA-256 prevent tampering with license data
- Private keys never leave the key generation environment
- Stored license keys are encrypted at rest in the database
- Expired licenses gracefully degrade to free tier (no service disruption)
- Invalid or tampered keys are rejected with an error message
