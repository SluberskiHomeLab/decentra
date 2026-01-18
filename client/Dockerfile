# Use python:3.11-slim base image
FROM python:3.11-slim

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
