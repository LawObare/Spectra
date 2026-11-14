"""Spectra NASA Benchmark Grounding Verification & Coordinate Propagation Engine.

Implements SPECIFICATION.md §2.2 Ground-Truth Coordinate Propagation & CI Grounding Check:
- Propagates J2000.0 positions to SPHEREx mission midpoint Epoch 2025.5:
    Δα = (μ_α* · Δt) / cos(δ_0)
    Δδ = μ_δ · Δt
- Enforces strict < 1.0'' (0.16 px at 6.2''/px) astrometric verification against
  SPECIFICATION.md Table 2.2 and Gaia DR3 / CDS Sesame standards.
- Pre-seeds canonical metadata for the 5 NASA Benchmark Targets:
    1. Barnard's Star (M4V high proper motion dwarf)
    2. WISE 0855-0714 (Y4 sub-brown dwarf)
    3. Epsilon Indi B (T1+T6 brown dwarf binary with 1/cos(dec) correction)
    4. RW Aurigae (Classical T Tauri star with protoplanetary disk)
    5. R Draconis (Mira AGB variable near NEP)
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Exact ground-truth constants from SPECIFICATION.md §2.2
MISSION_MIDPOINT_EPOCH = 2025.5
CATALOG_BASE_EPOCH = 2000.0
PIXEL_SCALE_ARCSEC = 6.2
MAX_ALLOWABLE_GROUNDING_ERROR_ARCSEC = 1.0  # < 1.0'' (0.16 px) strict CI gate


@dataclass(frozen=True)
class BenchmarkDefinition:
    subject_id: str
    title: str
    object_class: str
    ra_j2000: float  # deg (ICRS)
    dec_j2000: float  # deg (ICRS)
    pm_ra_cosdec_mas_yr: float  # mas/yr (μ_α* = μ_α · cos(δ))
    pm_dec_mas_yr: float  # mas/yr (μ_δ)
    expected_epoch_2025_5_ra: float  # deg (ICRS Table 2.2)
    expected_epoch_2025_5_dec: float  # deg (ICRS Table 2.2)
    parallax_mas: float
    radial_velocity_km_s: float
    recommended_tab: str
    preset: str
    fov_arcsec: float
    description: str
    expert_ground_truth: str
    ai_predicted_class: str
    ai_anomaly_score: float
    ice_column_densities: dict[str, float]


# Authoritative 5 NASA Benchmark Targets from SPECIFICATION.md Table 2.2
BENCHMARK_TARGETS: list[BenchmarkDefinition] = [
    BenchmarkDefinition(
        subject_id="benchmark_barnard",
        title="Barnard's Star",
        object_class="M4V Red Dwarf",
        ra_j2000=269.45208,
        dec_j2000=4.69336,
        pm_ra_cosdec_mas_yr=-801.60,
        pm_dec_mas_yr=10362.40,
        expected_epoch_2025_5_ra=269.44639,
        expected_epoch_2025_5_dec=4.76676,
        parallax_mas=546.98,
        radial_velocity_km_s=-110.5,
        recommended_tab="comparator",
        preset="true_nir",
        fov_arcsec=180.0,
        description="M4V high proper motion (+10.39\"/yr North, 1.68 px/yr along PA 355.6°)",
        expert_ground_truth="M4V Red Dwarf",
        ai_predicted_class="high_proper_motion_star",
        ai_anomaly_score=0.92,
        ice_column_densities={},
    ),
    BenchmarkDefinition(
        subject_id="benchmark_wise_0855",
        title="WISE 0855-0714",
        object_class="Y4 Sub-Brown Dwarf",
        ra_j2000=133.79513,
        dec_j2000=-7.24515,
        pm_ra_cosdec_mas_yr=-8123.70,
        pm_dec_mas_yr=673.20,
        expected_epoch_2025_5_ra=133.73712,
        expected_epoch_2025_5_dec=-7.24038,
        parallax_mas=433.0,
        radial_velocity_km_s=0.0,
        recommended_tab="comparator",
        preset="brown_dwarf",
        fov_arcsec=180.0,
        description="Y4 sub-brown dwarf (8.15\"/yr West along PA 274.7°, thermal peak in D5/D6)",
        expert_ground_truth="Y4 Sub-Brown Dwarf",
        ai_predicted_class="moving_brown_dwarf",
        ai_anomaly_score=0.98,
        ice_column_densities={},
    ),
    BenchmarkDefinition(
        subject_id="benchmark_eps_indi_b",
        title="Epsilon Indi B",
        object_class="T1 + T6 Brown Dwarf Binary",
        ra_j2000=331.04415,
        dec_j2000=-56.78284,
        pm_ra_cosdec_mas_yr=3982.00,
        pm_dec_mas_yr=-2466.80,
        expected_epoch_2025_5_ra=331.09566,
        expected_epoch_2025_5_dec=-56.80031,
        parallax_mas=275.8,
        radial_velocity_km_s=-40.0,
        recommended_tab="spectrophotometer",
        preset="brown_dwarf",
        fov_arcsec=180.0,
        description="T1+T6 binary (4.68\"/yr SE along PA 121.8°, 1/cos(dec) astrometric test)",
        expert_ground_truth="T1+T6 Brown Dwarf Binary",
        ai_predicted_class="moving_brown_dwarf",
        ai_anomaly_score=0.89,
        ice_column_densities={},
    ),
    BenchmarkDefinition(
        subject_id="benchmark_rw_aur",
        title="RW Aurigae",
        object_class="Classical T Tauri Star",
        ra_j2000=76.95646,
        dec_j2000=30.40144,
        pm_ra_cosdec_mas_yr=1.40,
        pm_dec_mas_yr=-20.60,
        expected_epoch_2025_5_ra=76.95647,
        expected_epoch_2025_5_dec=30.40130,
        parallax_mas=6.14,
        radial_velocity_km_s=15.8,
        recommended_tab="comparator",
        preset="comet_outgassing",
        fov_arcsec=180.0,
        description="Classical T Tauri star with circumstellar occultation dimming (>1.5 mag)",
        expert_ground_truth="Classical T Tauri Star",
        ai_predicted_class="variable_star",
        ai_anomaly_score=0.85,
        ice_column_densities={"H2O": 1.2e17, "CO": 3.4e16},
    ),
    BenchmarkDefinition(
        subject_id="benchmark_r_dra",
        title="R Draconis",
        object_class="Mira-type Pulsating AGB Variable",
        ra_j2000=248.16763,
        dec_j2000=66.75497,
        pm_ra_cosdec_mas_yr=6.10,
        pm_dec_mas_yr=9.80,
        expected_epoch_2025_5_ra=248.16773,
        expected_epoch_2025_5_dec=66.75504,
        parallax_mas=1.48,
        radial_velocity_km_s=-18.0,
        recommended_tab="spectrophotometer",
        preset="water_ice",
        fov_arcsec=180.0,
        description="Mira AGB variable (P=245d pulsation cycle, 8.61° from NEP)",
        expert_ground_truth="Mira-type Pulsating AGB Variable",
        ai_predicted_class="pulsating_variable",
        ai_anomaly_score=0.82,
        ice_column_densities={"H2O": 8.5e16, "CO2": 2.1e16},
    ),
]


def propagate_spherical_coordinates(
    ra_deg: float,
    dec_deg: float,
    pm_ra_cosdec_mas_yr: float,
    pm_dec_mas_yr: float,
    dt_years: float = (MISSION_MIDPOINT_EPOCH - CATALOG_BASE_EPOCH),
) -> tuple[float, float]:
    """Propagate spherical coordinates from base epoch using standard spherical proper motion.

    Formula (SPECIFICATION.md §2.2):
        Δα = (μ_α* · Δt) / cos(δ_0)
        Δδ = μ_δ · Δt
    Where μ_α* = μ_α · cos(δ_0).
    """
    dec_rad = math.radians(dec_deg)
    cos_dec = math.cos(dec_rad)
    if abs(cos_dec) < 1e-10:
        raise ValueError(f"Coordinate too close to celestial pole: dec={dec_deg}")

    delta_ra_deg = (pm_ra_cosdec_mas_yr * 1e-3 / 3600.0 / cos_dec) * dt_years
    delta_dec_deg = (pm_dec_mas_yr * 1e-3 / 3600.0) * dt_years

    new_ra = (ra_deg + delta_ra_deg) % 360.0
    new_dec = dec_deg + delta_dec_deg

    return new_ra, new_dec


def propagate_astropy_coordinates(
    target: BenchmarkDefinition,
    target_epoch: float = MISSION_MIDPOINT_EPOCH,
) -> tuple[float, float]:
    """Propagate coordinates using astropy.coordinates.SkyCoord.apply_space_motion if available."""
    try:
        import astropy.units as u
        from astropy.coordinates import SkyCoord
        from astropy.time import Time

        coord = SkyCoord(
            ra=target.ra_j2000 * u.deg,
            dec=target.dec_j2000 * u.deg,
            pm_ra_cosdec=target.pm_ra_cosdec_mas_yr * u.mas / u.yr,
            pm_dec=target.pm_dec_mas_yr * u.mas / u.yr,
            distance=(1000.0 / target.parallax_mas) * u.pc if target.parallax_mas > 0 else None,
            radial_velocity=target.radial_velocity_km_s * u.km / u.s,
            obstime=Time(f"J{CATALOG_BASE_EPOCH:.1f}"),
        )
        propagated = coord.apply_space_motion(new_obstime=Time(f"J{target_epoch:.1f}"))
        return float(propagated.ra.deg), float(propagated.dec.deg)
    except (ImportError, ValueError, AttributeError, TypeError):
        # Fallback to analytical spherical propagation
        dt = target_epoch - CATALOG_BASE_EPOCH
        return propagate_spherical_coordinates(
            target.ra_j2000,
            target.dec_j2000,
            target.pm_ra_cosdec_mas_yr,
            target.pm_dec_mas_yr,
            dt_years=dt,
        )


def angular_distance_arcsec(ra1_deg: float, dec1_deg: float, ra2_deg: float, dec2_deg: float) -> float:
    """Calculate great-circle angular separation in arcseconds between two coordinates."""
    r1, d1 = math.radians(ra1_deg), math.radians(dec1_deg)
    r2, d2 = math.radians(ra2_deg), math.radians(dec2_deg)

    d_ra = r2 - r1
    d_dec = d2 - d1

    # Haversine formula
    a = math.sin(d_dec / 2.0) ** 2 + math.cos(d1) * math.cos(d2) * math.sin(d_ra / 2.0) ** 2
    a = min(1.0, max(0.0, a))
    angular_dist_rad = 2.0 * math.asin(math.sqrt(a))

    return math.degrees(angular_dist_rad) * 3600.0


def verify_benchmark_grounding(
    max_tolerance_arcsec: float = MAX_ALLOWABLE_GROUNDING_ERROR_ARCSEC,
) -> tuple[bool, list[dict[str, Any]]]:
    """Verify that all 5 NASA benchmark targets match SPECIFICATION.md Table 2.2 within tolerance.

    Returns:
        (all_passed, results_list)
    """
    results = []
    all_passed = True

    for target in BENCHMARK_TARGETS:
        # 1. Analytical propagation
        calc_ra, calc_dec = propagate_spherical_coordinates(
            target.ra_j2000,
            target.dec_j2000,
            target.pm_ra_cosdec_mas_yr,
            target.pm_dec_mas_yr,
            dt_years=(MISSION_MIDPOINT_EPOCH - CATALOG_BASE_EPOCH),
        )

        # 2. Angular separation from SPECIFICATION Table 2.2 ground truth
        dist_arcsec = angular_distance_arcsec(
            calc_ra, calc_dec, target.expected_epoch_2025_5_ra, target.expected_epoch_2025_5_dec
        )
        dist_px = dist_arcsec / PIXEL_SCALE_ARCSEC

        passed = dist_arcsec <= max_tolerance_arcsec
        if not passed:
            all_passed = False

        results.append({
            "target": target.title,
            "subject_id": target.subject_id,
            "j2000": (target.ra_j2000, target.dec_j2000),
            "calculated_2025_5": (round(calc_ra, 5), round(calc_dec, 5)),
            "expected_2025_5": (target.expected_epoch_2025_5_ra, target.expected_epoch_2025_5_dec),
            "diff_arcsec": round(dist_arcsec, 4),
            "diff_pixels": round(dist_px, 4),
            "passed": passed,
        })

    return all_passed, results


def generate_synthetic_spectrum(target_id: str) -> list[float]:
    """Generate 102-channel flux array in MJy/sr calibrated for the target profile."""
    # 102 channels from 0.75 um to 5.00 um
    channels = 102
    spectrum = [0.0] * channels

    for i in range(channels):
        lam = 0.75 + i * (5.00 - 0.75) / (channels - 1)
        if target_id == "benchmark_barnard":
            # M4V dwarf: peak in near-IR ~ 1.0-1.6 um, declining to 5 um
            bb = (lam / 1.2) ** (-2.5) * math.exp(-((lam - 1.2) ** 2) / 0.8)
            spectrum[i] = round(max(0.01, bb * 12.5), 4)
        elif target_id == "benchmark_wise_0855":
            # Y4 sub-brown dwarf: faint/non-detected < 3.5 um, strong CH4 absorption, steep D5/D6 peak
            if lam < 3.8:
                flux = 0.005 + 0.002 * math.sin(i)
            else:
                # Strong peak around 4.5 - 4.8 um
                flux = 0.01 + 0.45 * math.exp(-((lam - 4.65) ** 2) / 0.08)
            spectrum[i] = round(max(0.001, flux), 4)
        elif target_id == "benchmark_eps_indi_b":
            # T1+T6 binary: methane and water absorption bands at 1.15, 1.4, 1.9 um
            base = 1.8 * (lam / 1.6) ** (-1.8)
            absorption = (
                0.6 * math.exp(-((lam - 1.4) ** 2) / 0.02)
                + 0.7 * math.exp(-((lam - 1.9) ** 2) / 0.03)
                + 0.5 * math.exp(-((lam - 3.3) ** 2) / 0.04)
            )
            spectrum[i] = round(max(0.02, base * (1.0 - absorption)), 4)
        elif target_id == "benchmark_rw_aur":
            # T Tauri: infrared excess from protoplanetary disk, flatter continuum
            base = 4.2 * (lam / 2.0) ** (-1.1)
            dust_bump = 0.8 * math.exp(-((lam - 3.5) ** 2) / 0.5)
            spectrum[i] = round(max(0.05, base + dust_bump), 4)
        elif target_id == "benchmark_r_dra":
            # Mira AGB: cool variable with strong molecular TiO/CO bands
            pulsation = 8.5 * math.exp(-((lam - 2.2) ** 2) / 1.2)
            co_band = 0.4 * math.exp(-((lam - 4.67) ** 2) / 0.05)
            spectrum[i] = round(max(0.05, pulsation * (1.0 - co_band)), 4)
        else:
            spectrum[i] = round(1.0 + 0.2 * math.sin(i * 0.1), 4)

    return spectrum


def format_sql_array(arr: list[float]) -> str:
    """Format python float list as PostgreSQL REAL[] literal."""
    vals = ", ".join(f"{v:.4f}" for v in arr)
    return f"ARRAY[{vals}]::REAL[]"


def generate_seed_sql() -> str:
    """Generate complete backend/db/seed_benchmarks.sql script."""
    sql_lines = [
        "-- ============================================================================",
        "-- Spectra Database Seed Script (Supabase PostgreSQL 16)",
        "-- Populates 5 NASA Benchmark Targets at Epoch 2025.5, Active Learning Queue,",
        "-- Sample Observer Profiles, and Observation Discussion Threads.",
        "-- SPECIFICATION.md §2.2, §5.1, §9.2",
        "-- ============================================================================",
        "",
        "-- 0. Telemetry Heartbeat",
        "INSERT INTO heartbeat (id, last_ping, irsa_status, active_workers)",
        "VALUES (1, NOW(), 'operational', 1)",
        "ON CONFLICT (id) DO UPDATE SET last_ping = EXCLUDED.last_ping, irsa_status = EXCLUDED.irsa_status;",
        "",
        "-- 1. Seed Observer Profiles (Zero-Auth Cryptographic Session Fingerprints)",
        "INSERT INTO observers (observer_id, key_hash, handle, total_classifications, calibration_seen, calibration_correct, reliability_weight)",
        "VALUES",
        "    ('00000000-0000-0000-0000-000000000001', encode(sha256('system_moderator_key'::bytea), 'hex'), 'SPHEREx-Moderator', 250, 250, 250, 1.00),",
        "    ('11111111-1111-1111-1111-111111111111', encode(sha256('observer_vega_409'::bytea), 'hex'), 'Observer-Vega-409', 42, 10, 9, 0.95),",
        "    ('22222222-2222-2222-2222-222222222222', encode(sha256('observer_orion_112'::bytea), 'hex'), 'Observer-Orion-112', 31, 8, 7, 0.88),",
        "    ('33333333-3333-3333-3333-333333333333', encode(sha256('observer_cygnus_774'::bytea), 'hex'), 'Observer-Cygnus-774', 58, 14, 13, 0.92),",
        "    ('44444444-4444-4444-4444-444444444444', encode(sha256('observer_draco_052'::bytea), 'hex'), 'Observer-Draco-052', 19, 5, 4, 0.83),",
        "    ('55555555-5555-5555-5555-555555555555', encode(sha256('observer_cassiopeia_318'::bytea), 'hex'), 'Observer-Cassiopeia-318', 27, 6, 5, 0.86)",
        "ON CONFLICT (observer_id) DO UPDATE SET",
        "    handle = EXCLUDED.handle,",
        "    reliability_weight = EXCLUDED.reliability_weight;",
        "",
        "-- 2. The 5 Mandatory NASA Benchmark Targets (Epoch 2025.5 Ground Truth)",
    ]

    for target in BENCHMARK_TARGETS:
        spec = generate_synthetic_spectrum(target.subject_id)
        spec_sql = format_sql_array(spec)
        ice_json = json.dumps(target.ice_column_densities)
        ai_probs = json.dumps({target.ai_predicted_class: 0.92, "other": 0.08})
        title_esc = target.title.replace("'", "''")
        exp_esc = target.description.replace("'", "''")
        ground_esc = target.expert_ground_truth.replace("'", "''")

        sql_lines.extend([
            f"-- Target: {target.title}",
            "INSERT INTO subjects (",
            "    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,",
            "    is_calibration, expert_ground_truth, spectrum_array, redshift_z,",
            "    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,",
            "    ai_explanation, classification_count, consensus_class, consensus_score,",
            "    shannon_entropy, verification_status, data_release",
            ") VALUES (",
            f"    '{target.subject_id}', '{title_esc}', 'benchmark',",
            f"    {target.expected_epoch_2025_5_ra:.5f}, {target.expected_epoch_2025_5_dec:.5f}, {target.fov_arcsec}, '{target.recommended_tab}',",
            f"    TRUE, '{ground_esc}', {spec_sql}, 0.0,",
            f"    '{ice_json}'::jsonb, {target.ai_anomaly_score}, '{target.ai_predicted_class}', '{ai_probs}'::jsonb,",
            f"    '{exp_esc}', 12, '{target.ai_predicted_class}', 0.95,",
            "    0.15, 'verified_discovery', 'spherex_qr2'",
            ") ON CONFLICT (subject_id) DO UPDATE SET",
            "    ra = EXCLUDED.ra,",
            "    dec = EXCLUDED.dec,",
            "    recommended_tab = EXCLUDED.recommended_tab,",
            "    spectrum_array = EXCLUDED.spectrum_array;",
            "",
        ])

    # 20 Active-Learning Queue Candidates (SPECIFICATION.md §9.2)
    sql_lines.append("-- 3. Active-Learning Queue Candidates (20 Distributed Science Targets)")
    queue_candidates = [
        # 8 High Proper Motion / Brown Dwarf Movers
        ("spx_j032541-112045", "SPX J0325-1120", "comparator", 51.4231, -11.3458, 120.0, "moving_brown_dwarf", 0.94, 1.45, 0.0),
        ("spx_j051219+214402", "SPX J0512+2144", "comparator", 78.0812, 21.7341, 150.0, "moving_brown_dwarf", 0.88, 1.62, 0.0),
        ("spx_j091402-085521", "SPX J0914-0855", "comparator", 138.5089, -8.9225, 120.0, "moving_brown_dwarf", 0.91, 1.25, 0.0),
        ("spx_j110455+381209", "SPX J1104+3812", "comparator", 166.2301, 38.2025, 150.0, "high_proper_motion_star", 0.82, 1.10, 0.0),
        ("spx_j145520-421105", "SPX J1455-4211", "comparator", 223.8354, -42.1848, 180.0, "moving_brown_dwarf", 0.89, 1.35, 0.0),
        ("spx_j180211+094412", "SPX J1802+0944", "comparator", 270.5482, 9.7367, 120.0, "high_proper_motion_star", 0.85, 1.15, 0.0),
        ("spx_j211944-301255", "SPX J2119-3012", "comparator", 319.9342, -30.2153, 150.0, "moving_brown_dwarf", 0.93, 1.70, 0.0),
        ("spx_j234812+012019", "SPX J2348+0120", "comparator", 357.0504, 1.3386, 120.0, "moving_brown_dwarf", 0.87, 1.40, 0.0),
        # 6 Variable Stars & Eclipsing Binaries
        ("spx_j021533+412055", "SPX J0215+4120", "spectrophotometer", 33.8875, 41.3486, 180.0, "variable_star", 0.78, 0.95, 0.0),
        ("spx_j064512-164258", "SPX J0645-1642", "comparator", 101.3000, -16.7161, 180.0, "pulsating_variable", 0.84, 1.20, 0.0),
        ("spx_j122906+020308", "SPX J1229+0203", "spectrophotometer", 187.2750, 2.0522, 180.0, "variable_star", 0.72, 0.88, 0.0),
        ("spx_j160522-241519", "SPX J1605-2415", "comparator", 241.3417, -24.2553, 150.0, "variable_star", 0.76, 1.05, 0.0),
        ("spx_j192518+424701", "SPX J1925+4247", "spectrophotometer", 291.3250, 42.7836, 180.0, "pulsating_variable", 0.81, 1.15, 0.0),
        ("spx_j205611+445520", "SPX J2056+4455", "comparator", 314.0458, 44.9222, 180.0, "variable_star", 0.75, 0.90, 0.0),
        # 4 Interstellar Ice / SPLICES Point-Source Background Stars
        ("spx_splices_0142", "SPLICES J1627-2430", "ice_studio", 246.7500, -24.5000, 180.0, "ice_background_star", 0.86, 1.30, 0.0),
        ("spx_splices_0588", "SPLICES J1810-1802", "ice_studio", 272.5000, -18.0333, 180.0, "ice_background_star", 0.90, 1.55, 0.0),
        ("spx_splices_0912", "SPLICES J2039+4219", "ice_studio", 309.7500, 42.3167, 180.0, "ice_background_star", 0.84, 1.25, 0.0),
        ("spx_splices_1140", "SPLICES J0431+1808", "ice_studio", 67.7500, 18.1333, 180.0, "ice_background_star", 0.88, 1.40, 0.0),
        # 2 Distant Galaxy Photo-z Candidates
        ("spx_gal_0332", "SPX Galaxy 0332-2748", "spectrophotometer", 53.1167, -27.8083, 180.0, "galaxy", 0.81, 1.65, 0.85),
        ("spx_gal_1236", "SPX Galaxy 1236+6214", "spectrophotometer", 189.2000, 62.2333, 180.0, "galaxy", 0.83, 1.50, 1.24),
    ]

    for sid, title, tab, ra, dec, fov, pclass, anom, entropy, z in queue_candidates:
        spec = [round(0.5 + 0.3 * math.sin((i + ra) * 0.1), 4) for i in range(102)]
        spec_sql = format_sql_array(spec)
        ice_dict = {}
        if tab == "ice_studio":
            ice_dict = {"H2O": 1.5e17, "CO2": 3.8e16, "CO": 8.2e15}
        ice_json = json.dumps(ice_dict)
        ai_probs = json.dumps({pclass: 0.80, "artifact": 0.20})

        sql_lines.extend([
            "INSERT INTO subjects (",
            "    subject_id, title, category, ra, dec, fov_arcsec, recommended_tab,",
            "    is_calibration, expert_ground_truth, spectrum_array, redshift_z,",
            "    ice_column_densities, ai_anomaly_score, ai_predicted_class, ai_probabilities,",
            "    ai_explanation, classification_count, shannon_entropy, verification_status, data_release",
            ") VALUES (",
            f"    '{sid}', '{title}', 'queue_anomaly', {ra:.4f}, {dec:.4f}, {fov:.1f}, '{tab}',",
            f"    FALSE, NULL, {spec_sql}, {z:.2f},",
            f"    '{ice_json}'::jsonb, {anom:.2f}, '{pclass}', '{ai_probs}'::jsonb,",
            f"    'Active-learning anomaly queued for citizen verification (Shannon entropy = {entropy:.2f}).', 0, {entropy:.2f}, 'pending', 'spherex_qr2'",
            ") ON CONFLICT (subject_id) DO NOTHING;",
        ])

    sql_lines.extend([
        "",
        "-- 4. Observation Discussion Threads (Tab 5 Sample Community Discussions)",
        "INSERT INTO discussion_threads (",
        "    subject_id, author_id, author_handle, channel, title,",
        "    body, hashtags, ra, dec, fov_arcsec, state_query, preview_metrics, upvotes, moderator_verified, admin_verification_note",
        ") VALUES",
        "    (",
        "        'benchmark_barnard', '00000000-0000-0000-0000-000000000001', 'SPHEREx-Moderator', 'movers',",
        "        'Confirmed +10.39\"/yr proper motion on Barnard''s Star',",
        "        'Official SPHEREx verification note: Barnard''s Star (M4V) exhibits unmistakable North-directed dipole motion across survey passes (+1.68 px/yr). Wavelength-matched differencing cleanly eliminates false LVF smile residuals.',",
        "        '[\"#benchmark\", \"#high-proper-motion\", \"#red-dwarf\", \"#verified\"]'::jsonb,",
        "        269.44639, 4.76676, 180.0, 'tab=comparator&ra=269.44639&dec=4.76676&fov=180&mode=diff&preset=true_nir',",
        "        '{\"pm_arcsec_yr\": 10.39, \"snr\": 48.2, \"pa_deg\": 355.6}'::jsonb, 15, TRUE, 'Verified by SPHEREx Mission Calibration Lead'",
        "    ),",
        "    (",
        "        'benchmark_wise_0855', '11111111-1111-1111-1111-111111111111', 'Observer-Vega-409', 'movers',",
        "        'Faint thermal dipole in D5/D6 coadds for cold brown dwarf WISE 0855',",
        "        'Examined the inverse-variance coadd of Bands D5 and D6. As predicted, this sub-brown dwarf (T_eff ~ 250K) is completely invisible in Bands D1-D3 but clearly translates West at 8.15\"/yr in the longer wavelengths.',",
        "        '[\"#brown-dwarf\", \"#cold-y-dwarf\", \"#coadd\", \"#wise0855\"]'::jsonb,",
        "        133.73712, -7.24038, 180.0, 'tab=comparator&ra=133.73712&dec=-7.24038&fov=180&mode=diff&preset=brown_dwarf',",
        "        '{\"pm_arcsec_yr\": 8.15, \"snr\": 7.4, \"pa_deg\": 274.7}'::jsonb, 11, FALSE, NULL",
        "    ),",
        "    (",
        "        'benchmark_eps_indi_b', '22222222-2222-2222-2222-222222222222', 'Observer-Orion-112', 'spectra',",
        "        'Composite T1+T6 spectral de-blending for Epsilon Indi B',",
        "        'Loaded Epsilon Indi B in Tab 3. Running the two-component NNLS unmixing solver shows textbook methane absorption at 1.4 um and 1.9 um matching the unresolved T1+T6 binary template.',",
        "        '[\"#spectral-unmixing\", \"#brown-dwarf-binary\", \"#methane\"]'::jsonb,",
        "        331.09566, -56.80031, 180.0, 'tab=spectrophotometer&ra=331.09566&dec=-56.80031&fov=180&preset=brown_dwarf',",
        "        '{\"t1_weight\": 0.62, \"t6_weight\": 0.38, \"nnls_residual\": 0.041}'::jsonb, 9, TRUE, 'Consistent with ESO VLT synthetic binary benchmarks'",
        "    ),",
        "    (",
        "        'benchmark_rw_aur', '33333333-3333-3333-3333-333333333333', 'Observer-Cygnus-774', 'discoveries',",
        "        'Severe occultation dimming event observed in RW Aurigae',",
        "        'Comparing Pass 1 against Pass 2 shows >1.6 mag dimming across all 6 detectors. Stationary monopole with circumstellar dust disk occultation.',",
        "        '[\"#t-tauri\", \"#disk-occultation\", \"#variability\"]'::jsonb,",
        "        76.95647, 30.40130, 180.0, 'tab=comparator&ra=76.95647&dec=30.40130&fov=180&mode=diff&preset=comet_outgassing',",
        "        '{\"delta_mag\": 1.62, \"is_stationary\": true}'::jsonb, 8, FALSE, NULL",
        "    ),",
        "    (",
        "        'benchmark_r_dra', '44444444-4444-4444-4444-444444444444', 'Observer-Draco-052', 'spectra',",
        "        'NEP Deep Field 245-day cycle validation on R Draconis',",
        "        'Located only 8.61 degrees from NEP, R Draconis has high pass cadence. Spectral light curve clearly traces the 245-day Mira pulsation cycle with massive CO overtone fluctuations.',",
        "        '[\"#mira-variable\", \"#agb-star\", \"#nep-deep-field\"]'::jsonb,",
        "        248.16773, 66.75504, 180.0, 'tab=spectrophotometer&ra=248.16773&dec=66.75504&fov=180&preset=water_ice',",
        "        '{\"period_days\": 245.2, \"co_depth\": 0.42}'::jsonb, 7, FALSE, NULL",
        "    ),",
        "    (",
        "        'spx_splices_0588', '00000000-0000-0000-0000-000000000001', 'SPHEREx-Moderator', 'ices',",
        "        'Deep 3.05 μm H2O and 4.27 μm CO2 interstellar ice absorption in SPLICES candidate',",
        "        'Pencil-beam optical depth integration toward background star SPLICES J1810-1802 reveals prominent water ice column density N(H2O) = 1.5e17 cm^-2 and CO2 column density N(CO2) = 3.8e16 cm^-2.',",
        "        '[\"#interstellar-ice\", \"#splices\", \"#optical-depth\", \"#astrochemistry\"]'::jsonb,",
        "        272.5000, -18.0333, 180.0, 'tab=ice_studio&ra=272.5000&dec=-18.0333&fov=180',",
        "        '{\"n_h2o\": 1.5e17, \"n_co2\": 3.8e16, \"co2_to_h2o\": 0.253}'::jsonb, 14, TRUE, 'Verified SPLICES dense cloud field candidate'",
        "    );",
        "",
        "-- 5. Sample Discussion Replies",
        "INSERT INTO discussion_replies (thread_id, author_id, author_handle, body, moderator_verified)",
        "VALUES",
        "    (1, '11111111-1111-1111-1111-111111111111', 'Observer-Vega-409', 'The cyan Frame-0 reference ring in Tab 2 makes this displacement immediately obvious!', FALSE),",
        "    (1, '00000000-0000-0000-0000-000000000001', 'SPHEREx-Moderator', 'Excellent observation. Note that the 1.68 px/yr motion aligns within 0.1 px of the Gaia DR3 astrometric prediction.', TRUE),",
        "    (2, '33333333-3333-3333-3333-333333333333', 'Observer-Cygnus-774', 'Confirming non-detection in D1-D3. The honest [Not Detected at Pass Depth] state is very clear.', FALSE),",
        "    (3, '00000000-0000-0000-0000-000000000001', 'SPHEREx-Moderator', 'Remember to check the 1/cos(dec) proper motion correction—v2.5 had a 46\" offset that is now resolved.', TRUE),",
        "    (4, '22222222-2222-2222-2222-222222222222', 'Observer-Orion-112', 'The aperture light curve in Tab 2 shows the sudden drop sharply.', FALSE),",
        "    (6, '55555555-5555-5555-5555-555555555555', 'Observer-Cassiopeia-318', 'Is the 4.38 μm 13CO2 shoulder detectable at this depth?', FALSE),",
        "    (6, '00000000-0000-0000-0000-000000000001', 'SPHEREx-Moderator', 'Yes, weak 13CO2 absorption is visible in the smoothed optical depth profile.', TRUE);",
        "",
    ])

    return "\n".join(sql_lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="SPHEREx Benchmark Grounding & Seed Builder")
    parser.add_argument("--verify", action="store_true", help="Run CI coordinate grounding check")
    parser.add_argument("--write-sql", action="store_true", help="Generate backend/db/seed_benchmarks.sql")
    parser.add_argument("--tolerance-arcsec", type=float, default=MAX_ALLOWABLE_GROUNDING_ERROR_ARCSEC)
    args = parser.parse_args()

    # Default action: verify and write SQL if not explicitly specified
    do_write = args.write_sql or (not args.verify)

    print("=" * 80)
    print("SPHEREx Benchmark Grounding & Astrometric Verification (SPECIFICATION.md §2.2)")
    print("=" * 80)

    passed, results = verify_benchmark_grounding(max_tolerance_arcsec=args.tolerance_arcsec)

    print(f"{'Target Name':20} | {'Expected (2025.5)':24} | {'Propagated':24} | {'Diff':10} | {'Status'}")
    print("-" * 88)
    for r in results:
        exp = f"({r['expected_2025_5'][0]:.5f}, {r['expected_2025_5'][1]:.5f})"
        calc = f"({r['calculated_2025_5'][0]:.5f}, {r['calculated_2025_5'][1]:.5f})"
        diff = f"{r['diff_arcsec']:.3f}\""
        status = "PASS [OK]" if r["passed"] else "FAIL [X]"
        print(f"{r['target']:20} | {exp:24} | {calc:24} | {diff:10} | {status}")

    print("-" * 88)
    max_err = max(r["diff_arcsec"] for r in results)
    print(f"Max Grounding Astrometric Error: {max_err:.4f}\" (Gate Threshold: < {args.tolerance_arcsec:.2f}\")")

    if not passed:
        print("\nERROR: CI Astrometric Grounding Check FAILED! Benchmark coordinates drift exceeds 1.0''.", file=sys.stderr)
        return 1

    print("\nSUCCESS: All 5 NASA Benchmark Targets strictly grounded to Epoch 2025.5 (< 1.0'').")

    if do_write:
        sql_content = generate_seed_sql()
        output_path = Path(__file__).resolve().parent.parent / "backend" / "db" / "seed_benchmarks.sql"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(sql_content, encoding="utf-8")
        print(f"Wrote verified database seed script to {output_path} ({len(sql_content.splitlines())} lines).")

    return 0


if __name__ == "__main__":
    sys.exit(main())
