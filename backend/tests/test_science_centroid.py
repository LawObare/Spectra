"""Unit & Regression Tests for Native Per-Exposure HDU 5 PSF Centroiding Engine.

Specification Anchors:
- SPECIFICATION.md §1.3 Audit #6 (Native PSF centroid shift vs DoG display aid, line 44)
- SPECIFICATION.md §1.4 Core Scientific Principles (Measure Natively, Display Rectified, line 61)
- SPECIFICATION.md §4.1 Pipeline 3 (Native Per-Exposure PSF Centroiding Engine, lines 446–455)
- SYSTEM_ARCHITECTURE.md §4.2 Item 7 (Native Per-Exposure PSF Centroiding Engine, lines 547–554)
- tasks.md Dev 1 (role:E1-astro) Issue #11

Acceptance Criteria:
- Sub-pixel shift of 0.76 px/yr (Epsilon Indi B) is recovered within <0.15 px RMS
  on synthetic PSF-convolved test frames.
- Saturated targets (Bit 1: OVERFLOW set in core pixels) skip PSF fitting and
  return saturated=True with catalog-predicted track coordinates.
"""

from __future__ import annotations

import math

import numpy as np
from astropy.wcs import WCS

try:
    from backend.science.centroid import (
        FLAG_OVERFLOW,
        NUM_PSF_ZONES_1D,
        SPHEREX_PIXEL_SCALE_ARCSEC,
        CentroidMeasurement,
        CoaddedCentroid,
        check_core_saturation,
        coadd_centroids_inverse_covariance,
        compute_proper_motion,
        compute_wcs_jacobian,
        extract_psf_kernel_from_cube,
        fit_psf_centroid_single_exposure,
        resample_psf_kernel_subpixel,
        select_psf_zone,
    )
except ImportError:
    from science.centroid import (
        FLAG_OVERFLOW,
        NUM_PSF_ZONES_1D,
        SPHEREX_PIXEL_SCALE_ARCSEC,
        CentroidMeasurement,
        CoaddedCentroid,
        check_core_saturation,
        coadd_centroids_inverse_covariance,
        compute_proper_motion,
        compute_wcs_jacobian,
        extract_psf_kernel_from_cube,
        fit_psf_centroid_single_exposure,
        resample_psf_kernel_subpixel,
        select_psf_zone,
    )


def make_test_wcs(
    ra_center: float = 331.09566,
    dec_center: float = -56.80031,
    crpix1: float = 51.0,
    crpix2: float = 51.0,
    pixel_scale_arcsec: float = SPHEREX_PIXEL_SCALE_ARCSEC,
) -> WCS:
    """Create a synthetic TAN spatial WCS centered on Epsilon Indi B."""
    scale_deg = pixel_scale_arcsec / 3600.0
    w = WCS(naxis=2)
    w.wcs.crval = [ra_center, dec_center]
    w.wcs.crpix = [crpix1, crpix2]
    # Standard North-Up: CDELT1 < 0 (RA increases East/left), CDELT2 > 0 (Dec increases North/up)
    w.wcs.cdelt = [-scale_deg, scale_deg]
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    return w


def make_synthetic_psf_cube(
    n_zones: int = 121,
    kernel_size: int = 25,
    sigma_base: float = 0.51,  # 1.2 px FWHM
) -> np.ndarray:
    """Generate synthetic 3D PSF cube with subtle spatial aberration variation across zones."""
    cube = np.zeros((n_zones, kernel_size, kernel_size), dtype=np.float32)
    k_center = (kernel_size - 1) / 2.0
    y_idx, x_idx = np.mgrid[0:kernel_size, 0:kernel_size]

    for z in range(n_zones):
        # Slightly vary sigma and ellipticity with zone index to simulate optical field distortion
        zone_x = z % NUM_PSF_ZONES_1D
        zone_y = z // NUM_PSF_ZONES_1D
        sx = sigma_base * (1.0 + 0.05 * (zone_x / 10.0))
        sy = sigma_base * (1.0 + 0.05 * (zone_y / 10.0))
        r2 = ((x_idx - k_center) / sx) ** 2 + ((y_idx - k_center) / sy) ** 2
        kernel = np.exp(-0.5 * r2)
        cube[z] = kernel / np.sum(kernel)

    return cube


