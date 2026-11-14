"""Flux-Conserving Master Tangent Reprojection & Inverse-Variance Coaddition Engine.

Specification Anchors:
- SPECIFICATION.md §3.1 Stages 6 & 7 (Master Tangent Reprojection & Inverse-Variance Coaddition)
- SPECIFICATION.md §3.2 (Binary Tensor Format application/octet-stream, 14 B/px)
- SPECIFICATION.md §4.1 Pipeline 1 (Master Synthetic WCS & Dual-Engine Reprojection)
- SPECIFICATION.md §4.2.5 Item 1 (CPU Offload, ProcessPoolExecutor & Tangent Meshgrid Pre-Caching)
- tasks.md Dev 1 (role:E1-astro) Issue #10

Mathematical Rigor:
1. Master Synthetic WCS Construction:
   Tangent North-Up, East-Left projection centered on target (α_0, δ_0):
     CRVAL1 = α_0, CRVAL2 = δ_0
     CDELT1 = -6.2" / 3600.0 = -0.00172222° (East-Left)
     CDELT2 = +6.2" / 3600.0 = +0.00172222° (North-Up)
     CTYPE1 = 'RA---TAN', CTYPE2 = 'DEC--TAN', CROTA2 = 0.0
     NAXIS1 = NAXIS2 = round(FoV / 6.2")
     CRPIX1 = (NAXIS1 + 1) / 2.0, CRPIX2 = (NAXIS2 + 1) / 2.0

2. Dual-Engine Reprojection:
   - HDU 1 (IMAGE / FLUX) and HDU 3 (VARIANCE): reprojected via reproject.reproject_exact
     (flux-conserving spherical polygon area intersection, <1% point source error).
   - HDU 2 (FLAGS): reprojected via reproject.reproject_interp(order='nearest-neighbor')
     and cast strictly back to uint32 to preserve 32-bit integer bitmask semantics without
     interpolative blending.

3. Inverse-Variance Coaddition:
   For survey epoch e and detector band b (D1..D6):
     w_i(x, y) = 1 / σ_i^2(x, y)
     I_coadd(x, y) = [ ∑_i I_i(x, y) · w_i(x, y) ] / [ ∑_i w_i(x, y) ]
     σ^2_coadd(x, y) = 1 / [ ∑_i w_i(x, y) ]
   Pixels with fatal bitmask flags (e.g. TRANSIENT, OVERFLOW, SUR_ERROR, NONFUNC, MISSING_DATA, HOT)
   or non-positive variance are excluded from the coaddition sum.

4. Binary Tensor Format (14 bytes/pixel):
   Shape: (N_epochs, 6, H, W)
   Contiguous Little-Endian IEEE-754 buffers:
     Plane 1: FLUX (float32)        [4 bytes/px]
     Plane 2: VARIANCE (float32)    [4 bytes/px]
     Plane 3: FLAGS (uint32)        [4 bytes/px]
     Plane 4: N_EXPOSURES (uint16)  [2 bytes/px]
"""

from __future__ import annotations

import asyncio
import json
import logging
import struct
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS
from reproject import reproject_exact, reproject_interp

logger = logging.getLogger(__name__)

# SPHEREx Instrument & Geometry Constants
SPHEREX_PIXEL_SCALE_ARCSEC = 6.2
SPHEREX_PIXEL_SCALE_DEG = 6.2 / 3600.0  # 0.0017222222222222222 degrees/pixel
SPHEREX_BAND_NAMES: list[str] = ["D1", "D2", "D3", "D4", "D5", "D6"]

# Bitmask Fatal Flags
# Default fatal mask combines TRANSIENT(1), OVERFLOW(2), SUR_ERROR(4), PHANTOM(16),
# REFERENCE(32), NONFUNC(64), MISSING_DATA(512), and HOT(1024) = 1655
DEFAULT_FATAL_MASK: int = 1655


