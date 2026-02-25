# Use python:3.11-slim base image
FROM python:3.11-slim

WORKDIR /app

# Install build dependencies for python-ldap and xmlsec
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libldap2-dev \
    libsasl2-dev \
    libxml2-dev \
    libxmlsec1-dev \
    libxmlsec1-openssl \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better layer caching
COPY requirements.txt .

# Install dependencies in a single RUN command to reduce layers
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy all application files in one layer
COPY server.py database.py api.py encryption_utils.py email_utils.py ssl_utils.py license_validator.py instance_fingerprint.py sso_utils.py audio_utils.py license_public_key.pem ./

# Expose WebSocket port
EXPOSE 8765

# Run the server
CMD ["python", "-u", "server.py"]
