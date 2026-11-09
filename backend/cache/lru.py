"""In-Memory LRU Cache for Spectra backend cutout tensors.

SPECIFICATION.md §4.2.3: Cutout & Spectral LRU Cache.
Async-wrapped cachetools LRU with 1.0 GB byte cap for Float32/tensor buffers.
"""
from __future__ import annotations

import asyncio
from typing import Any

from cachetools import LRUCache as _LRUCache

ONE_GB_BYTES = 1024 * 1024 * 1024


def _entry_size(value: Any) -> int:
    if isinstance(value, tuple) and len(value) == 2 and isinstance(value[0], (bytes, bytearray, memoryview)):
        return len(value[0])
    if isinstance(value, (bytes, bytearray, memoryview)):
        return len(value)
    return 1


class LRUCache:
    """Async-wrapped LRU cache for Float32 tensor buffers and spectra."""

    def __init__(self, maxsize: int = ONE_GB_BYTES):
        self._cache: _LRUCache[str, Any] = _LRUCache(maxsize=maxsize, getsizeof=_entry_size)
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> tuple[bytes, dict[str, Any]] | None:
        async with self._lock:
            value = self._cache.get(key)
            if value is None:
                return None
            if isinstance(value, tuple) and len(value) == 2:
                return value  # type: ignore[return-value]
            return (value, {})

    async def set(self, key: str, value: bytes, metadata: dict[str, Any] | None = None) -> None:
        async with self._lock:
            self._cache[key] = (value, metadata or {})

    async def delete(self, key: str) -> None:
        async with self._lock:
            self._cache.pop(key, None)

    async def clear(self) -> None:
        async with self._lock:
            self._cache.clear()

    def __len__(self) -> int:
        return len(self._cache)

    def __contains__(self, key: str) -> bool:
        return key in self._cache
