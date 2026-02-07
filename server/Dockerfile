# Use python:3.11-slim base image
FROM python:3.11-slim

WORKDIR /app

# Copy requirements first for better layer caching
COPY requirements.txt .

# Install dependencies in a single RUN command to reduce layers
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy all application files in one layer
COPY server.py database.py api.py encryption_utils.py email_utils.py ssl_utils.py license_validator.py license_public_key.pem ./
COPY static/ ./static/

# Expose WebSocket port
EXPOSE 8765

# Run the server
CMD ["python", "-u", "server.py"]