# ============================================================================
# 1. PSF Zone Selection & Extraction Tests
# ============================================================================


def test_select_psf_zone_grid():
    """Verify 11x11 zone mapping across Hawaii-2RG active detector area (2040x2040)."""
    # Corners
    assert select_psf_zone(0.0, 0.0) == 0
    assert select_psf_zone(2039.0, 0.0) == 10
    assert select_psf_zone(0.0, 2039.0) == 110
    assert select_psf_zone(2039.0, 2039.0) == 120

    # Center zone (ix=5, iy=5 -> 5 * 11 + 5 = 60)
    assert select_psf_zone(1020.0, 1020.0) == 60

    # Bounds clipping
    assert select_psf_zone(-10.0, -10.0) == 0
    assert select_psf_zone(3000.0, 3000.0) == 120


def test_extract_psf_kernel_from_cube_shapes():
    """Verify extraction across 3D, 4D, and 2D PSF arrays."""
    cube_3d = make_synthetic_psf_cube(n_zones=121, kernel_size=21)
    k = extract_psf_kernel_from_cube(cube_3d, 100.0, 100.0)
    assert k.shape == (21, 21)
    assert np.isclose(float(np.sum(k)), 1.0, atol=1e-5)

    # 4D shape (11, 11, 21, 21)
    cube_4d = cube_3d.reshape(11, 11, 21, 21)
    k_4d = extract_psf_kernel_from_cube(cube_4d, 1020.0, 1020.0)
    assert k_4d.shape == (21, 21)
    assert np.isclose(float(np.sum(k_4d)), 1.0, atol=1e-5)

    # 2D standalone kernel
    k_2d = cube_3d[0]
    k_res = extract_psf_kernel_from_cube(k_2d, 500.0, 500.0)
    assert k_res.shape == (21, 21)


# ============================================================================
# 2. Sub-Pixel Resampling & WCS Jacobian Tests
# ============================================================================


def test_resample_psf_kernel_conservation():
    """Verify flux conservation under sub-pixel resampling."""
    cube = make_synthetic_psf_cube(n_zones=121, kernel_size=25)
    kernel = cube[60]

    sy, sx = np.mgrid[8:13, 8:13]  # 5x5 stamp
    resampled = resample_psf_kernel_subpixel(kernel, 10.35, 10.72, sx, sy)
    assert resampled.shape == (5, 5)
    assert np.isclose(float(np.sum(resampled)), 1.0, atol=1e-5)

    # Gaussian fallback when kernel is None
    resampled_gauss = resample_psf_kernel_subpixel(None, 10.35, 10.72, sx, sy)
    assert resampled_gauss.shape == (5, 5)
    assert np.isclose(float(np.sum(resampled_gauss)), 1.0, atol=1e-5)


def test_compute_wcs_jacobian_scales():
    """Verify WCS Jacobian matches nominal 6.2 arcsec/pixel scale."""
    wcs = make_test_wcs()
    j = compute_wcs_jacobian(wcs, 50.0, 50.0)
    assert j.shape == (2, 2)

    scale_deg = SPHEREX_PIXEL_SCALE_ARCSEC / 3600.0
    cos_dec = math.cos(math.radians(-56.80031))
    # Physical scale on sky: RA component d(alpha)/dx * cos(dec), Dec component d(dec)/dy
    assert np.isclose(abs(j[0, 0]) * cos_dec, scale_deg, rtol=1e-3)
    assert np.isclose(abs(j[1, 1]), scale_deg, rtol=1e-3)
    # Off-diagonal should be near 0 for unrotated TAN WCS
    assert abs(j[0, 1]) < 1e-6
    assert abs(j[1, 0]) < 1e-6


