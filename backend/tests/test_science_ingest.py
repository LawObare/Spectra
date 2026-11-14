"""Tests for IRSA SIA2 ingestion driver (Issue #8, SPEC §3.1, §4.1)."""

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND = Path(__file__).resolve().parents[1]
for p in (REPO_ROOT, BACKEND):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))


def _import_ingest():
    try:
        import science.ingest as m  # backend-local
        return m
    except ImportError:
        import backend.science.ingest as m  # repo-root
        return m


ingest = _import_ingest()


@pytest.mark.asyncio
async def test_parse_ltv1_ltv2_offsets_from_metadata():
    ltv1, ltv2 = await ingest.parse_ltv1_ltv2_offsets({"metadata": {"LTV1": 12.5, "LTV2": -3}})
    assert ltv1 == 12.5
    assert ltv2 == -3.0


@pytest.mark.asyncio
async def test_parse_ltv1_ltv2_offsets_missing():
    ltv1, ltv2 = await ingest.parse_ltv1_ltv2_offsets({"metadata": {}})
    assert (ltv1, ltv2) == (None, None)


@pytest.mark.asyncio
async def test_group_exposures_by_survey_pass_dynamic_mjd():
    exposures = [{"exposure_id": 1, "mjd": 60010}, {"exposure_id": 2, "mjd": 60020}]
    config = {
        "pass_a": {"mjd_start": 60000, "mjd_end": 60015},
        "pass_b": {"mjd_start": 60016, "mjd_end": 60030},
    }
    grouped = await ingest.group_exposures_by_survey_pass(exposures, config)
    assert [e["mjd"] for e in grouped["pass_a"]] == [60010]
    assert [e["mjd"] for e in grouped["pass_b"]] == [60020]


@pytest.mark.asyncio
async def test_group_exposures_unknown_mjd_bucketed():
    exposures = [{"exposure_id": 1, "mjd": 99999}]
    config = {"pass_a": {"mjd_start": 60000, "mjd_end": 60015}}
    grouped = await ingest.group_exposures_by_survey_pass(exposures, config)
    assert [e["exposure_id"] for e in grouped["unknown"]] == [1]


def test_format_exposures_for_grouping():
    sia2 = {"exposure_ids": [10, 11], "mjds": [60001], "access_urls": ["u1", "u2"]}
    out = ingest._format_exposures_for_grouping(sia2)
    assert out[0]["exposure_id"] == 10 and out[0]["mjd"] == 60001 and out[0]["access_url"] == "u1"
    assert out[1]["exposure_id"] == 11 and out[1]["mjd"] is None and out[1]["access_url"] == "u2"


def test_parse_sia2_votable_minimal():
    xml = "<VOTABLE><ID>123</ID><DATE-OBS>60005</DATE-OBS><FOOTPRINT>poly</FOOTPRINT></VOTABLE>"
    res = ingest._parse_sia2_votable(xml, "spherex_qr2")
    assert res["exposure_ids"] == [123]
    assert res["mjds"][0] == 60005
    assert res["footprints"] == ["poly"]


@pytest.mark.asyncio
async def test_query_sia2_cone_http_error_returns_empty():
    mock_client = AsyncMock()
    mock_resp = MagicMock(status_code=500, text="")
    mock_client.__aenter__.return_value.get = AsyncMock(return_value=mock_resp)

    with patch("httpx.AsyncClient", return_value=mock_client):
        res = await ingest.query_sia2_cone(1.0, 2.0, 0.1)
    assert res == {}


@pytest.mark.asyncio
async def test_fetch_cutout_from_irsa_parses_mef():
    mock_client = AsyncMock()
    mock_resp = MagicMock(status_code=200, content=b"FITS")
    mock_client.__aenter__.return_value.get = AsyncMock(return_value=mock_resp)

    with patch("httpx.AsyncClient", return_value=mock_client):
        res = await ingest.fetch_cutout_from_irsa("https://example/cut", 1.0, 2.0, 0.01)
    assert "hdu1_image" in res and "hdu4_zodi" in res and "hdu6_wave_tab" in res
    assert res["metadata"]["wcs"] == "TAN/SIP"