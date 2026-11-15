"""SPLICES Point-Source Ice Photometry & Quantitative Column-Density Integrator.

Specification Anchors:
- SPECIFICATION.md §1.3 Audit #10 (Point-source background star workflow; verified lab
  A-values only, line 48)
- SPECIFICATION.md §2.4 (Laboratory Integrated Band Strengths A-Values, lines 193-205)
- SPECIFICATION.md §6.3.4 (Tab 4: Molecular & Ice Mapping Studio, lines 1526-1571)
- tasks.md Dev 5 (role:E5-datasci) Issue #25

Physics implemented here:
1. Pencil-beam point-source photometry (aperture + local sky annulus subtraction).
2. A 4th-order Chebyshev stellar continuum fitted across unabsorbed windows
   (2.10-2.40 um and 3.70-3.90 um).
3. Optical depth tau(lambda) = -ln(F_obs / F_cont).
4. Wavenumber nu = 10000 / lambda [cm^-1] and trapezoidal integration of tau(nu)
   across each molecular feature window.
5. N_ice = (1 / A) * integral(tau(nu) dnu) [cm^-2] using literature-verified laboratory
   A-values (Gerakines et al. 1995; Boogert et al. 2000; Jiang et al. 1975;
   Kerkhof et al. 1999).

Scientific guardrail: solid-ice A-values are NEVER applied to the photospheric 3.32 um
CH4 absorption of brown dwarfs (WISE 0855-0714, Epsilon Indi B). Those sightlines are
detected explicitly and return suppressed column densities plus an explanatory notice.
"""

from __future__ import annotations

import json
import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from numpy.polynomial.chebyshev import chebval, chebvander

# --------------------------------------------------------------------------------------
# Physical constants, continuum windows, and verified laboratory A-values
# --------------------------------------------------------------------------------------

# Unabsorbed continuum windows from SPECIFICATION.md §6.3.4 Detailed Mechanics item 2.
CONTINUUM_WINDOWS_UM: tuple[tuple[float, float], ...] = (
    (2.10, 2.40),
    (3.70, 3.90),
)

# Convert wavelength [um] to wavenumber [cm^-1]: nu = 10000 / lambda.
WAVENUMBER_ZERO_POINT = 10000.0

PHOTOSPHERIC_CH4_UM = 3.32
PHOTOSPHERIC_CH4_NOTICE = (
    "Scientific notice: the 3.32 um CH4 feature in WISE 0855-0714 and Epsilon Indi B is "
    "photospheric gas, not solid interstellar ice. Laboratory solid-ice A-values are not "
    "applied to brown-dwarf photospheres, and spurious ice column densities are suppressed."
)


@dataclass(frozen=True)
class IceBandStrength:
    """Literature-verified laboratory integrated band strength for one ice feature."""

    key: str
    species: str
    label: str
    center_um: float
    window_um: tuple[float, float]
    a_cm_per_molecule: float
    citation: str
    detector: str
    # Width used only by the deterministic synthetic SPLICES template generator.
    sigma_cm1: float


ICE_BAND_STRENGTHS: tuple[IceBandStrength, ...] = (
    IceBandStrength(
        key="h2o",
        species="H2O",
        label="Water ice (O-H stretch)",
        center_um=3.05,
        window_um=(2.80, 3.35),
        a_cm_per_molecule=2.0e-16,
        citation="Gerakines et al. (1995)",
        detector="D4",
        sigma_cm1=110.0,
    ),
    IceBandStrength(
        key="co2",
        species="CO2",
        label="Carbon dioxide ice (C=O asymmetric stretch nu3)",
        center_um=4.27,
        window_um=(4.22, 4.32),
        a_cm_per_molecule=7.6e-17,
        citation="Gerakines et al. (1995)",
        detector="D5",
        sigma_cm1=8.0,
    ),
    IceBandStrength(
        key="co2_13",
        species="13CO2",
        label="Carbon-13 dioxide ice (13C=O stretch)",
        center_um=4.38,
        window_um=(4.34, 4.42),
        a_cm_per_molecule=7.8e-17,
        citation="Boogert et al. (2000)",
        detector="D5",
        sigma_cm1=6.0,
    ),
    IceBandStrength(
        key="co",
        species="CO",
        label="Carbon monoxide ice (C=O stretch)",
        center_um=4.67,
        window_um=(4.60, 4.75),
        a_cm_per_molecule=1.1e-17,
        citation="Jiang et al. (1975)",
        detector="D6",
        sigma_cm1=8.0,
    ),
    IceBandStrength(
        key="ch3oh",
        species="CH3OH",
        label="Methanol ice (C-H stretch)",
        center_um=3.54,
        window_um=(3.42, 3.66),
        a_cm_per_molecule=5.3e-18,
        citation="Kerkhof et al. (1999)",
        detector="D4",
        sigma_cm1=30.0,
    ),
)

