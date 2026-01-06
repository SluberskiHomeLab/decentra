FROM python:3.11-slim

WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy server code and static files
COPY server.py .
COPY database.py .
COPY api.py .
COPY encryption_utils.py .
COPY email_utils.py .
COPY ssl_utils.py .
COPY static/ ./static/

# Expose WebSocket port
EXPOSE 8765

# Run the server
CMD ["python", "-u", "server.py"]
