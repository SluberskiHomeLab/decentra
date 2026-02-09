#!/usr/bin/env python3
"""
Database Initialization Script

Initializes the licensing server database with the required schema.
"""

import asyncio
import asyncpg
import os
from dotenv import load_dotenv

load_dotenv()

async def init_database():
    """Initialize the database schema"""
    database_url = os.getenv("DATABASE_URL")

    if not database_url:
        print("ERROR: DATABASE_URL environment variable not set")
        print("Please create a .env file based on .env.example")
        return False

    print(f"Connecting to database...")

    try:
        conn = await asyncpg.connect(database_url)
        print("Connected successfully!")

        # Read schema file
        with open('schema.sql', 'r') as f:
            schema = f.read()

        print("Creating tables and indexes...")
        await conn.execute(schema)

        print("✓ Database initialized successfully!")

        # Check if tables were created
        tables = await conn.fetch("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_type = 'BASE TABLE'
        """)

        print(f"\nCreated tables:")
        for table in tables:
            print(f"  - {table['table_name']}")

        await conn.close()
        return True

    except asyncpg.InvalidCatalogNameError:
        print(f"ERROR: Database does not exist")
        print(f"Please create the database first:")
        print(f"  createdb decentra_licenses")
        return False
    except Exception as e:
        print(f"ERROR: {e}")
        return False

if __name__ == "__main__":
    success = asyncio.run(init_database())
    exit(0 if success else 1)
