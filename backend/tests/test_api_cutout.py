"""Tests for cutout queue/SSE progress/binary tensor endpoint (Issue #12, SPEC §3.1, §3.2)."""

import json
import struct
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND = Path(__file__).resolve().parents[1]
for p in (REPO_ROOT, BACKEND):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))


def _client():
    import asyncio

    from api import cutout

    cutout.task_states.clear()
    # tensor_cache is async-wrapped; create fresh instance
    from cache.lru import LRUCache
    cutout.tensor_cache = LRUCache()
    cutout.cutout_queue = asyncio.Queue(maxsize=5)
    cutout._worker_started = False
    app = FastAPI()
    app.include_router(cutout.router)
    return TestClient(app), cutout


def test_post_cutout_returns_queued_task():
    client, _ = _client()
    r = client.post("/api/cutout", json={"ra": 269.44639, "dec": 4.76676, "fov_arcsec": 300})
    assert r.status_code == 202
    data = r.json()
    assert data["status"] == "queued"
    assert data["task_id"].startswith("task_spx_")


def test_post_cutout_queue_full_returns_503_retry_after():
    client, cutout = _client()
    # fill queue
    for _ in range(5):
        cutout.cutout_queue.put_nowait({"task_id": f"t{_}"})
    r = client.post("/api/cutout", json={"ra": 1.0, "dec": 2.0})
    assert r.status_code == 503
    assert r.headers.get("Retry-After") == "15"


def test_progress_unknown_task_404():
    client, _ = _client()
    r = client.get("/api/cutout/progress/nope")
    assert r.status_code == 404


def test_progress_after_enqueue():
    client, cutout = _client()
    cutout._worker_started = True  # prevent background processing for deterministic state
    tid = client.post("/api/cutout", json={"ra": 1.0, "dec": 2.0}).json()["task_id"]
    r = client.get(f"/api/cutout/progress/{tid}")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    assert r.json()["status"] == "queued"
    assert r.json()["progress"] == 0.0


def test_tensor_not_ready_returns_202_or_404():
    client, _ = _client()
    tid = client.post("/api/cutout", json={"ra": 1.0, "dec": 2.0}).json()["task_id"]
    r = client.get(f"/api/cutout/{tid}/tensor")
    # queued/incomplete task -> 202 (not complete) or 404 (no cached tensor), per implementation
    assert r.status_code in (202, 404)


def test_tensor_serves_binary_with_header():
    client, cutout = _client()
    tid = client.post("/api/cutout", json={"ra": 1.0, "dec": 2.0}).json()["task_id"]
    h = 2
    w = 2
    n_ep, n_b = 1, 1
    header = {
        "shape": [n_ep, n_b, h, w],
        "crval": [1.0, 2.0],
        "cdelt": [-0.001722, 0.001722],
        "mjd_ranges": [[59000, 59100]],
        "exposure_ids": [1],
        "release": "spherex_qr2",
        "source_badge": "NASA Benchmark",
        "compression": "none",
    }
    hb = json.dumps(header).encode("utf-8")
    payload = struct.pack("<I", len(hb)) + hb + (b"\x00" * (h * w * 14))
    cutout.task_states[tid]["status"] = "complete"
    # async cache: seed directly
    import asyncio
    asyncio.run(cutout.tensor_cache.set(f"tensor:{tid}", payload, header))
    r = client.get(f"/api/cutout/{tid}/tensor")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/octet-stream")
    L = struct.unpack("<I", r.content[:4])[0]
    meta = json.loads(r.content[4 : 4 + L])
    assert meta["release"] == "spherex_qr2"
    assert meta["shape"] == [1, 1, 2, 2]


def test_process_cutout_task_loads_benchmark():
    import asyncio
    _, cutout = _client()
    task = {
        "task_id": "test_barnard",
        "ra": 269.44639,
        "dec": 4.76676,
        "fov_arcsec": 300,
        "bands": None,
        "adaptive_window": False,
        "synth_a": None,
        "synth_b": None,
        "zodi_subtracted": False,
    }
    res = asyncio.run(cutout.process_cutout_task(task))
    assert res["status"] == "complete"
    cached = asyncio.run(cutout.tensor_cache.get("tensor:test_barnard"))
    assert cached is not None
    _, header = cached
    assert header.get("shape") == [3, 6, 29, 29]
    assert "Benchmark" in header.get("source_badge", "")
