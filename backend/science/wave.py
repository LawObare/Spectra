"""HDU 6 WCS-WAVE 102-Channel Smile Inversion & Forced PSF Spectrophotometry.

Specification Anchors:
- SPECIFICATION.md §2.4 (SPHEREx 6-Band Spectral Architecture Table, lines 180–191)
- SPECIFICATION.md §4.1 Pipeline 2 (WCS-WAVE Hyperspectral Extraction Pipeline, lines 432–445)
- SPECIFICATION.md §5.3.1 Endpoint 5 (GET /api/spectrum, lines 902–919)
- SYSTEM_ARCHITECTURE.md §4.2 Item 6 & Item 7 (Smile Inversion and PSF Photometry)
- tasks.md Dev 1 (role:E1-astro) Issue #19

Mathematical Rigor:
1. SPHEREx 102-Channel Spectral Architecture:
   SPHEREx divides the 0.75 - 5.00 um near-infrared spectrum into 6 detector bands (D1 to D6),
   with each band sampled at 17 discrete channels = 102 total channels:
     D1: 0.75 - 1.11 um (R ~ 35 - 41)
     D2: 1.11 - 1.63 um (R ~ 41 - 50)
     D3: 1.63 - 2.42 um (R ~ 50 - 64)
     D4: 2.42 - 3.82 um (R ~ 64 - 96)
     D5: 3.82 - 4.42 um (R ~ 96 - 118)
     D6: 4.42 - 5.00 um (R ~ 118 - 130)

2. Linear Variable Filter (LVF) Smile Inversion:
   Evaluates HDU 6 WAVE-TAB control points at native detector coordinates (x_det, y_det):
     λ_k = I_WAVE(x_det, y_det)
     Δλ_k = I_DWAVE(x_det, y_det)

3. Forced Point-Source PSF Photometry & Surface Brightness Conversion:
   Converts calibrated surface brightness I_nu (MJy/sr) to flux density F_nu (Janskys):
     F_nu [Jy] = I_nu [MJy/sr] * 10^6 * Ω_px [sr]
     Ω_px = (6.2" * π / (180 * 3600))^2 ≈ 9.02298 * 10^-10 sr
     Conversion factor: 10^6 * Ω_px ≈ 9.02298 * 10^-4 Jy / (MJy/sr)

   Optimal PSF-weighted point-source extraction:
     F_source [Jy] = [ Σ (I * PSF / σ^2) / Σ (PSF^2 / σ^2) ] * 10^6 * Ω_px
     Var(F_source) [Jy^2] = [ 1 / Σ (PSF^2 / σ^2) ] * (10^6 * Ω_px)^2
     Flags = Bitwise-OR of HDU 2 quality bitmasks across contributing pixels.

4. Multi-Exposure 102-Channel Binning & Non-Simultaneity Tracking:
   Exposures covering the target are mapped to the 102 channels. If multiple exposures
   fall within channel c, flux is combined via inverse-variance weighting:
     F_coadd,c = ( Σ F_k / σ_k^2 ) / ( Σ 1 / σ_k^2 )
     Var_coadd,c = 1 / ( Σ 1 / σ_k^2 )
   Tracks MJD span [t_min, t_max]. If Δt > 1.0 day, is_simultaneous = False.

5. Iterative 3σ-Clipped 4th-Order Chebyshev Polynomial Baseline:
   When normalize=True, fits baseline F_cont(λ) across unabsorbed continuum windows:
     Window 1: 0.80 - 1.10 um
     Window 2: 2.10 - 2.30 um
     Window 3: 3.70 - 3.90 um
   Iterates 3σ-clipping (3 passes) to reject absorption/emission features.
   Returns normalized transmission F / F_cont and optical depth τ(λ) = -ln(max(F/F_cont, 1e-4)).
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from numpy.polynomial.chebyshev import Chebyshev

logger = logging.getLogger(__name__)

# Astronomical & Telescope Constants
SPHEREX_PIXEL_SCALE_ARCSEC = 6.2
# Pixel solid angle in steradians: (6.2 * π / (180 * 3600))^2 ≈ 9.0229788e-10 sr
PIXEL_SOLID_ANGLE_SR = (SPHEREX_PIXEL_SCALE_ARCSEC * math.pi / (180.0 * 3600.0)) ** 2
# Surface brightness MJy/sr to Janskys conversion factor
# 1 MJy/sr = 10^6 Jy / sr  =>  F_Jy = I_MJy_sr * 10^6 * Ω_px
MJY_SR_TO_JY_PER_PIXEL = 1e6 * PIXEL_SOLID_ANGLE_SR  # ≈ 9.02298e-4

CHANNELS_PER_BAND = 17
TOTAL_SPHEREX_CHANNELS = 102

# SPHEREx 6-Band Wavelength Boundaries (micrometers)
BAND_WAVELENGTH_BOUNDS: dict[str, tuple[float, float]] = {
    "D1": (0.75, 1.11),
    "D2": (1.11, 1.63),
    "D3": (1.63, 2.42),
    "D4": (2.42, 3.82),
    "D5": (3.82, 4.42),
    "D6": (4.42, 5.00),
}

# Unabsorbed continuum windows for 4th-order Chebyshev baseline fitting
CONTINUUM_WINDOWS_UM: list[tuple[float, float]] = [
    (0.80, 1.10),
    (2.10, 2.30),
    (3.70, 3.90),
]

# Canonical 5 NASA Benchmark Targets coordinates (Epoch 2025.5 + J2000/Discovery reference coords)
BENCHMARK_TARGETS: dict[str, dict[str, Any]] = {
    "barnards_star": {
        "name": "Barnard's Star",
        "ra": 269.44639,
        "dec": 4.76676,
        "alt_coords": [(269.45208, 4.69336)],  # ICRS J2000.0
        "type": "M4V",
        "features": ["TiO", "H2O", "stellar_photosphere"],
        "base_flux_jy": 0.045,
        "slope": -1.2,
    },
    "wise_0855": {
        "name": "WISE 0855-0714",
        "ra": 133.73712,
        "dec": -7.24038,
        "alt_coords": [
            (133.78620, -7.24430),  # WISE discovery epoch ~2010.5 (Luhman 2014)
            (133.79513, -7.24515),  # Back-propagated ICRS J2000.0
        ],
        "type": "Y4",
        "features": ["CH4_3.3um", "H2O_steam", "cold_thermal_excess"],
        "base_flux_jy": 0.0005,
        "slope": 2.5,
    },
    "eps_indi_b": {
        "name": "Epsilon Indi B",
        "ra": 331.09566,
        "dec": -56.80031,
        "alt_coords": [(331.04415, -56.78284)],  # ICRS J2000.0
        "type": "T1+T6",
        "features": ["CH4_2.2um", "CH4_3.3um", "H2O_1.4um", "H2O_1.9um"],
        "base_flux_jy": 0.012,
        "slope": 0.3,
    },
    "rw_aurigae": {
        "name": "RW Aurigae",
        "ra": 76.95647,
        "dec": 30.40130,
        "alt_coords": [(76.95646, 30.40144)],
        "type": "T_Tauri",
        "features": ["IR_excess", "protoplanetary_dust", "variable_dimming"],
        "base_flux_jy": 0.18,
        "slope": -0.8,
    },
    "r_draconis": {
        "name": "R Draconis",
        "ra": 248.16773,
        "dec": 66.75504,
        "alt_coords": [(248.16763, 66.75497)],
        "type": "Mira_AGB",
        "features": ["CO_2.3um", "H2O_pulsation", "large_amplitude"],
        "base_flux_jy": 0.25,
        "slope": -1.0,
    },
}


@dataclass
class ChannelPoint:
    """Individual photometric observation landing at wavelength lambda_k."""

    wavelength_um: float
    bandwidth_um: float
    flux_jy: float
    variance_jy2: float
    flag: int
    mjd: float
    exposure_id: str
    band: str


@dataclass
class CalibratedSpectrum:
    """Complete 102-channel calibrated SPHEREx spectrum."""

    ra: float
    dec: float
    target_name: str | None
    channels: int
    wavelengths_um: list[float]
    flux_jy: list[float]
    variance_jy2: list[float]
    flags: list[int]
    channel_coverage: list[bool]
    mjd_per_channel: list[float]
    mjd_span: list[float]
    is_simultaneous: bool
    continuum_flux_jy: list[float] | None = None
    optical_depth_tau: list[float] | None = None
    provenance: dict[str, Any] = field(default_factory=dict)


def get_standard_channel_grid() -> np.ndarray:
    """Generate canonical 102 SPHEREx wavelength channel centers in micrometers.

    Comprises 17 channels in each of the 6 detector bands (D1 to D6).
    Returns 1D float64 array of length 102 spanning 0.75 um to 5.00 um.
    """
    channel_list: list[float] = []
    for band in ["D1", "D2", "D3", "D4", "D5", "D6"]:
        w_min, w_max = BAND_WAVELENGTH_BOUNDS[band]
        # 17 linearly spaced channels spanning [w_min, w_max]
        band_waves = np.linspace(w_min, w_max, CHANNELS_PER_BAND, dtype=np.float64)
        channel_list.extend(band_waves.tolist())
    return np.round(np.array(channel_list, dtype=np.float64), 4)


def extract_forced_psf_photometry(
    image_roi: np.ndarray,
    variance_roi: np.ndarray,
    flags_roi: np.ndarray,
    psf_roi: np.ndarray,
) -> tuple[float, float, int]:
    """Execute optimal PSF-weighted forced point-source extraction on native detector pixels.

    Formula (SPECIFICATION.md §4.1 line 441):
      F_source [Jy] = [ Σ (I * PSF / σ^2) / Σ (PSF^2 / σ^2) ] * 10^6 * Ω_px
      Var(F_source) [Jy^2] = [ 1 / Σ (PSF^2 / σ^2) ] * (10^6 * Ω_px)^2
      Flags = Bitwise-OR across all contributing ROI pixels.

    Returns:
      (flux_jy, variance_jy2, flags_mask)
    """
    img = np.asarray(image_roi, dtype=np.float64)
    var = np.asarray(variance_roi, dtype=np.float64)
    psf = np.asarray(psf_roi, dtype=np.float64)
    flg = np.asarray(flags_roi, dtype=np.uint32)

    # Protect against non-positive variance
    var_clean = np.where((var > 1e-12) & np.isfinite(var), var, 1e-12)
    inv_var = 1.0 / var_clean

    p_norm = np.sum(psf)
    if p_norm > 0:
        psf = psf / p_norm

    weights = (psf * psf) * inv_var
    denom = np.sum(weights)

    if denom <= 0.0 or not np.isfinite(denom):
        # Fallback to simple aperture integration if weights are singular
        flux_mjy = float(np.sum(img))
        var_mjy = float(np.sum(var_clean))
        flux_jy = flux_mjy * MJY_SR_TO_JY_PER_PIXEL
        var_jy2 = var_mjy * (MJY_SR_TO_JY_PER_PIXEL**2)
    else:
        numer = np.sum((img * psf) * inv_var)
        flux_mjy = float(numer / denom)
        var_mjy = float(1.0 / denom)
        flux_jy = flux_mjy * MJY_SR_TO_JY_PER_PIXEL
        var_jy2 = var_mjy * (MJY_SR_TO_JY_PER_PIXEL**2)

    # Combine flags across ROI via bitwise OR
    flags_combined = int(np.bitwise_or.reduce(flg.ravel())) if flg.size > 0 else 0

    return float(flux_jy), float(max(var_jy2, 1e-18)), flags_combined


def bin_observations_to_102_channels(
    observations: list[ChannelPoint],
    grid_waves: np.ndarray | None = None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Bin multi-exposure observations into the 102 standard SPHEREx channels.

    Combines multiple points landing in the same wavelength channel via inverse-variance weighting:
      F_coadd = ( Σ F_k / σ_k^2 ) / ( Σ 1 / σ_k^2 )
      Var_coadd = 1 / ( Σ 1 / σ_k^2 )

    Returns:
      (flux_jy_102, variance_jy2_102, flags_102, mjd_102)
    """
    if grid_waves is None:
        grid_waves = get_standard_channel_grid()

    n_chan = len(grid_waves)
    flux_arr = np.zeros(n_chan, dtype=np.float64)
    var_arr = np.full(n_chan, 1e-6, dtype=np.float64)
    flags_arr = np.zeros(n_chan, dtype=np.int32)
    mjd_arr = np.zeros(n_chan, dtype=np.float64)

    # Buckets per channel
    buckets: list[list[ChannelPoint]] = [[] for _ in range(n_chan)]

    for obs in observations:
        idx = _channel_for_observation(obs, grid_waves)
        if idx is not None:
            buckets[idx].append(obs)

    for i in range(n_chan):
        pts = buckets[i]
        if not pts:
            # MISSING_DATA is the documented SPHEREx bit 9 (512); bit 10 is HOT.
            flags_arr[i] = 512
            continue

        w_sum = 0.0
        fw_sum = 0.0
        flag_acc = 0
        mjd_list: list[float] = []

        for p in pts:
            v = max(1e-18, p.variance_jy2)
            w = 1.0 / v
            w_sum += w
            fw_sum += p.flux_jy * w
            flag_acc |= p.flag
            mjd_list.append(p.mjd)

        if w_sum > 0:
            flux_arr[i] = fw_sum / w_sum
            var_arr[i] = 1.0 / w_sum
        flags_arr[i] = flag_acc
        mjd_arr[i] = float(np.mean(mjd_list)) if mjd_list else 60750.0

    return flux_arr, var_arr, flags_arr, mjd_arr


