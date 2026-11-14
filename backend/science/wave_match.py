"""Pre-Reprojection HDU 6 WAVE-TAB Adaptive Wavelength Matcher.

Specification Anchors:
- SPECIFICATION.md §1.3 Audit #1 (Wavelength-matched frames, line 39)
- SPECIFICATION.md §2.4 (SPHEREx 6-Band Spectral Architecture Table, lines 180–191)
- SPECIFICATION.md §3.1 Stage 5 (Adaptive Wavelength Window Selection, lines 316–319)
- SPECIFICATION.md §4.1 Pipeline 2 Step 2 (Detector Space Lookup from Cutout Sub-Arrays, line 434)
- SYSTEM_ARCHITECTURE.md §4.2 Item 6 (Adaptive Wavelength Matching Algorithm, lines 542–546)
- tasks.md Dev 1 (role:E1-astro) Issue #9

Mathematical Rigor:
1. Native Detector Coordinate Translation:
   Translates target sky coordinates (α, δ) to native parent detector coordinates
   (x_det, y_det) in [0, 2040] using raw exposure TAN-SIP WCS or verified FITS cutout
   offset cards (CRPIX1A/CRPIX2A, LTV1/LTV2, or shifted CRPIX1/CRPIX2 from Spike S3):
     x_det = x_cut + 1.0 - CRPIX1A
     y_det = y_cut + 1.0 - CRPIX2A
   Validates active detector bounds: (x_det, y_det) in [0, 2040].

2. 2D Bilinear Interpolation on HDU 6 WAVE-TAB Grid:
   Evaluates central wavelength λ_i and bandpass width Δλ_i at (x_det, y_det):
     λ_i(x_det, y_det) = I_WAVE(x_det, y_det)
     Δλ_i(x_det, y_det) = I_DWAVE(x_det, y_det)

3. Full 2D Cutout Grid Wavelength Map:
   Evaluates HDU 6 across every pixel (y, x) in the cropped sub-array grid (H x W)
   generating λ(y, x) and Δλ(y, x) Float32 planes before reprojection.

4. Wavelength Window Selection:
   For band b with resolving power R_b and reference wavelength λ_{0,b}
   (median across candidate exposures covering the target):
     w_b,nom = 1 / R_b
     Filter condition: |λ_i - λ_{0,b}| / λ_{0,b} <= w_b
     i.e., λ_i in [λ_{0,b}(1 - w_b), λ_{0,b}(1 + w_b)]

5. Adaptive Window Widening:
   If adaptive_window=True and any available survey pass covering the target has
   0 matching exposures, w_b is iteratively widened in steps of 0.25 / R_b
   up to 3.0 / R_b until every available epoch has at least N_min >= 1 matched exposure.
   Sets is_adaptive_widened = True, attaches structured badge [Adaptive Window (w=...)],
   and records window_half_width = w_b in provenance.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS

logger = logging.getLogger(__name__)

# Nominal resolving powers per SPHEREx detector array (Hawaii-2RG, 2040x2040 active)
# Source: SPECIFICATION.md §2.4 Table, SYSTEM_ARCHITECTURE.md §4.2 Item 6
# Array 1 (D1): R = 35 - 41  (nominal 41.0)
# Array 2 (D2): R = 41 - 50  (nominal 45.0)
# Array 3 (D3): R = 50 - 64  (nominal 57.0)
# Array 4 (D4): R = 64 - 96  (nominal 80.0)
# Array 5 (D5): R = 96 - 118 (nominal 110.0)
# Array 6 (D6): R = 118 - 130 (nominal 130.0)
DEFAULT_BAND_RESOLVING_POWERS: dict[str, float] = {
    "D1": 41.0,
    "D2": 45.0,
    "D3": 57.0,
    "D4": 80.0,
    "D5": 110.0,
    "D6": 130.0,
}

# Nominal spectral band wavelength boundaries in micrometers
DEFAULT_BAND_WAVELENGTH_RANGES: dict[str, tuple[float, float]] = {
    "D1": (0.75, 1.11),
    "D2": (1.11, 1.63),
    "D3": (1.63, 2.42),
    "D4": (2.42, 3.82),
    "D5": (3.82, 4.42),
    "D6": (4.42, 5.00),
}

ACTIVE_DETECTOR_SIZE = 2040.0


def _is_in_bounds(x: float, y: float) -> bool:
    """Validate that coordinates fall within active 2040x2040 Hawaii-2RG detector boundaries."""
    return 0.0 <= x <= ACTIVE_DETECTOR_SIZE and 0.0 <= y <= ACTIVE_DETECTOR_SIZE


@dataclass
class BandProvenance:
    """Per-detector band provenance metadata for wavelength matching."""

    band: str
    reference_wavelength_um: float
    nominal_half_width: float
    window_half_width: float
    is_adaptive_widened: bool
    resolving_power: float
    wavelength_range_um: tuple[float, float]
    matched_count: int
    discarded_count: int
    epoch_counts: dict[str, int] = field(default_factory=dict)
    badge: str = "[NASA Benchmark (Pre-cached)]"
    adaptive_warning: str | None = None


@dataclass
class WavelengthMatchResult:
    """Output of pre-reprojection wavelength-matched exposure filtering."""

    matched_exposures: list[dict[str, Any]]
    discarded_exposures: list[dict[str, Any]]
    band_provenance: dict[str, BandProvenance]
    total_input: int
    total_matched: int
    total_discarded: int


def load_detector_resolving_powers() -> dict[str, float]:
    """Load nominal resolving powers R_b from config/detectors.json if available."""
    config_path = Path(__file__).resolve().parent.parent / "config" / "detectors.json"
    if config_path.is_file():
        try:
            with open(config_path, encoding="utf-8") as f:
                data = json.load(f)
            detectors = data.get("detectors", {})
            result = {}
            for band, det in detectors.items():
                min_r = float(det.get("resolving_power_min", 0.0))
                max_r = float(det.get("resolving_power_max", 999.0))
                nom = float(det.get("nominal_resolving_power", 0.0))
                # Validate nominal falls within [min_r, max_r] and is not a copy-paste placeholder.
                # If invalid or placeholder 41.0 when nominal default differs, use DEFAULT_BAND_RESOLVING_POWERS.
                if band in DEFAULT_BAND_RESOLVING_POWERS:
                    default_r = DEFAULT_BAND_RESOLVING_POWERS[band]
                    if min_r <= nom <= max_r and (nom != 41.0 or default_r == 41.0):
                        result[band] = nom
                    else:
                        result[band] = default_r
                elif min_r <= nom <= max_r:
                    result[band] = nom
                elif min_r > 0 and max_r < 999:
                    result[band] = 0.5 * (min_r + max_r)
            if result:
                return result
        except (OSError, json.JSONDecodeError, ValueError):
            logger.debug("Falling back to default resolving powers due to config read error")
    return DEFAULT_BAND_RESOLVING_POWERS.copy()


def restore_detector_coordinates(
    exposure: dict[str, Any],
    ra: float,
    dec: float,
) -> tuple[float, float] | None:
    """
    Transform target sky coordinate (ra, dec) in degrees to native parent detector
    coordinates (x_det, y_det) in [0, 2040].

    Supports:
    1. Uncropped parent exposures with spatial WCS ('header' or 'wcs').
    2. Sub-array cutout exposures with 'CRPIX1A' / 'CRPIX2A' alternate WCS-A cards
       (verified in Spike S3: x_det = x_cut + 1.0 - CRPIX1A).
    3. Cutouts with reference pixel shift: x_det = x_cut + CRPIX1_parent - CRPIX1_cut.
    4. Cutouts with legacy IRAF LTV1 / LTV2: x_det = x_cut - LTV1.
    5. Direct pre-computed (x_det, y_det) in exposure metadata.

    Returns (x_det, y_det) if inside active detector bounds [0, 2040], else None.
    """
    if "x_det" in exposure and "y_det" in exposure:
        x_det = float(exposure["x_det"])
        y_det = float(exposure["y_det"])
        return (x_det, y_det) if _is_in_bounds(x_det, y_det) else None

    header = exposure.get("header")
    cutout_header = exposure.get("cutout_header")

    # If exposure contains a cutout header, resolve coordinates via cutout WCS and offset cards
    if cutout_header is not None:
        try:
            wcs_cut = WCS(cutout_header)
            x_cut_val, y_cut_val = wcs_cut.world_to_pixel_values(ra, dec)
            x_cut, y_cut = float(x_cut_val), float(y_cut_val)
        except (ValueError, TypeError, fits.VerifyError, AttributeError):
            x_cut, y_cut = None, None

        if x_cut is not None and not (np.isnan(x_cut) or np.isnan(y_cut)):
            # Case A: Alternate WCS-A cards (standard SPHEREx QR2 IRSA Cutouts)
            if "CRPIX1A" in cutout_header and "CRPIX2A" in cutout_header:
                crpix1a = float(cutout_header["CRPIX1A"])
                crpix2a = float(cutout_header["CRPIX2A"])
                x_det = float(x_cut + 1.0 - crpix1a)
                y_det = float(y_cut + 1.0 - crpix2a)
                return (x_det, y_det) if _is_in_bounds(x_det, y_det) else None

            # Case B: Reference pixel delta against parent header
            if header is not None and "CRPIX1" in header and "CRPIX1" in cutout_header:
                delta_x = float(header["CRPIX1"]) - float(cutout_header["CRPIX1"])
                delta_y = float(header["CRPIX2"]) - float(cutout_header["CRPIX2"])
                x_det = float(x_cut + delta_x)
                y_det = float(y_cut + delta_y)
                return (x_det, y_det) if _is_in_bounds(x_det, y_det) else None

            # Case C: Legacy IRAF LTV1/LTV2
            if "LTV1" in cutout_header and "LTV2" in cutout_header:
                ltv1 = float(cutout_header["LTV1"])
                ltv2 = float(cutout_header["LTV2"])
                x_det = float(x_cut - ltv1)
                y_det = float(y_cut - ltv2)
                return (x_det, y_det) if _is_in_bounds(x_det, y_det) else None

    # Fallback: Transform via parent header WCS
    if header is not None:
        try:
            wcs_parent = WCS(header)
            x_det_wcs, y_det_wcs = wcs_parent.world_to_pixel_values(ra, dec)
            x_det = float(x_det_wcs)
            y_det = float(y_det_wcs)
            return (x_det, y_det) if _is_in_bounds(x_det, y_det) else None
        except (ValueError, TypeError, fits.VerifyError, AttributeError):
            logger.debug("Failed to transform world coordinates via parent header WCS")

    return None


def interpolate_wave_tab(
    x_coords: np.ndarray,
    y_coords: np.ndarray,
    values: np.ndarray,
    x_det: float,
    y_det: float,
) -> tuple[float, float]:
    """
    Perform 2D piecewise bilinear interpolation on HDU 6 WAVE-TAB control points grid.

    Parameters:
    - x_coords: 1D array of M control points in detector X axis (e.g. length 11)
    - y_coords: 1D array of N control points in detector Y axis (e.g. length 11)
    - values: (N, M, 2) array where [..., 0] is wavelength (um) and [..., 1] is bandwidth (um)
    - x_det, y_det: Native detector coordinate in active pixel space [0, 2040]

    Returns:
    - (wavelength_um, bandwidth_um) interpolated at (x_det, y_det).
    """
    x_arr = np.asarray(x_coords, dtype=np.float64).ravel()
    y_arr = np.asarray(y_coords, dtype=np.float64).ravel()
    val_arr = np.asarray(values, dtype=np.float64)

    if val_arr.ndim == 4 and val_arr.shape[0] == 1:
        val_arr = val_arr[0]

    n_rows, n_cols = val_arr.shape[:2]

    # Bracket X cell
    if x_det <= x_arr[0]:
        idx_x = 0
        u = 0.0
    elif x_det >= x_arr[-1]:
        idx_x = n_cols - 2
        u = 1.0
    else:
        idx_x = int(np.clip(np.searchsorted(x_arr, x_det) - 1, 0, n_cols - 2))
        denom_x = x_arr[idx_x + 1] - x_arr[idx_x]
        u = (x_det - x_arr[idx_x]) / denom_x if denom_x != 0 else 0.0

    # Bracket Y cell
    if y_det <= y_arr[0]:
        idx_y = 0
        v = 0.0
    elif y_det >= y_arr[-1]:
        idx_y = n_rows - 2
        v = 1.0
    else:
        idx_y = int(np.clip(np.searchsorted(y_arr, y_det) - 1, 0, n_rows - 2))
        denom_y = y_arr[idx_y + 1] - y_arr[idx_y]
        v = (y_det - y_arr[idx_y]) / denom_y if denom_y != 0 else 0.0

    # Bilinear weights
    w00 = (1.0 - u) * (1.0 - v)
    w10 = u * (1.0 - v)
    w01 = (1.0 - u) * v
    w11 = u * v

    # Central wavelength [..., 0]
    lam = (
        w00 * val_arr[idx_y, idx_x, 0]
        + w10 * val_arr[idx_y, idx_x + 1, 0]
        + w01 * val_arr[idx_y + 1, idx_x, 0]
        + w11 * val_arr[idx_y + 1, idx_x + 1, 0]
    )

    # Bandpass width [..., 1]
    if val_arr.shape[-1] >= 2:
        dlam = (
            w00 * val_arr[idx_y, idx_x, 1]
            + w10 * val_arr[idx_y, idx_x + 1, 1]
            + w01 * val_arr[idx_y + 1, idx_x, 1]
            + w11 * val_arr[idx_y + 1, idx_x + 1, 1]
        )
    else:
        dlam = lam / 45.0

    return float(lam), float(dlam)


def compute_cutout_wavelength_grid(
    cutout_header: fits.Header,
    wave_tab: dict[str, np.ndarray] | tuple[np.ndarray, np.ndarray, np.ndarray] | None = None,
    band: str = "D1",
) -> tuple[np.ndarray, np.ndarray]:
    """
    Evaluate HDU 6 WAVE-TAB across every pixel in a cutout sub-array (NAXIS2, NAXIS1)
    to compute exact 2D central wavelength λ(y, x) and bandpass width Δλ(y, x) Float32 planes.

    Spec-Anchor: SPECIFICATION.md §3.1 Stage 5 (line 316)
    """
    naxis1 = int(cutout_header.get("NAXIS1", 29))
    naxis2 = int(cutout_header.get("NAXIS2", 29))

    # Determine detector offset
    if "CRPIX1A" in cutout_header and "CRPIX2A" in cutout_header:
        offset_x = 1.0 - float(cutout_header["CRPIX1A"])
        offset_y = 1.0 - float(cutout_header["CRPIX2A"])
    elif "CRPIX1" in cutout_header:
        offset_x = 1020.5 - float(cutout_header["CRPIX1"])
        offset_y = 1020.5 - float(cutout_header.get("CRPIX2", 1020.5))
    else:
        offset_x, offset_y = 0.0, 0.0

    x_cut = np.arange(naxis1, dtype=np.float32)
    y_cut = np.arange(naxis2, dtype=np.float32)
    grid_x, grid_y = np.meshgrid(x_cut, y_cut)

    det_x = grid_x + offset_x
    det_y = grid_y + offset_y

    lam_map = np.empty((naxis2, naxis1), dtype=np.float32)
    dlam_map = np.empty((naxis2, naxis1), dtype=np.float32)

    if wave_tab is not None:
        if isinstance(wave_tab, dict):
            xc, yc, vals = wave_tab["X"], wave_tab["Y"], wave_tab["VALUES"]
        else:
            xc, yc, vals = wave_tab[0], wave_tab[1], wave_tab[2]

        for j in range(naxis2):
            for i in range(naxis1):
                lam_val, dlam_val = interpolate_wave_tab(xc, yc, vals, det_x[j, i], det_y[j, i])
                lam_map[j, i] = lam_val
                dlam_map[j, i] = dlam_val
    else:
        # Calibrated LVF linear dispersion fallback
        lam_min, lam_max = DEFAULT_BAND_WAVELENGTH_RANGES.get(band.upper(), (0.75, 1.11))
        r_b = DEFAULT_BAND_RESOLVING_POWERS.get(band.upper(), 41.0)
        frac = np.clip(det_y / ACTIVE_DETECTOR_SIZE, 0.0, 1.0)
        lam_map = (lam_min + (lam_max - lam_min) * frac).astype(np.float32)
        dlam_map = (lam_map / r_b).astype(np.float32)

    return lam_map, dlam_map


def get_exposure_wavelength(
    exposure: dict[str, Any],
    x_det: float,
    y_det: float,
    resolving_powers: dict[str, float] | None = None,
) -> tuple[float, float]:
    """
    Determine central wavelength λ and bandpass width Δλ at native coordinate (x_det, y_det).

    Priority:
    1. Pre-computed 'wavelength_um' and 'bandwidth_um' on the exposure dict.
    2. HDU 6 'wave_tab' structure: {'X': ..., 'Y': ..., 'VALUES': ...} or (x, y, values) tuple.
    3. FITS HDU 6 BinTable if attached as 'hdu6' or 'wave_hdu'.
    4. Calibrated linear variable filter (LVF) dispersion model across active array.
    """
    if "wavelength_um" in exposure:
        lam = float(exposure["wavelength_um"])
        dlam = float(exposure.get("bandwidth_um", lam / 45.0))
        return lam, dlam

    # Check for wave_tab dictionary or tuple
    wave_tab = exposure.get("wave_tab")
    if isinstance(wave_tab, dict) and "X" in wave_tab and "Y" in wave_tab and "VALUES" in wave_tab:
        return interpolate_wave_tab(
            np.asarray(wave_tab["X"]),
            np.asarray(wave_tab["Y"]),
            np.asarray(wave_tab["VALUES"]),
            x_det,
            y_det,
        )
    if isinstance(wave_tab, (tuple, list)) and len(wave_tab) >= 3:
        return interpolate_wave_tab(
            np.asarray(wave_tab[0]),
            np.asarray(wave_tab[1]),
            np.asarray(wave_tab[2]),
            x_det,
            y_det,
        )

    # Check for attached HDU 6 FITS extension
    wave_hdu = exposure.get("wave_hdu") or exposure.get("hdu6")
    if isinstance(wave_hdu, fits.BinTableHDU) and hasattr(wave_hdu, "data") and wave_hdu.data is not None:
        try:
            x_pts = wave_hdu.data["X"][0]
            y_pts = wave_hdu.data["Y"][0]
            val_pts = wave_hdu.data["VALUES"][0]
            return interpolate_wave_tab(x_pts, y_pts, val_pts, x_det, y_det)
        except (KeyError, IndexError, ValueError):
            logger.debug("Failed to extract wave grid points from wave_hdu")

    # Analytical LVF linear dispersion fallback
    band = str(exposure.get("band", "D1")).upper()
    lam_min, lam_max = DEFAULT_BAND_WAVELENGTH_RANGES.get(band, (0.75, 1.11))
    r_map = resolving_powers or DEFAULT_BAND_RESOLVING_POWERS
    r_b = r_map.get(band, 41.0)

    # SPHEREx linear variable filters disperse along Y axis
    frac_y = np.clip(y_det / ACTIVE_DETECTOR_SIZE, 0.0, 1.0)
    lam = lam_min + (lam_max - lam_min) * frac_y
    dlam = lam / r_b

    return float(lam), float(dlam)


def _match_band_exposures_at_window(
    band_exps: list[dict[str, Any]],
    lambda_0: float,
    unique_epochs: list[str],
    window_half_width: float,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, int]]:
    """Helper to evaluate match condition for a fixed half-width window_half_width."""
    matched_list: list[dict[str, Any]] = []
    discarded_list: list[dict[str, Any]] = []
    epoch_counts: dict[str, int] = {ep: 0 for ep in unique_epochs}

    lam_min = lambda_0 * (1.0 - window_half_width)
    lam_max = lambda_0 * (1.0 + window_half_width)

    for exp in band_exps:
        lam_val = float(exp["wavelength_um"])
        frac_diff = abs(lam_val - lambda_0) / lambda_0

        if frac_diff <= window_half_width:
            e_copy = dict(exp)
            e_copy["reference_wavelength_um"] = lambda_0
            e_copy["window_half_width"] = window_half_width
            e_copy["fractional_wavelength_offset"] = frac_diff
            matched_list.append(e_copy)
            ep = str(exp.get("epoch", 0))
            epoch_counts[ep] = epoch_counts.get(ep, 0) + 1
        else:
            e_copy = dict(exp)
            e_copy["discard_reason"] = (
                f"wavelength_out_of_window: {lam_val:.4f} um outside "
                f"[{lam_min:.4f}, {lam_max:.4f}] (offset={frac_diff:.4f} > wb={window_half_width:.4f})"
            )
            discarded_list.append(e_copy)

    return matched_list, discarded_list, epoch_counts


def filter_wavelength_matched_exposures(
    exposures: list[dict[str, Any]],
    ra: float,
    dec: float,
    adaptive_window: bool = True,
    resolving_powers: dict[str, float] | None = None,
    reference_wavelengths: dict[str, float] | float | None = None,
    n_min_per_epoch: int = 1,
) -> WavelengthMatchResult:
    """
    Evaluate HDU 6 WAVE-TAB at target coordinates before reprojection, grouping exposures
    into wavelength-matched windows [λ_0(1 - w_b), λ_0(1 + w_b)].

    Parameters:
    - exposures: List of exposure metadata dicts (must specify 'band', 'epoch', and WCS or coordinates).
    - ra, dec: Target celestial coordinates in degrees (J2000).
    - adaptive_window: If True, widens window half-width w_b (up to 3/R_b) when an available
      survey epoch has zero matching exposures.
    - resolving_powers: Optional mapping of detector band ('D1'..'D6') to resolving power R_b.
    - reference_wavelengths: Optional reference wavelength λ_0 (float or dict per band).
      Defaults to median of candidate exposures covering target.
    - n_min_per_epoch: Target minimum exposure count per available epoch (default: 1).

    Returns:
    - WavelengthMatchResult containing matched exposures, discarded exposures, and per-band provenance.
    """
    r_powers = resolving_powers or load_detector_resolving_powers()

    # Step 1: Translate (ra, dec) to native detector pixel and evaluate λ_i for all candidate exposures
    evaluated_exposures: list[dict[str, Any]] = []
    discarded_outside_detector: list[dict[str, Any]] = []

    for exp in exposures:
        exp_record = dict(exp)
        coords = restore_detector_coordinates(exp_record, ra, dec)

        if coords is None:
            exp_record["discard_reason"] = "target_outside_detector_bounds"
            discarded_outside_detector.append(exp_record)
            continue

        x_det, y_det = coords
        exp_record["x_det"] = x_det
        exp_record["y_det"] = y_det

        lam_um, dlam_um = get_exposure_wavelength(exp_record, x_det, y_det, resolving_powers=r_powers)
        exp_record["wavelength_um"] = lam_um
        exp_record["bandwidth_um"] = dlam_um
        evaluated_exposures.append(exp_record)

    # Step 2: Partition exposures by detector band
    exposures_by_band: dict[str, list[dict[str, Any]]] = {}
    for exp in evaluated_exposures:
        b = str(exp.get("band", "D1")).upper()
        exposures_by_band.setdefault(b, []).append(exp)

    all_matched: list[dict[str, Any]] = []
    all_discarded: list[dict[str, Any]] = list(discarded_outside_detector)
    band_provenance: dict[str, BandProvenance] = {}

    # Step 3: Execute wavelength windowing per band
    for band, band_exps in exposures_by_band.items():
        r_b = float(r_powers.get(band, DEFAULT_BAND_RESOLVING_POWERS.get(band, 41.0)))
        w_b_nom = 1.0 / r_b

        # Reference wavelength: caller override or median wavelength across epochs at target pixel
        all_lams = [e["wavelength_um"] for e in band_exps]
        if isinstance(reference_wavelengths, dict) and band in reference_wavelengths:
            lambda_0 = float(reference_wavelengths[band])
        elif isinstance(reference_wavelengths, (int, float)):
            lambda_0 = float(reference_wavelengths)
        else:
            lambda_0 = float(np.median(all_lams)) if all_lams else 1.0

        # Discover all unique epochs represented in this band
        unique_epochs = sorted({str(e.get("epoch", 0)) for e in band_exps})

        current_wb = w_b_nom
        is_widened = False
        warning_msg = None

        matched, discarded, epoch_counts = _match_band_exposures_at_window(
            band_exps, lambda_0, unique_epochs, current_wb
        )

        # Adaptive window widening algorithm (up to 3 / R_b)
        max_wb = 3.0 / r_b
        step_wb = 0.25 / r_b

        if adaptive_window and unique_epochs:
            # Check if any epoch with candidate coverage has fewer than n_min exposures
            # Iterates cleanly up to max_wb (inclusive) without premature float truncation
            while any(epoch_counts.get(ep, 0) < n_min_per_epoch for ep in unique_epochs) and current_wb < (max_wb - 1e-9):
                current_wb = min(max_wb, round(current_wb + step_wb, 6))
                matched, discarded, epoch_counts = _match_band_exposures_at_window(
                    band_exps, lambda_0, unique_epochs, current_wb
                )
                is_widened = True

        badge_str = "[NASA Benchmark (Pre-cached)]"
        if is_widened:
            ratio = current_wb / w_b_nom
            badge_str = f"[Adaptive Window (w={current_wb:.4f})]"
            warning_msg = (
                f"{badge_str} Wavelength window widened from "
                f"{w_b_nom:.4f} to {current_wb:.4f} ({ratio:.2f}/R) to achieve multi-epoch coverage."
            )

        provenance = BandProvenance(
            band=band,
            reference_wavelength_um=lambda_0,
            nominal_half_width=w_b_nom,
            window_half_width=current_wb,
            is_adaptive_widened=is_widened,
            resolving_power=r_b,
            wavelength_range_um=(lambda_0 * (1.0 - current_wb), lambda_0 * (1.0 + current_wb)),
            matched_count=len(matched),
            discarded_count=len(discarded),
            epoch_counts=epoch_counts,
            badge=badge_str,
            adaptive_warning=warning_msg,
        )

        band_provenance[band] = provenance
        all_matched.extend(matched)
        all_discarded.extend(discarded)

    return WavelengthMatchResult(
        matched_exposures=all_matched,
        discarded_exposures=all_discarded,
        band_provenance=band_provenance,
        total_input=len(exposures),
        total_matched=len(all_matched),
        total_discarded=len(all_discarded),
    )
