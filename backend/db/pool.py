"""Asyncpg connection pool for Spectra backend.

SPECIFICATION.md §5.3: All SQL operations executed via asyncpg parameterized queries.
"""
from __future__ import annotations

import os

import asyncpg

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
)


async def create_pool(min_size: int = 1, max_size: int = 5) -> asyncpg.Pool:
    """Create and return an asyncpg connection pool."""
    pool = await asyncpg.create_pool(
        dsn=DATABASE_URL,
        min_size=min_size,
        max_size=max_size,
        command_timeout=60.0,
    )
    return pool


async def close_pool(pool: asyncpg.Pool | None) -> None:
    """Close the given connection pool."""
    if pool:
        await pool.close()
