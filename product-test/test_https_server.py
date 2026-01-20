#!/usr/bin/env python3
"""
Test script to verify HTTPS server functionality with a simple HTTPS server.
"""

import asyncio
import ssl
import sys
import os

# Add server directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from aiohttp import web
from ssl_utils import generate_self_signed_cert, create_ssl_context


async def hello_handler(request):
    """Simple hello world handler."""
    return web.Response(text="Hello from HTTPS server!")


async def test_https_server():
    """Test starting an HTTPS server."""
    print("Testing HTTPS server startup...")
    
    # Generate certificate
    cert_dir = '/tmp/test_https_server'
    cert_path, key_path = generate_self_signed_cert(cert_dir=cert_dir)
    ssl_context = create_ssl_context(cert_path, key_path)
    
    print(f"✓ SSL context created")
    
    # Create simple web app
    app = web.Application()
    app.router.add_get('/', hello_handler)
    
    # Setup and start server
    runner = web.AppRunner(app)
    await runner.setup()
    
    # Use a different port for testing
    port = 8766
    site = web.TCPSite(runner, '127.0.0.1', port, ssl_context=ssl_context)
    
    print(f"Starting HTTPS server on https://127.0.0.1:{port}")
    await site.start()
    
    print(f"✓ HTTPS server started successfully!")
    
    # Test making a request to the server
    try:
        import aiohttp
        
        # Create SSL context that allows self-signed certificates
        client_ssl_context = ssl.create_default_context()
        client_ssl_context.check_hostname = False
        client_ssl_context.verify_mode = ssl.CERT_NONE
        
        url = f'https://127.0.0.1:{port}/'
        print(f"\nTesting HTTPS request to {url}")
        
        # Use aiohttp client for async request
        async with aiohttp.ClientSession() as session:
            async with session.get(url, ssl=client_ssl_context) as response:
                content = await response.text()
                assert content == "Hello from HTTPS server!", f"Unexpected response: {content}"
                print(f"✓ HTTPS request successful: {content}")
    
    except Exception as e:
        print(f"❌ HTTPS request failed: {e}")
        raise
    
    finally:
        # Cleanup
        await runner.cleanup()
        print("\n✅ All HTTPS server tests passed!")


if __name__ == "__main__":
    try:
        asyncio.run(test_https_server())
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
