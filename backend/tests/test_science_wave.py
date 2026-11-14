"""Unit & Regression Tests for HDU 6 WCS-WAVE 102-Channel Spectrophotometry & /api/spectrum.

Specification Anchors:
- SPECIFICATION.md §2.4 (SPHEREx 6-Band Spectral Architecture Table, lines 180–191)
- SPECIFICATION.md §4.1 Pipeline 2 (WCS-WAVE Hyperspectral Extraction Pipeline, lines 432–445)
- SPECIFICATION.md §5.3.1 Endpoint 5 (GET /api/spectrum, lines 903–919)
- tasks.md Dev 1 (role:E1-astro) Issue #19

Acceptance Criteria:
- GET /api/spectrum?ra=269.44639&dec=4.76676 returns 102 channels with wavelengths_um,
  flux_jy, variance_jy2, flags, mjd_per_channel, mjd_span, and is_simultaneous.
- Exported OpenAPI 3.1 schema compiles cleanly with SpectrumResponse model.
"""

from __future__ import annotations

import math

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

try:
    from backend.api import spectrum as spectrum_api
    from backend.api.spectrum import SpectrumResponse
    from backend.api.spectrum import router as spectrum_router
    from backend.science.wave import (
        BAND_WAVELENGTH_BOUNDS,
        CHANNELS_PER_BAND,
        MJY_SR_TO_JY_PER_PIXEL,
        PIXEL_SOLID_ANGLE_SR,
        TOTAL_SPHEREX_CHANNELS,
        ChannelPoint,
        bin_observations_to_102_channels,
        extract_102_channel_spectrum,
        extract_forced_psf_photometry,
        fit_chebyshev_continuum,
        get_standard_channel_grid,
        match_benchmark_target,
    )
except ImportError:
    from api import spectrum as spectrum_api
    from api.spectrum import SpectrumResponse
    from api.spectrum import router as spectrum_router
    from science.wave import (
        BAND_WAVELENGTH_BOUNDS,
        CHANNELS_PER_BAND,
        MJY_SR_TO_JY_PER_PIXEL,
        PIXEL_SOLID_ANGLE_SR,
        TOTAL_SPHEREX_CHANNELS,
        ChannelPoint,
        bin_observations_to_102_channels,
        extract_102_channel_spectrum,
        extract_forced_psf_photometry,
        fit_chebyshev_continuum,
        get_standard_channel_grid,
        match_benchmark_target,
    )

# Setup isolated test app
_app = FastAPI()
_app.include_router(spectrum_router)
client = TestClient(_app)


# ============================================================================
# 1. 102-Channel Grid Architecture Tests
# ============================================================================


def test_standard_channel_grid_architecture():
    """Verify 102 standard channels across 6 detector bands (17 channels each)."""
    grid = get_standard_channel_grid()
    assert len(grid) == TOTAL_SPHEREX_CHANNELS
    assert len(grid) == 102

    # Verify monotonic increasing wavelength
    assert np.all(np.diff(grid) >= 0.0)

    # Verify band boundaries
    assert np.isclose(grid[0], 0.75, atol=1e-3)
    assert np.isclose(grid[-1], 5.00, atol=1e-3)

    # Verify 17 channels per band
    for i, band in enumerate(["D1", "D2", "D3", "D4", "D5", "D6"]):
        b_min, b_max = BAND_WAVELENGTH_BOUNDS[band]
        band_slice = grid[i * CHANNELS_PER_BAND : (i + 1) * CHANNELS_PER_BAND]
        assert len(band_slice) == 17
        assert np.isclose(band_slice[0], b_min, atol=1e-3)
        assert np.isclose(band_slice[-1], b_max, atol=1e-3)


def test_solid_angle_and_jy_conversion_constants():
    """Verify physical conversion constants match SPECIFICATION.md §4.1 line 439."""
    expected_solid_angle = (6.2 * math.pi / (180.0 * 3600.0)) ** 2
    assert np.isclose(PIXEL_SOLID_ANGLE_SR, expected_solid_angle, rtol=1e-6)
    assert np.isclose(PIXEL_SOLID_ANGLE_SR, 9.0351e-10, rtol=1e-3)

    # 10^6 * Omega_px ≈ 9.035e-4
    assert np.isclose(MJY_SR_TO_JY_PER_PIXEL, 9.0351e-4, rtol=1e-3)


