"""
Database connection and utilities
"""

import asyncpg
from typing import Optional
from config import settings
import logging

logger = logging.getLogger(__name__)

# Global connection pool
_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    """Get or create the database connection pool"""
    global _pool

    if _pool is None:
        logger.info("Creating database connection pool")
        _pool = await asyncpg.create_pool(
            settings.database_url,
            min_size=2,
            max_size=10,
            command_timeout=60
        )

    return _pool


async def close_pool():
    """Close the database connection pool"""
    global _pool

    if _pool is not None:
        logger.info("Closing database connection pool")
        await _pool.close()
        _pool = None


async def get_connection():
    """Get a database connection from the pool"""
    pool = await get_pool()
    return await pool.acquire()


async def release_connection(conn):
    """Release a database connection back to the pool"""
    pool = await get_pool()
    await pool.release(conn)