def _channel_for_observation(obs: ChannelPoint, grid_waves: np.ndarray) -> int | None:
    if not len(grid_waves):
        return None
    idx = int(np.argmin(np.abs(grid_waves - obs.wavelength_um)))
    band_bounds = BAND_WAVELENGTH_BOUNDS.get(obs.band)
    if band_bounds is None:
        return None
    neighbor_steps = []
    if idx > 0 and grid_waves[idx - 1] >= band_bounds[0]:
        neighbor_steps.append(abs(float(grid_waves[idx] - grid_waves[idx - 1])))
    if idx + 1 < len(grid_waves) and grid_waves[idx + 1] <= band_bounds[1]:
        neighbor_steps.append(abs(float(grid_waves[idx + 1] - grid_waves[idx])))
    half_channel = 0.5 * min(neighbor_steps) if neighbor_steps else 0.0
    if abs(float(grid_waves[idx]) - obs.wavelength_um) > max(obs.bandwidth_um / 2.0, half_channel):
        return None
    return idx


async def extract_live_observations(
    ra: float,
    dec: float,
    progress_hook: Any = None,
) -> tuple[list[ChannelPoint], list[str], list[str]]:
    """Fetch real IRSA exposures and extract PSF-weighted wavelength samples."""
    try:
        from backend.science.ingest import ingest_exposures_for_target
        from backend.science.wave_match import get_exposure_wavelength, restore_detector_coordinates
    except ImportError:
        from science.ingest import ingest_exposures_for_target  # type: ignore
        from science.wave_match import get_exposure_wavelength, restore_detector_coordinates  # type: ignore

    from astropy.wcs import WCS

    ingestion = await ingest_exposures_for_target(
        ra=ra,
        dec=dec,
        fov_arcsec=60,
        adaptive_window=False,
        progress_hook=progress_hook,
        spectrum_mode=True,
    )
    exposures = ingestion.get("exposures", [])
    if not exposures:
        raise ValueError(ingestion.get("error") or "IRSA returned no exposures for this position")

    observations: list[ChannelPoint] = []
    releases: set[str] = set()
    used_ids: list[str] = []
    for item in exposures:
        cutout = item.get("cutout") or {}
        header = cutout.get("hdu1_header")
        image = cutout.get("hdu1_image")
        variance = cutout.get("hdu3_variance")
        flags = cutout.get("hdu2_flags")
        psf_cube = cutout.get("hdu5_psf")
        wave_tab = cutout.get("hdu6_wave_tab")
        if any(value is None for value in (header, image, variance, flags, psf_cube)):
            continue
        if not isinstance(wave_tab, dict) or not {"X", "Y", "VALUES"}.issubset(wave_tab):
            continue

        try:
            x_source, y_source = WCS(header).celestial.world_to_pixel_values(ra, dec)
            x_source, y_source = float(x_source), float(y_source)
        except Exception as exc:  # noqa: BLE001
            logger.debug("Skipping exposure with unusable sky WCS: %s", exc)
            continue
        center_x, center_y = round(x_source), round(y_source)
        radius = 4
        x0, x1 = center_x - radius, center_x + radius + 1
        y0, y1 = center_y - radius, center_y + radius + 1
        if x0 < 0 or y0 < 0 or y1 > image.shape[0] or x1 > image.shape[1]:
            continue

        exposure_for_wave = {
            **item,
            "cutout_header": header,
            "wave_tab": wave_tab,
        }
        detector_position = restore_detector_coordinates(exposure_for_wave, ra, dec)
        if detector_position is None:
            continue
        wavelength, bandwidth = get_exposure_wavelength(
            exposure_for_wave, detector_position[0], detector_position[1]
        )
        if not (0.75 <= wavelength <= 5.0 and bandwidth > 0):
            continue

        try:
            detector = str(item.get("band") or "").upper()
            if psf_cube.ndim != 3 or psf_cube.shape[0] < 121:
                continue
            # PSF HDU has 121 spatial zones in y-major order, 11 x 11 across detector.
            zone_x = min(10, max(0, int(detector_position[0] / 2040.0 * 11)))
            zone_y = min(10, max(0, int(detector_position[1] / 2040.0 * 11)))
            psf_hi = np.asarray(psf_cube[zone_y * 11 + zone_x], dtype=np.float64)
            if psf_hi.shape != (101, 101):
                continue
            shift_x = round((x_source - center_x) * 10)
            shift_y = round((y_source - center_y) * 10)
            shifted_psf = np.zeros_like(psf_hi)
            src_y0, src_y1 = max(0, -shift_y), min(101, 101 - shift_y)
            src_x0, src_x1 = max(0, -shift_x), min(101, 101 - shift_x)
            shifted_psf[src_y0 + shift_y:src_y1 + shift_y, src_x0 + shift_x:src_x1 + shift_x] = psf_hi[src_y0:src_y1, src_x0:src_x1]
            psf_hi = shifted_psf
            # Integrate the 10x oversampled PSF into the same 9x9 native-pixel ROI.
            psf_roi = psf_hi[5:95, 5:95].reshape(9, 10, 9, 10).sum(axis=(1, 3))
            image_roi = np.asarray(image[y0:y1, x0:x1], dtype=np.float64)
            variance_roi = np.asarray(variance[y0:y1, x0:x1], dtype=np.float64)
            flags_roi = np.asarray(flags[y0:y1, x0:x1], dtype=np.uint32)
            yy, xx = np.indices((9, 9))
            background_mask = (xx - 4) ** 2 + (yy - 4) ** 2 >= 9
            background = float(np.nanmedian(image_roi[background_mask]))
            image_roi = image_roi - background
            flux_jy, variance_jy2, flags_combined = extract_forced_psf_photometry(
                image_roi, variance_roi, flags_roi, psf_roi
            )
        except (ValueError, IndexError, FloatingPointError):
            continue

        collection = str(item.get("collection") or "spherex_qr2")
        exposure_id = str(item.get("exposure_id") or "unknown")
        observations.append(
            ChannelPoint(
                wavelength_um=float(wavelength),
                bandwidth_um=float(bandwidth),
                flux_jy=flux_jy,
                variance_jy2=variance_jy2,
                flag=flags_combined,
                mjd=float(item["mjd"]),
                exposure_id=exposure_id,
                band=detector,
            )
        )
        releases.add(collection)
        used_ids.append(exposure_id)

    if not observations:
        raise ValueError("IRSA exposures were found, but none produced usable WCS-WAVE PSF measurements")
    return observations, sorted(releases), used_ids