ICE_BY_KEY: dict[str, IceBandStrength] = {band.key: band for band in ICE_BAND_STRENGTHS}

BROWN_DWARF_TARGETS: dict[str, dict[str, Any]] = {
    "wise_0855": {
        "name": "WISE 0855-0714",
        "ra": 133.73712,
        "dec": -7.24038,
        "spectral_type": "Y4",
    },
    "eps_indi_b": {
        "name": "Epsilon Indi B",
        "ra": 331.09566,
        "dec": -56.80031,
        "spectral_type": "T1+T6",
    },
}

DEFAULT_SPLICES_CATALOG_PATH = Path(__file__).resolve().parents[1] / "data" / "splices_catalog.json"


# --------------------------------------------------------------------------------------
# Data classes
# --------------------------------------------------------------------------------------


@dataclass
class IceColumnDensity:
    """Recovered column density for one laboratory ice feature."""

    key: str
    species: str
    label: str
    center_um: float
    window_um: tuple[float, float]
    a_cm_per_molecule: float
    citation: str
    detector: str
    integrated_tau_cm1: float | None
    column_density_cm2: float | None
    suppressed: bool = False
    note: str | None = None


@dataclass
class IceAnalysis:
    """Complete optical-depth and column-density solution for one sightline."""

    wavelengths_um: list[float]
    continuum: list[float]
    tau: list[float]
    bands: list[IceColumnDensity]
    ratio_co2_h2o_percent: float | None
    brown_dwarf_notice: str | None = None
    source_badge: str = "[Synthetic Injection Mode]"
    target_name: str | None = None
    provenance: dict[str, Any] = field(default_factory=dict)

    @property
    def is_brown_dwarf(self) -> bool:
        return self.brown_dwarf_notice is not None

    def band(self, key: str) -> IceColumnDensity | None:
        for item in self.bands:
            if item.key == key:
                return item
        return None


# --------------------------------------------------------------------------------------
# SPLICES catalog helpers
# --------------------------------------------------------------------------------------


def load_splices_catalog(path: str | Path | None = None) -> list[dict[str, Any]]:
    """Load the seeded SPLICES background-star catalog from backend/data/*.json."""
    catalog_path = Path(path) if path is not None else DEFAULT_SPLICES_CATALOG_PATH
    with catalog_path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if isinstance(payload, dict):
        targets = payload.get("targets", [])
    else:
        targets = payload
    if not isinstance(targets, list):
        raise TypeError("SPLICES catalog must be a JSON list or an object with a 'targets' list")
    return [dict(item) for item in targets]


# --------------------------------------------------------------------------------------
# Continuum, optical depth, and wavenumber integration
# --------------------------------------------------------------------------------------


def wavenumber_cm1(wavelength_um: Sequence[float] | np.ndarray) -> np.ndarray:
    """Convert wavelength in micrometres to wavenumber in inverse centimetres."""
    waves = np.asarray(wavelength_um, dtype=np.float64)
    if np.any(waves <= 0.0):
        raise ValueError("Wavelengths must be positive micrometre values")
    return WAVENUMBER_ZERO_POINT / waves


def _continuum_window_mask(waves: np.ndarray, windows: Iterable[tuple[float, float]]) -> np.ndarray:
    mask = np.zeros(waves.shape, dtype=bool)
    for low, high in windows:
        mask |= (waves >= low) & (waves <= high)
    return mask


def _chebyshev_coefficients(
    x: np.ndarray,
    y: np.ndarray,
    weights: np.ndarray,
    order: int,
    ridge_scale: float = 1e-4,
) -> np.ndarray:
    """Solve a lightly regularised 4th-order Chebyshev least-squares system.

    Continuum windows are narrow and clustered, so the unregularised degree-3/4 terms can
    amplify sub-percent absorption leakage at window edges into large extrapolation errors.
    A tiny Tikhonov penalty on the highest-order coefficients keeps the mandated 4th-order
    Chebyshev basis numerically stable without biasing the recovered continuum.
    """
    design = chebvander(x, order)
    weighted_design = design * weights[:, None]
    weighted_flux = y * weights
    normal = weighted_design.T @ weighted_design
    rhs = weighted_design.T @ weighted_flux

    scale = max(float(np.trace(normal)) / float(order + 1), 1e-12)
    penalty = np.zeros(order + 1, dtype=np.float64)
    if order >= 3:
        penalty[3:] = 10.0
    regularised = normal + np.diag(ridge_scale * scale * penalty)
    try:
        return np.linalg.solve(regularised, rhs)
    except np.linalg.LinAlgError:
        return np.linalg.lstsq(regularised, rhs, rcond=None)[0]


