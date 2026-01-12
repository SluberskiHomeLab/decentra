# Pin to specific digest to avoid cache corruption issues
FROM python:3.11-slim@sha256:1dd3dca85e22886e44fcad1bb7ccab6691dfa83db52214cf9e20696e095f3e36

WORKDIR /app

# Copy requirements first for better layer caching
COPY requirements.txt .

# Install dependencies in a single RUN command to reduce layers
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy client code
COPY client.py .

# Set default environment variables
ENV SERVER_HOST=server
ENV SERVER_PORT=8765

# Run the client
CMD ["python", "client.py"]