def fit_chebyshev_continuum(
    wavelengths: np.ndarray,
    flux: np.ndarray,
    variance: np.ndarray,
    order: int = 4,
    n_sigma: float = 3.0,
    n_iter: int = 3,
    windows: list[tuple[float, float]] = CONTINUUM_WINDOWS_UM,
) -> tuple[np.ndarray, np.ndarray]:
    """Fit iterative 3σ-clipped 4th-order Chebyshev polynomial baseline and compute optical depth.

    Specification Anchor: SPECIFICATION.md §4.1 line 444
    Windows:
      0.80 - 1.10 um (D1 unabsorbed stellar continuum)
      2.10 - 2.30 um (D3 K-band continuum)
      3.70 - 3.90 um (D4 pre-ice continuum baseline)

    Returns:
      (continuum_flux, optical_depth_tau)
    """
    waves = np.asarray(wavelengths, dtype=np.float64)
    flx = np.asarray(flux, dtype=np.float64)
    var = np.asarray(variance, dtype=np.float64)

    # Construct initial window mask
    win_mask = np.zeros(len(waves), dtype=bool)
    for w_low, w_high in windows:
        win_mask |= (waves >= w_low) & (waves <= w_high)

    # Fallback to full spectrum if window mask has fewer points than polynomial degrees of freedom
    if np.sum(win_mask) < (order + 2):
        win_mask = np.ones(len(waves), dtype=bool)

    active_mask = win_mask.copy()

    # Iterative 3σ-clipping fit
    poly = None
    for _ in range(n_iter):
        fit_waves = waves[active_mask]
        fit_flux = flx[active_mask]
        fit_var = var[active_mask]

        if len(fit_waves) < (order + 1):
            break

        weights = 1.0 / np.sqrt(np.where(fit_var > 1e-12, fit_var, 1e-12))
        try:
            poly = Chebyshev.fit(fit_waves, fit_flux, deg=order, w=weights)
        except (ValueError, np.linalg.LinAlgError):
            poly = Chebyshev.fit(fit_waves, fit_flux, deg=1)

        residuals = fit_flux - poly(fit_waves)
        sigma_res = float(np.std(residuals))
        if sigma_res <= 0:
            break

        # Reject points where residual > 3*sigma
        good_in_fit = np.abs(residuals) <= (n_sigma * sigma_res)
        # Update active_mask
        active_indices = np.where(active_mask)[0]
        active_mask[active_indices[~good_in_fit]] = False

    if poly is None:
        continuum = np.maximum(flx, 1e-5)
    else:
        continuum = poly(waves)
        continuum = np.maximum(continuum, 1e-6)

    # Compute normalized transmission and optical depth τ = -ln(F / F_cont)
    trans = np.maximum(flx / continuum, 1e-4)
    tau = -np.log(trans)

    return continuum, tau


