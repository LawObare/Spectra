"""Tests for universal target and coordinate resolver (Issue #7, SPEC §3.1, §4.2.1)."""

import sys
import time
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND = Path(__file__).resolve().parents[1]
for p in (REPO_ROOT, BACKEND):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from main import app


@pytest.mark.asyncio
async def test_resolve_named_benchmark_barnard():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        t0 = time.perf_counter()
        r = await client.get("/api/resolve", params={"name": "barnard"})
        elapsed_ms = (time.perf_counter() - t0) * 1000
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert data["ra_deg"] == 269.44639
    assert data["dec_deg"] == 4.76676
    assert data["resolution_method"] == "local_catalog_map"
    assert elapsed_ms < 50  # local catalog path should be fast


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "name,ra,dec",
    [
        ("wise_0855", 133.73712, -7.24038),
        ("eps_indi_b", 331.09566, -56.80031),
        ("rw_aurigae", 76.95647, 30.40130),
        ("r_draconis", 248.16773, 66.75504),
    ],
)
async def test_resolve_named_benchmarks(name: str, ra: float, dec: float):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/resolve", params={"name": name})
    assert r.status_code == 200
    data = r.json()
    assert data["ra_deg"] == ra
    assert data["dec_deg"] == dec
    assert data["resolution_method"] == "local_catalog_map"


@pytest.mark.asyncio
async def test_resolve_decimal_degrees():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/resolve", params={"coord": "269.44639, 4.76676"})
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert data["ra_deg"] == 269.44639
    assert data["dec_deg"] == 4.76676
    assert data["resolution_method"] == "decimal_degrees"


@pytest.mark.asyncio
async def test_resolve_decimal_degrees_rejects_out_of_range():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/resolve", params={"coord": "400, 95"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_resolve_sexagesimal():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get(
            "/api/resolve",
            params={"coord": "17h 57m 48.498s, +04d 41m 36.25s"},
        )
    assert r.status_code == 200
    data = r.json()
    assert data["success"] is True
    assert abs(data["ra_deg"] - 269.452075) < 1e-3
    assert abs(data["dec_deg"] - 4.693403) < 1e-3
    assert data["resolution_method"] == "sexagesimal_parse"


@pytest.mark.asyncio
async def test_resolve_missing_input_returns_400():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/resolve")
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_resolve_health_circuit_breaker():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/resolve/health")
    assert r.status_code == 200
    data = r.json()
    assert data["circuit_breaker_state"] == "closed"
    assert "failure_count" in data


def _resolve_mod():
    try:
        import backend.api.resolve as mod
        return mod
    except ImportError:
        import api.resolve as mod
        return mod


@pytest.mark.asyncio
async def test_resolve_sesame_fallback_success(monkeypatch):
    mod = _resolve_mod()
    mod._circuit_breaker.update({"state": "closed", "failure_count": 0, "opened_at": 0.0})

    async def fake_sesame(name):
        return (10.0, -20.0)

    monkeypatch.setattr(mod, "resolve_named_target_sesame", fake_sesame)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/resolve", params={"name": "Unknown Target XYZ"})
    assert r.status_code == 200
    data = r.json()
    assert data["resolution_method"] == "cds_sesame_xml"
    assert data["ra_deg"] == 10.0 and data["dec_deg"] == -20.0


@pytest.mark.asyncio
async def test_resolve_sesame_circuit_breaker_opens(monkeypatch):
    mod = _resolve_mod()
    mod._circuit_breaker.update(
        {"state": "closed", "failure_count": mod.CIRCUIT_BREAKER_THRESHOLD - 1, "opened_at": 0.0}
    )

    async def fail(*a, **k):
        mod._record_sesame_failure()

    monkeypatch.setattr(mod, "resolve_named_target_sesame", fail)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/resolve", params={"name": "Nope"})
    assert r.status_code == 400
    assert mod._circuit_breaker["state"] == "open"


def test_parse_sesame_xml():
    mod = _resolve_mod()
    xml = "<Sesame><Target><Resolver><jradeg>1.5</jradeg><jdedeg>-2.5</jdedeg></Resolver></Target></Sesame>"
    assert mod._parse_sesame_xml(xml) == (1.5, -2.5)
