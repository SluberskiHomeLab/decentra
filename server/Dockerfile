# ── Build stage ──────────────────────────────────────────────────────────────
# Installs compiler + -dev headers to compile python-ldap and xmlsec wheels,
# then discards them in the runtime stage to keep the final image lean.
FROM python:3.11-slim-bookworm AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libldap2-dev \
    libsasl2-dev \
    libssl-dev \
    libxml2-dev \
    libxmlsec1-dev \
    libxmlsec1-openssl \
    pkg-config \
  && pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir -r requirements.txt \
  && apt-get purge -y --auto-remove \
    gcc \
    libldap2-dev \
    libsasl2-dev \
    libssl-dev \
    libxml2-dev \
    libxmlsec1-dev \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*

# Copy all application files in one layer
COPY server.py database.py api.py encryption_utils.py email_utils.py ssl_utils.py license_validator.py instance_fingerprint.py sso_utils.py audio_utils.py search_parser.py bot_scopes.py license_public_key.pem ./

# Expose WebSocket port
EXPOSE 8765

# Run the server
CMD ["python", "-u", "server.py"]
