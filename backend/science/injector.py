"""Synthetic Proper-Motion Source Injector & Active Learning Calibration Engine.

Specification Anchors:
- SPECIFICATION.md §1.4 (Automated Pre-Screeners & Synthetic Injections)
- SPECIFICATION.md §3.1, §4.1 (Synthetic Source Injector Engine synth_a & synth_b)
- SPECIFICATION.md §4.2.2, §6.4.6 (Calibration & Observer Reliability Loop)
- SYSTEM_ARCHITECTURE.md §4.2 (Item 8: Synthetic Source Injector Engine)
- tasks.md Dev 6 (role:E6-devops) Issue #24

Mathematical Rigor:
1. Proper Motion Vector Propagation:
   At observation epoch t_k with reference epoch t_0:
     Δt_yr = (t_k - t_0) / 365.25  (for MJD)
     Δα(t_k) = [ (μ_α* · 10^-3 / 3600) · Δt_yr ] / cos(δ_0)   [degrees]
     Δδ(t_k) =   (μ_δ  · 10^-3 / 3600) · Δt_yr                [degrees]
   where μ_α* = μ_α · cos(δ).

2. Point Spread Function Convolved Injection:
   Convolves requested spectral flux with empirical HDU 5 PSF (or calibrated 1.2" FWHM
   Gaussian kernel) shifted to trial sub-pixel phase (x_0, y_0):
     I_inj(x, y) = F_band(t_k) · PSF_subpixel(x - x_0, y - y_0)
   Injects additively into HDU 1 IMAGE:
     I_new(x, y) = I_orig(x, y) + I_inj(x, y)

3. Poisson Noise Variance Propagation:
   Propagates photon shot noise into HDU 3 VARIANCE:
     σ^2_shot(x, y) = max(0, I_inj(x, y)) / gain
     Var_new(x, y) = Var_orig(x, y) + σ^2_shot(x, y)

4. Transparent Provenance & Zero-Auth Calibration Loop:
   Tags outputs with source_badge = "Synthetic Injection", is_synthetic = True.
   Tracks observer sensitivity, evaluates classification against ground truth,
   and computes Bayesian reliability updates w_u in [0.1, 1.0].
"""

from __future__ import annotations

import copy
import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

# Physical & Astronomical Constants
ARCSEC_PER_DEG = 3600.0
MAS_PER_DEG = 3_600_000.0
DAYS_PER_JULIAN_YEAR = 365.25
SPHEREX_PIXEL_SCALE_ARCSEC = 6.2  # 6.2 arcsec/pixel
SPHEREX_PSF_FWHM_PX = 1.2         # Nominal SPHEREx spatial FWHM in native pixels (~7.44")
SPHEREX_NUM_BANDS = 6             # D1 through D6

# Standard Band Wavelength Centers (microns)
BAND_CENTERS_UM = [0.925, 1.350, 2.000, 3.100, 4.100, 4.700]

# Standard Survey Passes
DEFAULT_SURVEY_PASSES = [
    {"pass_id": "P1", "mjd": 60750.0, "date": "2025-03-15", "delta_years": 0.0},
    {"pass_id": "P2", "mjd": 60932.0, "date": "2025-09-15", "delta_years": 0.5},
    {"pass_id": "P3", "mjd": 61115.0, "date": "2026-03-15", "delta_years": 1.0},
]


