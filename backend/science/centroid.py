"""Native Per-Exposure HDU 5 PSF Centroiding & Astrometric Motion Engine.

Specification Anchors:
- SPECIFICATION.md §1.3 Audit #6 (Native PSF centroid shift vs DoG display aid, line 44)
- SPECIFICATION.md §1.4 Core Scientific Principles (Measure Natively, Display Rectified, line 61)
- SPECIFICATION.md §4.1 Pipeline 3 (Native Per-Exposure PSF Centroiding Engine, lines 446–455)
- SYSTEM_ARCHITECTURE.md §4.2 Item 7 (Native Per-Exposure PSF Centroiding Engine, lines 547–554)
- tasks.md Dev 1 (role:E1-astro) Issue #11

Mathematical Rigor:
1. Native Detector Space Stamp Extraction:
   Maps target sky coordinates (α, δ) to parent detector pixel coordinates (x_det, y_det) in [0, 2040].
   Extracts a 5 x 5 native pixel ROI stamp around the integer-rounded nominal position (x_c, y_c).

2. HDU 5 Empirical PSF Zone Selection:
   The empirical Point Spread Function in HDU 5 is indexed by parent detector coordinates
   (x_parent, y_parent) across an 11 x 11 spatial grid (121 zones).
   Zone index:
     i_x = clip(floor(x_parent / 2040.0 * 11), 0, 10)
     i_y = clip(floor(y_parent / 2040.0 * 11), 0, 10)
     zone_idx = i_y * 11 + i_x

3. Core Saturation Pre-Screening:
   Checks if Bit 1 (OVERFLOW, 0x0002) is set in core pixels within the 3 x 3 nucleus.
   If saturated, skips non-linear PSF optimization and returns saturated=True with
   catalog-predicted track coordinates.

4. Sub-Pixel Phase Resampling & PSF Centroid Fitting:
   Fits local model:
     I_model(x, y) = F_0 · PSF_resamp(x - x_0, y - y_0) + B_0
   weighted by inverse variance 1 / σ^2(x, y) in a 5 x 5 native pixel stamp via
   bounded non-linear least squares to obtain (x_0, y_0) and 2x2 covariance matrix Σ_pix.

5. Astrometric Covariance Transformation:
   Transforms (x_0, y_0) and Σ_pix to sky coordinates (α_i, δ_i) via the native TAN-SIP WCS Jacobian J:
     Σ_sky = J · Σ_pix · J^T  [deg^2]

6. Inverse-Covariance Coaddition of Positions per (Epoch, Band):
   Combines native centroids across exposures:
     r_vec(e, b) = ( Σ_i Σ_i^-1 )^-1 · Σ_i ( Σ_i^-1 · r_vec_i )
     Σ(e, b) = ( Σ_i Σ_i^-1 )^-1

7. Proper Motion Vector, Velocity, Position Angle & Motion SNR:
   Between earliest and latest epochs:
     Δt_yr = (t_latest - t_earliest) / 365.25
     Δα* = (α_2 - α_1) · cos(δ_mean) [deg]
     Δδ = δ_2 - δ_1                  [deg]
     Velocity = sqrt((Δα*)^2 + Δδ^2) * 3600 / Δt_yr  [arcsec/yr]
     Position Angle = atan2(Δα*, Δδ)                [deg East of North]
     SNR_motion = Δθ / σ_Δθ                         [significance vs background covariance]
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from scipy.optimize import least_squares

logger = logging.getLogger(__name__)

# Optical & Geometric Constants
ACTIVE_DETECTOR_SIZE = 2040.0
SPHEREX_PIXEL_SCALE_ARCSEC = 6.2  # 6.2 arcsec/pixel
SPHEREX_PSF_FWHM_PX = 1.2         # 1.2 native pixels (~7.44 arcsec)
DAYS_PER_JULIAN_YEAR = 365.25
ARCSEC_PER_DEG = 3600.0
MAS_PER_DEG = 3_600_000.0

# 11x11 PSF Grid Zones across Hawaii-2RG active array
NUM_PSF_ZONES_1D = 11
TOTAL_PSF_ZONES = NUM_PSF_ZONES_1D * NUM_PSF_ZONES_1D  # 121

# Quality Bitmasks (backend/config/flags.json)
FLAG_TRANSIENT = 1   # Bit 0 (0x0001)
FLAG_OVERFLOW = 2    # Bit 1 (0x0002) - Detector well saturation (>85% full well)
FLAG_SUR_ERROR = 4   # Bit 2 (0x0004)


@dataclass
class CentroidMeasurement:
    """Sub-pixel centroid measurement for a single exposure in native detector space."""

    exposure_id: str
    epoch_id: str
    band: str
    mjd: float
    x_det: float
    y_det: float
    ra_deg: float
    dec_deg: float
    flux: float
    background: float
    cov_pix: np.ndarray  # 2x2 covariance in pixel^2
    cov_sky: np.ndarray  # 2x2 covariance in deg^2
    sigma_ra_arcsec: float
    sigma_dec_arcsec: float
    saturated: bool = False
    converged: bool = True
    chi2_reduced: float = 0.0
    psf_zone: int = 0
    provenance: dict[str, Any] = field(default_factory=dict)


@dataclass
class CoaddedCentroid:
    """Inverse-covariance weighted coadded centroid per (Epoch, Band)."""

    epoch_id: str
    band: str
    mean_mjd: float
    ra_deg: float
    dec_deg: float
    cov_sky: np.ndarray  # 2x2 covariance in deg^2
    sigma_ra_arcsec: float
    sigma_dec_arcsec: float
    num_exposures: int
    is_saturated: bool = False


@dataclass
class ProperMotionResult:
    """Proper motion displacement, velocity, position angle, and significance."""

    delta_ra_arcsec: float
    delta_dec_arcsec: float
    total_shift_arcsec: float
    total_shift_pixels: float
    dt_years: float
    pm_ra_cosdec_mas_yr: float
    pm_dec_mas_yr: float
    velocity_arcsec_yr: float
    position_angle_deg: float
    motion_snr: float
    is_mover: bool
    earliest_epoch: str
    latest_epoch: str
    earliest_mjd: float
    latest_mjd: float
    provenance: dict[str, Any] = field(default_factory=dict)


def select_psf_zone(
    x_parent: float,
    y_parent: float,
    n_zones_1d: int = NUM_PSF_ZONES_1D,
    max_coord: float = ACTIVE_DETECTOR_SIZE,
) -> int:
    """Calculate 1D linear zone index into HDU 5 3D PSF cube based on native detector position.

    Formula:
      i_x = clip(floor(x_parent / max_coord * n_zones_1d), 0, n_zones_1d - 1)
      i_y = clip(floor(y_parent / max_coord * n_zones_1d), 0, n_zones_1d - 1)
      zone_idx = i_y * n_zones_1d + i_x
    """
    ix = math.floor((float(x_parent) / max_coord) * n_zones_1d)
    iy = math.floor((float(y_parent) / max_coord) * n_zones_1d)
    ix = max(0, min(n_zones_1d - 1, ix))
    iy = max(0, min(n_zones_1d - 1, iy))
    return int(iy * n_zones_1d + ix)


def extract_psf_kernel_from_cube(
    psf_data: np.ndarray,
    x_parent: float,
    y_parent: float,
    header: fits.Header | None = None,
) -> np.ndarray:
    """Extract and normalize a 2D empirical PSF kernel from HDU 5 3D cube.

    Supports:
    - 3D cube of shape (N_zones, kh, kw) e.g. (121, 25, 25) or (121, 101, 101)
    - 3D cube of shape (kh, kw, N_zones)
    - 4D grid of shape (n_y, n_x, kh, kw)
    - 2D single kernel of shape (kh, kw)
    """
    if psf_data.ndim == 2:
        kernel = psf_data.astype(np.float32)
    elif psf_data.ndim == 3:
        n_zones = TOTAL_PSF_ZONES
        if psf_data.shape[0] == n_zones:
            zone_idx = select_psf_zone(x_parent, y_parent)
            kernel = psf_data[zone_idx].astype(np.float32)
        elif psf_data.shape[2] == n_zones:
            zone_idx = select_psf_zone(x_parent, y_parent)
            kernel = psf_data[:, :, zone_idx].astype(np.float32)
        else:
            # General N-slice cube along axis 0
            n_slices = psf_data.shape[0]
            n_1d = round(math.sqrt(n_slices))
            if n_1d * n_1d == n_slices:
                zone_idx = select_psf_zone(x_parent, y_parent, n_zones_1d=n_1d)
            else:
                zone_idx = min(
                    n_slices - 1,
                    max(0, round((y_parent / ACTIVE_DETECTOR_SIZE) * (n_slices - 1))),
                )
            kernel = psf_data[zone_idx].astype(np.float32)
    elif psf_data.ndim == 4:
        ny_zones, nx_zones = psf_data.shape[0], psf_data.shape[1]
        ix = max(0, min(nx_zones - 1, math.floor((x_parent / ACTIVE_DETECTOR_SIZE) * nx_zones)))
        iy = max(0, min(ny_zones - 1, math.floor((y_parent / ACTIVE_DETECTOR_SIZE) * ny_zones)))
        kernel = psf_data[iy, ix].astype(np.float32)
    else:
        raise ValueError(f"Unsupported PSF array dimensions: {psf_data.shape}")

    k_sum = float(np.sum(kernel))
    if k_sum > 0:
        kernel = kernel / k_sum
    return kernel


def resample_psf_kernel_subpixel(
    kernel: np.ndarray | None,
    x0: float,
    y0: float,
    stamp_x: np.ndarray,
    stamp_y: np.ndarray,
    fwhm_px: float = SPHEREX_PSF_FWHM_PX,
    oversampling: float = 1.0,
) -> np.ndarray:
    """Evaluate and resample the Point Spread Function onto the stamp at sub-pixel center (x0, y0).

    If kernel is None, uses standard SPHEREx circular Gaussian PSF with nominal FWHM.
    If kernel is provided, uses 2D bilinear interpolation from empirical kernel.
    """
    if kernel is None:
        sigma = fwhm_px / 2.354820045  # FWHM / (2 * sqrt(2 * ln(2)))
        two_sigma_sq = 2.0 * sigma * sigma
        r2 = (stamp_x - x0) ** 2 + (stamp_y - y0) ** 2
        p = np.exp(-r2 / two_sigma_sq, dtype=np.float32)
        p_sum = float(np.sum(p))
        return (p / p_sum) if p_sum > 0 else p

    kh, kw = kernel.shape
    k_center_x = (kw - 1) / 2.0
    k_center_y = (kh - 1) / 2.0

    dx = stamp_x - x0
    dy = stamp_y - y0

    uk = k_center_x + dx * oversampling
    vk = k_center_y + dy * oversampling

    u0 = np.floor(uk).astype(np.int32)
    v0 = np.floor(vk).astype(np.int32)
    u1 = u0 + 1
    v1 = v0 + 1

    wu = (uk - u0).astype(np.float32)
    wv = (vk - v0).astype(np.float32)

    u0_c = np.clip(u0, 0, kw - 1)
    u1_c = np.clip(u1, 0, kw - 1)
    v0_c = np.clip(v0, 0, kh - 1)
    v1_c = np.clip(v1, 0, kh - 1)

    val = (
        kernel[v0_c, u0_c] * (1.0 - wu) * (1.0 - wv)
        + kernel[v0_c, u1_c] * wu * (1.0 - wv)
        + kernel[v1_c, u0_c] * (1.0 - wu) * wv
        + kernel[v1_c, u1_c] * wu * wv
    )

    # Zero-out pixels that map entirely outside kernel footprint
    in_bounds = (uk >= 0.0) & (uk <= kw - 1.0) & (vk >= 0.0) & (vk <= kh - 1.0)
    val = np.where(in_bounds, val, 0.0).astype(np.float32)

    v_sum = float(np.sum(val))
    if v_sum > 0:
        val = val / v_sum
    return val


def check_core_saturation(
    flags: np.ndarray,
    x_nom: float,
    y_nom: float,
    core_radius: int = 1,
    overflow_mask: int = FLAG_OVERFLOW,
) -> bool:
    """Check if Bit 1 (OVERFLOW) is set in any core pixels within the (2*r + 1) nucleus."""
    h, w = flags.shape
    xc = round(x_nom)
    yc = round(y_nom)

    x_min = max(0, xc - core_radius)
    x_max = min(w, xc + core_radius + 1)
    y_min = max(0, yc - core_radius)
    y_max = min(h, yc + core_radius + 1)

    if x_min >= x_max or y_min >= y_max:
        return False

    core_flags = flags[y_min:y_max, x_min:x_max]
    return bool(np.any((core_flags & overflow_mask) != 0))


def compute_wcs_jacobian(
    wcs: WCS,
    x: float,
    y: float,
    h: float = 1e-4,
) -> np.ndarray:
    """Compute local astrometric Jacobian matrix J = d(alpha, delta) / d(x, y) in degrees/pixel.

    Uses central finite differences with wrapping protection across the RA=0/360 boundary.
    """
    # Step in X
    ra_xp, dec_xp = wcs.pixel_to_world_values(x + h, y)
    ra_xm, dec_xm = wcs.pixel_to_world_values(x - h, y)

    # Step in Y
    ra_yp, dec_yp = wcs.pixel_to_world_values(x, y + h)
    ra_ym, dec_ym = wcs.pixel_to_world_values(x, y - h)

    # Wrap RA safely
    d_ra_x = ((float(ra_xp) - float(ra_xm) + 180.0) % 360.0) - 180.0
    d_dec_x = float(dec_xp) - float(dec_xm)

    d_ra_y = ((float(ra_yp) - float(ra_ym) + 180.0) % 360.0) - 180.0
    d_dec_y = float(dec_yp) - float(dec_ym)

    j_matrix = np.array(
        [
            [d_ra_x / (2.0 * h), d_ra_y / (2.0 * h)],
            [d_dec_x / (2.0 * h), d_dec_y / (2.0 * h)],
        ],
        dtype=np.float64,
    )
    return j_matrix


def fit_psf_centroid_single_exposure(
    image: np.ndarray,
    variance: np.ndarray,
    flags: np.ndarray,
    wcs: WCS,
    ra_target: float,
    dec_target: float,
    exposure_id: str = "exp_001",
    epoch_id: str = "P1",
    band: str = "D1",
    mjd: float = 60750.0,
    psf_kernel: np.ndarray | None = None,
    oversampling: float = 1.0,
    stamp_radius: int = 2,
    saturation_check: bool = True,
) -> CentroidMeasurement:
    """Fit sub-pixel PSF centroid in native detector space on a single exposure.

    Steps:
    1. Transform (ra_target, dec_target) to nominal detector coordinates (x_nom, y_nom).
    2. Check core saturation (Bit 1: OVERFLOW). If set, skip fitting and return saturated=True
       with catalog-predicted track coordinates.
    3. Extract (2*stamp_radius + 1)^2 stamp (default 5x5).
    4. Fit I_model(x, y) = F_0 · PSF(x - x_0, y - y_0) + B_0 via weighted least squares.
    5. Derive parameter covariance Σ_pix from Jacobian.
    6. Transform Σ_pix to sky covariance Σ_sky [deg^2] via local WCS Jacobian.
    """
    # 1. Transform nominal coordinates to native pixel space
    x_nom_val, y_nom_val = wcs.world_to_pixel_values(ra_target, dec_target)
    x_nom = float(x_nom_val)
    y_nom = float(y_nom_val)

    h_img, w_img = image.shape
    zone_idx = select_psf_zone(x_nom, y_nom)

    # 2. Check core saturation
    if saturation_check and check_core_saturation(flags, x_nom, y_nom, core_radius=1):
        logger.info("Target %s is saturated (OVERFLOW bit set). Skipping PSF fit.", exposure_id)
        # Construct large default uncertainty for saturated prediction
        j_wcs = compute_wcs_jacobian(wcs, x_nom, y_nom)
        cov_pix_sat = np.diag([1.0, 1.0]).astype(np.float64)  # ~1 px uncertainty
        cov_sky_sat = j_wcs @ cov_pix_sat @ j_wcs.T

        cos_dec = math.cos(math.radians(dec_target))
        sig_ra = math.sqrt(max(0.0, cov_sky_sat[0, 0])) * abs(cos_dec) * ARCSEC_PER_DEG
        sig_dec = math.sqrt(max(0.0, cov_sky_sat[1, 1])) * ARCSEC_PER_DEG

        return CentroidMeasurement(
            exposure_id=exposure_id,
            epoch_id=epoch_id,
            band=band,
            mjd=mjd,
            x_det=x_nom,
            y_det=y_nom,
            ra_deg=ra_target,
            dec_deg=dec_target,
            flux=float(np.nanmax(image)),
            background=0.0,
            cov_pix=cov_pix_sat,
            cov_sky=cov_sky_sat,
            sigma_ra_arcsec=sig_ra,
            sigma_dec_arcsec=sig_dec,
            saturated=True,
            converged=True,
            chi2_reduced=0.0,
            psf_zone=zone_idx,
            provenance={"reason": "core_saturation_overflow", "status": "catalog_predicted_track"},
        )

    # 3. Define 5x5 ROI stamp around rounded nominal center
    xc = round(x_nom)
    yc = round(y_nom)

    x_min = xc - stamp_radius
    x_max = xc + stamp_radius + 1
    y_min = yc - stamp_radius
    y_max = yc + stamp_radius + 1

    # Check bounds
    if x_min < 0 or x_max > w_img or y_min < 0 or y_max > h_img:
        raise ValueError(
            f"Nominal coordinates ({x_nom:.1f}, {y_nom:.1f}) stamp [{x_min}:{x_max}, {y_min}:{y_max}] "
            f"exceeds image boundaries ({w_img}, {h_img})"
        )

    stamp_img = image[y_min:y_max, x_min:x_max].astype(np.float32)
    stamp_var = variance[y_min:y_max, x_min:x_max].astype(np.float32)

    # Positive variance guard
    stamp_var = np.where(stamp_var > 1e-6, stamp_var, 1e-6)
    stamp_weights = 1.0 / np.sqrt(stamp_var)

    stamp_y_grid, stamp_x_grid = np.mgrid[y_min:y_max, x_min:x_max].astype(np.float32)

    # Initial guesses
    bg_init = float(np.median([stamp_img[0, :], stamp_img[-1, :], stamp_img[:, 0], stamp_img[:, -1]]))
    flux_init = max(float(np.sum(stamp_img - bg_init)), 1.0)
    x0_init = x_nom
    y0_init = y_nom

    def residuals(params: np.ndarray) -> np.ndarray:
        f0, x0, y0, b0 = params
        psf_model = resample_psf_kernel_subpixel(
            psf_kernel,
            x0,
            y0,
            stamp_x_grid,
            stamp_y_grid,
            fwhm_px=SPHEREX_PSF_FWHM_PX,
            oversampling=oversampling,
        )
        mod = f0 * psf_model + b0
        return ((stamp_img - mod) * stamp_weights).ravel()

    # Parameter bounds: F0 >= 0, x0 in [xc - 1.5, xc + 1.5], y0 in [yc - 1.5, yc + 1.5]
    lower_bounds = [0.0, xc - 1.5, yc - 1.5, -abs(bg_init) * 5.0 - 10.0]
    upper_bounds = [flux_init * 100.0 + 1e5, xc + 1.5, yc + 1.5, abs(bg_init) * 5.0 + 10.0]

    init_params = [flux_init, x0_init, y0_init, bg_init]
    init_params[1] = max(lower_bounds[1] + 1e-3, min(upper_bounds[1] - 1e-3, init_params[1]))
    init_params[2] = max(lower_bounds[2] + 1e-3, min(upper_bounds[2] - 1e-3, init_params[2]))

    res = least_squares(
        residuals,
        init_params,
        bounds=(lower_bounds, upper_bounds),
        method="trf",
        ftol=1e-7,
        xtol=1e-7,
        gtol=1e-7,
        max_nfev=200,
    )

    f_fit, x_fit, y_fit, b_fit = res.x
    dof = max(1, len(res.fun) - 4)
    chi2_red = float(np.sum(res.fun**2) / dof)

    # Derive covariance from Jacobian J
    # H = J^T J
    j_mat = res.jac
    h_mat = j_mat.T @ j_mat
    try:
        cov_all = np.linalg.pinv(h_mat + 1e-9 * np.eye(4))
        cov_pix = cov_all[1:3, 1:3].astype(np.float64)
    except np.linalg.LinAlgError:
        cov_pix = np.diag([0.01, 0.01]).astype(np.float64)

    # Ensure covariance is positive definite
    eigvals = np.linalg.eigvalsh(cov_pix)
    if np.any(eigvals <= 0):
        cov_pix += np.eye(2) * (abs(float(min(eigvals))) + 1e-6)

    # 4. Transform fitted coordinates and covariance to sky
    ra_fit_val, dec_fit_val = wcs.pixel_to_world_values(x_fit, y_fit)
    ra_fit = float(ra_fit_val)
    dec_fit = float(dec_fit_val)

    j_wcs = compute_wcs_jacobian(wcs, x_fit, y_fit)
    cov_sky = j_wcs @ cov_pix @ j_wcs.T  # in deg^2

    cos_dec = math.cos(math.radians(dec_fit))
    sig_ra = math.sqrt(max(0.0, cov_sky[0, 0])) * abs(cos_dec) * ARCSEC_PER_DEG
    sig_dec = math.sqrt(max(0.0, cov_sky[1, 1])) * ARCSEC_PER_DEG

    return CentroidMeasurement(
        exposure_id=exposure_id,
        epoch_id=epoch_id,
        band=band,
        mjd=mjd,
        x_det=float(x_fit),
        y_det=float(y_fit),
        ra_deg=ra_fit,
        dec_deg=dec_fit,
        flux=float(f_fit),
        background=float(b_fit),
        cov_pix=cov_pix,
        cov_sky=cov_sky,
        sigma_ra_arcsec=sig_ra,
        sigma_dec_arcsec=sig_dec,
        saturated=False,
        converged=bool(res.success),
        chi2_reduced=chi2_red,
        psf_zone=zone_idx,
        provenance={
            "nfev": res.nfev,
            "status": res.status,
            "cost": float(res.cost),
            "stamp_radius": stamp_radius,
        },
    )


def coadd_centroids_inverse_covariance(
    measurements: list[CentroidMeasurement],
    group_by: str = "epoch_and_band",
) -> list[CoaddedCentroid]:
    """Combine native centroids per (Epoch, Band) or (Epoch) via inverse-covariance weighting.

    Formula:
      Σ_coadd = ( Σ_i Σ_i^-1 )^-1
      r_coadd = Σ_coadd · Σ_i ( Σ_i^-1 · r_i )
    """
    if not measurements:
        return []

    # Group measurements
    groups: dict[tuple[str, str], list[CentroidMeasurement]] = {}
    for m in measurements:
        key = (m.epoch_id, m.band) if group_by == "epoch_and_band" else (m.epoch_id, "ALL")
        groups.setdefault(key, []).append(m)

    coadded_list: list[CoaddedCentroid] = []

    for (epoch_id, band), group in groups.items():
        # Separate valid and saturated measurements
        valid = [m for m in group if not m.saturated and m.converged]
        all_saturated = len(valid) == 0

        target_set = group if all_saturated else valid

        # Reference coordinate for local Euclidean projection to eliminate RA wrapping
        ref_ra = target_set[0].ra_deg
        ref_dec = target_set[0].dec_deg

        w_total = np.zeros((2, 2), dtype=np.float64)
        weighted_offsets = np.zeros(2, dtype=np.float64)
        mjds: list[float] = []

        for m in target_set:
            cov = m.cov_sky
            try:
                w_mat = np.linalg.pinv(cov + 1e-12 * np.eye(2))
            except np.linalg.LinAlgError:
                w_mat = np.eye(2) * 1e8

            d_ra = ((m.ra_deg - ref_ra + 180.0) % 360.0) - 180.0
            d_dec = m.dec_deg - ref_dec
            delta_vec = np.array([d_ra, d_dec], dtype=np.float64)

            w_total += w_mat
            weighted_offsets += w_mat @ delta_vec
            mjds.append(m.mjd)

        try:
            cov_coadd = np.linalg.pinv(w_total + 1e-12 * np.eye(2))
        except np.linalg.LinAlgError:
            cov_coadd = np.eye(2) * 1e-8

        coadd_offset = cov_coadd @ weighted_offsets
        coadd_ra = (ref_ra + coadd_offset[0]) % 360.0
        coadd_dec = max(-90.0, min(90.0, ref_dec + coadd_offset[1]))

        cos_dec = math.cos(math.radians(coadd_dec))
        sig_ra = math.sqrt(max(0.0, cov_coadd[0, 0])) * abs(cos_dec) * ARCSEC_PER_DEG
        sig_dec = math.sqrt(max(0.0, cov_coadd[1, 1])) * ARCSEC_PER_DEG

        coadded_list.append(
            CoaddedCentroid(
                epoch_id=epoch_id,
                band=band,
                mean_mjd=float(np.mean(mjds)),
                ra_deg=coadd_ra,
                dec_deg=coadd_dec,
                cov_sky=cov_coadd,
                sigma_ra_arcsec=sig_ra,
                sigma_dec_arcsec=sig_dec,
                num_exposures=len(group),
                is_saturated=all_saturated,
            )
        )

    # Sort deterministically by mean MJD
    coadded_list.sort(key=lambda c: c.mean_mjd)
    return coadded_list


def compute_proper_motion(
    centroids: list[CoaddedCentroid] | list[CentroidMeasurement],
    pixel_scale_arcsec: float = SPHEREX_PIXEL_SCALE_ARCSEC,
    min_snr_mover: float = 3.0,
) -> ProperMotionResult:
    """Compute proper motion vector, velocity, position angle, and motion significance (SNR).

    Compares earliest and latest epoch coadds.
    """
    if len(centroids) < 2:
        raise ValueError("At least 2 epoch centroids are required to measure proper motion.")

    # Convert to CoaddedCentroid if CentroidMeasurement list passed
    coadds: list[CoaddedCentroid] = []
    if isinstance(centroids[0], CentroidMeasurement):
        coadds = coadd_centroids_inverse_covariance(centroids, group_by="epoch")  # type: ignore[arg-type]
    else:
        coadds = sorted(centroids, key=lambda c: c.mean_mjd)  # type: ignore[arg-type]

    first = coadds[0]
    last = coadds[-1]

    dt_days = last.mean_mjd - first.mean_mjd
    dt_years = dt_days / DAYS_PER_JULIAN_YEAR

    if dt_years <= 0.0:
        dt_years = 1e-4  # Zero or negative baseline protection

    mean_dec = (first.dec_deg + last.dec_deg) / 2.0
    cos_dec = math.cos(math.radians(mean_dec))

    # Delta coordinates in degrees
    d_ra_deg = ((last.ra_deg - first.ra_deg + 180.0) % 360.0) - 180.0
    d_ra_star_deg = d_ra_deg * cos_dec  # Δα* = Δα · cos(δ)
    d_dec_deg = last.dec_deg - first.dec_deg

    # Delta in arcseconds
    d_ra_arcsec = d_ra_star_deg * ARCSEC_PER_DEG
    d_dec_arcsec = d_dec_deg * ARCSEC_PER_DEG
    total_shift_arcsec = math.hypot(d_ra_arcsec, d_dec_arcsec)
    total_shift_pixels = total_shift_arcsec / pixel_scale_arcsec

    # Proper motion rates in mas/yr
    pm_ra_cosdec_mas_yr = (d_ra_arcsec * 1000.0) / dt_years
    pm_dec_mas_yr = (d_dec_arcsec * 1000.0) / dt_years
    velocity_arcsec_yr = total_shift_arcsec / dt_years

    # Position Angle (degrees East of North)
    pa_rad = math.atan2(d_ra_star_deg, d_dec_deg)
    pa_deg = (math.degrees(pa_rad) + 360.0) % 360.0

    # Covariance of shift: Σ_Δ = Σ_1 + Σ_2 [deg^2]
    cov_delta_deg2 = first.cov_sky + last.cov_sky
    # Projection matrix P to [Δα*, Δδ]
    p_mat = np.array([[cos_dec, 0.0], [0.0, 1.0]], dtype=np.float64)
    cov_delta_star_deg2 = p_mat @ cov_delta_deg2 @ p_mat.T
    cov_delta_arcsec2 = cov_delta_star_deg2 * (ARCSEC_PER_DEG**2)

    # Variance along direction of motion
    if total_shift_arcsec > 1e-9:
        u_hat = np.array([d_ra_arcsec / total_shift_arcsec, d_dec_arcsec / total_shift_arcsec])
        var_along_shift = float(u_hat.T @ cov_delta_arcsec2 @ u_hat)
        sigma_shift_arcsec = math.sqrt(max(1e-12, var_along_shift))
        motion_snr = total_shift_arcsec / sigma_shift_arcsec
    else:
        sigma_shift_arcsec = math.sqrt(float(np.trace(cov_delta_arcsec2)) / 2.0)
        motion_snr = 0.0

    is_mover = bool(motion_snr >= min_snr_mover and total_shift_pixels >= 0.1)

    return ProperMotionResult(
        delta_ra_arcsec=float(d_ra_arcsec),
        delta_dec_arcsec=float(d_dec_arcsec),
        total_shift_arcsec=float(total_shift_arcsec),
        total_shift_pixels=float(total_shift_pixels),
        dt_years=float(dt_years),
        pm_ra_cosdec_mas_yr=float(pm_ra_cosdec_mas_yr),
        pm_dec_mas_yr=float(pm_dec_mas_yr),
        velocity_arcsec_yr=float(velocity_arcsec_yr),
        position_angle_deg=float(pa_deg),
        motion_snr=float(motion_snr),
        is_mover=is_mover,
        earliest_epoch=first.epoch_id,
        latest_epoch=last.epoch_id,
        earliest_mjd=first.mean_mjd,
        latest_mjd=last.mean_mjd,
        provenance={
            "sigma_shift_arcsec": float(sigma_shift_arcsec),
            "num_epochs": len(coadds),
            "pixel_scale_arcsec": pixel_scale_arcsec,
            "min_snr_mover": min_snr_mover,
        },
    )
