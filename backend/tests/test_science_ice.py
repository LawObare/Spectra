"""Unit & Acceptance Tests for SPLICES Point-Source Ice Column-Density Integration.

Specification Anchors:
- SPECIFICATION.md §2.4 (Laboratory Integrated Band Strengths A-Values)
- SPECIFICATION.md §6.3.4 (Tab 4: Molecular & Ice Mapping Studio)
- tasks.md Dev 5 (role:E5-datasci) Issue #25

Acceptance Criteria:
- A known synthetic/SPLICES optical-depth profile reproduces analytical N(H2O) and
  N(CO2) within <2%.
- Brown-dwarf sightlines (WISE 0855, Epsilon Indi B) return an explicit photospheric-CH4
  notice and suppress all solid-ice column densities.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

try:
    from backend.science.ice import (
        CONTINUUM_WINDOWS_UM,
        ICE_BAND_STRENGTHS,
        ICE_BY_KEY,
        PHOTOSPHERIC_CH4_NOTICE,
        SPLICES_DEMO_COLUMNS,
        analyze_ice_sightline,
        compute_optical_depth,
        fit_stellar_continuum,
        generate_brown_dwarf_spectrum,
        generate_synthetic_ice_spectrum,
        integrate_tau_wavenumber,
        is_brown_dwarf_target,
        load_splices_catalog,
        wavenumber_cm1,
    )
except ImportError:
    from science.ice import (  # type: ignore
        CONTINUUM_WINDOWS_UM,
        ICE_BAND_STRENGTHS,
        ICE_BY_KEY,
        PHOTOSPHERIC_CH4_NOTICE,
        SPLICES_DEMO_COLUMNS,
        analyze_ice_sightline,
        compute_optical_depth,
        fit_stellar_continuum,
        generate_brown_dwarf_spectrum,
        generate_synthetic_ice_spectrum,
        integrate_tau_wavenumber,
        is_brown_dwarf_target,
        load_splices_catalog,
        wavenumber_cm1,
    )


# --------------------------------------------------------------------------------------
# Specification constants
# --------------------------------------------------------------------------------------


def test_laboratory_a_values_match_specification() -> None:
    """Assert every literature A-value matches SPECIFICATION.md §2.4 exactly."""
    expected = {
        "h2o": 2.0e-16,  # Gerakines et al. (1995)
        "co2": 7.6e-17,  # Gerakines et al. (1995)
        "co2_13": 7.8e-17,  # Boogert et al. (2000)
        "co": 1.1e-17,  # Jiang et al. (1975)
        "ch3oh": 5.3e-18,  # Kerkhof et al. (1999)
    }
    assert {band.key: band.a_cm_per_molecule for band in ICE_BAND_STRENGTHS} == expected
    assert ICE_BY_KEY["h2o"].center_um == 3.05
    assert ICE_BY_KEY["co2"].center_um == 4.27
    assert ICE_BY_KEY["co2_13"].center_um == 4.38
    assert ICE_BY_KEY["co"].center_um == 4.67
    assert ICE_BY_KEY["ch3oh"].center_um == 3.54


def test_continuum_windows_match_specification() -> None:
    """Assert the issue-mandated unabsorbed continuum windows are used."""
    assert CONTINUUM_WINDOWS_UM == ((2.10, 2.40), (3.70, 3.90))


def test_wavenumber_conversion() -> None:
    """Assert nu = 10000 / lambda with exact representative values."""
    nu = wavenumber_cm1([3.05, 4.27, 4.67])
    assert np.allclose(nu, [10000.0 / 3.05, 10000.0 / 4.27, 10000.0 / 4.67])
    assert wavenumber_cm1([2.0])[0] == pytest.approx(5000.0)


# --------------------------------------------------------------------------------------
# Continuum, tau, and analytical integration
# --------------------------------------------------------------------------------------


def test_optical_depth_inverts_known_transmission() -> None:
    """Assert tau = -ln(F/F_cont) recovers an injected optical depth."""
    continuum = np.full(64, 2.5)
    injected_tau = np.linspace(0.0, 1.4, 64)
    flux = continuum * np.exp(-injected_tau)
    recovered = compute_optical_depth(flux, continuum)
    assert np.allclose(recovered, injected_tau, atol=1e-12)


def test_trapezoid_integral_in_wavenumber_space() -> None:
    """Assert a constant tau integrates to tau * |Delta nu| over the feature window."""
    waves = np.linspace(2.80, 3.35, 4001)
    tau = np.full_like(waves, 0.5)
    integral = integrate_tau_wavenumber(waves, tau, (2.80, 3.35))
    expected = 0.5 * abs(wavenumber_cm1([2.80])[0] - wavenumber_cm1([3.35])[0])
    assert integral == pytest.approx(expected, rel=1e-4)


def test_chebyshev_continuum_recovers_polynomial_baseline() -> None:
    """Assert the 4th-order Chebyshev fit recovers a smooth stellar continuum."""
    waves = np.linspace(0.75, 5.00, 3001)
    shifted = waves - 2.9
    continuum = 1.0 + 0.16 * shifted - 0.020 * shifted**2
    flux = continuum * np.exp(-0.8 * np.exp(-0.5 * ((waves - 3.05) / 0.16) ** 2))
    recovered = fit_stellar_continuum(waves, flux)
    # Within the molecular-feature range (<5 um) the regularised 4th-order Chebyshev
    # baseline stays well below 0.5%; the extreme 5 um red edge is extrapolation.
    assert np.allclose(recovered, continuum, rtol=5e-3, atol=1e-6)
    ice_range = waves <= 4.80
    assert np.allclose(recovered[ice_range], continuum[ice_range], rtol=1e-3, atol=1e-6)


# --------------------------------------------------------------------------------------
# Acceptance: analytical N(H2O), N(CO2) within <2%
# --------------------------------------------------------------------------------------


def test_synthetic_splices_profile_reproduces_column_densities_within_2pc() -> None:
    """Known synthetic SPLICES profile must recover analytical N(H2O) and N(CO2) <2%."""
    waves, flux = generate_synthetic_ice_spectrum(n_points=4001)
    analysis = analyze_ice_sightline(
        waves,
        flux,
        target_name="SPLICES-J181410-175200",
        ra=273.54167,
        dec=-17.86667,
    )

    assert analysis.brown_dwarf_notice is None
    assert analysis.is_brown_dwarf is False

    for key in ("h2o", "co2"):
        expected = SPLICES_DEMO_COLUMNS[key]
        recovered = analysis.band(key)
        assert recovered is not None
        assert recovered.column_density_cm2 is not None
        relative_error = abs(recovered.column_density_cm2 - expected) / expected
        assert relative_error < 0.02, (
            f"{key}: recovered {recovered.column_density_cm2:.4e} vs analytical "
            f"{expected:.4e} ({relative_error * 100:.2f}% error)"
        )

    # The CO2/H2O abundance ratio must be 16.82% for the injected demo profile.
    expected_ratio = 100.0 * SPLICES_DEMO_COLUMNS["co2"] / SPLICES_DEMO_COLUMNS["h2o"]
    assert analysis.ratio_co2_h2o_percent is not None
    assert analysis.ratio_co2_h2o_percent == pytest.approx(expected_ratio, rel=0.02)


def test_all_five_lab_bands_are_integrated() -> None:
    """Assert the full molecular ruler set is present in the solution."""
    waves, flux = generate_synthetic_ice_spectrum()
    analysis = analyze_ice_sightline(waves, flux)
    assert {band.key for band in analysis.bands} == {
        "h2o",
        "co2",
        "co2_13",
        "co",
        "ch3oh",
    }
    for band in analysis.bands:
        assert band.column_density_cm2 is not None
        assert band.column_density_cm2 > 0.0
        assert band.citation


# --------------------------------------------------------------------------------------
# Acceptance: brown-dwarf photospheric CH4 guardrail
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "ra", "dec"),
    [
        ("WISE 0855-0714", 133.73712, -7.24038),
        ("Epsilon Indi B", 331.09566, -56.80031),
        (None, 133.73712, -7.24038),
        (None, 331.09566, -56.80031),
    ],
)
def test_brown_dwarf_target_detection(name: str | None, ra: float, dec: float) -> None:
    """Assert both brown dwarfs are detected by name and by coordinates."""
    assert is_brown_dwarf_target(target_name=name, ra=ra, dec=dec) is True


def test_brown_dwarf_sightline_suppresses_solid_ice_columns() -> None:
    """WISE 0855 / Epsilon Indi B must not receive spurious solid-ice column densities."""
    waves, flux = generate_brown_dwarf_spectrum()
    for name, ra, dec in (
        ("WISE 0855-0714", 133.73712, -7.24038),
        ("Epsilon Indi B", 331.09566, -56.80031),
    ):
        analysis = analyze_ice_sightline(waves, flux, target_name=name, ra=ra, dec=dec)
        assert analysis.brown_dwarf_notice == PHOTOSPHERIC_CH4_NOTICE
        assert analysis.ratio_co2_h2o_percent is None
        assert analysis.provenance["photospheric_ch4_um"] == 3.32
        assert analysis.provenance["brown_dwarf_guard"] is True
        assert len(analysis.bands) == 5
        for band in analysis.bands:
            assert band.suppressed is True
            assert band.column_density_cm2 is None
            assert band.integrated_tau_cm1 is None

        # The 3.32 um photospheric CH4 feature is not one of the solid-ice rulers.
        assert all(abs(band.center_um - 3.32) > 0.01 for band in analysis.bands)


# --------------------------------------------------------------------------------------
# SPLICES catalog seed
# --------------------------------------------------------------------------------------


def test_splices_catalog_seed_is_valid() -> None:
    """Assert the seeded SPLICES catalog is loadable, unique, and coordinate-valid."""
    targets = load_splices_catalog()
    assert len(targets) >= 4
    ids = [target["id"] for target in targets]
    assert len(ids) == len(set(ids))
    for target in targets:
        assert 0.0 <= float(target["ra"]) < 360.0
        assert -90.0 <= float(target["dec"]) <= 90.0
        assert target["name"].startswith("SPLICES-")
        assert target["catalog"].startswith("SPLICES")
        columns = target["columns_cm2"]
        for key in ("h2o", "co2", "co2_13", "co", "ch3oh"):
            assert float(columns[key]) > 0.0
        assert math.isfinite(float(target["snr"]))