def match_benchmark_target(ra: float, dec: float, match_radius_arcsec: float = 30.0) -> dict[str, Any] | None:
    """Match sky coordinates against the 5 NASA Benchmark Targets (Epoch 2025.5 & J2000/Discovery)."""
    match_rad_deg = match_radius_arcsec / 3600.0
    for target in BENCHMARK_TARGETS.values():
        candidate_coords = [(target["ra"], target["dec"])] + list(target.get("alt_coords", []))
        for c_ra, c_dec in candidate_coords:
            d_ra = ((ra - c_ra + 180.0) % 360.0) - 180.0
            d_ra_star = d_ra * math.cos(math.radians((dec + c_dec) / 2.0))
            d_dec = dec - c_dec
            dist = math.hypot(d_ra_star, d_dec)
            if dist <= match_rad_deg:
                return target
    return None


def generate_benchmark_sed_102(
    target: dict[str, Any],
    grid_waves: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, list[float], bool]:
    """Reference-template SED generator for the in-memory similarity template library only."""
    waves = grid_waves
    base_f = target.get("base_flux_jy", 0.05)
    slope = target.get("slope", -1.0)
    ttype = target.get("type", "standard")

    # Power-law baseline: F(λ) = F_0 * (λ / 1.0 um)^slope
    flux = base_f * (waves / 1.0) ** slope

    # Add characteristic molecular / atomic spectral absorption features
    if "M4V" in ttype:
        # Barnard's Star: TiO absorption bands in D1 (0.84 um) and water vapor in D2/D3
        flux *= 1.0 - 0.25 * np.exp(-((waves - 0.84) / 0.03) ** 2)
        flux *= 1.0 - 0.30 * np.exp(-((waves - 1.40) / 0.06) ** 2)
        flux *= 1.0 - 0.35 * np.exp(-((waves - 1.90) / 0.08) ** 2)
        flux *= 1.0 - 0.20 * np.exp(-((waves - 2.30) / 0.05) ** 2)  # CO bandhead
    elif "Y4" in ttype:
        # WISE 0855: Deep methane (CH4) band at 3.3 um and ammonia/water, prominent D5/D6 thermal flux
        flux *= 1.0 - 0.80 * np.exp(-((waves - 3.32) / 0.12) ** 2)
        flux *= 1.0 - 0.70 * np.exp(-((waves - 1.66) / 0.05) ** 2)
        # Rising thermal continuum in D5/D6
        flux += 0.002 * np.exp((waves - 3.8) / 0.4)
    elif "T1+T6" in ttype:
        # Epsilon Indi B: Unresolved binary T-dwarf with strong 1.4, 1.9, and 2.2 um methane/water dips
        flux *= 1.0 - 0.55 * np.exp(-((waves - 1.42) / 0.05) ** 2)
        flux *= 1.0 - 0.65 * np.exp(-((waves - 1.92) / 0.07) ** 2)
        flux *= 1.0 - 0.45 * np.exp(-((waves - 2.22) / 0.06) ** 2)
        flux *= 1.0 - 0.60 * np.exp(-((waves - 3.32) / 0.10) ** 2)
    elif "T_Tauri" in ttype:
        # RW Aurigae: Accretion infrared excess and silicate emission at ~1.0 um
        flux += 0.05 * np.exp(-((waves - 1.1) / 0.2) ** 2)
        # Mild dust absorption
        flux *= 1.0 - 0.15 * np.exp(-((waves - 3.05) / 0.15) ** 2)
    elif "Mira_AGB" in ttype:
        # R Draconis: Deep circumstellar water steam + CO bandhead at 2.3 um
        flux *= 1.0 - 0.45 * np.exp(-((waves - 1.9) / 0.1) ** 2)
        flux *= 1.0 - 0.50 * np.exp(-((waves - 2.3) / 0.08) ** 2)

    flux = np.maximum(flux, 1e-6)

    # Realistic Poisson + read noise variance (SNR ~ 50 - 100)
    variance = (flux * 0.02) ** 2 + 1e-10
    flags = np.zeros(len(waves), dtype=np.int32)

    # Observation MJDs across survey passes starting May 2025 (MJD 60789.85, survey_passes.json)
    pass_mjds = np.linspace(60789.85, 61237.87, len(waves))
    mjd_span = [float(pass_mjds[0]), float(pass_mjds[-1])]
    is_simultaneous = False  # Multi-epoch all-sky survey is inherently non-simultaneous

    return flux, variance, flags, pass_mjds, mjd_span, is_simultaneous