# ============================================================================
# 2. Optimal PSF Photometry Extraction Tests
# ============================================================================


def test_extract_forced_psf_photometry_optimal_weighting():
    """Verify optimal PSF-weighted point source extraction in Janskys."""
    shape = (5, 5)
    psf = np.array(
        [
            [0.01, 0.02, 0.04, 0.02, 0.01],
            [0.02, 0.08, 0.16, 0.08, 0.02],
            [0.04, 0.16, 0.32, 0.16, 0.04],
            [0.02, 0.08, 0.16, 0.08, 0.02],
            [0.01, 0.02, 0.04, 0.02, 0.01],
        ],
        dtype=np.float32,
    )
    psf /= np.sum(psf)

    # True point source amplitude in MJy/sr
    true_amplitude_mjy_sr = 50.0
    image = true_amplitude_mjy_sr * psf
    variance = np.full(shape, 0.25, dtype=np.float32)
    flags = np.zeros(shape, dtype=np.uint32)
    flags[2, 2] = 1  # Transient bit on peak

    flux_jy, var_jy2, combined_flags = extract_forced_psf_photometry(
        image_roi=image,
        variance_roi=variance,
        flags_roi=flags,
        psf_roi=psf,
    )

    expected_flux_jy = true_amplitude_mjy_sr * MJY_SR_TO_JY_PER_PIXEL
    assert np.isclose(flux_jy, expected_flux_jy, rtol=1e-3)
    assert var_jy2 > 0.0
    assert combined_flags == 1


# ============================================================================
# 3. 102-Channel Multi-Exposure Binning Tests
# ============================================================================


def test_bin_observations_to_102_channels():
    """Verify inverse-variance weighted combination across exposures into 102 grid."""
    obs_list = [
        # Two exposures landing in channel 0 (~0.75 um)
        ChannelPoint(
            wavelength_um=0.751,
            bandwidth_um=0.02,
            flux_jy=0.010,
            variance_jy2=1e-6,
            flag=0,
            mjd=60750.0,
            exposure_id="exp_01",
            band="D1",
        ),
        ChannelPoint(
            wavelength_um=0.749,
            bandwidth_um=0.02,
            flux_jy=0.020,
            variance_jy2=1e-6,
            flag=0,
            mjd=60751.0,
            exposure_id="exp_02",
            band="D1",
        ),
        # One exposure landing in channel 50 (~2.12 um)
        ChannelPoint(
            wavelength_um=2.12,
            bandwidth_um=0.04,
            flux_jy=0.035,
            variance_jy2=2e-6,
            flag=4,
            mjd=60932.0,
            exposure_id="exp_03",
            band="D3",
        ),
    ]

    fluxes, variances, flags, mjds = bin_observations_to_102_channels(obs_list)
    assert len(fluxes) == 102

    # Equal weights for exp_01 and exp_02 -> mean flux = 0.015
    assert np.isclose(fluxes[0], 0.015, atol=1e-4)
    # Variance should be halved (1e-6 / 2 = 5e-7)
    assert np.isclose(variances[0], 5e-7, atol=1e-8)
    assert flags[0] == 0
    assert np.isclose(mjds[0], 60750.5, atol=0.1)

    # Channel 50 check
    grid = get_standard_channel_grid()
    idx_50 = int(np.argmin(np.abs(grid - 2.12)))
    assert np.isclose(fluxes[idx_50], 0.035, atol=1e-4)
    assert flags[idx_50] == 4

    # Uncovered channels should be flagged with MISSING_DATA (512) or Bit 10
    assert flags[1] in (512, 1024)


# ============================================================================
# 4. Chebyshev Continuum Normalization Tests
# ============================================================================