def fit_stellar_continuum(
    wavelengths: Sequence[float] | np.ndarray,
    flux: Sequence[float] | np.ndarray,
    variance: Sequence[float] | np.ndarray | None = None,
    order: int = 4,
    windows: Sequence[tuple[float, float]] = CONTINUUM_WINDOWS_UM,
    n_sigma: float = 3.0,
    n_iter: int = 3,
) -> np.ndarray:
    """Fit a 4th-order Chebyshev stellar continuum across unabsorbed windows.

    ``tau(lambda) = -ln(F / F_cont)`` is evaluated by :func:`compute_optical_depth`.
    A full-spectrum fallback is used only if the windows contain fewer samples than the
    polynomial degrees of freedom (e.g. very coarse channel grids).
    """
    waves = np.asarray(wavelengths, dtype=np.float64)
    flx = np.asarray(flux, dtype=np.float64)
    if waves.shape != flx.shape:
        raise ValueError("wavelengths and flux must have the same length")
    if waves.size <= order:
        raise ValueError(f"At least {order + 1} spectral samples are required")

    var = None if variance is None else np.asarray(variance, dtype=np.float64)
    if var is not None and var.shape != flx.shape:
        raise ValueError("variance must match the flux shape")

    mask = _continuum_window_mask(waves, windows)
    if int(np.sum(mask)) < order + 2:
        mask = np.ones(waves.shape, dtype=bool)

    # Normalise the Chebyshev domain over the full spectral range for numerical stability.
    lo = float(np.min(waves))
    hi = float(np.max(waves))
    span = hi - lo if hi > lo else 1.0
    x_all = 2.0 * (waves - lo) / span - 1.0

    active = mask.copy()
    coefficients: np.ndarray | None = None
    for _ in range(max(1, n_iter)):
        x_fit = x_all[active]
        y_fit = flx[active]
        if x_fit.size < order + 1:
            break

        if var is not None:
            sigma = np.sqrt(np.maximum(var[active], 1e-30))
            weights = 1.0 / sigma
        else:
            weights = np.ones_like(y_fit)

        coefficients = _chebyshev_coefficients(x_fit, y_fit, weights, order)
        residuals = y_fit - chebval(x_fit, coefficients)
        scatter = float(np.std(residuals))
        if scatter <= 0.0 or not np.isfinite(scatter):
            break
        good = np.abs(residuals) <= n_sigma * scatter
        if np.all(good):
            break
        active_indices = np.flatnonzero(active)
        active[active_indices[~good]] = False

    if coefficients is None:
        continuum = np.maximum(flx, 1e-12)
    else:
        continuum = np.maximum(chebval(x_all, coefficients), 1e-12)
    return continuum.astype(np.float64)


def compute_optical_depth(
    flux: Sequence[float] | np.ndarray,
    continuum: Sequence[float] | np.ndarray,
    min_transmission: float = 1e-4,
) -> np.ndarray:
    """Evaluate tau(lambda) = -ln(F_obs / F_cont) with a numerically safe transmission floor."""
    flx = np.asarray(flux, dtype=np.float64)
    cont = np.asarray(continuum, dtype=np.float64)
    if flx.shape != cont.shape:
        raise ValueError("flux and continuum must have the same length")
    ratio = np.divide(flx, cont, out=np.full_like(flx, min_transmission), where=cont > 0.0)
    ratio = np.maximum(ratio, min_transmission)
    return -np.log(ratio)


def integrate_tau_wavenumber(
    wavelengths_um: Sequence[float] | np.ndarray,
    tau: Sequence[float] | np.ndarray,
    window_um: tuple[float, float],
    clip_negative_tau: bool = True,
) -> float:
    """Numerically integrate tau(nu) dnu over a molecular feature window (trapezoid rule)."""
    waves = np.asarray(wavelengths_um, dtype=np.float64)
    taus = np.asarray(tau, dtype=np.float64)
    if waves.shape != taus.shape:
        raise ValueError("wavelengths and tau must have the same length")

    low, high = window_um
    mask = (waves >= low) & (waves <= high) & np.isfinite(taus)
    if int(np.sum(mask)) < 2:
        return 0.0

    nu = wavenumber_cm1(waves[mask])
    values = taus[mask]
    if clip_negative_tau:
        values = np.maximum(values, 0.0)

    order = np.argsort(nu)
    integral = np.trapezoid(values[order], nu[order])
    return float(max(0.0, integral))


