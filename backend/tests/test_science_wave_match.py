"""Unit tests for HDU 6 WAVE-TAB Adaptive Wavelength Matcher.

Spec-Anchors:
- SPECIFICATION.md §1.3 Audit #1 (Wavelength-matched frames, line 39)
- SPECIFICATION.md §2.4 (SPHEREx 6-Band Spectral Architecture Table, lines 180–191)
- SPECIFICATION.md §3.1 Stage 5 (Adaptive Wavelength Window Selection, lines 316–319)
- SPECIFICATION.md §4.1 Pipeline 2 Step 2 (Detector Space Lookup from Cutout Sub-Arrays, line 434)
- SYSTEM_ARCHITECTURE.md §4.2 Item 6 (Adaptive Wavelength Matching Algorithm, lines 542–546)
- tasks.md Dev 1 (role:E1-astro) Issue #9
"""

from __future__ import annotations

import numpy as np
from astropy.io import fits

try:
    from backend.science.wave_match import (
        DEFAULT_BAND_RESOLVING_POWERS,
        DEFAULT_BAND_WAVELENGTH_RANGES,
        compute_cutout_wavelength_grid,
        filter_wavelength_matched_exposures,
        interpolate_wave_tab,
        load_detector_resolving_powers,
        restore_detector_coordinates,
    )
except ImportError:
    from science.wave_match import (
        DEFAULT_BAND_RESOLVING_POWERS,
        DEFAULT_BAND_WAVELENGTH_RANGES,
        compute_cutout_wavelength_grid,
        filter_wavelength_matched_exposures,
        interpolate_wave_tab,
        load_detector_resolving_powers,
        restore_detector_coordinates,
    )


def make_synthetic_wcs_header(
    ra_center: float = 164.70559,
    dec_center: float = 29.13890,
    crpix1: float = 1020.5,
    crpix2: float = 1020.5,
    cdelt1: float = -0.001722222222,  # 6.2 arcsec/px in deg
    cdelt2: float = 0.001722222222,
) -> fits.Header:
    """Create a synthetic TAN spatial WCS header."""
    h = fits.Header()
    h["NAXIS"] = 2
    h["NAXIS1"] = 2040
    h["NAXIS2"] = 2040
    h["CTYPE1"] = "RA---TAN"
    h["CTYPE2"] = "DEC--TAN"
    h["CRVAL1"] = ra_center
    h["CRVAL2"] = dec_center
    h["CRPIX1"] = crpix1
    h["CRPIX2"] = crpix2
    h["CDELT1"] = cdelt1
    h["CDELT2"] = cdelt2
    return h


def make_synthetic_wave_tab(
    band: str = "D2",
    n_pts: int = 11,
) -> dict[str, np.ndarray]:
    """Create a synthetic HDU 6 WAVE-TAB control points grid."""
    lam_min, lam_max = DEFAULT_BAND_WAVELENGTH_RANGES.get(band, (1.11, 1.63))
    r_b = DEFAULT_BAND_RESOLVING_POWERS.get(band, 45.0)

    x_grid = np.linspace(0.0, 2040.0, n_pts, dtype=np.float32)
    y_grid = np.linspace(0.0, 2040.0, n_pts, dtype=np.float32)

    values = np.zeros((n_pts, n_pts, 2), dtype=np.float32)
    for j in range(n_pts):
        lam = lam_min + (lam_max - lam_min) * (y_grid[j] / 2040.0)
        values[j, :, 0] = lam
        values[j, :, 1] = lam / r_b

    return {"X": x_grid, "Y": y_grid, "VALUES": values}


def test_load_detector_resolving_powers():
    """Verify loading of Hawaiian-2RG resolving powers matches SPHEREx specs."""
    r_powers = load_detector_resolving_powers()
    assert set(r_powers.keys()) >= {"D1", "D2", "D3", "D4", "D5", "D6"}
    assert r_powers["D1"] == 41.0
    # D3: 50-64, D4: 64-96 per SPECIFICATION.md §2.4 Table
    assert r_powers["D3"] >= 50.0
    assert r_powers["D4"] >= 64.0
    assert r_powers["D5"] == 110.0
    assert r_powers["D6"] == 130.0


def test_restore_detector_coordinates_parent_wcs():
    """Verify coordinate transformation from (ra, dec) to parent detector pixel space."""
    target_ra = 164.70559
    target_dec = 29.13890
    parent_hdr = make_synthetic_wcs_header(ra_center=target_ra, dec_center=target_dec)

    exp = {"header": parent_hdr, "band": "D2", "epoch": 0}
    coords = restore_detector_coordinates(exp, target_ra, target_dec)
    assert coords is not None
    x_det, y_det = coords
    assert abs(x_det - 1019.5) < 0.05 or abs(x_det - 1020.5) < 0.05
    assert abs(y_det - 1019.5) < 0.05 or abs(y_det - 1020.5) < 0.05