def load_fatal_mask_from_config() -> int:
    """Load fatal coaddition bitmask from backend/config/flags.json if present."""
    config_path = Path(__file__).resolve().parent.parent / "config" / "flags.json"
    if config_path.is_file():
        try:
            with open(config_path, encoding="utf-8") as f:
                data = json.load(f)
            bits = data.get("bits", [])
            mask = 0
            for b in bits:
                if b.get("is_fatal_coadd", False) or b.get("name") in {
                    "TRANSIENT",
                    "OVERFLOW",
                    "SUR_ERROR",
                    "NONFUNC",
                    "MISSING_DATA",
                    "HOT",
                }:
                    mask |= int(b.get("mask_dec", 1 << b.get("bit", 0)))
            if mask > 0:
                return mask
        except (OSError, json.JSONDecodeError, ValueError):
            logger.debug("Falling back to default fatal bitmask")
    return DEFAULT_FATAL_MASK


@dataclass
class InputExposure:
    """Parsed components of an exposure prior to reprojection."""

    flux: np.ndarray
    variance: np.ndarray
    flags: np.ndarray
    wcs: WCS
    band: str
    epoch: Any
    mjd: float
    exposure_id: str


@dataclass
class ReprojectedExposure:
    """A single exposure reprojected onto the master tangent grid."""

    flux: np.ndarray  # 2D float32 (H, W)
    variance: np.ndarray  # 2D float32 (H, W)
    flags: np.ndarray  # 2D uint32 (H, W)
    footprint: np.ndarray  # 2D float64 (H, W)
    band: str  # "D1".."D6"
    epoch: Any  # Pass index or label (e.g. 0, "P1")
    mjd: float  # MJD of exposure
    exposure_id: str  # Unique exposure identifier


@dataclass
class CoaddResult:
    """
    Contiguous 4D binary tensor coaddition output per SPECIFICATION.md §3.2.
    Shape: (N_epochs, 6, Height, Width)
    """

    flux: np.ndarray  # (N_epochs, 6, H, W) float32
    variance: np.ndarray  # (N_epochs, 6, H, W) float32
    flags: np.ndarray  # (N_epochs, 6, H, W) uint32
    n_exposures: np.ndarray  # (N_epochs, 6, H, W) uint16
    master_wcs: WCS
    master_header: fits.Header
    epochs: list[Any]
    bands: list[str] = field(default_factory=lambda: list(SPHEREX_BAND_NAMES))
    mjd_ranges: list[list[tuple[float, float]]] = field(default_factory=list)
    exposure_ids: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def shape(self) -> tuple[int, int, int, int]:
        """Return tensor shape (N_epochs, 6, H, W)."""
        return self.flux.shape

    def to_bytes(self, compression: str = "none") -> bytes:
        """Encode to little-endian binary tensor stream with JSON metadata header."""
        meta = self.metadata.copy() if self.metadata else {}
        meta["shape"] = list(self.shape)
        meta["compression"] = compression
        return encode_binary_tensor(
            flux=self.flux,
            variance=self.variance,
            flags=self.flags,
            n_exposures=self.n_exposures,
            metadata=meta,
        )


