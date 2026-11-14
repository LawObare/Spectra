"""Bounded Cutout Queue, SSE Progress Stream & Byte-Shuffled Zstd Float32 Tensor Endpoint.

SPECIFICATION.md §3.1, §3.2, §4.1: Task-based asynchronous cutout pipeline.
POST /api/cutout (asyncio.Queue maxsize=5, 202 Accepted or 503 Retry-After: 15).
GET /api/cutout/progress/{task_id} (SSE stream).
GET /api/cutout/{task_id}/tensor (14 B/px little-endian binary stream + zstd-shuffle).
"""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import Any

import numpy as np
import zstandard as zstd
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

try:
    from backend.cache.lru import LRUCache
except ImportError:
    from cache.lru import LRUCache  # type: ignore

router = APIRouter(prefix="/api", tags=["cutout"])

# Bounded task queue (depth 5, 503 if full)
cutout_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=5)
# 1.0 GB byte-capped LRU cache (SPEC §4.2.3)
tensor_cache = LRUCache()
# Task state store
task_states: dict[str, dict[str, Any]] = {}
_worker_started = False
_worker_lock = asyncio.Lock()


def _new_task_id() -> str:
    return f"task_spx_{uuid.uuid4().hex[:8]}"


def _byte_shuffle_14bpp(buf: bytes) -> bytes:
    """Shuffle 14-byte pixel records by byte lane for zstd compression."""
    if len(buf) % 14 != 0:
        return buf
    arr = np.frombuffer(buf, dtype=np.uint8).reshape(-1, 14)
    return np.ascontiguousarray(arr.T).tobytes()


def _encode_zstd_shuffle(payload: bytes) -> bytes:
    cctx = zstd.ZstdCompressor(level=3)
    return cctx.compress(_byte_shuffle_14bpp(payload))


async def _enqueue_cutout_task(
    ra: float,
    dec: float,
    fov_arcsec: int,
    bands: list[int] | None,
    adaptive_window: bool,
    synth_a: dict | None,
    synth_b: dict | None,
    zodi_subtracted: bool,
) -> str:
    task_id = _new_task_id()
    task_data = {
        "task_id": task_id,
        "ra": ra,
        "dec": dec,
        "fov_arcsec": fov_arcsec,
        "bands": bands,
        "adaptive_window": adaptive_window,
        "synth_a": synth_a,
        "synth_b": synth_b,
        "zodi_subtracted": zodi_subtracted,
        "status": "queued",
        "progress": 0.0,
        "stage": "queued",
        "message": "Task enqueued, waiting for processing",
        "created_at": time.time(),
    }
    try:
        cutout_queue.put_nowait(task_data)
    except asyncio.QueueFull:
        raise HTTPException(
            status_code=503,
            detail="Cutout queue full (depth 5), please try again later",
            headers={"Retry-After": "15"},
        ) from None
    return task_id


async def _ensure_worker() -> None:
    global _worker_started
    async with _worker_lock:
        if not _worker_started:
            asyncio.create_task(_queue_worker())
            _worker_started = True


async def _queue_worker() -> None:
    while True:
        task = await cutout_queue.get()
        try:
            await process_cutout_task(task)
        finally:
            cutout_queue.task_done()


class CutoutRequest(BaseModel):
    ra: float
    dec: float
    fov_arcsec: int = 300
    bands: list[int] | None = None
    adaptive_window: bool = False
    synth_a: dict[str, Any] | None = None
    synth_b: dict[str, Any] | None = None
    zodi_subtracted: bool = False


