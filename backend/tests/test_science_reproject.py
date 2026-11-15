"""Unit & Regression Tests for Flux-Conserving Reprojection & Inverse-Variance Coaddition.

Specification Anchors:
- SPECIFICATION.md §3.1 Stages 6 & 7 (Master Tangent Reprojection & Inverse-Variance Coaddition)
- SPECIFICATION.md §3.2 (Binary Tensor Format application/octet-stream, 14 B/px)
- SPECIFICATION.md §4.1 Pipeline 1 (Master Synthetic WCS & Dual-Engine Reprojection)
- tasks.md Dev 1 (role:E1-astro) Issue #10
"""

from __future__ import annotations

import numpy as np
import pytest
from astropy.io import fits
from astropy.wcs import WCS

try:
    from backend.science.reproject import (
        SPHEREX_PIXEL_SCALE_DEG,
        build_master_wcs,
        coadd_inverse_variance,
        compute_master_tangent_meshgrid,
        decode_binary_tensor,
        get_cpu_pool,
        reproject_exposures_async,
        reproject_exposures_parallel,
        reproject_exposures_sync,
        reproject_single_exposure,
    )
except ImportError:
    from science.reproject import (
        SPHEREX_PIXEL_SCALE_DEG,
        build_master_wcs,
        coadd_inverse_variance,
        compute_master_tangent_meshgrid,
        decode_binary_tensor,
        get_cpu_pool,
        reproject_exposures_async,
        reproject_exposures_parallel,
        reproject_exposures_sync,
        reproject_single_exposure,
    )


def make_synthetic_point_source(
    shape: tuple[int, int] = (25, 25),
    center: tuple[float, float] = (12.0, 12.0),
    total_flux: float = 100.0,
    fwhm_px: float = 1.2,
) -> np.ndarray:
    """Generate a 2D Gaussian point source with known integrated flux."""
    height, width = shape
    y_grid, x_grid = np.mgrid[0:height, 0:width]
    sigma = fwhm_px / 2.35482
    r2 = (x_grid - center[0]) ** 2 + (y_grid - center[1]) ** 2
    raw_gauss = np.exp(-r2 / (2.0 * sigma**2))
    norm = np.sum(raw_gauss)
    return (raw_gauss / norm * total_flux).astype(np.float32)


def make_test_wcs(
    ra: float = 180.0,
    dec: float = 0.0,
    shape: tuple[int, int] = (25, 25),
    rotation_deg: float = 0.0,
) -> WCS:
    """Create a TAN projection spatial WCS with optional rotation."""
    h, w = shape
    wcs = WCS(naxis=2)
    wcs.wcs.crval = [float(ra), float(dec)]
    wcs.wcs.crpix = [(w + 1.0) / 2.0, (h + 1.0) / 2.0]
    wcs.wcs.cdelt = [-SPHEREX_PIXEL_SCALE_DEG, SPHEREX_PIXEL_SCALE_DEG]
    wcs.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    wcs.wcs.cunit = ["deg", "deg"]

    if rotation_deg != 0.0:
        rad = np.deg2rad(rotation_deg)
        cos_t, sin_t = np.cos(rad), np.sin(rad)
        wcs.wcs.pc = np.array([[cos_t, -sin_t], [sin_t, cos_t]])

    return wcs


def test_build_master_wcs():
    """Verify master synthetic WCS parameters, center alignment, and pixel scales."""
    ra_target = 133.73712
    dec_target = -7.24038
    fov_arcsec = 180.0  # ~29 pixels

    wcs, header, shape = build_master_wcs(ra_target, dec_target, fov_arcsec)
    h, w = shape
    assert h == 29
    assert w == 29
    assert header["NAXIS1"] == 29
    assert header["NAXIS2"] == 29
    assert header["CTYPE1"] == "RA---TAN"
    assert header["CTYPE2"] == "DEC--TAN"
    assert header["CROTA2"] == 0.0

    # East-Left: CDELT1 is negative; North-Up: CDELT2 is positive
    assert wcs.wcs.cdelt[0] < 0.0
    assert wcs.wcs.cdelt[1] > 0.0
    assert abs(abs(wcs.wcs.cdelt[0]) - SPHEREX_PIXEL_SCALE_DEG) < 1e-12

    # Check center pixel maps to target coordinates
    center_x = (w - 1) / 2.0
    center_y = (h - 1) / 2.0
    sky_ra, sky_dec = wcs.pixel_to_world_values(center_x, center_y)
    assert abs(sky_ra - ra_target) < 1e-9
    assert abs(sky_dec - dec_target) < 1e-9