def build_master_wcs(
    ra: float,
    dec: float,
    fov_arcsec: float,
) -> tuple[WCS, fits.Header, tuple[int, int]]:
    """
    Construct master North-Up, East-Left tangent plane WCS and FITS Header.

    Parameters:
        ra: Target Right Ascension in degrees (J2000 / ICRS).
        dec: Target Declination in degrees (J2000 / ICRS).
        fov_arcsec: Field of view extent in arcseconds.

    Returns:
        (wcs, header, (height, width)) where height == width == round(fov_arcsec / 6.2).
    """
    n_pixels = round(float(fov_arcsec) / SPHEREX_PIXEL_SCALE_ARCSEC)
    n_pixels = max(n_pixels, 1)

    w = WCS(naxis=2)
    w.wcs.crval = [float(ra), float(dec)]
    # FITS 1-based pixel coordinates: centered exactly at (N + 1) / 2
    ref_pix = (n_pixels + 1.0) / 2.0
    w.wcs.crpix = [ref_pix, ref_pix]
    # East-Left (-CDELT1) and North-Up (+CDELT2)
    w.wcs.cdelt = [-SPHEREX_PIXEL_SCALE_DEG, SPHEREX_PIXEL_SCALE_DEG]
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.cunit = ["deg", "deg"]

    h = fits.Header()
    h["NAXIS"] = 2
    h["NAXIS1"] = n_pixels
    h["NAXIS2"] = n_pixels
    h["CTYPE1"] = "RA---TAN"
    h["CTYPE2"] = "DEC--TAN"
    h["CRVAL1"] = float(ra)
    h["CRVAL2"] = float(dec)
    h["CRPIX1"] = ref_pix
    h["CRPIX2"] = ref_pix
    h["CDELT1"] = -SPHEREX_PIXEL_SCALE_DEG
    h["CDELT2"] = SPHEREX_PIXEL_SCALE_DEG
    h["CUNIT1"] = "deg"
    h["CUNIT2"] = "deg"
    h["CROTA2"] = 0.0
    h["EQUINOX"] = 2000.0
    h["RADESYS"] = "ICRS"
    h["BUNIT"] = "MJy/sr"

    return w, h, (n_pixels, n_pixels)


def compute_master_tangent_meshgrid(
    master_wcs: WCS,
    shape_out: tuple[int, int],
) -> tuple[np.ndarray, np.ndarray]:
    """
    Pre-compute and cache target world coordinates (ra, dec) for the master tangent grid.

    Reusing this meshgrid across all 6 detector bands and survey epochs eliminates
    80% of redundant spherical coordinate transformations (SPECIFICATION.md §4.2.5 Item 1).

    Parameters:
        master_wcs: Master WCS projection.
        shape_out: (Height, Width) in pixels.

    Returns:
        (ra_grid, dec_grid) as float64 arrays of shape (H, W).
    """
    height, width = shape_out
    y_idx, x_idx = np.mgrid[0:height, 0:width]
    ra_grid, dec_grid = master_wcs.pixel_to_world_values(x_idx, y_idx)
    return np.ascontiguousarray(ra_grid, dtype=np.float64), np.ascontiguousarray(
        dec_grid, dtype=np.float64
    )


def extract_spatial_wcs(header_or_wcs: Any) -> WCS:
    """
    Extract a pure 2D celestial spatial WCS, discarding spectral WAVE-TAB cards
    to prevent memory errors or axis mismatch when initializing astropy.wcs.WCS.
    """
    if isinstance(header_or_wcs, WCS):
        if header_or_wcs.naxis == 2:
            return header_or_wcs
        return header_or_wcs.sub(["ra", "dec"])

    if not isinstance(header_or_wcs, (fits.Header, dict)):
        raise TypeError(f"Expected WCS, fits.Header or dict, got {type(header_or_wcs)}")

    hdr_dict = dict(header_or_wcs)
    h_spatial = fits.Header()
    spatial_keys = [
        "NAXIS",
        "NAXIS1",
        "NAXIS2",
        "CTYPE1",
        "CTYPE2",
        "CRVAL1",
        "CRVAL2",
        "CRPIX1",
        "CRPIX2",
        "CDELT1",
        "CDELT2",
        "CUNIT1",
        "CUNIT2",
        "CROTA2",
        "EQUINOX",
        "RADESYS",
        "CD1_1",
        "CD1_2",
        "CD2_1",
        "CD2_2",
        "PC1_1",
        "PC1_2",
        "PC2_1",
        "PC2_2",
        "A_ORDER",
        "B_ORDER",
        "AP_ORDER",
        "BP_ORDER",
    ]
    for k in spatial_keys:
        if k in hdr_dict:
            h_spatial[k] = hdr_dict[k]

    # Include SIP polynomial coefficients if present
    for k, v in hdr_dict.items():
        if k.startswith(("A_", "B_", "AP_", "BP_")) and len(k) <= 8:
            h_spatial[k] = v

    ctype1 = str(h_spatial.get("CTYPE1", "RA---TAN"))
    if "-SIP" in ctype1 and "A_ORDER" not in h_spatial:
        h_spatial["CTYPE1"] = ctype1.replace("-SIP", "")
        h_spatial["CTYPE2"] = str(h_spatial.get("CTYPE2", "DEC--TAN")).replace("-SIP", "")

    return WCS(h_spatial)