# ============================================================================
# 3. Core Saturation Acceptance Criterion Test
# ============================================================================


def test_core_saturation_acceptance_criterion():
    """Acceptance Criterion 2: Saturated targets (Bit 1: OVERFLOW set in core pixels)

    skip PSF fitting and return saturated=True with catalog-predicted track coordinates.
    """
    wcs = make_test_wcs(ra_center=76.95647, dec_center=30.40130)  # RW Aurigae
    shape = (100, 100)
    image = np.full(shape, 2.0, dtype=np.float32)
    variance = np.full(shape, 0.1, dtype=np.float32)
    flags = np.zeros(shape, dtype=np.uint32)

    # Core pixel (50, 50) has Bit 1 (OVERFLOW = 2)
    flags[50, 50] = FLAG_OVERFLOW
    image[50, 50] = 50000.0  # Saturated well

    # Verify check_core_saturation function directly
    assert check_core_saturation(flags, 50.0, 50.0) is True
    assert check_core_saturation(flags, 20.0, 20.0) is False

    # Execute centroid fitting
    res = fit_psf_centroid_single_exposure(
        image=image,
        variance=variance,
        flags=flags,
        wcs=wcs,
        ra_target=76.95647,
        dec_target=30.40130,
        exposure_id="rw_aur_pass1",
        epoch_id="P1",
        band="D1",
        mjd=60750.0,
    )

    assert res.saturated is True
    assert res.provenance["reason"] == "core_saturation_overflow"
    # Returned coordinates match catalog prediction exactly
    assert np.isclose(res.ra_deg, 76.95647, atol=1e-5)
    assert np.isclose(res.dec_deg, 30.40130, atol=1e-5)
    assert np.isclose(res.x_det, 50.0, atol=1e-3)
    assert np.isclose(res.y_det, 50.0, atol=1e-3)


# ============================================================================
# 4. Epsilon Indi B Sub-Pixel Motion Acceptance Criterion Test (< 0.15 px RMS)
# ============================================================================