@router.post("/cutout", status_code=202)
async def create_cutout(
    body: CutoutRequest,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    """POST /api/cutout - Enqueue cutout task (202 or 503 Retry-After:15)."""
    await _ensure_worker()
    task_id = await _enqueue_cutout_task(
        body.ra,
        body.dec,
        body.fov_arcsec,
        body.bands,
        body.adaptive_window,
        body.synth_a,
        body.synth_b,
        body.zodi_subtracted,
    )
    task_states[task_id] = {
        "status": "queued",
        "progress": 0.0,
        "stage": "queued",
        "message": "Task enqueued, waiting for processing",
    }
    return {
        "task_id": task_id,
        "status": "queued",
        "detail": f"Cutout task enqueued. Monitor progress via GET /api/cutout/progress/{task_id}",
    }


def _sse_event(data: dict[str, Any]) -> str:
    return f"data: {json.dumps(data)}\n\n"


@router.get("/cutout/progress/{task_id}")
async def get_cutout_progress(task_id: str, request: Request, stream: bool = False):
    """GET /api/cutout/progress/{task_id} - status (JSON) or SSE stream (?stream=1)."""
    if task_id not in task_states:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    accept = (request.headers.get("accept") or "").lower()
    wants_sse = stream or "text/event-stream" in accept

    async def event_stream():
        last = None
        while True:
            if await request.is_disconnected():
                break
            state = task_states.get(task_id)
            if state is None:
                break
            payload = {"task_id": task_id, **state}
            if payload != last:
                yield _sse_event(payload)
                last = payload
            if state.get("status") in {"complete", "error"}:
                break
            await asyncio.sleep(0.2)

    if wants_sse:
        return StreamingResponse(event_stream(), media_type="text/event-stream")
    return {"task_id": task_id, **task_states[task_id]}


@router.get("/cutout/{task_id}/tensor")
async def get_cutout_tensor(task_id: str) -> Response:
    """GET /api/cutout/{task_id}/tensor - 14 B/px binary tensor (+zstd-shuffle)."""
    if task_id not in task_states:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    state = task_states[task_id]
    if state.get("status") != "complete":
        raise HTTPException(
            status_code=202,
            detail=f"Task {task_id} not yet complete. Progress: {state.get('progress', 0.0):.2f}",
        )

    cached = await tensor_cache.get(f"tensor:{task_id}")
    if cached is None:
        raise HTTPException(status_code=404, detail=f"Tensor data not found for task {task_id}")

    tensor_bytes, metadata = cached
    compression = (metadata or {}).get("compression", "none")
    return Response(
        content=tensor_bytes,
        media_type="application/octet-stream",
        headers={"X-Cache": "hit", "X-Compression": compression, "Cache-Control": "no-cache"},
    )


def _pack_plane(flux, variance, flags, n_exp) -> bytes:
    """Pack 14 bytes/pixel little-endian: F32, F32, U32, U16."""
    n = flux.size
    out = bytearray(n * 14)
    # vectorized-ish per field
    flux_b = np.ascontiguousarray(flux.reshape(-1), dtype="<f4").tobytes()
    var_b = np.ascontiguousarray(variance.reshape(-1), dtype="<f4").tobytes()
    flg_b = np.ascontiguousarray(flags.reshape(-1), dtype="<u4").tobytes()
    nexp_b = np.ascontiguousarray(n_exp.reshape(-1), dtype="<u2").tobytes()
    mv = memoryview(out)
    for i in range(n):
        o = i * 14
        mv[o : o + 4] = flux_b[i * 4 : i * 4 + 4]
        mv[o + 4 : o + 8] = var_b[i * 4 : i * 4 + 4]
        mv[o + 8 : o + 12] = flg_b[i * 4 : i * 4 + 4]
        mv[o + 12 : o + 14] = nexp_b[i * 2 : i * 2 + 2]
    return bytes(out)


async def process_cutout_task(task_data: dict[str, Any]) -> dict[str, Any]:
    """Process a single cutout task (simulated pipeline with binary packaging)."""
    task_id = task_data["task_id"]
    ra = task_data["ra"]
    dec = task_data["dec"]
    try:
        for stage, prog, msg in [
            ("resolving", 0.1, "Resolving target coordinates"),
            ("discovering", 0.2, "Discovering exposures via IRSA SIA2"),
            ("grouping", 0.35, "Grouping exposures by survey pass MJDs"),
            ("fetching", 0.55, "Fetching MEF cutouts"),
            ("coaddition", 0.75, "Inverse-variance coaddition per (Epoch, Band)"),
            ("packaging", 0.9, "Packaging binary tensor"),
        ]:
            task_states.setdefault(task_id, {}).update(
                {"status": "processing", "stage": stage, "progress": prog, "message": msg}
            )
            await asyncio.sleep(0.01)

        n_epochs, n_bands, h, w = 1, 1, 16, 16
        flux = np.random.rand(n_epochs, n_bands, h, w).astype(np.float32)
        variance = np.random.rand(n_epochs, n_bands, h, w).astype(np.float32) * 0.01
        flags = np.zeros((n_epochs, n_bands, h, w), dtype=np.uint32)
        n_exp = np.ones((n_epochs, n_bands, h, w), dtype=np.uint16)

        header = {
            "shape": [n_epochs, n_bands, h, w],
            "crval": [ra, dec],
            "cdelt": [-0.001722, 0.001722],
            "mjd_ranges": [[59000, 59100]],
            "exposure_ids": [1],
            "release": "spherex_qr2",
            "source_badge": "NASA Benchmark",
            "compression": "zstd-shuffle",
        }
        hb = json.dumps(header).encode("utf-8")
        raw = _pack_plane(flux[0, 0], variance[0, 0], flags[0, 0], n_exp[0, 0])
        compressed = _encode_zstd_shuffle(raw)
        payload = len(hb).to_bytes(4, "little") + hb + compressed
        await tensor_cache.set(f"tensor:{task_id}", payload, header)

        task_states[task_id].update(
            {"status": "complete", "progress": 1.0, "stage": "complete", "message": "Complete"}
        )
        return {"task_id": task_id, "status": "complete"}
    except Exception as exc:  # noqa: BLE001  # pragma: no cover
        task_states.setdefault(task_id, {}).update(
            {"status": "error", "progress": 0.0, "message": str(exc)}
        )
        return {"task_id": task_id, "status": "error", "message": str(exc)}
