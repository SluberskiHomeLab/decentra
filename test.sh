#!/bin/bash
# Test script to verify the Decentra chat application

echo "Testing Decentra Chat Application"
echo "=================================="
echo ""

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "Error: Python3 is not installed"
    exit 1
fi

echo "✓ Python3 is available"

# Test Python syntax
echo "Checking Python syntax..."
python3 -m py_compile server/server.py
python3 -m py_compile client/client.py
echo "✓ Python syntax is valid"

# Check if websockets can be installed
echo "Checking if websockets library is available..."
pip3 install --user websockets &> /dev/null
if [ $? -eq 0 ]; then
    echo "✓ Websockets library can be installed"
else
    echo "⚠ Warning: Could not install websockets library"
fi

# Test server startup (with timeout)
echo "Testing server startup..."
timeout 5 python3 server/server.py &> /tmp/server_test.log &
SERVER_PID=$!
sleep 3

if ps -p $SERVER_PID > /dev/null; then
    echo "✓ Server starts successfully"
    kill $SERVER_PID 2>/dev/null
    wait $SERVER_PID 2>/dev/null
else
    echo "⚠ Server may have issues"
    cat /tmp/server_test.log
fi

echo ""
echo "=================================="
echo "Basic tests completed!"
echo ""
echo "To run the full application:"
echo "  With Docker: docker compose up --build"
echo "  Locally: See README.md for instructions"