def test_epsilon_indi_b_subpixel_motion_rms():
    """Acceptance Criterion 1: Sub-pixel shift of 0.76 px/yr (Epsilon Indi B)

    is recovered within <0.15 px RMS on synthetic PSF-convolved test frames.
    """
    wcs = make_test_wcs(ra_center=331.09566, dec_center=-56.80031, crpix1=50.0, crpix2=50.0)
    cube = make_synthetic_psf_cube()
    kernel = cube[select_psf_zone(50.0, 50.0)]

    shift_true_px = 0.76  # Epsilon Indi B annual shift
    # Position Angle ~122.6 deg (South-East: d_x > 0, d_y < 0 in North-Up, East-Left display)
    pa_rad = math.radians(122.6)
    # In North-Up display: dx (East) = shift * sin(PA), dy (North) = shift * cos(PA)
    # Pixel coordinates: x increases right (West, opposite of East in North-Up)
    dx_px = -shift_true_px * math.sin(pa_rad)
    dy_px = shift_true_px * math.cos(pa_rad)

    rng = np.random.default_rng(2026)
    n_trials = 20
    errors: list[float] = []

    for trial in range(n_trials):
        # Base position at Epoch 1 with random sub-pixel phase
        x1_true = 50.0 + rng.uniform(-0.3, 0.3)
        y1_true = 50.0 + rng.uniform(-0.3, 0.3)
        x2_true = x1_true + dx_px
        y2_true = y1_true + dy_px

        def generate_exposure(xt: float, yt: float, noise_sigma: float = 0.5) -> np.ndarray:
            frame = np.full((100, 100), 2.0, dtype=np.float32)  # 2.0 MJy/sr background
            xc, yc = round(xt), round(yt)
            sy, sx = np.mgrid[yc - 2 : yc + 3, xc - 2 : xc + 3]
            psf_stamp = resample_psf_kernel_subpixel(kernel, xt, yt, sx, sy)
            frame[yc - 2 : yc + 3, xc - 2 : xc + 3] += 50.0 * psf_stamp  # Source flux = 50
            noise = rng.normal(0.0, noise_sigma, frame.shape).astype(np.float32)
            return frame + noise

        img1 = generate_exposure(x1_true, y1_true)
        img2 = generate_exposure(x2_true, y2_true)
        var = np.full((100, 100), 0.25, dtype=np.float32)
        flg = np.zeros((100, 100), dtype=np.uint32)

        # Get world coords for initial targets
        ra1_t, dec1_t = wcs.pixel_to_world_values(x1_true, y1_true)
        ra2_t, dec2_t = wcs.pixel_to_world_values(x2_true, y2_true)

        # Fit Epoch 1
        m1 = fit_psf_centroid_single_exposure(
            image=img1,
            variance=var,
            flags=flg,
            wcs=wcs,
            ra_target=float(ra1_t),
            dec_target=float(dec1_t),
            exposure_id=f"eps_p1_{trial}",
            epoch_id="P1",
            band="D5",
            mjd=60750.0,
            psf_kernel=kernel,
        )

        # Fit Epoch 2
        m2 = fit_psf_centroid_single_exposure(
            image=img2,
            variance=var,
            flags=flg,
            wcs=wcs,
            ra_target=float(ra2_t),
            dec_target=float(dec2_t),
            exposure_id=f"eps_p2_{trial}",
            epoch_id="P2",
            band="D5",
            mjd=61115.25,  # 1 Julian year later
            psf_kernel=kernel,
        )

        recovered_shift_px = math.hypot(m2.x_det - m1.x_det, m2.y_det - m1.y_det)
        errors.append(abs(recovered_shift_px - shift_true_px))

    rms_error = math.sqrt(float(np.mean(np.array(errors) ** 2)))
    mean_error = float(np.mean(errors))

    print(f"Epsilon Indi B Shift Recovery: Mean Err = {mean_error:.4f} px, RMS Err = {rms_error:.4f} px")
    assert rms_error < 0.15, f"RMS error {rms_error:.4f} px exceeded acceptance criterion < 0.15 px"


# ============================================================================
# 5. Inverse-Covariance Coaddition & Proper Motion Pipeline Tests
# ============================================================================


def test_inverse_covariance_coaddition_math():
    """Verify weighted mean combination of multiple exposures."""
    # 3 exposures for Pass 1, Band D5
    cov_low_noise = np.diag([1e-9, 1e-9])   # High weight
    cov_high_noise = np.diag([4e-9, 4e-9])  # Low weight

    cos_dec = math.cos(math.radians(10.0001))
    sig_low_ra = math.sqrt(cov_low_noise[0, 0]) * cos_dec * 3600.0
    sig_low_dec = math.sqrt(cov_low_noise[1, 1]) * 3600.0
    sig_high_ra = math.sqrt(cov_high_noise[0, 0]) * cos_dec * 3600.0
    sig_high_dec = math.sqrt(cov_high_noise[1, 1]) * 3600.0

    m1 = CentroidMeasurement(
        exposure_id="e1",
        epoch_id="P1",
        band="D5",
        mjd=60750.0,
        x_det=50.0,
        y_det=50.0,
        ra_deg=100.0001,
        dec_deg=10.0001,
        flux=100.0,
        background=2.0,
        cov_pix=np.eye(2),
        cov_sky=cov_low_noise,
        sigma_ra_arcsec=sig_low_ra,
        sigma_dec_arcsec=sig_low_dec,
    )
    m2 = CentroidMeasurement(
        exposure_id="e2",
        epoch_id="P1",
        band="D5",
        mjd=60750.1,
        x_det=50.1,
        y_det=50.1,
        ra_deg=100.0002,
        dec_deg=10.0002,
        flux=98.0,
        background=2.1,
        cov_pix=np.eye(2),
        cov_sky=cov_low_noise,
        sigma_ra_arcsec=sig_low_ra,
        sigma_dec_arcsec=sig_low_dec,
    )
    m3 = CentroidMeasurement(
        exposure_id="e3",
        epoch_id="P1",
        band="D5",
        mjd=60750.2,
        x_det=50.5,
        y_det=50.5,
        ra_deg=100.0009,
        dec_deg=10.0009,
        flux=80.0,
        background=2.5,
        cov_pix=np.eye(2),
        cov_sky=cov_high_noise,
        sigma_ra_arcsec=sig_high_ra,
        sigma_dec_arcsec=sig_high_dec,
    )

    coadds = coadd_centroids_inverse_covariance([m1, m2, m3])
    assert len(coadds) == 1
    c = coadds[0]
    assert c.epoch_id == "P1"
    assert c.band == "D5"
    assert c.num_exposures == 3

    # Coadded uncertainty should be strictly smaller than any individual exposure
    assert c.sigma_ra_arcsec < m1.sigma_ra_arcsec
    assert c.sigma_dec_arcsec < m1.sigma_dec_arcsec

    # High weight exposures m1 and m2 should dominate the coadded position
    assert 100.0001 <= c.ra_deg <= 100.0003


