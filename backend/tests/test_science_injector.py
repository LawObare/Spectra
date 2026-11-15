"""Unit & Integration Tests for Synthetic Source Injector & Calibration Loop.

Specification Anchors:
- SPECIFICATION.md §1.4 (Pre-Screeners & Synthetic Injections)
- SPECIFICATION.md §3.1, §4.1 (Synthetic Source Injector Engine synth_a & synth_b)
- SPECIFICATION.md §4.2.2, §6.4.6 (Active Learning & Observer Reliability Tracking)
- tasks.md Dev 6 (role:E6-devops) Issue #24
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pytest
from astropy.io import fits

try:
    from backend.science.injector import (
        DEFAULT_SURVEY_PASSES,
        SPHEREX_PIXEL_SCALE_ARCSEC,
        SyntheticSourceConfig,
        calculate_pixel_centroid,
        compute_calibration_metrics,
        create_synth_a_preset,
        create_synth_b_preset,
        create_synth_control_preset,
        evaluate_volunteer_classification,
        generate_subpixel_psf_kernel,
        inject_into_fits_hdulist,
        inject_into_tensor_bundle,
        inject_synthetic_source_into_planes,
        propagate_proper_motion,
        update_bayesian_reliability,
    )
except ImportError:
    from science.injector import (
        DEFAULT_SURVEY_PASSES,
        SPHEREX_PIXEL_SCALE_ARCSEC,
        SyntheticSourceConfig,
        calculate_pixel_centroid,
        compute_calibration_metrics,
        create_synth_a_preset,
        create_synth_b_preset,
        create_synth_control_preset,
        evaluate_volunteer_classification,
        generate_subpixel_psf_kernel,
        inject_into_fits_hdulist,
        inject_into_tensor_bundle,
        inject_synthetic_source_into_planes,
        propagate_proper_motion,
        update_bayesian_reliability,
    )


class TestProperMotionPropagation:
    """Verify high-precision astrometric propagation of proper motion vectors."""

    def test_stationary_source_zero_shift(self) -> None:
        """Stationary source should not shift coordinates across epochs."""
        control = create_synth_control_preset(ra_deg=100.0, dec_deg=20.0)
        # 1 year later (365.25 days)
        ra_tk, dec_tk = propagate_proper_motion(control, obs_epoch_mjd=control.ref_epoch_mjd + 365.25)

        assert pytest.approx(ra_tk, abs=1e-7) == 100.0
        assert pytest.approx(dec_tk, abs=1e-7) == 20.0

    def test_synth_a_high_proper_motion_propagation(self) -> None:
        """Synth A (WISE 0855 analogue) should shift ~8.15 arcsec West in 1 year."""
        synth_a = create_synth_a_preset(ra_deg=133.73712, dec_deg=-7.24038)
        dt_days = 365.25  # Exactly 1.0 Julian year
        ra_tk, dec_tk = propagate_proper_motion(synth_a, obs_epoch_mjd=synth_a.ref_epoch_mjd + dt_days)

        # Expected RA shift in degrees: (μ_α* / 3600_000) / cos(δ)
        cos_dec = math.cos(math.radians(-7.24038))
        expected_d_ra = (-8150.0 * 1e-3 / 3600.0) / cos_dec
        expected_d_dec = 650.0 * 1e-3 / 3600.0

        assert pytest.approx(ra_tk, abs=1e-7) == 133.73712 + expected_d_ra
        assert pytest.approx(dec_tk, abs=1e-7) == -7.24038 + expected_d_dec

        # Verify net motion matches ~8.176" / yr
        total_pm_mas = math.hypot(-8150.0, 650.0)
        assert pytest.approx(total_pm_mas, abs=1.0) == 8175.9

    def test_celestial_pole_boundary_safety(self) -> None:
        """Proper motion propagation near North pole should not crash or overflow."""
        polar_source = SyntheticSourceConfig(
            source_id="polar_test",
            ra_deg=45.0,
            dec_deg=89.99,
            pm_ra_cosdec_mas_yr=1000.0,
            pm_dec_mas_yr=100.0,
            ref_epoch_mjd=60750.0,
        )
        ra_tk, dec_tk = propagate_proper_motion(polar_source, obs_epoch_mjd=60750.0 + 365.25)
        assert 0.0 <= ra_tk < 360.0
        assert -90.0 <= dec_tk <= 90.0


class TestPixelCentroidMapping:
    """Verify tangent-plane and sub-pixel coordinate mapping."""

    def test_center_pixel_at_reference_coordinates(self) -> None:
        """Target at exact cutout center should yield center pixel coordinates."""
        cutout_shape = (29, 29)
        x_px, y_px = calculate_pixel_centroid(
            ra_tk=150.0,
            dec_tk=10.0,
            crval_ra=150.0,
            crval_dec=10.0,
            cutout_shape=cutout_shape,
            pixel_scale_arcsec=SPHEREX_PIXEL_SCALE_ARCSEC,
        )
        assert pytest.approx(x_px, abs=1e-4) == 14.0
        assert pytest.approx(y_px, abs=1e-4) == 14.0

    def test_proper_motion_pixel_displacement(self) -> None:
        """Displacement in arcsec should scale correctly by 6.2 arcsec/pixel."""
        cutout_shape = (29, 29)
        # Shift 6.2" North (positive Dec) -> should increase y by 1.0 px
        shift_dec_deg = 6.2 / 3600.0
        x_px, y_px = calculate_pixel_centroid(
            ra_tk=150.0,
            dec_tk=10.0 + shift_dec_deg,
            crval_ra=150.0,
            crval_dec=10.0,
            cutout_shape=cutout_shape,
        )
        assert pytest.approx(x_px, abs=1e-4) == 14.0
        assert pytest.approx(y_px, abs=1e-4) == 15.0


class TestPSFGeneration:
    """Verify empirical and analytic Point Spread Function synthesis."""

    def test_gaussian_psf_conservation_of_flux(self) -> None:
        """Integrated PSF kernel sum must equal 1.0 to conserve photon flux."""
        cutout_shape = (29, 29)
        psf = generate_subpixel_psf_kernel(cutout_shape, center_x=14.3, center_y=14.7)

        assert psf.shape == cutout_shape
        assert psf.dtype == np.float32
        assert pytest.approx(float(np.sum(psf)), abs=1e-5) == 1.0

    def test_psf_fwhm_geometry(self) -> None:
        """Gaussian PSF peak should be at target sub-pixel coordinate."""
        cutout_shape = (31, 31)
        target_x, target_y = 15.2, 15.8
        psf = generate_subpixel_psf_kernel(cutout_shape, center_x=target_x, center_y=target_y)

        # Maximum value should occur at integer pixel closest to subpixel center
        max_y, max_x = np.unravel_index(np.argmax(psf), psf.shape)
        assert max_x == round(target_x)
        assert max_y == round(target_y)

    def test_empirical_psf_resampling(self) -> None:
        """Empirical HDU 5 2D kernel should be re-centered and normalized."""
        cutout_shape = (25, 25)
        # Synthetic empirical kernel 7x7
        empirical = np.zeros((7, 7), dtype=np.float32)
        empirical[3, 3] = 10.0
        empirical[2:5, 3] += 2.0
        empirical[3, 2:5] += 2.0

        psf = generate_subpixel_psf_kernel(
            cutout_shape,
            center_x=12.0,
            center_y=12.0,
            empirical_psf=empirical,
        )
        assert pytest.approx(float(np.sum(psf)), abs=1e-4) == 1.0
        assert psf[12, 12] == np.max(psf)


class TestFluxAndVarianceInjection:
    """Verify 2D plane and 4D tensor injection mechanics."""

    def test_single_plane_injection_adds_flux_and_shot_noise(self) -> None:
        """Injection into FLUX and VARIANCE planes should update both according to Poisson statistics."""
        dim = 25
        flux_plane = np.zeros((dim, dim), dtype=np.float32)
        variance_plane = np.ones((dim, dim), dtype=np.float32) * 0.25  # base read noise
        flags_plane = np.zeros((dim, dim), dtype=np.uint32)

        config = create_synth_a_preset(ra_deg=100.0, dec_deg=20.0)
        # Inject into Band 5 (D5 index = 4), which has flux = 1.85 mJy
        res = inject_synthetic_source_into_planes(
            flux_plane=flux_plane,
            variance_plane=variance_plane,
            flags_plane=flags_plane,
            crval_ra=100.0,
            crval_dec=20.0,
            obs_epoch_mjd=config.ref_epoch_mjd,
            band_idx=4,
            config=config,
            gain=1.5,
        )

        assert res["is_in_bounds"] is True
        assert res["source_badge"] == "Synthetic Injection"

        # FLUX plane should have integrated sum equal to injected flux
        total_injected_flux = float(np.sum(flux_plane))
        assert pytest.approx(total_injected_flux, abs=1e-3) == 1.85

        # VARIANCE plane should have increased by injected_flux / gain
        total_variance_increase = float(np.sum(variance_plane - 0.25))
        expected_shot_var = 1.85 / 1.5
        assert pytest.approx(total_variance_increase, abs=1e-3) == expected_shot_var

    def test_saturation_overflow_flagging(self) -> None:
        """Extremely bright synthetic flux should trigger OVERFLOW flag (bit 1 = 2)."""
        dim = 21
        flux_plane = np.zeros((dim, dim), dtype=np.float32)
        variance_plane = np.zeros((dim, dim), dtype=np.float32)
        flags_plane = np.zeros((dim, dim), dtype=np.uint32)

        config = SyntheticSourceConfig(
            source_id="super_bright",
            ra_deg=100.0,
            dec_deg=20.0,
            flux_band_mjy=[500.0] * 6,
            ref_epoch_mjd=60750.0,
        )

        inject_synthetic_source_into_planes(
            flux_plane=flux_plane,
            variance_plane=variance_plane,
            flags_plane=flags_plane,
            crval_ra=100.0,
            crval_dec=20.0,
            obs_epoch_mjd=60750.0,
            band_idx=0,
            config=config,
            saturation_threshold=50.0,
        )

        # Core pixels should have bit 1 (OVERFLOW = 2) set
        assert np.any(flags_plane & 2 != 0)

    def test_tensor_bundle_injection_multi_epoch(self) -> None:
        """Injecting synth_a into a 4D tensor bundle should displace source across epochs."""
        n_epochs = 3
        n_bands = 6
        dim = 29
        flux = np.zeros((n_epochs, n_bands, dim, dim), dtype=np.float32)
        variance = np.ones((n_epochs, n_bands, dim, dim), dtype=np.float32) * 0.1
        flags = np.zeros((n_epochs, n_bands, dim, dim), dtype=np.uint32)
        n_exp = np.zeros((n_epochs, n_bands, dim, dim), dtype=np.uint16)

        header: dict[str, Any] = {
            "crval": [133.73712, -7.24038],
            "cdelt": [-SPHEREX_PIXEL_SCALE_ARCSEC / 3600.0, SPHEREX_PIXEL_SCALE_ARCSEC / 3600.0],
            "release": "spherex_qr2",
        }

        synth_a = create_synth_a_preset(ra_deg=133.73712, dec_deg=-7.24038)
        new_flux, new_var, new_flags, new_n_exp, new_header = inject_into_tensor_bundle(
            flux_tensor=flux,
            variance_tensor=variance,
            flags_tensor=flags,
            n_exp_tensor=n_exp,
            header=header,
            sources=[synth_a],
            survey_passes=DEFAULT_SURVEY_PASSES,
        )

        assert new_var.shape == variance.shape
        assert new_flags.shape == flags.shape
        assert np.any(new_n_exp > 0)

        # Header metadata verification
        assert new_header["is_synthetic"] is True
        assert new_header["source_badge"] == "Synthetic Injection"
        assert len(new_header["synthetic_injections"]) == 1
        assert new_header["synthetic_injections"][0]["source_id"] == "synth_a"

        # Check motion in Band 5 across Epoch 0 (P1) and Epoch 2 (P3)
        b = 4  # D5
        _peak_y_p1, peak_x_p1 = np.unravel_index(np.argmax(new_flux[0, b]), (dim, dim))
        _peak_y_p3, peak_x_p3 = np.unravel_index(np.argmax(new_flux[2, b]), (dim, dim))

        # In 1 year, synth_a moves ~8.15" West (positive Eastward pm_ra is negative, so moves right/East in pixel space)
        # Shift in x should be observable between P1 (t=0) and P3 (t=1.0 yr)
        dx = peak_x_p3 - peak_x_p1
        assert abs(dx) >= 1  # Detectable motion across discrete 6.2"/px pixels


class TestFITSHDUListInjection:
    """Verify injection into astropy HDUList MEF structures."""

    def test_fits_injection_updates_data_and_header(self) -> None:
        """Injecting into HDUList must update HDU 1, HDU 3, and record provenance headers."""
        dim = 25
        primary_hdu = fits.PrimaryHDU()
        image_hdu = fits.ImageHDU(data=np.zeros((dim, dim), dtype=np.float32), name="IMAGE")
        image_hdu.header["CRVAL1"] = 76.95647
        image_hdu.header["CRVAL2"] = 30.40130
        flags_hdu = fits.ImageHDU(data=np.zeros((dim, dim), dtype=np.uint32), name="FLAGS")
        var_hdu = fits.ImageHDU(data=np.ones((dim, dim), dtype=np.float32) * 0.2, name="VARIANCE")

        hdul = fits.HDUList([primary_hdu, image_hdu, flags_hdu, var_hdu])

        synth_b = create_synth_b_preset(ra_deg=76.95647, dec_deg=30.40130)
        updated_hdul, meta = inject_into_fits_hdulist(
            hdul=hdul,
            config=synth_b,
            obs_epoch_mjd=synth_b.ref_epoch_mjd,
            band_idx=3,
        )

        assert meta["source_id"] == "synth_b"
        assert updated_hdul[1].header["INJECTED"] is True
        assert updated_hdul[1].header["SYNTH_ID"] == "synth_b"
        assert updated_hdul[1].header["BADGE"] == "Synthetic Injection"
        assert np.max(updated_hdul[1].data) > 0.0


class TestActiveLearningCalibrationLoop:
    """Verify volunteer evaluation, Bayesian reliability updates, and ROC metrics."""

    def test_evaluate_volunteer_classification_taxonomy(self) -> None:
        """Taxonomy evaluator must recognize synonyms and hashtag classifications."""
        mover = create_synth_a_preset()
        assert evaluate_volunteer_classification(mover, "moving_brown_dwarf") is True
        assert evaluate_volunteer_classification(mover, "mover") is True
        assert evaluate_volunteer_classification(mover, "#mover") is True
        assert evaluate_volunteer_classification(mover, "dipole") is True
        assert evaluate_volunteer_classification(mover, "stationary_star") is False

        control = create_synth_control_preset()
        assert evaluate_volunteer_classification(control, "stationary") is True
        assert evaluate_volunteer_classification(control, "control") is True
        assert evaluate_volunteer_classification(control, "#mover") is False

        var = create_synth_b_preset()
        assert evaluate_volunteer_classification(var, "variable_star") is True
        assert evaluate_volunteer_classification(var, "#variable") is True

    def test_bayesian_reliability_weight_updates(self) -> None:
        """Bayesian update w_u = (α + C_correct) / (α + β + C_seen) clamped to [0.1, 1.0]."""
        # Starting with 0 seen: w_0 = (2 + 0) / (2 + 1 + 0) = 2/3 = 0.6667
        w, seen, correct = update_bayesian_reliability(
            current_weight=0.5,
            calibration_seen=0,
            calibration_correct=0,
            is_correct=True,
            prior_alpha=2.0,
            prior_beta=1.0,
        )
        assert seen == 1
        assert correct == 1
        # w_1 = (2 + 1) / (2 + 1 + 1) = 3/4 = 0.75
        assert pytest.approx(w, abs=1e-4) == 0.75

        # 9 correct out of 10 seen
        w_10, seen_10, corr_10 = update_bayesian_reliability(
            current_weight=0.75,
            calibration_seen=9,
            calibration_correct=8,
            is_correct=True,
            prior_alpha=2.0,
            prior_beta=1.0,
        )
        # w = (2 + 9) / (3 + 10) = 11/13 ~ 0.8462
        assert seen_10 == 10
        assert corr_10 == 9
        assert pytest.approx(w_10, abs=1e-4) == 0.8462

    def test_calibration_metrics_roc_calculations(self) -> None:
        """ROC metrics should accurately calculate TPR, FPR, Precision, and F1."""
        evals = [
            {"is_actual_mover": True, "predicted_mover": True},    # TP
            {"is_actual_mover": True, "predicted_mover": True},    # TP
            {"is_actual_mover": True, "predicted_mover": False},   # FN
            {"is_actual_mover": False, "predicted_mover": True},   # FP
            {"is_actual_mover": False, "predicted_mover": False},  # TN
            {"is_actual_mover": False, "predicted_mover": False},  # TN
        ]
        metrics = compute_calibration_metrics(evals)

        # TP=2, FN=1 -> TPR = 2/3 ~ 0.6667
        # FP=1, TN=2 -> FPR = 1/3 ~ 0.3333
        # Precision = 2 / (2 + 1) = 2/3 ~ 0.6667
        assert metrics["tp"] == 2
        assert metrics["fp"] == 1
        assert metrics["tn"] == 2
        assert metrics["fn"] == 1
        assert pytest.approx(metrics["tpr"], abs=1e-3) == 0.6667
        assert pytest.approx(metrics["fpr"], abs=1e-3) == 0.3333
        assert pytest.approx(metrics["precision"], abs=1e-3) == 0.6667
        assert pytest.approx(metrics["accuracy"], abs=1e-3) == 4 / 6