def test_compute_master_tangent_meshgrid():
    """Verify pre-computed tangent meshgrid matches direct WCS transformations."""
    wcs, _, shape = build_master_wcs(269.44639, 4.76676, 62.0)  # 10x10 px
    ra_grid, dec_grid = compute_master_tangent_meshgrid(wcs, shape)

    assert ra_grid.shape == shape
    assert dec_grid.shape == shape
    assert ra_grid.dtype == np.float64
    assert dec_grid.dtype == np.float64

    # Direct check corner pixel (0, 0)
    expected_ra, expected_dec = wcs.pixel_to_world_values(0, 0)
    assert abs(ra_grid[0, 0] - expected_ra) < 1e-12
    assert abs(dec_grid[0, 0] - expected_dec) < 1e-12


def test_reproject_exact_flux_conservation():
    """
    Acceptance Criterion 1:
    Synthetic point source flux is conserved within <1% before and after reproject_exact.
    """
    target_ra = 76.95647
    target_dec = 30.40130
    shape_in = (31, 31)

    # Input image with rotated WCS (e.g. 35 degrees relative to North)
    w_in = make_test_wcs(target_ra, target_dec, shape=shape_in, rotation_deg=35.0)
    in_flux = 500.0
    data_in = make_synthetic_point_source(shape=shape_in, center=(15.0, 15.0), total_flux=in_flux)
    tot_flux_in = float(np.sum(data_in))

    # Master tangent grid (CROTA=0, North-Up)
    w_master, _, shape_master = build_master_wcs(target_ra, target_dec, fov_arcsec=31 * 6.2)

    exp = {
        "data": data_in,
        "wcs": w_in,
        "band": "D3",
        "epoch": 0,
        "mjd": 60750.0,
        "exposure_id": "test_flux_cons",
    }

    reproj = reproject_single_exposure(exp, w_master, shape_out=shape_master)
    tot_flux_out = float(np.nansum(reproj.flux))

    pct_diff = abs(tot_flux_out - tot_flux_in) / tot_flux_in * 100.0
    assert pct_diff < 1.0, f"Flux difference {pct_diff:.4f}% exceeds 1% tolerance"
    assert reproj.flux.dtype == np.float32


def test_reproject_preserves_integer_bitmasks():
    """
    Acceptance Criterion 2:
    Integer bitmask flags in HDU 2 are never blended into non-integer floats during reprojection.
    """
    target_ra = 248.16773
    target_dec = 66.75504
    shape = (21, 21)

    # Create distinct bitmask flags: Bit 1 (OVERFLOW=2), Bit 6 (NONFUNC=64), Bit 10 (HOT=1024)
    flags_in = np.zeros(shape, dtype=np.uint32)
    flags_in[5:8, 5:8] = 2  # OVERFLOW
    flags_in[12:15, 12:15] = 64  # NONFUNC
    flags_in[10, 10] = 1024  # HOT

    w_in = make_test_wcs(target_ra, target_dec, shape=shape, rotation_deg=45.0)
    w_master, _, shape_master = build_master_wcs(target_ra, target_dec, fov_arcsec=21 * 6.2)

    exp = {
        "data": np.ones(shape, dtype=np.float32),
        "flags": flags_in,
        "wcs": w_in,
        "band": "D1",
        "epoch": 0,
    }

    reproj = reproject_single_exposure(exp, w_master, shape_out=shape_master)

    # Verify uint32 dtype
    assert reproj.flags.dtype == np.uint32
    # Verify that only valid discrete bit values (or their bitwise combinations) exist
    unique_flags = set(np.unique(reproj.flags))
    allowed_values = {0, 2, 64, 1024}
    assert unique_flags.issubset(allowed_values), f"Unexpected blended flag values: {unique_flags}"


def test_inverse_variance_coaddition_math():
    """Verify weighted inverse-variance coaddition math and error propagation."""
    target_ra = 100.0
    target_dec = 20.0
    w_master, _, shape = build_master_wcs(target_ra, target_dec, fov_arcsec=31.0)  # 5x5 px
    w_in = make_test_wcs(target_ra, target_dec, shape=shape)

    # Exposure 1: Flux = 10.0, Var = 4.0 (sigma = 2.0), Weight = 0.25
    exp1 = {
        "data": np.full(shape, 10.0, dtype=np.float32),
        "variance": np.full(shape, 4.0, dtype=np.float32),
        "flags": np.zeros(shape, dtype=np.uint32),
        "wcs": w_in,
        "band": "D2",
        "epoch": 0,
        "exposure_id": "exp_1",
    }
    # Exposure 2: Flux = 20.0, Var = 1.0 (sigma = 1.0), Weight = 1.0
    exp2 = {
        "data": np.full(shape, 20.0, dtype=np.float32),
        "variance": np.full(shape, 1.0, dtype=np.float32),
        "flags": np.zeros(shape, dtype=np.uint32),
        "wcs": w_in,
        "band": "D2",
        "epoch": 0,
        "exposure_id": "exp_2",
    }

    reproj1 = reproject_single_exposure(exp1, w_master, shape)
    reproj2 = reproject_single_exposure(exp2, w_master, shape)

    res = coadd_inverse_variance(
        [reproj1, reproj2],
        w_master,
        shape,
        epochs=[0],
    )

    # Expected coadded flux: (10 * 0.25 + 20 * 1.0) / (0.25 + 1.0) = 22.5 / 1.25 = 18.0
    # Expected coadded var: 1 / 1.25 = 0.8
    # Center pixel (2, 2)
    flux_val = res.flux[0, 1, 2, 2]  # epoch 0, band D2 (index 1)
    var_val = res.variance[0, 1, 2, 2]
    nexp_val = res.n_exposures[0, 1, 2, 2]

    assert abs(flux_val - 18.0) < 1e-4
    assert abs(var_val - 0.8) < 1e-4
    assert nexp_val == 2