@dataclass
class SyntheticSourceConfig:
    """Configuration for an artificial test source injected into SPHEREx MEF frames."""

    source_id: str = "synth_a"
    ra_deg: float = 133.73712
    dec_deg: float = -7.24038
    pm_ra_cosdec_mas_yr: float = -8150.0  # Proper motion Eastward: μ_α* = μ_α · cos(δ)
    pm_dec_mas_yr: float = 650.0          # Proper motion Northward: μ_δ
    ref_epoch_mjd: float = 60750.0        # Pass 1 reference epoch (Epoch 2025.5)

    # Spectral Energy Distribution across SPHEREx 6 detector bands (D1 to D6) in arbitrary flux / mJy units
    flux_band_mjy: list[float] | None = None
    spectral_class: str = "cold_brown_dwarf"

    # Variability model (optional)
    variability_model: str | None = None  # None, "pulsing", "occulting", "flashing"
    variability_amplitude: float = 0.0    # Fractional modulation amplitude (e.g. 0.75 = ~1.5 mag)
    variability_period_days: float = 0.0

    # Ground truth flags for calibration loop
    is_mover: bool = True
    is_variable: bool = False
    ground_truth_class: str = "moving_brown_dwarf"
    tags: list[str] = field(default_factory=lambda: ["high_proper_motion", "d5_detection"])

    def __post_init__(self) -> None:
        """Assign default astrophysical SED if not explicitly provided."""
        if self.flux_band_mjy is None:
            if self.spectral_class == "cold_brown_dwarf":
                # Cold sub-brown dwarf (Y/T dwarf): faint in D1-D3, thermal emission in D5/D6
                self.flux_band_mjy = [0.02, 0.02, 0.04, 0.45, 1.85, 2.10]
            elif self.spectral_class == "m_dwarf":
                # M-dwarf (e.g. Barnard's Star): bright in D1-D3, declining toward D6
                self.flux_band_mjy = [25.0, 32.0, 20.0, 12.0, 7.0, 4.5]
            elif self.spectral_class == "binary_t_dwarf":
                # Unresolved T-dwarf binary (e.g. Epsilon Indi B)
                self.flux_band_mjy = [6.5, 4.2, 3.8, 5.0, 7.2, 5.8]
            elif self.spectral_class == "flat_control":
                # Uniform stationary calibration control
                self.flux_band_mjy = [5.0, 5.0, 5.0, 5.0, 5.0, 5.0]
            else:
                self.flux_band_mjy = [10.0] * SPHEREX_NUM_BANDS


def create_synth_a_preset(
    ra_deg: float = 133.73712,
    dec_deg: float = -7.24038,
) -> SyntheticSourceConfig:
    """Create canonical synth_a: High-proper-motion cold brown dwarf.

    Characteristics:
    - High proper motion: ~8.15"/yr Westward (WISE 0855 analogue)
    - Distinctive methane absorption in D2/D3, detected in D5/D6 coadds
    - Primary Class: 'moving_brown_dwarf'
    """
    return SyntheticSourceConfig(
        source_id="synth_a",
        ra_deg=ra_deg,
        dec_deg=dec_deg,
        pm_ra_cosdec_mas_yr=-8150.0,
        pm_dec_mas_yr=650.0,
        ref_epoch_mjd=60750.0,
        spectral_class="cold_brown_dwarf",
        flux_band_mjy=[0.02, 0.02, 0.04, 0.45, 1.85, 2.10],
        is_mover=True,
        is_variable=False,
        ground_truth_class="moving_brown_dwarf",
        tags=["high_proper_motion", "cold_brown_dwarf", "d5_dipole"],
    )


def create_synth_b_preset(
    ra_deg: float = 76.95647,
    dec_deg: float = 30.40130,
) -> SyntheticSourceConfig:
    """Create canonical synth_b: Moderate-motion flashing/occulting variable star.

    Characteristics:
    - Moderate proper motion: ~5.5"/yr (PA ~145°)
    - Occultation / dimming variable (>1.5 mag dimming in pass 2/3)
    - Primary Class: 'variable_star'
    """
    return SyntheticSourceConfig(
        source_id="synth_b",
        ra_deg=ra_deg,
        dec_deg=dec_deg,
        pm_ra_cosdec_mas_yr=3200.0,
        pm_dec_mas_yr=-4500.0,
        ref_epoch_mjd=60750.0,
        spectral_class="m_dwarf",
        flux_band_mjy=[18.0, 16.5, 14.0, 12.5, 11.0, 9.5],
        variability_model="occulting",
        variability_amplitude=0.76,  # ~1.5 mag dimming (factor of ~4)
        is_mover=True,
        is_variable=True,
        ground_truth_class="variable_star",
        tags=["proper_motion", "variable_star", "occultation"],
    )


def create_synth_control_preset(
    ra_deg: float = 248.16773,
    dec_deg: float = 66.75504,
) -> SyntheticSourceConfig:
    """Create canonical stationary control: Non-moving flat source.

    Used to assess volunteer false-positive rates and prevent bias.
    """
    return SyntheticSourceConfig(
        source_id="synth_control",
        ra_deg=ra_deg,
        dec_deg=dec_deg,
        pm_ra_cosdec_mas_yr=0.0,
        pm_dec_mas_yr=0.0,
        ref_epoch_mjd=60750.0,
        spectral_class="flat_control",
        flux_band_mjy=[8.0, 8.0, 8.0, 8.0, 8.0, 8.0],
        is_mover=False,
        is_variable=False,
        ground_truth_class="stationary_star",
        tags=["calibration_control", "stationary_reference"],
    )


