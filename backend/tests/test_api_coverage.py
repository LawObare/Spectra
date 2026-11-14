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


def test_coverage_combines_dr1_and_qr3(monkeypatch):
    calls = []

    async def query(ra, dec, radius_deg, collection, **kwargs):
        calls.append((collection, kwargs))
        return _result(collection, collection)

    monkeypatch.setattr(coverage, "query_sia2_cone", query)
    response = _client().get("/api/coverage?ra=10&dec=20&radius_deg=1")

    assert response.status_code == 200
    assert response.json()["status"] == "ready"
    assert {row["collection"] for row in response.json()["exposures"]} == {
        "spherex_dr1",
        "spherex_qr3",
    }
    assert {collection for collection, _ in calls} == {"spherex_dr1", "spherex_qr3"}
    assert all(kwargs == {"CALIB": 2, "MAXREC": 500} for _, kwargs in calls)


def test_coverage_reports_partial_release_failure(monkeypatch):
    async def query(ra, dec, radius_deg, collection, **kwargs):
        return _result(collection) if collection == "spherex_dr1" else {}

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


def test_coverage_full_endpoint():
    response = _client().get("/api/coverage/full")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ("ready", "offline")
    assert "count" in data
    assert "zones" in data
    assert "mocs" in data
    assert "deep_fields" in data
    assert "exposures" in data
    assert "survey_swaths" not in data


def test_coverage_full_serves_mocs_from_db_pool():
    class FakeConn:
        async def fetch(self, query, *args):
            if "FROM coverage_mocs" in query:
                return [
                    {
                        "collection": "spherex_qr2",
                        "moc_order": 4,
                        "moc_json": '{"4": [1, 2, 3]}',
                        "sky_fraction": 0.001,
                        "cell_count": 3,
                        "exposure_count": 1,
                        "updated_at": None,
                    },
                    {
                        "collection": "spherex_qr3",
                        "moc_order": 4,
                        "moc_json": '{"4": [4, 5]}',
                        "sky_fraction": 0.0006,
                        "cell_count": 2,
                        "exposure_count": 1,
                        "updated_at": None,
                    },
                ]
            if "GROUP BY" in query:
                return [{"ra": 45.0, "dec": 15.0, "count": 1}]
            return [
                {
                    "obs_id": "db-exp-1",
                    "collection": "spherex_qr3",
                    "detector": "D3",
                    "mjd": 61200.0,
                    "wavelength": "D3",
                    "ra_center": 45.0,
                    "dec_center": 15.0,
                    "s_region": "POLYGON ICRS 44 14 46 14 46 16 44 16",
                    "access_url": "https://irsa.example/db-exp-1.fits",
                }
            ]

    class FakeAcquire:
        async def __aenter__(self):
            return FakeConn()

        async def __aexit__(self, exc_type, exc, tb):
            pass

    class FakePool:
        def acquire(self):
            return FakeAcquire()

    app = FastAPI()
    app.include_router(coverage.router)
    app.state.db_pool = FakePool()
    client = TestClient(app)

    response = client.get("/api/coverage/full")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert data["mode"] == "real_qr2_qr3_database"
    assert set(data["mocs"].keys()) == {"spherex_qr2", "spherex_qr3"}
    assert data["mocs"]["spherex_qr2"]["moc_json"] == {"4": [1, 2, 3]}
    assert data["mocs"]["spherex_qr3"]["cell_count"] == 2
    assert len(data["exposures"]) == 1
    assert len(data["deep_fields"]) == 2


def test_coverage_serves_from_db_pool():
    class FakeConn:
        async def fetch(self, query, *args):
            return [
                {
                    "obs_id": "db-exp-1",
                    "collection": "spherex_qr2",
                    "detector": "D3",
                    "mjd": 61200.0,
                    "wavelength": "D3",
                    "ra_center": 45.0,
                    "dec_center": 15.0,
                    "s_region": "POLYGON ICRS 44 14 46 14 46 16 44 16",
                    "access_url": "https://irsa.example/db-exp-1.fits",
                }
            ]

    class FakeAcquire:
        async def __aenter__(self):
            return FakeConn()

        async def __aexit__(self, exc_type, exc, tb):
            pass

    class FakePool:
        def acquire(self):
            return FakeAcquire()

    app = FastAPI()
    app.include_router(coverage.router)
    app.state.db_pool = FakePool()
    client = TestClient(app)

    response = client.get("/api/coverage?ra=45&dec=15&radius_deg=0.5")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert data["source"] == "database"
    assert len(data["exposures"]) == 1
    assert data["exposures"][0]["obs_id"] == "db-exp-1"