def integrate_ice_column_densities(
    wavelengths_um: Sequence[float] | np.ndarray,
    tau: Sequence[float] | np.ndarray,
    bands: Sequence[IceBandStrength] | None = None,
    clip_negative_tau: bool = True,
) -> list[IceColumnDensity]:
    """Compute N_ice = (1/A) integral tau(nu) dnu for each requested ice band."""
    selected = tuple(bands) if bands is not None else ICE_BAND_STRENGTHS
    results: list[IceColumnDensity] = []
    for band in selected:
        integral = integrate_tau_wavenumber(
            wavelengths_um,
            tau,
            band.window_um,
            clip_negative_tau=clip_negative_tau,
        )
        density = integral / band.a_cm_per_molecule if band.a_cm_per_molecule > 0 else None
        results.append(
            IceColumnDensity(
                key=band.key,
                species=band.species,
                label=band.label,
                center_um=band.center_um,
                window_um=band.window_um,
                a_cm_per_molecule=band.a_cm_per_molecule,
                citation=band.citation,
                detector=band.detector,
                integrated_tau_cm1=integral,
                column_density_cm2=density,
            )
        )
    return results


# --------------------------------------------------------------------------------------
# Brown-dwarf guardrail
# --------------------------------------------------------------------------------------


def _normalise_name(name: str) -> str:
    return "".join(character for character in name.lower() if character.isalnum())