def propagate_proper_motion(
    config: SyntheticSourceConfig,
    obs_epoch_mjd: float,
) -> tuple[float, float]:
    """Compute true displaced sky coordinates (alpha, delta) at observation epoch t_k.

    Formula (SPECIFICATION.md §4.1):
      Δt_yr = (obs_epoch_mjd - ref_epoch_mjd) / 365.25
      Δα(t_k) = [ (μ_α* · 10^-3 / 3600) · Δt_yr ] / cos(δ_0)   [degrees]
      Δδ(t_k) =   (μ_δ  · 10^-3 / 3600) · Δt_yr                [degrees]
    """
    dt_years = (obs_epoch_mjd - config.ref_epoch_mjd) / DAYS_PER_JULIAN_YEAR

    cos_dec = math.cos(math.radians(config.dec_deg))
    if abs(cos_dec) < 1e-6:
        cos_dec = 1e-6  # Protect against celestial pole singularity

    # Convert mas/yr to degrees/yr
    shift_ra_deg = ((config.pm_ra_cosdec_mas_yr * 1e-3) / ARCSEC_PER_DEG) * dt_years / cos_dec
    shift_dec_deg = ((config.pm_dec_mas_yr * 1e-3) / ARCSEC_PER_DEG) * dt_years

    ra_tk = (config.ra_deg + shift_ra_deg) % 360.0
    dec_tk = config.dec_deg + shift_dec_deg
    dec_tk = max(-90.0, min(90.0, dec_tk))

    return ra_tk, dec_tk


def calculate_pixel_centroid(
    ra_tk: float,
    dec_tk: float,
    crval_ra: float,
    crval_dec: float,
    cutout_shape: tuple[int, int],
    pixel_scale_arcsec: float = SPHEREX_PIXEL_SCALE_ARCSEC,
    wcs: Any | None = None,
) -> tuple[float, float]:
    """Calculate sub-pixel coordinate (x_px, y_px) on cutout frame.

    Standard convention:
    - x corresponds to column index (West -> East: RA increases to the left / negative X in North-Up)
    - y corresponds to row index (South -> North: Dec increases upward / positive Y)
    - Center pixel: ( (W - 1) / 2.0, (H - 1) / 2.0 )
    """
    if wcs is not None:
        try:
            x_px, y_px = wcs.all_world2pix(ra_tk, dec_tk, 0)
            return float(x_px), float(y_px)
        except (AttributeError, ValueError, RuntimeError):
            pass  # Fall back to tangent-plane analytic projection

    height, width = cutout_shape
    center_x = (width - 1) / 2.0
    center_y = (height - 1) / 2.0

    cos_dec = math.cos(math.radians(crval_dec))
    d_ra_arcsec = (ra_tk - crval_ra) * cos_dec * ARCSEC_PER_DEG
    d_dec_arcsec = (dec_tk - crval_dec) * ARCSEC_PER_DEG

    # In North-Up, East-Left display: positive RA shift is East (left, negative x)
    # dx_px = - (ΔRA_arcsec / pixel_scale)
    # dy_px = + (ΔDec_arcsec / pixel_scale)
    target_x = center_x - (d_ra_arcsec / pixel_scale_arcsec)
    target_y = center_y + (d_dec_arcsec / pixel_scale_arcsec)

    return float(target_x), float(target_y)


