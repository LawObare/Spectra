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


def test_parse_sia2_votable_ivoa_table():
    xml = """<?xml version="1.0" encoding="UTF-8"?>
    <VOTABLE xmlns="http://www.ivoa.net/xml/VOTable/v1.3">
      <RESOURCE><TABLE>
        <FIELD name="obs_id"/>
        <FIELD name="energy_bandpassname"/>
        <FIELD name="t_min"/>
        <FIELD name="access_url"/>
        <FIELD name="s_region"/>
        <DATA><TABLEDATA>
          <TR>
            <TD>2025W35_1A_0432_4</TD>
            <TD>SPHEREx-D1</TD>
            <TD>60810.25</TD>
            <TD>https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/test.fits</TD>
            <TD>POLYGON ICRS 269.4 4.7</TD>
          </TR>
        </TABLEDATA></DATA>
      </TABLE></RESOURCE>
    </VOTABLE>"""
    res = ingest._parse_sia2_votable(xml, "spherex_qr2")
    assert res["exposure_ids"] == ["2025W35_1A_0432_4"]
    assert res["detector_ids"] == ["D1"]
    assert res["mjds"] == [60810.25]
    assert res["access_urls"] == ["https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/test.fits"]


def test_parse_irsa_mef_cutout_real_fits():
    import io

    import numpy as np
    from astropy.io import fits

    primary = fits.PrimaryHDU()
    hdu1 = fits.ImageHDU(data=np.ones((8, 8), dtype=np.float32) * 3.5, name="IMAGE")
    hdu1.header["CRPIX1A"] = -100.0
    hdu1.header["CRPIX2A"] = -200.0
    hdu2 = fits.ImageHDU(data=np.zeros((8, 8), dtype=np.uint32), name="FLAGS")
    hdu3 = fits.ImageHDU(data=np.ones((8, 8), dtype=np.float32) * 0.04, name="VARIANCE")
    hdu4 = fits.ImageHDU(data=np.ones((8, 8), dtype=np.float32) * 0.12, name="ZODI")
    hdul = fits.HDUList([primary, hdu1, hdu2, hdu3, hdu4])
    buf = io.BytesIO()
    hdul.writeto(buf)

    parsed = ingest._parse_irsa_mef_cutout(buf.getvalue(), "spherex_qr2")
    assert parsed["hdu1_image"] is not None
    assert parsed["hdu1_image"].shape == (8, 8)
    assert float(parsed["hdu1_image"][0, 0]) == pytest.approx(3.5)
    assert float(parsed["hdu3_variance"][0, 0]) == pytest.approx(0.04)
    assert float(parsed["hdu4_zodi"][0, 0]) == pytest.approx(0.12)
    assert parsed["metadata"]["LTV1"] == pytest.approx(-101.0)
    assert parsed["metadata"]["LTV2"] == pytest.approx(-201.0)


def test_survey_passes_from_config_loads_json():
    passes = ingest.survey_passes_from_config()
    assert "pass_01" in passes
    assert passes["pass_01"]["mjd_start"] > 60780.0