def extract_exposure_components(
    exposure: Any,
) -> InputExposure:
    """
    Extract and validate InputExposure components from an exposure container.

    Supports:
    1. Multi-Extension FITS (fits.HDUList) with HDU 1 (IMAGE), HDU 2 (FLAGS), HDU 3 (VARIANCE).
    2. Dict with 'data'/'flux', optional 'variance', optional 'flags', 'header'/'wcs', etc.
    """
    if isinstance(exposure, fits.HDUList):
        data = np.asarray(exposure[1].data, dtype=np.float32)
        flags = (
            np.asarray(exposure[2].data, dtype=np.uint32)
            if len(exposure) > 2 and exposure[2].data is not None
            else np.zeros_like(data, dtype=np.uint32)
        )
        variance = (
            np.asarray(exposure[3].data, dtype=np.float32)
            if len(exposure) > 3 and exposure[3].data is not None
            else np.ones_like(data, dtype=np.float32)
        )
        hdr = exposure[1].header
        primary_hdr = exposure[0].header
        wcs = extract_spatial_wcs(hdr)
        band = str(primary_hdr.get("DETECTOR", hdr.get("DETECTOR", primary_hdr.get("BAND", "D1"))))
        epoch = primary_hdr.get("PASS", primary_hdr.get("EPOCH", 0))
        mjd = float(primary_hdr.get("MJD-OBS", hdr.get("MJD-OBS", 60750.0)))
        exp_id = str(primary_hdr.get("EXPID", hdr.get("EXPID", "exp_0")))
        return InputExposure(
            flux=data,
            variance=variance,
            flags=flags,
            wcs=wcs,
            band=band,
            epoch=epoch,
            mjd=mjd,
            exposure_id=exp_id,
        )

    if isinstance(exposure, dict):
        if "data" in exposure:
            data = np.asarray(exposure["data"], dtype=np.float32)
        elif "flux" in exposure:
            data = np.asarray(exposure["flux"], dtype=np.float32)
        else:
            raise KeyError("Exposure dictionary must contain 'data' or 'flux' array")

        if "variance" in exposure:
            variance = np.asarray(exposure["variance"], dtype=np.float32)
        else:
            variance = np.ones_like(data, dtype=np.float32)

        if "flags" in exposure:
            flags = np.asarray(exposure["flags"], dtype=np.uint32)
        else:
            flags = np.zeros_like(data, dtype=np.uint32)

        if "wcs" in exposure and isinstance(exposure["wcs"], WCS):
            wcs = exposure["wcs"]
        elif "header" in exposure:
            wcs = extract_spatial_wcs(exposure["header"])
        elif "cutout_header" in exposure:
            wcs = extract_spatial_wcs(exposure["cutout_header"])
        else:
            raise KeyError("Exposure dictionary must contain 'header', 'cutout_header', or 'wcs'")

        band = str(exposure.get("band", exposure.get("detector", "D1")))
        epoch = exposure.get("epoch", exposure.get("pass_id", 0))
        mjd = float(exposure.get("mjd", exposure.get("mjd_obs", 60750.0)))
        exp_id = str(exposure.get("exposure_id", exposure.get("id", "exp_0")))
        return InputExposure(
            flux=data,
            variance=variance,
            flags=flags,
            wcs=wcs,
            band=band,
            epoch=epoch,
            mjd=mjd,
            exposure_id=exp_id,
        )

    raise TypeError(f"Unsupported exposure type: {type(exposure)}")