def generate_subpixel_psf_kernel(
    cutout_shape: tuple[int, int],
    center_x: float,
    center_y: float,
    fwhm_px: float = SPHEREX_PSF_FWHM_PX,
    empirical_psf: np.ndarray | None = None,
) -> np.ndarray:
    """Generate normalized 2D Point Spread Function kernel centered at sub-pixel coordinates.

    Supports:
    1. Calibrated empirical 2D/3D PSF kernels from SPHEREx Level 2 MEF HDU 5.
    2. High-fidelity Gaussian/Moffat model matching the 1.2 px (~7.44") spatial profile.

    Returns:
        np.ndarray: 2D float32 array with sum == 1.0 (conserving integrated photon flux).
    """
    height, width = cutout_shape

    if empirical_psf is not None and empirical_psf.ndim == 2:
        # Re-center empirical HDU 5 PSF onto trial sub-pixel phase
        kh, kw = empirical_psf.shape
        k_center_x = (kw - 1) / 2.0
        k_center_y = (kh - 1) / 2.0

        # Allocate full cutout and place shifted empirical kernel
        full_psf = np.zeros((height, width), dtype=np.float32)
        y_grid, x_grid = np.indices((height, width), dtype=np.float32)

        # Map back to empirical kernel coordinates
        map_x = x_grid - (center_x - k_center_x)
        map_y = y_grid - (center_y - k_center_y)

        # Bilinear interpolation inside kernel bounds
        valid_mask = (map_x >= 0) & (map_x < kw - 1) & (map_y >= 0) & (map_y < kh - 1)
        x0 = np.floor(map_x).astype(np.int32)
        y0 = np.floor(map_y).astype(np.int32)
        x1 = x0 + 1
        y1 = y0 + 1

        wx = map_x - x0
        wy = map_y - y0

        x0 = np.clip(x0, 0, kw - 1)
        x1 = np.clip(x1, 0, kw - 1)
        y0 = np.clip(y0, 0, kh - 1)
        y1 = np.clip(y1, 0, kh - 1)

        val = (
            empirical_psf[y0, x0] * (1 - wx) * (1 - wy)
            + empirical_psf[y0, x1] * wx * (1 - wy)
            + empirical_psf[y1, x0] * (1 - wx) * wy
            + empirical_psf[y1, x1] * wx * wy
        )
        full_psf[valid_mask] = val[valid_mask]

        kernel_sum = float(np.sum(full_psf))
        if kernel_sum > 0:
            return full_psf / kernel_sum

    # Standard Calibrated Gaussian Kernel
    sigma_px = fwhm_px / (2.0 * math.sqrt(2.0 * math.log(2.0)))  # FWHM / 2.35482
    two_sigma_sq = 2.0 * sigma_px * sigma_px

    y_indices, x_indices = np.indices((height, width), dtype=np.float32)
    dist_sq = (x_indices - center_x) ** 2 + (y_indices - center_y) ** 2
    psf_kernel = np.exp(-dist_sq / two_sigma_sq)

    kernel_sum = float(np.sum(psf_kernel))
    if kernel_sum > 0:
        psf_kernel /= kernel_sum

    return psf_kernel.astype(np.float32)


def compute_epoch_flux(
    config: SyntheticSourceConfig,
    band_idx: int,
    obs_epoch_mjd: float,
) -> float:
    """Compute astrophysical flux in specified detector band at observation epoch t_k."""
    base_flux = (
        config.flux_band_mjy[band_idx]
        if config.flux_band_mjy and band_idx < len(config.flux_band_mjy)
        else 5.0
    )

    if not config.variability_model or config.variability_amplitude == 0.0:
        return float(base_flux)

    dt_days = obs_epoch_mjd - config.ref_epoch_mjd

    if config.variability_model == "occulting":
        # Pass 1 baseline, Pass 2/3 dimming (dimming_factor = 1.0 - amplitude)
        if dt_days > 100.0:
            return float(base_flux * max(0.05, 1.0 - config.variability_amplitude))
        return float(base_flux)
    elif config.variability_model == "pulsing":
        period = config.variability_period_days if config.variability_period_days > 0 else 245.0
        phase = (2.0 * math.pi * dt_days) / period
        factor = 1.0 + config.variability_amplitude * math.sin(phase)
        return float(base_flux * max(0.05, factor))
    elif config.variability_model == "flashing":
        # Alternating pulses
        is_flash = (int(dt_days / 150.0) % 2) == 1
        factor = (1.0 + config.variability_amplitude) if is_flash else 1.0
        return float(base_flux * factor)

    return float(base_flux)