def _angular_separation_arcsec(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    d_ra = ((ra1 - ra2 + 180.0) % 360.0) - 180.0
    d_ra_star = d_ra * math.cos(math.radians((dec1 + dec2) / 2.0))
    return math.hypot(d_ra_star, dec1 - dec2) * 3600.0


def is_brown_dwarf_target(
    target_name: str | None = None,
    ra: float | None = None,
    dec: float | None = None,
    match_radius_arcsec: float = 30.0,
) -> bool:
    """Return True for the two cold brown-dwarf benchmark sightlines."""
    if target_name:
        normalised = _normalise_name(target_name)
        for aliases in (("wise08550714", "wise0855"), ("epsilonindib", "epsindib")):
            if any(alias in normalised for alias in aliases):
                return True

    if ra is not None and dec is not None:
        for target in BROWN_DWARF_TARGETS.values():
            separation = _angular_separation_arcsec(ra, dec, target["ra"], target["dec"])
            if separation <= match_radius_arcsec:
                return True
    return False


def _suppress_solid_ice(results: list[IceColumnDensity], notice: str) -> list[IceColumnDensity]:
    for result in results:
        result.integrated_tau_cm1 = None
        result.column_density_cm2 = None
        result.suppressed = True
        result.note = notice
    return results


# --------------------------------------------------------------------------------------
# Top-level analysis
# --------------------------------------------------------------------------------------


def analyze_ice_sightline(
    wavelengths_um: Sequence[float] | np.ndarray,
    flux: Sequence[float] | np.ndarray,
    variance: Sequence[float] | np.ndarray | None = None,
    target_name: str | None = None,
    ra: float | None = None,
    dec: float | None = None,
    bands: Sequence[IceBandStrength] | None = None,
    continuum_order: int = 4,
    continuum_windows: Sequence[tuple[float, float]] = CONTINUUM_WINDOWS_UM,
    source_badge: str = "[Synthetic Injection Mode]",
) -> IceAnalysis:
    """Run the complete Tab 4 ice workflow for a single point-source sightline."""
    waves = np.asarray(wavelengths_um, dtype=np.float64)
    flx = np.asarray(flux, dtype=np.float64)
    if waves.shape != flx.shape:
        raise ValueError("wavelengths and flux must have the same length")

    continuum = fit_stellar_continuum(
        waves,
        flx,
        variance=variance,
        order=continuum_order,
        windows=continuum_windows,
    )
    tau = compute_optical_depth(flx, continuum)
    results = integrate_ice_column_densities(waves, tau, bands=bands)

    brown_dwarf = is_brown_dwarf_target(target_name=target_name, ra=ra, dec=dec)
    notice: str | None = None
    ratio: float | None = None
    if brown_dwarf:
        notice = PHOTOSPHERIC_CH4_NOTICE
        results = _suppress_solid_ice(results, notice)
    else:
        by_key = {item.key: item for item in results}
        water = by_key.get("h2o")
        carbon_dioxide = by_key.get("co2")
        if (
            water is not None
            and carbon_dioxide is not None
            and water.column_density_cm2
            and carbon_dioxide.column_density_cm2 is not None
        ):
            ratio = 100.0 * carbon_dioxide.column_density_cm2 / water.column_density_cm2

    provenance = {
        "continuum_windows_um": [list(item) for item in continuum_windows],
        "continuum_order": continuum_order,
        "wavenumber_formula": "nu = 10000 / lambda_um",
        "integration": "trapezoidal rule in wavenumber space",
        "a_value_source": "laboratory literature (see per-band citation)",
        "brown_dwarf_guard": brown_dwarf,
        "photospheric_ch4_um": PHOTOSPHERIC_CH4_UM,
    }

    return IceAnalysis(
        wavelengths_um=[float(value) for value in waves],
        continuum=[float(value) for value in continuum],
        tau=[float(value) for value in tau],
        bands=results,
        ratio_co2_h2o_percent=ratio,
        brown_dwarf_notice=notice,
        source_badge=source_badge,
        target_name=target_name,
        provenance=provenance,
    )


# --------------------------------------------------------------------------------------
# Deterministic SPLICES synthetic template (used by tests and the offline demo mode)
# --------------------------------------------------------------------------------------


SPLICES_DEMO_COLUMNS: dict[str, float] = {
    "h2o": 2.45e18,
    "co2": 4.12e17,
    "co2_13": 6.4e16,
    "co": 8.9e17,
    "ch3oh": 1.2e17,
}


def _gaussian_tau_nu(nu: np.ndarray, center_cm1: float, sigma_cm1: float, area_cm1: float) -> np.ndarray:
    """Unit-area Gaussian in wavenumber space scaled to a known integrated tau area."""
    norm = sigma_cm1 * math.sqrt(2.0 * math.pi)
    return (area_cm1 / norm) * np.exp(-0.5 * ((nu - center_cm1) / sigma_cm1) ** 2)


def generate_synthetic_ice_spectrum(
    columns_cm2: dict[str, float] | None = None,
    n_points: int = 2001,
    wavelength_range_um: tuple[float, float] = (0.75, 5.00),
    base_flux: float = 1.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Build a smooth stellar continuum modulated by analytically known ice optical depth.

    The injected tau(nu) is a sum of Gaussians whose exact integrals are
    ``N_ice * A_ice``. Recovering ``N_ice`` from the returned flux therefore provides a
    machine-checkable <2% validation of the full Tab 4 pipeline.
    """
    columns = dict(SPLICES_DEMO_COLUMNS)
    if columns_cm2:
        columns.update(columns_cm2)

    waves = np.linspace(wavelength_range_um[0], wavelength_range_um[1], n_points, dtype=np.float64)
    nu = wavenumber_cm1(waves)

    # Smooth stellar continuum: a low-order polynomial is exactly representable by the
    # 4th-order Chebyshev baseline. The continuum windows remain unabsorbed.
    shifted = waves - 2.9
    continuum = base_flux * (1.0 + 0.16 * shifted - 0.020 * shifted**2)

    tau_nu = np.zeros_like(nu)
    for band in ICE_BAND_STRENGTHS:
        column = columns.get(band.key)
        if not column:
            continue
        center_nu = WAVENUMBER_ZERO_POINT / band.center_um
        area_cm1 = column * band.a_cm_per_molecule
        tau_nu += _gaussian_tau_nu(nu, center_nu, band.sigma_cm1, area_cm1)

    flux = continuum * np.exp(-tau_nu)
    return waves, np.maximum(flux, 1e-12)


def generate_brown_dwarf_spectrum(
    n_points: int = 2001,
    wavelength_range_um: tuple[float, float] = (0.75, 5.00),
    base_flux: float = 1.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Build a cold brown-dwarf photosphere with gaseous 3.32 um CH4 and no solid ice."""
    waves = np.linspace(wavelength_range_um[0], wavelength_range_um[1], n_points, dtype=np.float64)
    shifted = waves - 2.9
    continuum = base_flux * (1.0 + 0.10 * shifted - 0.012 * shifted**2)
    gas_tau = np.zeros_like(waves)
    gas_tau += 0.80 * np.exp(-0.5 * ((waves - PHOTOSPHERIC_CH4_UM) / 0.12) ** 2)
    gas_tau += 0.55 * np.exp(-0.5 * ((waves - 1.42) / 0.05) ** 2)
    gas_tau += 0.65 * np.exp(-0.5 * ((waves - 1.92) / 0.07) ** 2)
    flux = continuum * np.exp(-gas_tau)
    return waves, np.maximum(flux, 1e-12)