def test_fit_chebyshev_continuum_3sigma_clipping():
    """Verify 4th-order Chebyshev baseline and optical depth calculation."""
    grid = get_standard_channel_grid()

    # Synthetic stellar continuum F_cont(λ) = 0.1 * (λ / 1.0)^(-1.5)
    true_continuum = 0.1 * (grid / 1.0) ** (-1.5)

    # Inject ice absorption feature at 3.05 um (H2O ice)
    ice_absorption = 0.03 * np.exp(-((grid - 3.05) / 0.15) ** 2)
    observed_flux = true_continuum - ice_absorption
    variance = np.full(len(grid), 1e-8, dtype=np.float64)

    cont_fit, tau = fit_chebyshev_continuum(grid, observed_flux, variance, order=4)
    assert len(cont_fit) == 102
    assert len(tau) == 102

    # In continuum windows, cont_fit should match true_continuum within <5%
    mask_continuum = (
        ((grid >= 0.8) & (grid <= 1.1))
        | ((grid >= 2.1) & (grid <= 2.3))
        | ((grid >= 3.7) & (grid <= 3.9))
    )
    rel_err = np.abs(cont_fit[mask_continuum] - true_continuum[mask_continuum]) / true_continuum[mask_continuum]
    assert np.mean(rel_err) < 0.05

    # Optical depth tau should peak near 3.05 um
    peak_idx = int(np.argmin(np.abs(grid - 3.05)))
    assert tau[peak_idx] > 0.2
    # In unabsorbed continuum, optical depth tau should be near 0
    assert tau[0] < 0.05


# ============================================================================
# 5. NASA Benchmark Target Matching & SED Generation Tests
# ============================================================================


def test_match_benchmark_target_all_5():
    """Verify coordinate matching for all 5 mandatory NASA benchmark targets."""
    # Barnard's Star
    t1 = match_benchmark_target(269.44639, 4.76676)
    assert t1 is not None
    assert t1["name"] == "Barnard's Star"

    # WISE 0855-0714
    t2 = match_benchmark_target(133.73712, -7.24038)
    assert t2 is not None
    assert "WISE 0855" in t2["name"]

    # Epsilon Indi B
    t3 = match_benchmark_target(331.09566, -56.80031)
    assert t3 is not None
    assert "Epsilon Indi B" in t3["name"]

    # RW Aurigae
    t4 = match_benchmark_target(76.95647, 30.40130)
    assert t4 is not None
    assert "RW Aurigae" in t4["name"]

    # R Draconis
    t5 = match_benchmark_target(248.16773, 66.75504)
    assert t5 is not None
    assert "R Draconis" in t5["name"]

    # Unmatched arbitrary coordinate
    t_none = match_benchmark_target(10.0, 10.0)
    assert t_none is None