def test_compute_proper_motion_barnard():
    """Verify proper motion calculation on Barnard's Star (+10.39"/yr North)."""
    # 1 year baseline
    c1 = CoaddedCentroid(
        epoch_id="P1",
        band="D1",
        mean_mjd=60750.0,
        ra_deg=269.44639,
        dec_deg=4.76676,
        cov_sky=np.diag([1e-9, 1e-9]),
        sigma_ra_arcsec=0.02,
        sigma_dec_arcsec=0.02,
        num_exposures=4,
    )
    # Displace Northward by 10.39 arcsec (10.39 / 3600 deg)
    shift_deg = 10.39 / 3600.0
    c2 = CoaddedCentroid(
        epoch_id="P2",
        band="D1",
        mean_mjd=61115.25,
        ra_deg=269.44639,
        dec_deg=4.76676 + shift_deg,
        cov_sky=np.diag([1e-9, 1e-9]),
        sigma_ra_arcsec=0.02,
        sigma_dec_arcsec=0.02,
        num_exposures=4,
    )

    pm = compute_proper_motion([c1, c2])
    assert pm.is_mover is True
    assert np.isclose(pm.velocity_arcsec_yr, 10.39, atol=0.01)
    # Position angle should be ~0 deg (Northward)
    assert abs(pm.position_angle_deg) < 1.0 or abs(pm.position_angle_deg - 360.0) < 1.0
    # Annual pixel shift at 6.2"/px: 10.39 / 6.2 = ~1.676 px
    assert np.isclose(pm.total_shift_pixels, 1.676, atol=0.01)
    assert pm.motion_snr > 10.0


def test_compute_proper_motion_stationary_source():
    """Verify stationary target is flagged as is_mover=False."""
    c1 = CoaddedCentroid(
        epoch_id="P1",
        band="D3",
        mean_mjd=60750.0,
        ra_deg=248.16773,
        dec_deg=66.75504,
        cov_sky=np.diag([1e-9, 1e-9]),
        sigma_ra_arcsec=0.03,
        sigma_dec_arcsec=0.03,
        num_exposures=4,
    )
    c2 = CoaddedCentroid(
        epoch_id="P2",
        band="D3",
        mean_mjd=61115.25,
        ra_deg=248.16773,
        dec_deg=66.75504 + (0.05 / 3600.0),  # Minor 0.05" noise offset (<0.01 px)
        cov_sky=np.diag([1e-9, 1e-9]),
        sigma_ra_arcsec=0.03,
        sigma_dec_arcsec=0.03,
        num_exposures=4,
    )

    pm = compute_proper_motion([c1, c2])
    assert pm.is_mover is False
    assert pm.total_shift_pixels < 0.1
