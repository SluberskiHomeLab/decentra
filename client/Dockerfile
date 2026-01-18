# Use python:3.11-slim with a digest pin to ensure reproducible and secure builds
FROM python:3.11-slim@sha256:0000000000000000000000000000000000000000000000000000000000000000

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