def _make_archive_observations() -> list[ChannelPoint]:
    grid = get_standard_channel_grid()
    bands = ["D1", "D2", "D3", "D4", "D5", "D6"]
    points: list[ChannelPoint] = []
    for idx, lam in enumerate(grid):
        band = bands[min(5, idx // CHANNELS_PER_BAND)]
        points.append(
            ChannelPoint(
                wavelength_um=float(lam),
                bandwidth_um=0.05,
                flux_jy=float(0.05 * (lam / 1.0) ** (-0.8)),
                variance_jy2=1e-7,
                flag=0,
                mjd=60789.85 + idx * 4.4,
                exposure_id=f"exp_{idx:03d}",
                band=band,
            )
        )
    return points


def test_extract_102_channel_spectrum_requires_observations():
    """Verify extract_102_channel_spectrum never synthesizes mock data without archive points."""
    with pytest.raises(ValueError, match="Archive observations are required"):
        extract_102_channel_spectrum(ra=269.44639, dec=4.76676, normalize=True)


def test_extract_102_channel_spectrum_non_simultaneity():
    """Verify non-simultaneity tracking across SPHEREx survey passes."""
    spec = extract_102_channel_spectrum(
        ra=269.44639,
        dec=4.76676,
        normalize=True,
        custom_observations=_make_archive_observations(),
    )
    assert spec.channels == 102
    assert len(spec.wavelengths_um) == 102
    assert len(spec.flux_jy) == 102
    assert len(spec.variance_jy2) == 102
    assert len(spec.flags) == 102
    assert len(spec.mjd_per_channel) == 102
    assert spec.is_simultaneous is False
    assert spec.mjd_span[1] > spec.mjd_span[0]
    assert spec.continuum_flux_jy is not None
    assert spec.optical_depth_tau is not None


# ============================================================================
# 6. Acceptance Criteria: GET /api/spectrum Endpoint Tests
# ============================================================================


def test_api_spectrum_acceptance_criterion_1(monkeypatch):
    """Acceptance Criterion 1: GET /api/spectrum?ra=269.44639&dec=4.76676 returns

    102 channels with wavelengths_um, flux_jy, variance_jy2, flags, mjd_per_channel,
    mjd_span, and is_simultaneous from archive observations (no synthetic fallback).
    """
    obs = _make_archive_observations()

    async def _fake_live(ra: float, dec: float, progress_hook=None):
        return obs, ["spherex_dr1", "spherex_qr3"], [p.exposure_id for p in obs]

    monkeypatch.setattr(spectrum_api, "extract_live_observations", _fake_live)
    response = client.get("/api/spectrum?ra=269.44639&dec=4.76676")
    assert response.status_code == 200

    data = response.json()
    assert np.isclose(data["ra"], 269.44639, atol=1e-4)
    assert np.isclose(data["dec"], 4.76676, atol=1e-4)
    assert data["target_name"] == "Barnard's Star"
    assert data["channels"] == 102
    assert data["provenance"]["source_badge"] == "[IRSA Live (spherex_dr1 + spherex_qr3)]"

    assert len(data["wavelengths_um"]) == 102
    assert len(data["flux_jy"]) == 102
    assert len(data["variance_jy2"]) == 102
    assert len(data["flags"]) == 102
    assert len(data["mjd_per_channel"]) == 102
    assert len(data["mjd_span"]) == 2
    assert isinstance(data["is_simultaneous"], bool)
    assert data["is_simultaneous"] is False

    # Continuum and tau should be None when normalize=false
    assert data["continuum_flux_jy"] is None
    assert data["optical_depth_tau"] is None


def test_api_spectrum_with_normalization(monkeypatch):
    """Verify GET /api/spectrum?ra=...&dec=...&normalize=true returns continuum & tau."""
    obs = _make_archive_observations()

    async def _fake_live(ra: float, dec: float, progress_hook=None):
        return obs, ["spherex_dr1"], [p.exposure_id for p in obs]

    monkeypatch.setattr(spectrum_api, "extract_live_observations", _fake_live)
    response = client.get("/api/spectrum?ra=133.73712&dec=-7.24038&normalize=true")
    assert response.status_code == 200

    data = response.json()
    assert data["target_name"] == "WISE 0855-0714"
    assert data["channels"] == 102
    assert data["continuum_flux_jy"] is not None
    assert len(data["continuum_flux_jy"]) == 102
    assert data["optical_depth_tau"] is not None
    assert len(data["optical_depth_tau"]) == 102


def test_api_spectrum_acceptance_criterion_2_schema():
    """Acceptance Criterion 2: Exported OpenAPI 3.1 schema compiles cleanly with SpectrumResponse."""
    schema = SpectrumResponse.model_json_schema()
    assert schema["title"] == "SpectrumResponse"
    assert "ra" in schema["properties"]
    assert "dec" in schema["properties"]
    assert "channels" in schema["properties"]
    assert "wavelengths_um" in schema["properties"]
    assert "flux_jy" in schema["properties"]
    assert "variance_jy2" in schema["properties"]
    assert "mjd_span" in schema["properties"]
    assert "is_simultaneous" in schema["properties"]
    assert "continuum_flux_jy" in schema["properties"]
    assert "optical_depth_tau" in schema["properties"]


def test_api_spectrum_coordinate_validation():
    """Verify input validation rejecting out-of-range RA/Dec."""
    # Out of range RA > 360
    r_bad_ra = client.get("/api/spectrum?ra=370.0&dec=10.0")
    assert r_bad_ra.status_code == 422

    # Out of range Dec > 90
    r_bad_dec = client.get("/api/spectrum?ra=100.0&dec=95.0")
    assert r_bad_dec.status_code == 422
