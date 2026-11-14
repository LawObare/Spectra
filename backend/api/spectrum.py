"""HDU 6 WCS-WAVE 102-Channel Hyperspectral Extraction Endpoint (GET /api/spectrum).

Specification Anchors:
- SPECIFICATION.md §4.1 Pipeline 2 (WCS-WAVE Hyperspectral Extraction Pipeline, lines 432–445)
- SPECIFICATION.md §5.3.1 Endpoint 5 (GET /api/spectrum, lines 903–919)
- SYSTEM_ARCHITECTURE.md §4.2 Item 6 & Item 7 (Smile Inversion and PSF Photometry)
- tasks.md Dev 1 (role:E1-astro) Issue #19

Behavior:
Extracts calibrated 102-channel near-infrared spectrum (0.75 - 5.00 um) in Janskys
via HDU 6 WCS-WAVE smile inversion and HDU 5 empirical PSF forced photometry.
When normalize=true, fits an iterative 3σ-clipped 4th-order Chebyshev polynomial
across unabsorbed spectral windows and returns normalized transmission and optical depth τ(λ).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

try:
    from backend.science.wave import (
        TOTAL_SPHEREX_CHANNELS,
        extract_102_channel_spectrum,
    )
except ImportError:
    from science.wave import (
        TOTAL_SPHEREX_CHANNELS,
        extract_102_channel_spectrum,
    )

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["spectrum"])


class SpectrumResponse(BaseModel):
    """Calibrated 102-channel SPHEREx spectrum response model."""

    ra: float = Field(..., description="Right Ascension in J2000 decimal degrees")
    dec: float = Field(..., description="Declination in J2000 decimal degrees")
    target_name: str | None = Field(None, description="Matched astronomical target or benchmark name")
    channels: int = Field(TOTAL_SPHEREX_CHANNELS, description="Total spectral channels (102)")
    wavelengths_um: list[float] = Field(..., description="Channel center wavelengths in micrometers (0.75-5.00 um)")
    flux_jy: list[float] = Field(..., description="Flux density per channel in Janskys")
    variance_jy2: list[float] = Field(..., description="Flux variance per channel in Jy^2")
    flags: list[int] = Field(..., description="Bitwise quality flag bitmasks per channel")
    mjd_per_channel: list[float] = Field(..., description="Observation MJD per channel")
    mjd_span: list[float] = Field(..., description="Observation MJD range [t_min, t_max]")
    is_simultaneous: bool = Field(..., description="True if MJD span <= 1.0 day; False for all-sky survey passes")
    continuum_flux_jy: list[float] | None = Field(
        None, description="Iterative 3σ-clipped 4th-order Chebyshev continuum baseline when normalize=true"
    )
    optical_depth_tau: list[float] | None = Field(
        None, description="Apparent optical depth τ(λ) = -ln(F/F_cont) when normalize=true"
    )
    provenance: dict[str, Any] = Field(default_factory=dict, description="Calibration provenance and institutional badges")


@router.get(
    "/spectrum",
    response_model=SpectrumResponse,
    summary="Extract calibrated 102-channel SPHEREx spectrum",
    description=(
        "Extracts native point-source spectrophotometry using HDU 5 PSF cube and HDU 6 WCS-WAVE "
        "smile inversion across all overlapping exposures. Converts MJy/sr surface brightness to Janskys "
        "(F_nu = I_nu * 10^6 * Omega_px). When normalize=true, evaluates 3σ-clipped 4th-order Chebyshev continuum."
    ),
)
async def get_spectrum(
    ra: float = Query(..., ge=0.0, le=360.0, description="Right Ascension in J2000 decimal degrees [0, 360]"),
    dec: float = Query(..., ge=-90.0, le=90.0, description="Declination in J2000 decimal degrees [-90, +90]"),
    normalize: bool = Query(False, description="Apply 3σ-clipped 4th-order Chebyshev polynomial continuum normalization"),
) -> SpectrumResponse:
    """Handle GET /api/spectrum requests."""
    try:
        spec = extract_102_channel_spectrum(ra=ra, dec=dec, normalize=normalize)
        return SpectrumResponse(
            ra=spec.ra,
            dec=spec.dec,
            target_name=spec.target_name,
            channels=spec.channels,
            wavelengths_um=spec.wavelengths_um,
            flux_jy=spec.flux_jy,
            variance_jy2=spec.variance_jy2,
            flags=spec.flags,
            mjd_per_channel=spec.mjd_per_channel,
            mjd_span=spec.mjd_span,
            is_simultaneous=spec.is_simultaneous,
            continuum_flux_jy=spec.continuum_flux_jy,
            optical_depth_tau=spec.optical_depth_tau,
            provenance=spec.provenance,
        )
    except Exception as exc:
        logger.exception("Failed to extract spectrum at (%s, %s)", ra, dec)
        raise HTTPException(status_code=500, detail=f"Failed to extract spectrum: {exc}") from exc
