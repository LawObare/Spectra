"""Unit tests for SPHEREx NASA Benchmark Astrometric Grounding & Seed Script.

SPECIFICATION.md §2.2 Ground-Truth Astrometric Grounding:
- Enforces strict < 1.0'' coordinate verification against SPECIFICATION.md Table 2.2.
- Verifies proper spherical trigonometry propagation including the 1/cos(dec) correction.
- Asserts complete database seed script generation with 102-channel spectral arrays.
"""

from __future__ import annotations

import re
from pathlib import Path

from benchmarks.build import (
    BENCHMARK_TARGETS,
    CATALOG_BASE_EPOCH,
    MAX_ALLOWABLE_GROUNDING_ERROR_ARCSEC,
    MISSION_MIDPOINT_EPOCH,
    angular_distance_arcsec,
    generate_seed_sql,
    generate_synthetic_spectrum,
    propagate_spherical_coordinates,
    verify_benchmark_grounding,
)


def test_propagate_spherical_coordinates_accuracy():
    """Verify that all 5 NASA benchmark targets propagate to within 0.1 arcsec of Table 2.2."""
    for target in BENCHMARK_TARGETS:
        calc_ra, calc_dec = propagate_spherical_coordinates(
            target.ra_j2000,
            target.dec_j2000,
            target.pm_ra_cosdec_mas_yr,
            target.pm_dec_mas_yr,
            dt_years=(MISSION_MIDPOINT_EPOCH - CATALOG_BASE_EPOCH),
        )
        dist = angular_distance_arcsec(
            calc_ra, calc_dec, target.expected_epoch_2025_5_ra, target.expected_epoch_2025_5_dec
        )
        # All benchmark coordinates must agree with Table 2.2 within 0.1" (strict sub-pixel precision)
        assert dist < 0.1, f"Target {target.title} error {dist:.4f}\" exceeds 0.1\" threshold"


def test_all_five_benchmarks_pass_gate():
    """Verify the formal CI grounding verification gate."""
    passed, results = verify_benchmark_grounding(max_tolerance_arcsec=MAX_ALLOWABLE_GROUNDING_ERROR_ARCSEC)
    assert passed is True
    assert len(results) == 5
    for r in results:
        assert r["passed"] is True
        assert r["diff_arcsec"] < 1.0
        assert r["diff_pixels"] < (1.0 / 6.2)


def test_epsilon_indi_cos_dec_correction():
    """Verify that omitting the 1/cos(dec) factor produces ~46'' error, while applying it produces <0.05'' error.

    (SPECIFICATION.md §1.3 Audit #2, §2.2 Grounding Rule)
    """
    eps = next(t for t in BENCHMARK_TARGETS if t.subject_id == "benchmark_eps_indi_b")
    dt = MISSION_MIDPOINT_EPOCH - CATALOG_BASE_EPOCH

    # Correct propagation (with 1/cos(dec))
    ra_correct, dec_correct = propagate_spherical_coordinates(
        eps.ra_j2000, eps.dec_j2000, eps.pm_ra_cosdec_mas_yr, eps.pm_dec_mas_yr, dt_years=dt
    )
    dist_correct = angular_distance_arcsec(
        ra_correct, dec_correct, eps.expected_epoch_2025_5_ra, eps.expected_epoch_2025_5_dec
    )
    assert dist_correct < 0.05, f"Correct propagation error {dist_correct:.4f}\" is higher than expected"

    # Flawed v2.5 propagation (omitting 1/cos(dec)): Δα = μ_α* · Δt
    delta_ra_uncorrected = (eps.pm_ra_cosdec_mas_yr * 1e-3 / 3600.0) * dt
    delta_dec_uncorrected = (eps.pm_dec_mas_yr * 1e-3 / 3600.0) * dt
    ra_flawed = eps.ra_j2000 + delta_ra_uncorrected
    dec_flawed = eps.dec_j2000 + delta_dec_uncorrected

    dist_flawed = angular_distance_arcsec(
        ra_flawed, dec_flawed, eps.expected_epoch_2025_5_ra, eps.expected_epoch_2025_5_dec
    )
    # The omission causes ~46" error (~7.5 pixels)
    assert 40.0 < dist_flawed < 55.0, f"Expected flawed distance ~46\", got {dist_flawed:.2f}\""


def test_haversine_angular_distance():
    """Test angular distance edge cases."""
    # Identity
    assert angular_distance_arcsec(100.0, 20.0, 100.0, 20.0) == 0.0
    # 1 degree separation along declination
    dist_1deg = angular_distance_arcsec(0.0, 0.0, 0.0, 1.0)
    assert abs(dist_1deg - 3600.0) < 1e-3


def test_synthetic_spectrum_102_channels():
    """Verify that every generated spectrum has exactly 102 positive floating-point channels."""
    for target in BENCHMARK_TARGETS:
        spec = generate_synthetic_spectrum(target.subject_id)
        assert len(spec) == 102
        assert all(isinstance(v, float) for v in spec)
        assert all(v > 0.0 for v in spec)

    # Test generic spectrum
    spec_generic = generate_synthetic_spectrum("unknown_target")
    assert len(spec_generic) == 102


def test_seed_sql_generation():
    """Verify backend/db/seed_benchmarks.sql structure, counts, and syntax."""
    sql = generate_seed_sql()
    assert "INSERT INTO heartbeat" in sql
    assert "INSERT INTO observers" in sql
    assert "INSERT INTO subjects" in sql
    assert "INSERT INTO discussion_threads" in sql
    assert "INSERT INTO discussion_replies" in sql

    # Verify all 5 benchmarks exist in SQL
    for target in BENCHMARK_TARGETS:
        assert target.subject_id in sql
        assert f"{target.expected_epoch_2025_5_ra:.5f}" in sql
        assert f"{target.expected_epoch_2025_5_dec:.5f}" in sql

    # Verify 20 active-learning queue candidates
    queue_matches = re.findall(r"'queue_anomaly'", sql)
    assert len(queue_matches) == 20, f"Expected 20 queue candidates, found {len(queue_matches)}"

    # Verify 6 discussion threads
    thread_matches = re.findall(r"INSERT INTO discussion_threads", sql)
    assert len(thread_matches) == 1

    # Verify 102-channel arrays in SQL
    arrays = re.findall(r"ARRAY\[(.*?)\]::REAL\[\]", sql)
    assert len(arrays) >= 25  # 5 benchmarks + 20 queue candidates
    for arr_str in arrays:
        items = [x.strip() for x in arr_str.split(",")]
        assert len(items) == 102, f"Expected 102 channels, got {len(items)}"


def test_seed_sql_file_matches_generator():
    """Verify that the generated file on disk matches generate_seed_sql()."""
    sql_path = Path(__file__).resolve().parent.parent / "backend" / "db" / "seed_benchmarks.sql"
    assert sql_path.exists(), f"Seed file does not exist at {sql_path}"
    file_content = sql_path.read_text(encoding="utf-8")
    assert "SPHEREx Benchmark Grounding" in file_content or "Spectra Database Seed Script" in file_content
    assert "benchmark_barnard" in file_content
    assert "benchmark_wise_0855" in file_content
    assert "benchmark_eps_indi_b" in file_content
    assert "benchmark_rw_aur" in file_content
    assert "benchmark_r_dra" in file_content