def inject_synthetic_source_into_planes(
    flux_plane: np.ndarray,
    variance_plane: np.ndarray,
    flags_plane: np.ndarray,
    crval_ra: float,
    crval_dec: float,
    obs_epoch_mjd: float,
    band_idx: int,
    config: SyntheticSourceConfig,
    gain: float = 1.5,
    empirical_psf: np.ndarray | None = None,
    saturation_threshold: float = 120.0,
) -> dict[str, Any]:
    """Inject a synthetic proper-motion source into 2D (H, W) FLUX, VARIANCE, and FLAGS planes.

    Parameters:
        flux_plane: 2D float32 image array (modified in place)
        variance_plane: 2D float32 variance array (modified in place)
        flags_plane: 2D uint32 flags array (modified in place)
        crval_ra: Right Ascension at frame center in degrees
        crval_dec: Declination at frame center in degrees
        obs_epoch_mjd: Exposure observation epoch in MJD
        band_idx: SPHEREx band index (0 to 5)
        config: SyntheticSourceConfig
        gain: Detector gain in e-/flux units (default 1.5)
        empirical_psf: Optional empirical PSF from HDU 5
        saturation_threshold: Threshold to flag OVERFLOW in HDU 2 (FLAGS)

    Returns:
        dict: Metadata regarding the injected target for verification and logging.
    """
    height, width = flux_plane.shape

    # 1. Propagate sky coordinates
    ra_tk, dec_tk = propagate_proper_motion(config, obs_epoch_mjd)

    # 2. Map to cutout pixel coordinates
    target_x, target_y = calculate_pixel_centroid(
        ra_tk=ra_tk,
        dec_tk=dec_tk,
        crval_ra=crval_ra,
        crval_dec=crval_dec,
        cutout_shape=(height, width),
    )

    # 3. Check if target falls within cutout bounds (with 3-px margin)
    is_in_bounds = (-3 <= target_x < width + 3) and (-3 <= target_y < height + 3)

    injected_flux = 0.0
    if is_in_bounds:
        # 4. Compute target flux for this epoch & band
        target_flux = compute_epoch_flux(config, band_idx, obs_epoch_mjd)
        injected_flux = target_flux

        # 5. Generate sub-pixel convolved PSF
        psf_kernel = generate_subpixel_psf_kernel(
            cutout_shape=(height, width),
            center_x=target_x,
            center_y=target_y,
            empirical_psf=empirical_psf,
        )

        # 6. Convolve flux with PSF
        convolved_source = (target_flux * psf_kernel).astype(np.float32)

        # 7. Add convolved flux into FLUX plane (HDU 1 IMAGE)
        flux_plane += convolved_source

        # 8. Propagate Poisson shot noise variance into VARIANCE plane (HDU 3 VARIANCE)
        # Var_shot = max(0, I_inj) / gain
        shot_noise_variance = np.maximum(0.0, convolved_source) / max(0.1, gain)
        variance_plane += shot_noise_variance

        # 9. HDU 2 (FLAGS) Bitmask handling: Flag OVERFLOW (bit 1 = 2) if core exceeds threshold
        saturated_mask = flux_plane >= saturation_threshold
        if np.any(saturated_mask):
            flags_plane[saturated_mask] |= 2  # OVERFLOW bit

    return {
        "source_id": config.source_id,
        "obs_epoch_mjd": obs_epoch_mjd,
        "band_idx": band_idx,
        "ra_tk": ra_tk,
        "dec_tk": dec_tk,
        "target_x_px": target_x,
        "target_y_px": target_y,
        "is_in_bounds": is_in_bounds,
        "injected_flux": injected_flux,
        "is_synthetic": True,
        "source_badge": "Synthetic Injection",
    }


def inject_into_tensor_bundle(
    flux_tensor: np.ndarray,
    variance_tensor: np.ndarray,
    flags_tensor: np.ndarray,
    n_exp_tensor: np.ndarray,
    header: dict[str, Any],
    sources: list[SyntheticSourceConfig],
    survey_passes: list[dict[str, Any]] | None = None,
    gain: float = 1.5,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict[str, Any]]:
    """Inject one or more synthetic sources into a canonical 4D SPHEREx tensor bundle.

    Tensor shapes: [N_epochs, N_bands, Height, Width]

    Returns:
        tuple: (modified_flux, modified_variance, modified_flags, modified_n_exp, updated_header)
    """
    passes = survey_passes or DEFAULT_SURVEY_PASSES
    num_epochs, num_bands, _height, _width = flux_tensor.shape

    crval_ra = header.get("crval", [0.0, 0.0])[0]
    crval_dec = header.get("crval", [0.0, 0.0])[1]

    new_flux = copy.deepcopy(flux_tensor)
    new_variance = copy.deepcopy(variance_tensor)
    new_flags = copy.deepcopy(flags_tensor)
    new_n_exp = copy.deepcopy(n_exp_tensor)
    new_header = copy.deepcopy(header)

    injection_telemetry: list[dict[str, Any]] = []

    for src in sources:
        for e in range(num_epochs):
            obs_mjd = passes[e]["mjd"] if e < len(passes) else 60750.0 + e * 182.5
            for b in range(num_bands):
                res = inject_synthetic_source_into_planes(
                    flux_plane=new_flux[e, b],
                    variance_plane=new_variance[e, b],
                    flags_plane=new_flags[e, b],
                    crval_ra=crval_ra,
                    crval_dec=crval_dec,
                    obs_epoch_mjd=obs_mjd,
                    band_idx=b,
                    config=src,
                    gain=gain,
                )
                if res["is_in_bounds"]:
                    new_n_exp[e, b] = np.maximum(new_n_exp[e, b], 1)
                injection_telemetry.append(res)

    # Attach transparent calibration badges to header
    new_header["is_synthetic"] = True
    new_header["source_badge"] = "Synthetic Injection"
    new_header["synthetic_injections"] = [
        {
            "source_id": s.source_id,
            "spectral_class": s.spectral_class,
            "pm_ra_cosdec_mas_yr": s.pm_ra_cosdec_mas_yr,
            "pm_dec_mas_yr": s.pm_dec_mas_yr,
            "is_mover": s.is_mover,
            "is_variable": s.is_variable,
            "ground_truth_class": s.ground_truth_class,
        }
        for s in sources
    ]

    return new_flux, new_variance, new_flags, new_n_exp, new_header