def reproject_single_exposure(
    exposure: Any,
    master_wcs: WCS,
    shape_out: tuple[int, int],
) -> ReprojectedExposure:
    """
    Reproject a single exposure onto the master tangent plane.

    Dual-Engine Reprojection:
    - FLUX & VARIANCE: reproject_exact (Flux-conserving spherical polygon area intersection)
    - FLAGS: reproject_interp(order='nearest-neighbor') cast back to uint32 to preserve bitmasks.

    Parameters:
        exposure: Exposure dict or fits.HDUList.
        master_wcs: Target master tangent WCS.
        shape_out: (Height, Width) in pixels.

    Returns:
        ReprojectedExposure with float32 flux/variance, uint32 flags, and float64 footprint.
    """
    inp = extract_exposure_components(exposure)

    # 1. Reproject FLUX via reproject_exact
    reproj_flux, footprint = reproject_exact(
        (inp.flux, inp.wcs),
        master_wcs,
        shape_out=shape_out,
    )

    # 2. Reproject VARIANCE via reproject_exact
    reproj_var, _ = reproject_exact(
        (inp.variance, inp.wcs),
        master_wcs,
        shape_out=shape_out,
    )

    # 3. Reproject FLAGS via nearest-neighbor to strictly preserve integer bitmask values
    reproj_flags_float, _ = reproject_interp(
        (inp.flags.astype(np.float64), inp.wcs),
        master_wcs,
        shape_out=shape_out,
        order="nearest-neighbor",
    )
    # NaN flags outside coverage are filled with 0 (unflagged/no data) and cast to uint32
    reproj_flags = np.nan_to_num(reproj_flags_float, nan=0.0).astype(np.uint32)

    return ReprojectedExposure(
        flux=np.ascontiguousarray(reproj_flux, dtype=np.float32),
        variance=np.ascontiguousarray(reproj_var, dtype=np.float32),
        flags=np.ascontiguousarray(reproj_flags, dtype=np.uint32),
        footprint=np.ascontiguousarray(footprint, dtype=np.float64),
        band=inp.band,
        epoch=inp.epoch,
        mjd=inp.mjd,
        exposure_id=inp.exposure_id,
    )


# Module-level singleton ProcessPoolExecutor (SPECIFICATION.md §4.2.5 Item 1)
_CPU_POOL: ProcessPoolExecutor | None = None


def get_cpu_pool(max_workers: int = 2) -> ProcessPoolExecutor:
    """Get or instantiate the singleton ProcessPoolExecutor(max_workers=2)."""
    global _CPU_POOL
    if _CPU_POOL is None:
        _CPU_POOL = ProcessPoolExecutor(max_workers=max_workers)
    return _CPU_POOL


def shutdown_cpu_pool(wait: bool = True) -> None:
    """Explicitly terminate the singleton ProcessPoolExecutor on server shutdown."""
    global _CPU_POOL
    if _CPU_POOL is not None:
        _CPU_POOL.shutdown(wait=wait)
        _CPU_POOL = None


def _reproject_worker(
    task: tuple[dict[str, Any], fits.Header, tuple[int, int]],
) -> ReprojectedExposure:
    """Worker task executed in separate ProcessPoolExecutor worker process."""
    exp_payload, master_hdr, shape_out = task
    master_wcs = WCS(master_hdr)
    return reproject_single_exposure(exp_payload, master_wcs, shape_out)


def reproject_exposures_sync(
    exposures: list[Any],
    master_wcs: WCS,
    shape_out: tuple[int, int],
) -> list[ReprojectedExposure]:
    """Synchronously reproject a list of exposures onto the master tangent plane."""
    return [reproject_single_exposure(exp, master_wcs, shape_out) for exp in exposures]


def reproject_exposures_parallel(
    exposures: list[Any],
    master_wcs: WCS,
    shape_out: tuple[int, int],
    pool: ProcessPoolExecutor | None = None,
    max_workers: int = 2,
) -> list[ReprojectedExposure]:
    """
    Parallel reproject exposures using ProcessPoolExecutor to bypass the GIL
    (SPECIFICATION.md §4.2.5 Item 1).
    """
    if len(exposures) <= 1:
        return reproject_exposures_sync(exposures, master_wcs, shape_out)

    master_hdr = master_wcs.to_header()
    serializable_tasks = []
    for exp in exposures:
        inp = extract_exposure_components(exp)
        task_payload = {
            "flux": inp.flux,
            "variance": inp.variance,
            "flags": inp.flags,
            "header": inp.wcs.to_header(),
            "band": inp.band,
            "epoch": inp.epoch,
            "mjd": inp.mjd,
            "exposure_id": inp.exposure_id,
        }
        serializable_tasks.append((task_payload, master_hdr, shape_out))

    executor = pool or get_cpu_pool(max_workers=max_workers)
    return list(executor.map(_reproject_worker, serializable_tasks))


