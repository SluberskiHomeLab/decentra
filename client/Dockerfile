FROM python:3.11-slim

WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy client code
COPY client.py .

# Set default environment variables
ENV SERVER_HOST=server
ENV SERVER_PORT=8765

# Run the client
CMD ["python", "client.py"]