def inject_into_fits_hdulist(
    hdul: Any,
    config: SyntheticSourceConfig,
    obs_epoch_mjd: float,
    band_idx: int = 4,  # D5 by default
    gain: float = 1.5,
) -> Any:
    """Inject synthetic source into an astropy.io.fits.HDUList MEF container.

    HDU 1: IMAGE
    HDU 2: FLAGS
    HDU 3: VARIANCE
    HDU 5: Empirical PSF (if present)
    """
    image_hdu = hdul[1]
    flags_hdu = hdul[2] if len(hdul) > 2 else None
    var_hdu = hdul[3] if len(hdul) > 3 else None
    psf_hdu = hdul[5] if len(hdul) > 5 else None

    flux_plane = image_hdu.data
    height, width = flux_plane.shape

    # Extract central WCS coordinates from header
    crval_ra = image_hdu.header.get("CRVAL1", config.ra_deg)
    crval_dec = image_hdu.header.get("CRVAL2", config.dec_deg)

    var_plane = var_hdu.data if var_hdu is not None else np.zeros((height, width), dtype=np.float32)
    flags_plane = (
        flags_hdu.data if flags_hdu is not None else np.zeros((height, width), dtype=np.uint32)
    )
    empirical_psf = psf_hdu.data if psf_hdu is not None else None

    res = inject_synthetic_source_into_planes(
        flux_plane=flux_plane,
        variance_plane=var_plane,
        flags_plane=flags_plane,
        crval_ra=crval_ra,
        crval_dec=crval_dec,
        obs_epoch_mjd=obs_epoch_mjd,
        band_idx=band_idx,
        config=config,
        gain=gain,
        empirical_psf=empirical_psf,
    )

    # Attach FITS header provenance keywords
    image_hdu.header["INJECTED"] = (True, "Synthetic source injected")
    image_hdu.header["SYNTH_ID"] = (config.source_id, "Injected synthetic identifier")
    image_hdu.header["SYNTH_RA"] = (config.ra_deg, "Injected source ref RA (deg)")
    image_hdu.header["SYNTH_DE"] = (config.dec_deg, "Injected source ref Dec (deg)")
    image_hdu.header["SYN_PMRA"] = (config.pm_ra_cosdec_mas_yr, "Injected proper motion RA (mas/yr)")
    image_hdu.header["SYN_PMDE"] = (config.pm_dec_mas_yr, "Injected proper motion Dec (mas/yr)")
    image_hdu.header["BADGE"] = ("Synthetic Injection", "Data honesty attribution badge")

    return hdul, res


# ============================================================================
# Active Learning Calibration Loop & Volunteer Reliability Tracking (Issue #24)
# ============================================================================


# Taxonomy mappings to handle citizen science classification tags
MOVER_CLASSES = {
    "mover",
    "moving_brown_dwarf",
    "high_proper_motion",
    "high_proper_motion_star",
    "dipole",
    "#mover",
    "#dipole",
}
VARIABLE_CLASSES = {
    "variable",
    "variable_star",
    "pulsing",
    "occulting",
    "flashing",
    "#variable",
    "#flashing",
}
STATIONARY_CLASSES = {
    "stationary",
    "stationary_star",
    "constant",
    "control",
    "reference",
    "flat_control",
    "#stationary",
}
ARTIFACT_CLASSES = {
    "artifact",
    "optical_blend",
    "blend_artifact",
    "diffraction_spike",
    "#blend_artifact",
    "#artifact",
}