def test_fatal_flag_exclusion():
    """Verify that pixels flagged with fatal bitmask bits are excluded from coaddition."""
    target_ra = 100.0
    target_dec = 20.0
    w_master, _, shape = build_master_wcs(target_ra, target_dec, fov_arcsec=31.0)
    w_in = make_test_wcs(target_ra, target_dec, shape=shape)

    # Good exposure: Flux = 12.0, Var = 1.0; corner pixel (0, 0) has NONFUNC (64)
    flags1 = np.zeros(shape, dtype=np.uint32)
    flags1[0, 0] = 64  # NONFUNC
    exp1 = {
        "data": np.full(shape, 12.0, dtype=np.float32),
        "variance": np.full(shape, 1.0, dtype=np.float32),
        "flags": flags1,
        "wcs": w_in,
        "band": "D4",
        "epoch": 0,
    }

    # Fatal exposure with OVERFLOW (bit 1 = 2) at center (2, 2) and corner (0, 0)
    flags2 = np.zeros(shape, dtype=np.uint32)
    flags2[2, 2] = 2  # OVERFLOW
    flags2[0, 0] = 2  # OVERFLOW
    exp2 = {
        "data": np.full(shape, 9999.0, dtype=np.float32),
        "variance": np.full(shape, 1.0, dtype=np.float32),
        "flags": flags2,
        "wcs": w_in,
        "band": "D4",
        "epoch": 0,
    }

    reproj1 = reproject_single_exposure(exp1, w_master, shape)
    reproj2 = reproject_single_exposure(exp2, w_master, shape)

    res = coadd_inverse_variance([reproj1, reproj2], w_master, shape, epochs=[0])

    # Center pixel (2, 2): exp2 rejected, exp1 contributed cleanly
    center_flux = res.flux[0, 3, 2, 2]  # D4 is index 3
    center_nexp = res.n_exposures[0, 3, 2, 2]
    center_flags = res.flags[0, 3, 2, 2]

    assert abs(center_flux - 12.0) < 1e-4
    assert center_nexp == 1
    # Contributing exposure was unflagged at center, so coadded flags remain clean
    assert center_flags == 0

    # Corner pixel (0, 0): both exp1 (NONFUNC) and exp2 (OVERFLOW) rejected -> nexp == 0
    corner_nexp = res.n_exposures[0, 3, 0, 0]
    corner_flags = res.flags[0, 3, 0, 0]
    assert corner_nexp == 0
    assert np.isnan(res.flux[0, 3, 0, 0])
    # Rejected flags record both fatal conditions (64 | 2 = 66)
    assert corner_flags == (64 | 2)


def test_tensor_shape_and_dtypes():
    """
    Acceptance Criterion 3:
    Pre-allocated contiguous arrays (N_epochs, 6, H, W) are returned for:
    - FLUX (float32)
    - VARIANCE (float32)
    - FLAGS (uint32)
    - N_EXPOSURES (uint16)
    """
    w_master, _, shape = build_master_wcs(0.0, 0.0, fov_arcsec=62.0)  # 10x10 px
    epochs = [0, 1, 2]

    res = coadd_inverse_variance([], w_master, shape, epochs=epochs)

    expected_shape = (3, 6, 10, 10)
    assert res.flux.shape == expected_shape
    assert res.variance.shape == expected_shape
    assert res.flags.shape == expected_shape
    assert res.n_exposures.shape == expected_shape

    assert res.flux.dtype == np.float32
    assert res.variance.dtype == np.float32
    assert res.flags.dtype == np.uint32
    assert res.n_exposures.dtype == np.uint16

    assert res.flux.flags.c_contiguous
    assert res.variance.flags.c_contiguous
    assert res.flags.flags.c_contiguous
    assert res.n_exposures.flags.c_contiguous