def test_restore_detector_coordinates_cutout_wcs_a():
    """Verify coordinate restoration using Spike S3 verified Alternate WCS-A formula."""
    target_ra = 164.70559
    target_dec = 29.13890
    cut_hdr = make_synthetic_wcs_header(
        ra_center=target_ra,
        dec_center=target_dec,
        crpix1=15.5,
        crpix2=13.5,
    )
    cut_hdr["CRPIX1A"] = -1004.0
    cut_hdr["CRPIX2A"] = -1006.0

    exp = {"cutout_header": cut_hdr, "band": "D2", "epoch": 0}
    coords = restore_detector_coordinates(exp, target_ra, target_dec)
    assert coords is not None
    x_det, y_det = coords
    assert abs(x_det - 1019.5) < 0.1
    assert abs(y_det - 1019.5) < 0.1


def test_restore_detector_coordinates_bounds_check():
    """Verify that coordinates projecting outside [0, 2040] return None."""
    target_ra = 164.70559
    target_dec = 29.13890
    off_hdr = make_synthetic_wcs_header(ra_center=target_ra + 10.0, dec_center=target_dec + 10.0)
    exp = {"header": off_hdr, "band": "D1", "epoch": 0}
    coords = restore_detector_coordinates(exp, target_ra, target_dec)
    assert coords is None


def test_interpolate_wave_tab_2d_bilinear():
    """Verify 2D bilinear interpolation on synthetic WAVE-TAB grid."""
    wave_tab = make_synthetic_wave_tab(band="D2", n_pts=11)
    lam, dlam = interpolate_wave_tab(
        wave_tab["X"],
        wave_tab["Y"],
        wave_tab["VALUES"],
        x_det=1020.0,
        y_det=1020.0,
    )
    assert abs(lam - 1.3700) < 1e-4
    assert abs(dlam - (1.3700 / 45.0)) < 1e-4

    lam_0, _ = interpolate_wave_tab(wave_tab["X"], wave_tab["Y"], wave_tab["VALUES"], 0.0, 0.0)
    assert abs(lam_0 - 1.1100) < 1e-4

    lam_max, _ = interpolate_wave_tab(wave_tab["X"], wave_tab["Y"], wave_tab["VALUES"], 2040.0, 2040.0)
    assert abs(lam_max - 1.6300) < 1e-4


def test_compute_cutout_wavelength_grid():
    """Verify per-pixel 2D cutout grid wavelength map generation (§3.1 Stage 5)."""
    cut_hdr = make_synthetic_wcs_header(crpix1=15.5, crpix2=13.5)
    cut_hdr["NAXIS1"] = 29
    cut_hdr["NAXIS2"] = 29
    cut_hdr["CRPIX1A"] = -1004.0
    cut_hdr["CRPIX2A"] = -1006.0

    wave_tab = make_synthetic_wave_tab(band="D2", n_pts=11)
    lam_map, dlam_map = compute_cutout_wavelength_grid(cut_hdr, wave_tab=wave_tab, band="D2")

    assert lam_map.shape == (29, 29)
    assert dlam_map.shape == (29, 29)
    assert lam_map.dtype == np.float32
    assert dlam_map.dtype == np.float32

    # Wavelength should increase with Y (SPHEREx LVF dispersion axis)
    assert lam_map[28, 14] > lam_map[0, 14]
    assert np.all(dlam_map > 0.0)


def test_filter_wavelength_matched_nominal_window():
    """Verify that exposures outside nominal 1/R_b window are strictly discarded."""
    target_ra = 164.70559
    target_dec = 29.13890

    # Band D5: nominal R = 110.0 -> w_b = 1/110 = 0.00909 (~0.91%)
    exposures = [
        {"exposure_id": "exp_in_1", "band": "D5", "epoch": "P1", "x_det": 1000.0, "y_det": 1000.0, "wavelength_um": 4.100},
        {"exposure_id": "exp_in_2", "band": "D5", "epoch": "P2", "x_det": 1020.0, "y_det": 1020.0, "wavelength_um": 4.120},
        {"exposure_id": "exp_out_1", "band": "D5", "epoch": "P1", "x_det": 1500.0, "y_det": 1500.0, "wavelength_um": 4.200},
        {"exposure_id": "exp_out_2", "band": "D5", "epoch": "P2", "x_det": 500.0, "y_det": 500.0, "wavelength_um": 3.950},
    ]

    res = filter_wavelength_matched_exposures(
        exposures,
        ra=target_ra,
        dec=target_dec,
        adaptive_window=False,
    )

    matched_ids = [e["exposure_id"] for e in res.matched_exposures]
    discarded_ids = [e["exposure_id"] for e in res.discarded_exposures]

    assert matched_ids == ["exp_in_1", "exp_in_2"]
    assert set(discarded_ids) == {"exp_out_1", "exp_out_2"}
    assert res.total_matched == 2
    assert res.total_discarded == 2

    prov = res.band_provenance["D5"]
    assert prov.is_adaptive_widened is False
    assert prov.resolving_power == 110.0
    assert abs(prov.nominal_half_width - (1.0 / 110.0)) < 1e-6
    assert abs(prov.window_half_width - (1.0 / 110.0)) < 1e-6
    assert prov.badge == "[NASA Benchmark (Pre-cached)]"
    assert prov.matched_count == 2
    assert prov.discarded_count == 2


