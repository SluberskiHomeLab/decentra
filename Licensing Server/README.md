# Decentra Licensing Server

Server-based license validation system for Decentra. This server tracks license check-ins, manages revocations, and enforces installation limits.

## Features

- License verification and validation
- Installation tracking and limits enforcement
- Remote license revocation
- Check-in history and analytics
- RESTful API with FastAPI

## Quick Start

### Prerequisites

- Python 3.8+
- PostgreSQL 15+ (or SQLite for development)
- Docker (optional, for containerized deployment)

### Development Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your database credentials and admin token
```

3. Initialize the database:
```bash
python init_db.py
```

4. Run the server:
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`

API documentation: `http://localhost:8000/docs`

### Production Deployment (Docker)

```bash
# Set environment variables
cp .env.example .env
# Edit .env with production values

# Start services
docker-compose up -d

# View logs
docker-compose logs -f
```

## API Endpoints

### Public Endpoints

- `POST /api/v1/verify` - Verify a license and record check-in
- `GET /health` - Health check

### Admin Endpoints (require `Authorization: Bearer <token>`)

- `POST /api/v1/admin/revoke` - Revoke a license
- `POST /api/v1/admin/restore` - Restore a revoked license
- `GET /api/v1/admin/licenses/{license_id}` - Get license details
- `GET /api/v1/admin/licenses/{license_id}/installations` - View active installations
- `GET /api/v1/admin/stats` - Get system statistics

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string
- `ADMIN_API_TOKEN` - Secret token for admin endpoints
- `CORS_ORIGINS` - Comma-separated list of allowed CORS origins (optional)
- `LOG_LEVEL` - Logging level (default: INFO)

## Security

- All admin endpoints require Bearer token authentication
- Rate limiting applied to prevent abuse
- HTTPS required in production
- Database credentials encrypted at rest

## Database Schema

See `schema.sql` for the complete database schema.

## License

This licensing server is part of the Decentra project.

# How to Generate Licenses
Here's the complete process for generating licenses for your Decentra hybrid licensing system:

Step 1: Generate the RSA Key Pair (One-Time Setup)
First, you need to create the cryptographic keys:


cd tools/license
python generate_keypair.py
This creates:

keys/license_private_key.pem - Used to sign licenses (⚠️ KEEP SECRET!)
keys/license_public_key.pem - Used to verify licenses
Automatically copies the public key to server/license_public_key.pem
Security Warning: Never commit or share license_private_key.pem. Anyone with this file can create valid licenses.

Step 2: Create License Keys
Generate a license for a customer:


cd tools/license
python create_license.py \
    --tier standard \
    --customer-name "John Doe" \
    --customer-email "john@example.com" \
    --company "Acme Corp" \
    --duration-days 365
Save to a file:


python create_license.py \
    --tier elite \
    --customer-name "Jane Smith" \
    --customer-email "jane@example.com" \
    --company "Tech Inc" \
    --duration-days 365 \
    --output-file licenses/jane-elite.key
Available Tiers
Tier	Max Users	Max Servers	Features
community	30	2	Basic features, no SSO
lite	50	5	Basic features, no SSO
standard	80	8	All features + SSO
elite	Unlimited	Unlimited	All features, 1440p quality
off_the_walls	Unlimited	Unlimited	All features, 4K quality
Step 3: Register License in Database (For Hybrid Mode)
If you're using the hybrid licensing server, you also need to import the license key into the database:


cd "Licensing Server"

# Import a single license
python populate_licenses.py "eyJsaWNlbnNlX2lkIjoiTElD..."

# Import from a file (one key per line)
python populate_licenses.py --file licenses.txt
Complete Example Workflow

# 1. Generate keypair (one-time)
cd tools/license
python generate_keypair.py

# 2. Create a license
python create_license.py \
    --tier standard \
    --customer-name "Acme Corp" \
    --customer-email "admin@acme.com" \
    --company "Acme Corporation" \
    --duration-days 365 \
    --output-file acme-standard.key

# 3. Register in licensing server database
cd "../../Licensing Server"
python populate_licenses.py --file ../tools/license/acme-standard.key
Output Format
The tool will display:


============================================================
  Decentra License Key Created
============================================================
  License ID : LIC-20260209-ABC12
  Customer   : Acme Corp
  Email      : admin@acme.com
  Company    : Acme Corporation
  Tier       : standard
  Issued     : 2026-02-09T12:00:00+00:00
  Expires    : 2027-02-09T12:00:00+00:00
============================================================

License Key:
eyJsaWNlbnNlX2lkIjoiTElDLTIwMjYwMjA5LUFCQ...
The customer receives this base64-encoded license key and enters it in the Decentra admin panel.