# Decentra Licensing Tools

Command-line utilities for generating and managing Decentra license keys.

## Prerequisites

- Python 3.8+
- `cryptography` library: `pip install cryptography`

## Quick Start

### 1. Generate the RSA key pair

```bash
cd tools/license
python generate_keypair.py
```

This creates:

- `keys/license_private_key.pem` -- used to **sign** licenses (keep secret!)
- `keys/license_public_key.pem` -- used to **verify** licenses
- Automatically copies the public key to `server/license_public_key.pem`

### 2. Create a license key

```bash
python create_license.py \
    --tier professional \
    --customer-name "John" \
    --customer-email "john@example.com" \
    --company "Acme Corp" \
    --duration-days 365
```

To save the key directly to a file:

```bash
python create_license.py \
    --tier enterprise \
    --customer-name "Jane" \
    --customer-email "jane@example.com" \
    --output-file license.key
```

Available tiers: `free`, `professional`, `enterprise`.

## Where the public key goes

The server loads `server/license_public_key.pem` at runtime to verify incoming
license keys. The `generate_keypair.py` script copies the public key there
automatically, but you can also copy it manually:

```bash
cp tools/license/keys/license_public_key.pem server/license_public_key.pem
```

## Security Warning

**Keep `keys/license_private_key.pem` secret.** Anyone with the private key can
create valid license keys. Never commit it to version control or share it
outside of trusted infrastructure. The `.gitignore` should already exclude
`*.pem` files under `tools/license/keys/`.