def extract_102_channel_spectrum(
    ra: float,
    dec: float,
    normalize: bool = False,
    custom_observations: list[ChannelPoint] | None = None,
) -> CalibratedSpectrum:
    """Bin archive HDU 5/6 observations at (ra, dec) into the 102-channel SPHEREx grid.

    Raises:
      ValueError: If no archive observations are supplied (never synthesizes fake spectra).
    """
    if not custom_observations:
        raise ValueError("Archive observations are required to extract a 102-channel spectrum")

    grid_waves = get_standard_channel_grid()
    benchmark = match_benchmark_target(ra, dec)

    flux, variance, flg, mjds = bin_observations_to_102_channels(custom_observations, grid_waves)
    coverage = [False] * len(grid_waves)
    for observation in custom_observations:
        channel_index = _channel_for_observation(observation, grid_waves)
        if channel_index is not None:
            coverage[channel_index] = True
    mjd_valid = [p.mjd for p in custom_observations]
    mjd_span = [float(min(mjd_valid)), float(max(mjd_valid))] if mjd_valid else [0.0, 0.0]
    is_simultaneous = (mjd_span[1] - mjd_span[0]) <= 1.0
    target_name = benchmark["name"] if benchmark else None
    source_badge = "[IRSA Live (spherex_qr2)]"

    cont_flux = None
    tau = None
    if normalize:
        cont_arr, tau_arr = fit_chebyshev_continuum(grid_waves, flux, variance)
        cont_flux = [float(v) for v in np.round(cont_arr, 6)]
        tau = [float(v) for v in np.round(tau_arr, 4)]

    return CalibratedSpectrum(
        ra=float(ra),
        dec=float(dec),
        target_name=target_name,
        channels=TOTAL_SPHEREX_CHANNELS,
        wavelengths_um=[float(v) for v in grid_waves],
        flux_jy=[float(v) for v in np.round(flux, 6)],
        variance_jy2=[float(v) for v in np.round(variance, 12)],
        flags=[int(v) for v in flg],
        channel_coverage=coverage,
        mjd_per_channel=[float(v) for v in np.round(mjds, 2)],
        mjd_span=[float(v) for v in np.round(mjd_span, 2)],
        is_simultaneous=is_simultaneous,
        continuum_flux_jy=cont_flux,
        optical_depth_tau=tau,
        provenance={
            "source_badge": source_badge,
            "unit": "Jansky",
            "solid_angle_sr": PIXEL_SOLID_ANGLE_SR,
            "conversion_factor": MJY_SR_TO_JY_PER_PIXEL,
            "bands": ["D1", "D2", "D3", "D4", "D5", "D6"],
            "channels_per_band": CHANNELS_PER_BAND,
        },
    )
