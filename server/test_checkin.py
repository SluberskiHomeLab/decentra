#!/usr/bin/env python3
"""Test script to check if we can reach the licensing server"""

import aiohttp
import asyncio
import sys

async def test_connection():
    url = "https://licensevalidation.decentrachat.cc"
    print(f"Testing connection to: {url}")
    
    try:
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url) as response:
                print(f"✓ Connected successfully!")
                print(f"  Status: {response.status}")
                print(f"  Headers: {dict(response.headers)}")
                return True
    except asyncio.TimeoutError:
        print("✗ Connection timed out")
        return False
    except aiohttp.ClientError as e:
        print(f"✗ Client error: {e}")
        return False
    except Exception as e:
        print(f"✗ Unexpected error: {e}")
        return False

if __name__ == "__main__":
    result = asyncio.run(test_connection())
    sys.exit(0 if result else 1)