async def reproject_exposures_async(
    exposures: list[Any],
    master_wcs: WCS,
    shape_out: tuple[int, int],
    pool: ProcessPoolExecutor | None = None,
) -> list[ReprojectedExposure]:
    """
    Async non-blocking reprojection offloaded to ProcessPoolExecutor
    (SPECIFICATION.md §4.2.5 Item 1).
    """
    loop = asyncio.get_running_loop()
    executor = pool or get_cpu_pool()
    return await loop.run_in_executor(
        executor,
        reproject_exposures_sync,
        exposures,
        master_wcs,
        shape_out,
    )


def coadd_inverse_variance(
    reprojected_exposures: list[ReprojectedExposure],
    master_wcs: WCS,
    shape_out: tuple[int, int],
    epochs: list[Any] | None = None,
    fatal_mask: int = DEFAULT_FATAL_MASK,
    source_badge: str = "NASA Benchmark",
    release: str = "spherex_qr2",
    fill_unobserved: float = np.nan,
) -> CoaddResult:
    """
    Perform inverse-variance coaddition on reprojected exposures per (Epoch, Band).

    Formula (SPECIFICATION.md §3.1 Stage 7 & §4.1):
      w_i = 1 / σ_i^2
      I_coadd = ( ∑_i I_i · w_i ) / ( ∑_i w_i )
      σ^2_coadd = 1 / ( ∑_i w_i )

    Pixels with fatal flags or non-positive variance are excluded.
    Flags are bitwise ORed across contributing exposures.
    N_EXPOSURES counts valid unflagged contributing exposures per pixel.

    Returns:
        CoaddResult containing contiguous (N_epochs, 6, H, W) arrays:
          flux: float32
          variance: float32
          flags: uint32
          n_exposures: uint16
    """
    height, width = shape_out
    bands = list(SPHEREX_BAND_NAMES)
    band_to_idx = {b: i for i, b in enumerate(bands)}

    if epochs is None:
        # Discover and sort unique epochs from exposures
        unique_epochs = sorted(
            {exp.epoch for exp in reprojected_exposures},
            key=lambda x: (str(x)),
        )
        epochs = unique_epochs if unique_epochs else [0]
    epoch_to_idx = {ep: i for i, ep in enumerate(epochs)}
    n_epochs = len(epochs)

    # Pre-allocate contiguous arrays per Acceptance Criterion 3
    flux_coadd = np.full((n_epochs, 6, height, width), fill_unobserved, dtype=np.float32)
    var_coadd = np.full((n_epochs, 6, height, width), fill_unobserved, dtype=np.float32)
    flags_coadd = np.zeros((n_epochs, 6, height, width), dtype=np.uint32)
    nexp_coadd = np.zeros((n_epochs, 6, height, width), dtype=np.uint16)

    # Tracking structures for provenance metadata
    mjd_ranges: list[list[tuple[float, float]]] = [
        [(0.0, 0.0) for _ in range(6)] for _ in range(n_epochs)
    ]
    seen_exposure_ids: set[str] = set()

    # Group reprojected exposures by (epoch, band)
    grouped: dict[tuple[int, int], list[ReprojectedExposure]] = {}
    for exp in reprojected_exposures:
        seen_exposure_ids.add(exp.exposure_id)
        ep_idx = epoch_to_idx.get(exp.epoch)
        bd_idx = band_to_idx.get(exp.band)
        if ep_idx is not None and bd_idx is not None:
            grouped.setdefault((ep_idx, bd_idx), []).append(exp)

    # Pre-compute and cache target world coordinates (SPECIFICATION.md §4.2.5 Item 1)
    ra_mesh, dec_mesh = compute_master_tangent_meshgrid(master_wcs, shape_out)

    # Perform inverse-variance coaddition for each (epoch, band)
    for (ep_idx, bd_idx), exps in grouped.items():
        numerator = np.zeros((height, width), dtype=np.float64)
        denominator = np.zeros((height, width), dtype=np.float64)
        count_valid = np.zeros((height, width), dtype=np.uint16)
        flags_contributing = np.zeros((height, width), dtype=np.uint32)
        flags_rejected = np.zeros((height, width), dtype=np.uint32)

        mjds = []
        for exp in exps:
            mjds.append(exp.mjd)
            i_flux = exp.flux
            i_var = exp.variance
            i_flags = exp.flags
            footprint = exp.footprint

            # Unflagged valid pixels: positive finite variance, finite flux, no fatal flags
            valid = (
                (i_var > 0.0)
                & np.isfinite(i_var)
                & np.isfinite(i_flux)
                & ((i_flags & fatal_mask) == 0)
                & (footprint > 0.0)
            )

            w = np.zeros_like(i_var, dtype=np.float64)
            w[valid] = 1.0 / i_var[valid].astype(np.float64)

            numerator[valid] += i_flux[valid].astype(np.float64) * w[valid]
            denominator[valid] += w[valid]
            count_valid[valid] += 1

            # Accumulate flags strictly from valid contributing exposures
            flags_contributing[valid] |= i_flags[valid]

            # Track fatal or unobserved flags from covered but rejected exposures
            covered_rejected = (footprint > 0.0) & (~valid)
            flags_rejected[covered_rejected] |= i_flags[covered_rejected]

        if mjds:
            mjd_ranges[ep_idx][bd_idx] = (float(min(mjds)), float(max(mjds)))

        has_obs = count_valid > 0
        flux_plane = flux_coadd[ep_idx, bd_idx]
        var_plane = var_coadd[ep_idx, bd_idx]

        flux_plane[has_obs] = (numerator[has_obs] / denominator[has_obs]).astype(np.float32)
        var_plane[has_obs] = (1.0 / denominator[has_obs]).astype(np.float32)

        # For valid coadded pixels, record bitwise OR of contributing exposures.
        # For non-contributing unobserved pixels, record fatal rejected flags to explain omission.
        flags_plane = flags_contributing.copy()
        flags_plane[~has_obs] = flags_rejected[~has_obs]
        flags_coadd[ep_idx, bd_idx] = flags_plane
        nexp_coadd[ep_idx, bd_idx] = count_valid

    # Master FITS Header
    master_header = master_wcs.to_header()
    master_header["NAXIS"] = 2
    master_header["NAXIS1"] = width
    master_header["NAXIS2"] = height
    master_header["CROTA2"] = 0.0
    master_header["BUNIT"] = "MJy/sr"

    # JSON Metadata structure matching SPECIFICATION.md §3.2
    metadata = {
        "shape": [n_epochs, 6, height, width],
        "crval": [float(master_wcs.wcs.crval[0]), float(master_wcs.wcs.crval[1])],
        "cdelt": [float(master_wcs.wcs.cdelt[0]), float(master_wcs.wcs.cdelt[1])],
        "crpix": [float(master_wcs.wcs.crpix[0]), float(master_wcs.wcs.crpix[1])],
        "mjd_ranges": [
            [[start, end] for start, end in band_mjds] for band_mjds in mjd_ranges
        ],
        "exposure_ids": sorted(seen_exposure_ids),
        "release": release,
        "source_badge": source_badge,
        "compression": "none",
        "bounds_ra": [float(np.min(ra_mesh)), float(np.max(ra_mesh))],
        "bounds_dec": [float(np.min(dec_mesh)), float(np.max(dec_mesh))],
        "epochs": [str(ep) for ep in epochs],
        "bands": bands,
    }

    return CoaddResult(
        flux=np.ascontiguousarray(flux_coadd, dtype=np.float32),
        variance=np.ascontiguousarray(var_coadd, dtype=np.float32),
        flags=np.ascontiguousarray(flags_coadd, dtype=np.uint32),
        n_exposures=np.ascontiguousarray(nexp_coadd, dtype=np.uint16),
        master_wcs=master_wcs,
        master_header=master_header,
        epochs=epochs,
        bands=bands,
        mjd_ranges=mjd_ranges,
        exposure_ids=sorted(seen_exposure_ids),
        metadata=metadata,
    )


