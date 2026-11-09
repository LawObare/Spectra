"""Tests for POST /api/classify and GET /api/queue/next (Issue #22, SPEC §4.2.2, §5.1)."""

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND = Path(__file__).resolve().parents[1]
for p in (REPO_ROOT, BACKEND):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from api import auth as auth_mod
from api.classify import router


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    auth_mod.rate_limiter.clear()
    yield
    auth_mod.rate_limiter.clear()


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as c:
        yield c


def test_classification_missing_headers(client):
    response = client.post(
        "/api/classify",
        json={"subject_id": "test", "exposure_ids": [1], "band_selection": [1], "flux_value": 1.0},
    )
    assert response.status_code == 401


def test_classification_with_valid_session(client, monkeypatch):
    async def _ok(request):
        return "obs-1"

    monkeypatch.setattr("api.classify.verify_observer_session", _ok)

    class _Conn:
        async def fetchrow(self, *a, **k): return {"subject_id":"spx_j032541-112045","w_u":0.85,"shannon_entropy":0.5}
        async def fetch(self, *a, **k): return []
        def transaction(self): 
            class _T:
                async def __aenter__(self): return self
                async def __aexit__(self, *a): return False
            return _T()
    class _Pool:
        async def __aenter__(self): return _Conn()
        async def __aexit__(self, *a): return False
        def acquire(self): return self
        async def close(self): pass
    async def _pool(*a, **k): return _Pool()
    async def _close(p): return None
    import api.classify as mod
    monkeypatch.setattr(mod, "create_pool", _pool)
    monkeypatch.setattr(mod, "close_pool", _close)
    monkeypatch.setattr(mod, "_db_imports", lambda: (_pool, _close, "C","UO","US"))
    async def _apply(*a, **k): return {"w_u":0.86,"shannon_entropy":0.42,"subject":{"subject_id":"spx_j032541-112045"}}
    monkeypatch.setattr(mod, "_apply_consensus_updates", _apply)

    response = client.post(
        "/api/classify",
        json={"subject_id":"spx_j032541-112045","primary_class":"moving_brown_dwarf","tab_workflow":"comparator","confidence":0.9},
        headers={"X-Observer-ID": "obs-1", "X-Observer-Key": "k"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["observer_id"] == "obs-1"
    assert data["observer_weight_w_u"] == 0.86
    assert data["shannon_entropy"] == 0.42



def test_queue_next_missing_observer(client):
    response = client.get("/api/queue/next")
    assert response.status_code == 422  # missing required query param observer_id


def test_queue_next_with_observer(client, monkeypatch):
    async def _next(observer_id, tab_workflow="comparator"):
        return {"subject_id": "spx1", "title": "Test", "shannon_entropy": 1.2}

    # patch all plausible import paths
    for modname in ("api.auth", "backend.api.auth", "api.classify", "backend.api.classify"):
        try:
            mod = __import__(modname, fromlist=["get_observer_queue_next"])
            monkeypatch.setattr(mod, "get_observer_queue_next", _next)
        except (ImportError, AttributeError):
            pass
    response = client.get("/api/queue/next", params={"observer_id": "obs-1"})
    assert response.status_code == 200
    assert response.json()["success"] is True
    assert response.json()["subject_id"] == "spx1"


def test_rate_limiter_enforces_60_writes_per_minute():
    # direct rate limiter contract (SPEC §4.2.2: 60 writes/min, Retry-After: 60)
    auth_mod.rate_limiter.clear()
    observer_id = "rate-test"
    observer_key = "k"
    auth_mod.rate_limiter[observer_id] = {"tokens": 60, "last_refill": __import__("time").time()}
    for _ in range(60):
        auth_mod.verify_observer_rate_limiter(observer_id, observer_key)
    with pytest.raises(Exception) as exc:
        auth_mod.verify_observer_rate_limiter(observer_id, observer_key)
    # FastAPI HTTPException
    e = exc.value
    assert getattr(e, "status_code", None) == 429
    assert getattr(e, "headers", {}).get("Retry-After") == "60"