def evaluate_volunteer_classification(
    ground_truth: SyntheticSourceConfig,
    volunteer_choice: str,
) -> bool:
    """Evaluate whether a volunteer's classification accurately identifies ground truth.

    Normalizes synonyms and tags across citizen science taxonomy.
    """
    clean_choice = volunteer_choice.strip().lower()

    if clean_choice == ground_truth.ground_truth_class.lower():
        return True

    if ground_truth.is_mover and (clean_choice in MOVER_CLASSES):
        return True

    if ground_truth.is_variable and (clean_choice in VARIABLE_CLASSES):
        return True

    if not ground_truth.is_mover and not ground_truth.is_variable:
        # Stationary control: correct if identified as stationary / not a mover or variable
        return (
            clean_choice in STATIONARY_CLASSES
            or clean_choice not in (MOVER_CLASSES | VARIABLE_CLASSES)
        )

    return False


def update_bayesian_reliability(
    current_weight: float,
    calibration_seen: int,
    calibration_correct: int,
    is_correct: bool,
    prior_alpha: float = 2.0,
    prior_beta: float = 1.0,
    min_weight: float = 0.1,
    max_weight: float = 1.0,
) -> tuple[float, int, int]:
    """Compute Bayesian reliability weight w_u update upon classification of calibration control.

    Uses Beta-Binomial conjugate update model:
      w_u = (α_0 + C_correct) / (α_0 + β_0 + C_seen)
    clamped to [min_weight, max_weight].

    Parameters:
        current_weight: Previous w_u snapshot
        calibration_seen: Total calibration controls evaluated by volunteer
        calibration_correct: Correct calibration classifications
        is_correct: Whether the current submission matches ground truth
        prior_alpha: Beta prior positive parameter (default 2.0)
        prior_beta: Beta prior negative parameter (default 1.0)
        min_weight: Lower bound (0.1)
        max_weight: Upper bound (1.0)

    Returns:
        tuple: (new_weight, new_calibration_seen, new_calibration_correct)
    """
    new_seen = calibration_seen + 1
    new_correct = calibration_correct + (1 if is_correct else 0)

    raw_weight = (prior_alpha + new_correct) / (prior_alpha + prior_beta + new_seen)
    bounded_weight = max(min_weight, min(max_weight, raw_weight))

    return round(bounded_weight, 4), new_seen, new_correct


def compute_calibration_metrics(
    evaluations: list[dict[str, Any]],
) -> dict[str, float]:
    """Compute ROC, precision, recall, and sensitivity metrics across synthetic calibration controls.

    Expects list of dicts with keys:
      - 'is_actual_mover': bool (ground truth)
      - 'predicted_mover': bool (volunteer classification)

    Returns:
        dict: TPR, FPR, precision, recall, f1_score, accuracy
    """
    if not evaluations:
        return {
            "tpr": 0.0,
            "fpr": 0.0,
            "precision": 0.0,
            "recall": 0.0,
            "f1_score": 0.0,
            "accuracy": 0.0,
            "total": 0,
        }

    tp = 0
    fp = 0
    tn = 0
    fn = 0

    for ev in evaluations:
        actual = bool(ev.get("is_actual_mover", False))
        predicted = bool(ev.get("predicted_mover", False))

        if actual and predicted:
            tp += 1
        elif not actual and predicted:
            fp += 1
        elif not actual and not predicted:
            tn += 1
        else:
            fn += 1

    total = tp + fp + tn + fn
    tpr = tp / (tp + fn) if (tp + fn) > 0 else 0.0  # Sensitivity / Recall
    fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0  # Fall-out
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    accuracy = (tp + tn) / total if total > 0 else 0.0
    f1 = 2.0 * (precision * tpr) / (precision + tpr) if (precision + tpr) > 0 else 0.0

    return {
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "tpr": round(tpr, 4),
        "fpr": round(fpr, 4),
        "precision": round(precision, 4),
        "recall": round(tpr, 4),
        "f1_score": round(f1, 4),
        "accuracy": round(accuracy, 4),
        "total": total,
    }