def test_binary_tensor_serialization_roundtrip():
    """Verify binary tensor format serialization (14 B/px) and roundtrip decoding."""
    w_master, _, shape = build_master_wcs(133.7, -7.2, fov_arcsec=18.6)  # 3x3 px
    epochs = [0, 1]
    res = coadd_inverse_variance([], w_master, shape, epochs=epochs)

    # Populate dummy test values
    res.flux[0, 0, 1, 1] = 42.5
    res.variance[0, 0, 1, 1] = 0.25
    res.flags[0, 0, 1, 1] = 16
    res.n_exposures[0, 0, 1, 1] = 3

    payload = res.to_bytes()

    # Verify payload sizing: 4 bytes length + JSON len + N_epochs * 6 * H * W * 14
    header_len = int.from_bytes(payload[:4], byteorder="little")
    expected_pixel_bytes = 2 * 6 * 3 * 3 * 14
    assert len(payload) == 4 + header_len + expected_pixel_bytes

    # Roundtrip decoding
    meta, flux, var, flags, nexp = decode_binary_tensor(payload)
    assert meta["shape"] == [2, 6, 3, 3]
    assert abs(flux[0, 0, 1, 1] - 42.5) < 1e-5
    assert abs(var[0, 0, 1, 1] - 0.25) < 1e-5
    assert flags[0, 0, 1, 1] == 16
    assert nexp[0, 0, 1, 1] == 3


def test_reproject_fits_hdulist_support():
    """Verify that multi-extension FITS HDUList inputs are handled transparently."""
    shape = (15, 15)
    w_in = make_test_wcs(150.0, 10.0, shape=shape)

    primary_hdu = fits.PrimaryHDU()
    primary_hdu.header["DETECTOR"] = "D5"
    primary_hdu.header["PASS"] = "P1"
    primary_hdu.header["MJD-OBS"] = 60750.5
    primary_hdu.header["EXPID"] = "fits_exp_99"

    img_hdu = fits.ImageHDU(data=np.full(shape, 7.5, dtype=np.float32), header=w_in.to_header())
    flags_hdu = fits.ImageHDU(data=np.zeros(shape, dtype=np.uint32))
    var_hdu = fits.ImageHDU(data=np.full(shape, 2.0, dtype=np.float32))

    hdulist = fits.HDUList([primary_hdu, img_hdu, flags_hdu, var_hdu])

    w_master, _, shape_master = build_master_wcs(150.0, 10.0, fov_arcsec=15 * 6.2)
    reproj = reproject_single_exposure(hdulist, w_master, shape_master)

    assert reproj.band == "D5"
    assert reproj.epoch == "P1"
    assert reproj.mjd == 60750.5
    assert reproj.exposure_id == "fits_exp_99"
    assert reproj.flux.shape == shape_master
    assert abs(reproj.flux[7, 7] - 7.5) < 0.1


def test_reproject_batch_sync_and_parallel():
    """Verify batch reprojection produces identical results synchronously and in parallel."""
    target_ra = 331.09566
    target_dec = -56.80031
    shape = (11, 11)
    w_in1 = make_test_wcs(target_ra, target_dec, shape=shape, rotation_deg=0.0)
    w_in2 = make_test_wcs(target_ra, target_dec, shape=shape, rotation_deg=10.0)

    exps = [
        {"data": np.full(shape, 5.0, dtype=np.float32), "wcs": w_in1, "band": "D1", "epoch": 0},
        {"data": np.full(shape, 8.0, dtype=np.float32), "wcs": w_in2, "band": "D2", "epoch": 0},
    ]

    w_master, _, shape_master = build_master_wcs(target_ra, target_dec, fov_arcsec=11 * 6.2)

    res_sync = reproject_exposures_sync(exps, w_master, shape_master)
    res_parallel = reproject_exposures_parallel(exps, w_master, shape_master, max_workers=2)

    assert len(res_sync) == 2
    assert len(res_parallel) == 2

    for s, p in zip(res_sync, res_parallel, strict=True):
        assert s.band == p.band
        assert np.allclose(s.flux, p.flux, equal_nan=True)
        assert np.array_equal(s.flags, p.flags)


@pytest.mark.asyncio
async def test_reproject_async_and_cpu_pool():
    """Verify async reprojection using the singleton CPU process pool."""
    target_ra = 180.0
    target_dec = 0.0
    shape = (7, 7)
    w_in = make_test_wcs(target_ra, target_dec, shape=shape)
    exps = [
        {"data": np.full(shape, 3.0, dtype=np.float32), "wcs": w_in, "band": "D3", "epoch": 0},
    ]
    w_master, _, shape_master = build_master_wcs(target_ra, target_dec, fov_arcsec=7 * 6.2)

    pool = get_cpu_pool(max_workers=2)
    assert pool is not None

    res_async = await reproject_exposures_async(exps, w_master, shape_master, pool=pool)
    assert len(res_async) == 1
    assert res_async[0].band == "D3"
    assert res_async[0].flux.shape == shape_master
