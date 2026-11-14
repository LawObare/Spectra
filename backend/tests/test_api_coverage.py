"""Tests for the same-origin IRSA archive coverage endpoint."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import coverage


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(coverage.router)
    return TestClient(app)


def _result(collection: str, exposure_id: str = "exp-1") -> dict:
    return {
        "collection": collection,
        "exposure_ids": [exposure_id],
        "access_urls": [f"https://irsa.example/{exposure_id}.fits"],
        "footprints": ["POLYGON ICRS 1 2 3 2 3 4"],
        "detector_ids": ["D2"],
        "mjds": [61000.0],
    }


def test_coverage_combines_qr2_and_qr3(monkeypatch):
    calls = []

    async def query(ra, dec, radius_deg, collection, **kwargs):
        calls.append((collection, kwargs))
        return _result(collection, collection)

    monkeypatch.setattr(coverage, "query_sia2_cone", query)
    response = _client().get("/api/coverage?ra=10&dec=20&radius_deg=1")

    assert response.status_code == 200
    assert response.json()["status"] == "ready"
    assert {row["collection"] for row in response.json()["exposures"]} == {
        "spherex_qr2",
        "spherex_qr3",
    }
    assert {collection for collection, _ in calls} == {"spherex_qr2", "spherex_qr3"}
    assert all(kwargs == {"CALIB": 2, "MAXREC": 500} for _, kwargs in calls)


def test_coverage_reports_partial_release_failure(monkeypatch):
    async def query(ra, dec, radius_deg, collection, **kwargs):
        return _result(collection) if collection == "spherex_qr2" else {}

    monkeypatch.setattr(coverage, "query_sia2_cone", query)
    response = _client().get("/api/coverage?ra=10&dec=20&radius_deg=1")

    assert response.status_code == 200
    assert response.json()["status"] == "partial"
    assert response.json()["unavailable_collections"] == ["spherex_qr3"]
    assert len(response.json()["exposures"]) == 1


def test_coverage_reports_empty_only_when_both_releases_respond(monkeypatch):
    async def query(ra, dec, radius_deg, collection, **kwargs):
        return {"collection": collection, "exposure_ids": [], "access_urls": [], "footprints": []}

    monkeypatch.setattr(coverage, "query_sia2_cone", query)
    response = _client().get("/api/coverage?ra=10&dec=20&radius_deg=1")

    assert response.status_code == 200
    assert response.json()["status"] == "empty"
    assert response.json()["exposures"] == []


def test_coverage_returns_502_when_both_release_queries_fail(monkeypatch):
    async def query(ra, dec, radius_deg, collection, **kwargs):
        return {}

    monkeypatch.setattr(coverage, "query_sia2_cone", query)
    response = _client().get("/api/coverage?ra=10&dec=20&radius_deg=1")

    assert response.status_code == 502
