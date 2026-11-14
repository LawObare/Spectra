"""Zero-Auth Observer Session Guard & Rate Limiter.

SPECIFICATION.md §4.2.2, §5.1: Client telemetry session fingerprinting via
X-Observer-ID (UUIDv4) and X-Observer-Key (32-byte hex secret). Server stores
sha256(observer_key) in observers.key_hash.
"""
from __future__ import annotations

import hashlib
import time
from typing import Any

from fastapi import HTTPException, Request

# In-memory rate limiter: token bucket (60 writes/min per observer)
rate_limiter: dict[str, dict[str, Any]] = {}


def _db_imports():
    try:
        from backend.db.pool import close_pool, create_pool
        from backend.db.queries import (
            GET_NEXT_ACTIVE_LEARNING_SUBJECT,
            UPSERT_OBSERVER,
        )
    except ImportError:
        from db.pool import close_pool, create_pool  # type: ignore
        from db.queries import (  # type: ignore
            GET_NEXT_ACTIVE_LEARNING_SUBJECT,
            UPSERT_OBSERVER,
        )
    return create_pool, close_pool, UPSERT_OBSERVER, GET_NEXT_ACTIVE_LEARNING_SUBJECT


async def verify_observer_session(request: Request) -> str:
    observer_id = request.headers.get("X-Observer-ID")
    observer_key = request.headers.get("X-Observer-Key")
    if not observer_id or not observer_key:
        raise HTTPException(
            status_code=401,
            detail="Missing X-Observer-ID or X-Observer-Key headers",
        )

    create_pool, close_pool, UPSERT_OBSERVER, _ = _db_imports()
    key_hash = hashlib.sha256(observer_key.encode()).hexdigest()
    handle = f"Observer-{observer_id[:8]}"
    pool = await create_pool(min_size=1, max_size=5)
    try:
        async with pool.acquire() as conn:
            await conn.fetchrow(UPSERT_OBSERVER, observer_id, key_hash, handle)
    finally:
        await close_pool(pool)

    if observer_id not in rate_limiter:
        rate_limiter[observer_id] = {"tokens": 60, "last_refill": time.time()}
    return verify_observer_rate_limiter(observer_id, observer_key)


def verify_observer_rate_limiter(observer_id: str, observer_key: str) -> str:
    _ = observer_key
    now = time.time()
    limiter = rate_limiter.get(observer_id, {"tokens": 60, "last_refill": now})
    elapsed = now - limiter["last_refill"]
    if elapsed >= 60:
        limiter["tokens"] = 60
        limiter["last_refill"] = now
    elif elapsed > 0:
        refill = int(elapsed)  # 1 token/sec
        if refill > 0:
            limiter["tokens"] = min(60, limiter["tokens"] + refill)
            limiter["last_refill"] = limiter["last_refill"] + refill

    if limiter["tokens"] < 1:
        rate_limiter[observer_id] = limiter
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded. Maximum 60 writes per minute.",
            headers={"Retry-After": "60"},
        )

    limiter["tokens"] -= 1
    rate_limiter[observer_id] = limiter
    return observer_id


async def get_observer_queue_next(
    observer_id: str, tab_workflow: str = "comparator"
) -> dict[str, Any] | None:
    _ = observer_id
    create_pool, close_pool, _, GET_NEXT = _db_imports()
    pool = await create_pool(min_size=1, max_size=5)
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(GET_NEXT, tab_workflow)
            return dict(row) if row else None
    finally:
        await close_pool(pool)
