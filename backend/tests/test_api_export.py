"""Unit & Integration Tests for SPHEREx Data Product Exporter API.

Specification Anchors:
- SPECIFICATION.md §1.3 (Item 19: Community Products & Disclaimer)
- SPECIFICATION.md §4.2.1, §6.4.6 (Tab 5: Data Product Exporters)
- tasks.md Dev 6 (role:E6-devops) Issue #28
"""

from __future__ import annotations

import io

import pytest
from astropy.io import fits
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

try:
    from backend.api.export import router as export_router
except ImportError:
    from api.export import router as export_router


@pytest.fixture
def test_app() -> FastAPI:
    """Instantiate lightweight test FastAPI application with export router."""
    app = FastAPI(title="Export Test App")
    app.include_router(export_router)
    return app


@pytest.mark.asyncio
async def test_export_summary(test_app: FastAPI) -> None:
    """Verify export summary returns all 4 products + ml-dataset with community disclaimers."""
    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/admin/export/summary")
        assert response.status_code == 200
        data = response.json()

        assert data["attribution"] == "Community Product"
        assert "Not an official NASA or JPL publication" in data["disclaimer"]
        assert "candidates" in data["products"]
        assert "ices" in data["products"]
        assert "variability" in data["products"]
        assert "artifacts" in data["products"]
        assert "ml-dataset" in data["products"]


@pytest.mark.asyncio
async def test_export_candidates_csv(test_app: FastAPI) -> None:
    """Verify candidates export generates valid RFC 4180 CSV with provenance banner."""
    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/admin/export/csv?product=candidates")
        assert response.status_code == 200
        assert "text/csv" in response.headers["Content-Type"]
        assert response.headers["X-Data-Product"] == "Community Product"
        assert "attachment; filename=" in response.headers["Content-Disposition"]

        body = response.text
        assert "# SPHEREx Community Data Product: CANDIDATES" in body
        assert "subject_id,title,ra,dec" in body
        assert "benchmark_barnard" in body
        assert "benchmark_wise_0855" in body


@pytest.mark.asyncio
async def test_export_candidates_json(test_app: FastAPI) -> None:
    """Verify candidates export generates structured JSON bundle."""
    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/admin/export/json?product=candidates")
        assert response.status_code == 200
        data = response.json()

        assert data["attribution"] == "Community Product"
        assert data["product"] == "candidates"
        assert len(data["records"]) > 0
        first = data["records"][0]
        assert "subject_id" in first
        assert "ra" in first
        assert "dec" in first


@pytest.mark.asyncio
async def test_export_candidates_votable(test_app: FastAPI) -> None:
    """Verify candidates export generates valid IVOA VOTable XML."""
    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/admin/export/votable?product=candidates")
        assert response.status_code == 200
        assert "application/x-votable+xml" in response.headers["Content-Type"]

        xml_text = response.text
        assert "<VOTABLE" in xml_text
        assert "xmlns=\"http://www.ivoa.net/xml/VOTable/v1.4\"" in xml_text
        assert "<TABLEDATA>" in xml_text
        assert "benchmark_barnard" in xml_text


@pytest.mark.asyncio
async def test_export_ices_fits(test_app: FastAPI) -> None:
    """Verify ice atlas export generates binary FITS file with BinTableHDU."""
    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/admin/export/fits?product=ices")
        assert response.status_code == 200
        assert response.headers["Content-Type"] == "application/fits"

        fits_bytes = response.content
        hdul = fits.open(io.BytesIO(fits_bytes))
        assert len(hdul) >= 2
        assert hdul[0].header["PRODUCT"] == "Community Product"
        assert hdul[0].header["RELEASE"] == "spherex_qr2"

        # Check table columns
        table_hdu = hdul[1]
        col_names = table_hdu.columns.names
        assert "subject_id" in col_names
        assert "tau_h2o_3_05um" in col_names
        assert "n_h2o_cm2" in col_names
        assert len(table_hdu.data) > 0


@pytest.mark.asyncio
async def test_export_variability_csv(test_app: FastAPI) -> None:
    """Verify variability export delivers dimming ratios and periods."""
    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/admin/export/csv?product=variability")
        assert response.status_code == 200
        text = response.text
        assert "dimming_ratio" in text
        assert "RW Aurigae" in text
        assert "R Draconis" in text


@pytest.mark.asyncio
async def test_export_artifacts_hdf5(test_app: FastAPI) -> None:
    """Verify artifact atlas export generates HDF5-compatible package with dataloader."""
    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/admin/export/hdf5?product=artifacts")
        assert response.status_code == 200
        assert "application/x-hdf5" in response.headers["Content-Type"]

        data = response.json()
        assert data["format"] == "HDF5-TensorBundle-v1"
        assert "dataloader_script" in data
        assert "SPHERExDataset" in data["dataloader_script"]
        assert len(data["records"]) > 0


@pytest.mark.asyncio
async def test_export_verified_only_filter(test_app: FastAPI) -> None:
    """Verify verified_only query parameter excludes unverified community candidates."""
    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp_all = await client.get("/api/admin/export/json?product=candidates&verified_only=false")
        resp_verified = await client.get("/api/admin/export/json?product=candidates&verified_only=true")

        all_records = resp_all.json()["records"]
        ver_records = resp_verified.json()["records"]

        assert len(ver_records) <= len(all_records)
        for r in ver_records:
            assert r["verification_status"] == "verified_discovery"


@pytest.mark.asyncio
async def test_export_error_handling(test_app: FastAPI) -> None:
    """Verify 400 Bad Request on invalid format or unknown product."""
    transport = ASGITransport(app=test_app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Invalid format
        bad_format = await client.get("/api/admin/export/exe?product=candidates")
        assert bad_format.status_code == 400
        assert "Unsupported format" in bad_format.json()["detail"]

        # Invalid product
        bad_product = await client.get("/api/admin/export/csv?product=nonexistent")
        assert bad_product.status_code == 400
        assert "Unknown data product" in bad_product.json()["detail"]