def test_filter_wavelength_matched_adaptive_widening():
    """Verify adaptive widening triggers when an available epoch has zero matching exposures."""
    target_ra = 164.70559
    target_dec = 29.13890

    # Band D6: R = 130 -> w_b_nom = 1 / 130 = 0.00769 (~0.77%)
    # Epoch P1 has exposures clustered around reference 4.700 um (offset ~0.000)
    # Epoch P2 only has exposure at 4.780 um (offset = 0.080 / 4.700 = 0.01702 = ~2.21 / R)
    exposures = [
        {"exposure_id": "exp_p1_a", "band": "D6", "epoch": "P1", "x_det": 1000.0, "y_det": 1000.0, "wavelength_um": 4.700},
        {"exposure_id": "exp_p1_b", "band": "D6", "epoch": "P1", "x_det": 1005.0, "y_det": 1005.0, "wavelength_um": 4.701},
        {"exposure_id": "exp_p2_offset", "band": "D6", "epoch": "P2", "x_det": 1100.0, "y_det": 1100.0, "wavelength_um": 4.780},
    ]

    # Without adaptive widening: Epoch P2 is discarded, only Epoch P1 exposures match
    res_strict = filter_wavelength_matched_exposures(
        exposures,
        ra=target_ra,
        dec=target_dec,
        adaptive_window=False,
        reference_wavelengths=4.700,
    )
    assert len(res_strict.matched_exposures) == 2
    matched_strict_ids = [e["exposure_id"] for e in res_strict.matched_exposures]
    assert "exp_p1_a" in matched_strict_ids
    assert "exp_p1_b" in matched_strict_ids
    assert "exp_p2_offset" not in matched_strict_ids
    assert res_strict.band_provenance["D6"].is_adaptive_widened is False
    assert res_strict.band_provenance["D6"].epoch_counts["P2"] == 0

    # With adaptive widening: Window widens to encompass Epoch P2
    res_adaptive = filter_wavelength_matched_exposures(
        exposures,
        ra=target_ra,
        dec=target_dec,
        adaptive_window=True,
        reference_wavelengths=4.700,
    )
    matched_ids = [e["exposure_id"] for e in res_adaptive.matched_exposures]
    assert "exp_p1_a" in matched_ids
    assert "exp_p1_b" in matched_ids
    assert "exp_p2_offset" in matched_ids
    assert len(matched_ids) == 3

    prov = res_adaptive.band_provenance["D6"]
    assert prov.is_adaptive_widened is True
    assert prov.window_half_width > prov.nominal_half_width
    assert "[Adaptive Window" in prov.badge
    assert prov.adaptive_warning is not None
    assert "[Adaptive Window" in prov.adaptive_warning
    assert prov.epoch_counts["P1"] >= 1
    assert prov.epoch_counts["P2"] >= 1


def test_filter_wavelength_matched_multi_band_isolation():
    """Verify that multiple detector bands are grouped and evaluated in strict isolation."""
    target_ra = 164.70559
    target_dec = 29.13890

    exposures = [
        # D1 exposures (~0.92 um, R=41)
        {"exposure_id": "d1_exp1", "band": "D1", "epoch": "P1", "x_det": 1000.0, "y_det": 1000.0, "wavelength_um": 0.920},
        {"exposure_id": "d1_exp2", "band": "D1", "epoch": "P2", "x_det": 1010.0, "y_det": 1010.0, "wavelength_um": 0.925},
        # D2 exposures (~1.35 um, R=45)
        {"exposure_id": "d2_exp1", "band": "D2", "epoch": "P1", "x_det": 1000.0, "y_det": 1000.0, "wavelength_um": 1.350},
        {"exposure_id": "d2_exp2", "band": "D2", "epoch": "P2", "x_det": 1010.0, "y_det": 1010.0, "wavelength_um": 1.360},
    ]

    res = filter_wavelength_matched_exposures(exposures, ra=target_ra, dec=target_dec)
    assert res.total_matched == 4
    assert res.total_discarded == 0
    assert set(res.band_provenance.keys()) == {"D1", "D2"}

    assert abs(res.band_provenance["D1"].reference_wavelength_um - 0.9225) < 1e-4
    assert abs(res.band_provenance["D2"].reference_wavelength_um - 1.3550) < 1e-4
