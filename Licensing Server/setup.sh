#!/bin/bash
# Setup script for Decentra Licensing Server

set -e

echo "======================================"
echo "Decentra Licensing Server Setup"
echo "======================================"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "Creating .env file from template..."
    cp .env.example .env

    # Generate secure random tokens
    DB_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)
    ADMIN_TOKEN=$(openssl rand -base64 48 | tr -d '/+=' | cut -c1-64)

    # Update .env with generated values
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s|your_secure_password|$DB_PASSWORD|g" .env
        sed -i '' "s|your_secure_admin_token_here_change_this_in_production|$ADMIN_TOKEN|g" .env
    else
        # Linux
        sed -i "s|your_secure_password|$DB_PASSWORD|g" .env
        sed -i "s|your_secure_admin_token_here_change_this_in_production|$ADMIN_TOKEN|g" .env
    fi

    echo "✓ Generated secure credentials in .env"
    echo ""
    echo "IMPORTANT: Save this admin token - you'll need it for API calls:"
    echo "  $ADMIN_TOKEN"
    echo ""
else
    echo ".env file already exists, skipping..."
fi

# Create SSL directory
if [ ! -d ssl ]; then
    echo "Creating SSL directory..."
    mkdir ssl

    # Generate self-signed certificate for development
    echo "Generating self-signed SSL certificate (for development only)..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout ssl/key.pem \
        -out ssl/cert.pem \
        -subj "/C=US/ST=State/L=City/O=Decentra/CN=localhost"

    echo "✓ SSL certificates created (self-signed)"
    echo "  For production, replace with real certificates in the ssl/ directory"
    echo ""
fi

echo "======================================"
echo "Setup complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo "  1. Review and edit .env file if needed"
echo "  2. For development:"
echo "     docker-compose -f docker-compose.dev.yml up"
echo "  3. For production:"
echo "     docker-compose up -d"
echo ""
echo "API will be available at:"
echo "  - Development: http://localhost:8000"
echo "  - Production: https://your-domain.com"
echo ""
echo "Documentation: http://localhost:8000/docs"
echo ""