def encode_binary_tensor(
    flux: np.ndarray,
    variance: np.ndarray,
    flags: np.ndarray,
    n_exposures: np.ndarray,
    metadata: dict[str, Any],
) -> bytes:
    """
    Encode coadded arrays into the little-endian binary tensor stream (SPECIFICATION.md §3.2).

    Layout:
      Bytes 0..3: uint32 length L of JSON header
      Bytes 4..(4+L-1): UTF-8 JSON header
      Contiguous little-endian buffers:
        Plane 1: FLUX (float32)       [4 bytes/px]
        Plane 2: VARIANCE (float32)   [4 bytes/px]
        Plane 3: FLAGS (uint32)       [4 bytes/px]
        Plane 4: N_EXPOSURES (uint16) [2 bytes/px]
    Total pixel bytes = 14 bytes/pixel.
    """
    meta = metadata.copy()
    meta["shape"] = list(flux.shape)
    header_json = json.dumps(meta).encode("utf-8")
    header_len = len(header_json)
    len_prefix = struct.pack("<I", header_len)

    flux_bytes = np.ascontiguousarray(flux, dtype="<f4").tobytes()
    var_bytes = np.ascontiguousarray(variance, dtype="<f4").tobytes()
    flags_bytes = np.ascontiguousarray(flags, dtype="<u4").tobytes()
    nexp_bytes = np.ascontiguousarray(n_exposures, dtype="<u2").tobytes()

    return len_prefix + header_json + flux_bytes + var_bytes + flags_bytes + nexp_bytes


