"""Tests for persistent user-installed sky sections API."""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api import sections


def _make_tensor_payload(n_epochs: int = 2, n_bands: int = 6, h: int = 5, w: int = 5) -> bytes:
    header = {
        "shape": [n_epochs, n_bands, h, w],
        "crval": [120.0, 20.0],
        "cdelt": [-0.00172222, 0.00172222],
        "mjd_ranges": [[[60800.0, 60801.0] for _ in range(n_bands)] for _ in range(n_epochs)],
        "exposure_ids": ["exp_1"],
        "release": "spherex_dr1 + spherex_qr3",
        "source_badge": "[IRSA Live (spherex_dr1 + spherex_qr3)]",
        "compression": "none",
    }
    header_bytes = json.dumps(header).encode("utf-8")
    flux = np.full((n_epochs, n_bands, h, w), 1.5, dtype="<f4")
    var = np.full((n_epochs, n_bands, h, w), 0.01, dtype="<f4")
    flags = np.zeros((n_epochs, n_bands, h, w), dtype="<u4")
    n_exp = np.full((n_epochs, n_bands, h, w), 2, dtype="<u2")
    return (
        struct.pack("<I", len(header_bytes))
        + header_bytes
        + flux.tobytes()
        + var.tobytes()
        + flags.tobytes()
        + n_exp.tobytes()
    )


class _FakeConn:
    def __init__(self, rows: dict[str, dict]):
        self.rows = rows

    async def fetch(self, query: str, *args):
        return list(self.rows.values())

    async def fetchrow(self, query: str, *args):
        sec_id = args[0]
        if query.strip().startswith("DELETE"):
            return self.rows.pop(sec_id, None)
        return self.rows.get(sec_id)

    async def execute(self, query: str, *args):
        sec_id = args[0]
        if "INSERT INTO installed_sections" in query:
            self.rows[sec_id] = {
                "section_id": sec_id,
                "label": args[1],
                "ra": args[2],
                "dec": args[3],
                "fov_arcsec": args[4],
                "status": "installing",
                "epochs": 0,
                "bands": 6,
                "height": 0,
                "width": 0,
                "source_badge": "[IRSA Live]",
                "tensor_path": None,
                "spectrum_json": None,
                "size_bytes": 0,
                "error_message": None,
                "created_at": None,
                "updated_at": None,
            }
        elif "UPDATE installed_sections" in query and "status = 'ready'" in query:
            row = self.rows[sec_id]
            row.update(
                {
                    "status": "ready",
                    "epochs": args[1],
                    "bands": args[2],
                    "height": args[3],
                    "width": args[4],
                    "source_badge": args[5],
                    "tensor_path": args[6],
                    "spectrum_json": args[7],
                    "size_bytes": args[8],
                }
            )


class _FakeAcquire:
    def __init__(self, rows: dict[str, dict]):
        self.rows = rows

    async def __aenter__(self):
        return _FakeConn(self.rows)

    async def __aexit__(self, exc_type, exc, tb):
        pass


class _FakePool:
    def __init__(self, rows: dict[str, dict]):
        self.rows = rows

    def acquire(self):
        return _FakeAcquire(self.rows)


def test_sections_list_tensor_spectrum_and_uninstall(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(sections, "SECTIONS_DIR", tmp_path)
    payload = _make_tensor_payload()
    sec_id = sections.section_id_for(120.0, 20.0, 180.0)
    tensor_path, size_bytes = sections._write_installed_tensor_bytes(sec_id, payload)

    rows = {
        sec_id: {
            "section_id": sec_id,
            "label": "Test Field",
            "ra": 120.0,
            "dec": 20.0,
            "fov_arcsec": 180.0,
            "status": "ready",
            "epochs": 2,
            "bands": 6,
            "height": 5,
            "width": 5,
            "source_badge": "[IRSA Live (spherex_dr1 + spherex_qr3)]",
            "tensor_path": tensor_path,
            "spectrum_json": None,
            "size_bytes": size_bytes,
            "error_message": None,
            "created_at": None,
            "updated_at": None,
        }
    }

    app = FastAPI()
    app.include_router(sections.router)
    app.state.db_pool = _FakePool(rows)
    client = TestClient(app)

    # 1. List
    res = client.get("/api/sections")
    assert res.status_code == 200
    assert len(res.json()["sections"]) == 1
    assert res.json()["sections"][0]["section_id"] == sec_id

    # 2. Re-install short-circuits cleanly when already installed
    ins = client.post("/api/sections/install", json={"ra": 120.0, "dec": 20.0, "fov_arcsec": 180.0})
    assert ins.status_code == 202
    assert ins.json()["already_installed"] is True

    # 3. Tensor stream
    ten = client.get(f"/api/sections/{sec_id}/tensor")
    assert ten.status_code == 200
    assert ten.content == payload

    # 4. Spectrum extraction from persisted tensor (with pixel probe + normalize)
    spec = client.get(f"/api/sections/{sec_id}/spectrum?px=2&py=2&normalize=true")
    assert spec.status_code == 200
    spec_data = spec.json()
    assert spec_data["channels"] == 102
    assert len(spec_data["flux_jy"]) == 102
    assert spec_data["continuum_flux_jy"] is not None
    assert spec_data["provenance"]["probe_pixel"] == [2, 2]

    # 5. Uninstall removes DB row and disk file
    rem = client.delete(f"/api/sections/{sec_id}")
    assert rem.status_code == 200
    assert not Path(tensor_path).exists()
    assert client.get("/api/sections").json()["sections"] == []