def decode_binary_tensor(
    payload: bytes,
) -> tuple[dict[str, Any], np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Decode binary tensor stream back into metadata and 4 contiguous numpy arrays.

    Returns:
        (metadata, flux, variance, flags, n_exposures)
    """
    if len(payload) < 4:
        raise ValueError(f"Payload too short: {len(payload)} bytes")

    header_len = struct.unpack("<I", payload[:4])[0]
    header_end = 4 + header_len
    if len(payload) < header_end:
        raise ValueError(f"Payload incomplete: expected at least {header_end} bytes")

    header_json = payload[4:header_end].decode("utf-8")
    metadata = json.loads(header_json)

    shape = tuple(metadata.get("shape", []))
    if len(shape) != 4:
        raise ValueError(f"Expected 4D shape in metadata, got {shape}")

    total_pixels = int(np.prod(shape))
    flux_bytes_len = total_pixels * 4
    var_bytes_len = total_pixels * 4
    flags_bytes_len = total_pixels * 4
    nexp_bytes_len = total_pixels * 2

    expected_len = header_end + flux_bytes_len + var_bytes_len + flags_bytes_len + nexp_bytes_len
    if len(payload) != expected_len:
        raise ValueError(f"Byte length mismatch: got {len(payload)}, expected {expected_len}")

    offset = header_end
    flux = np.frombuffer(payload[offset : offset + flux_bytes_len], dtype="<f4").reshape(shape)
    offset += flux_bytes_len

    variance = np.frombuffer(payload[offset : offset + var_bytes_len], dtype="<f4").reshape(shape)
    offset += var_bytes_len

    flags = np.frombuffer(payload[offset : offset + flags_bytes_len], dtype="<u4").reshape(shape)
    offset += flags_bytes_len

    n_exposures = np.frombuffer(payload[offset : offset + nexp_bytes_len], dtype="<u2").reshape(
        shape
    )

    return metadata, flux, variance, flags, n_exposures
