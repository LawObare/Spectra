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

import asyncio
import logging
import time
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

try:
    from backend.science.wave import (
        TOTAL_SPHEREX_CHANNELS,
        extract_102_channel_spectrum,
        extract_live_observations,
        match_benchmark_target,
    )
except ImportError:
    from science.wave import (
        TOTAL_SPHEREX_CHANNELS,
        extract_102_channel_spectrum,
        extract_live_observations,
        match_benchmark_target,
    )

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["spectrum"])
_spectrum_tasks: dict[str, dict[str, Any]] = {}
_spectrum_semaphore = asyncio.Semaphore(2)
_MAX_PENDING_SPECTRUM_TASKS = 3
_SPECTRUM_TASK_TTL_SECONDS = 900


class SpectrumTaskRequest(BaseModel):
    ra: float = Field(..., ge=0.0, le=360.0)
    dec: float = Field(..., ge=-90.0, le=90.0)
    normalize: bool = False


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
    channel_coverage: list[bool] = Field(..., description="Whether each channel has at least one accepted archive measurement")
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
    """Synchronously extract an archive-backed spectrum for API clients."""
    if match_benchmark_target(ra, dec, match_radius_arcsec=60.0):
        spec = extract_102_channel_spectrum(ra=ra, dec=dec, normalize=normalize, custom_observations=None)
        return _response_from_spectrum(spec)

    try:
        observations, releases, exposure_ids = await extract_live_observations(ra, dec)
        spec = extract_102_channel_spectrum(
            ra=ra, dec=dec, normalize=normalize, custom_observations=observations
        )
        spec.provenance.update(_live_provenance(releases, exposure_ids, spec.channel_coverage))
        return _response_from_spectrum(spec)
    except Exception as exc:
        logger.exception("Failed to extract spectrum at (%s, %s)", ra, dec)
        raise HTTPException(status_code=503, detail=f"Live spectrum unavailable: {exc}") from exc


def _live_provenance(releases: list[str], exposure_ids: list[str], coverage: list[bool]) -> dict[str, Any]:
    release = " + ".join(releases)
    return {
        "source_badge": f"[IRSA Live ({release})]",
        "release": release,
        "exposure_ids": exposure_ids,
        "exposure_count": len(exposure_ids),
        "covered_channels": sum(coverage),
        "channel_count": TOTAL_SPHEREX_CHANNELS,
        "method": "HDU 5 PSF photometry + HDU 6 WCS-WAVE",
    }


def _response_from_spectrum(spec: Any) -> SpectrumResponse:
    return SpectrumResponse(
        ra=spec.ra,
        dec=spec.dec,
        target_name=spec.target_name,
        channels=spec.channels,
        wavelengths_um=spec.wavelengths_um,
        flux_jy=spec.flux_jy,
        variance_jy2=spec.variance_jy2,
        flags=spec.flags,
        channel_coverage=spec.channel_coverage,
        mjd_per_channel=spec.mjd_per_channel,
        mjd_span=spec.mjd_span,
        is_simultaneous=spec.is_simultaneous,
        continuum_flux_jy=spec.continuum_flux_jy,
        optical_depth_tau=spec.optical_depth_tau,
        provenance=spec.provenance,
    )


async def _run_spectrum_task(task_id: str, request: SpectrumTaskRequest) -> None:
    state = _spectrum_tasks[task_id]
    try:
        async with _spectrum_semaphore:
            state.update(status="running", stage="discovering", progress=0.05, message="Querying IRSA exposures")

            async def progress_hook(stage: str, progress: float, message: str) -> None:
                state.update(stage=stage, progress=progress, message=message)

            observations, releases, exposure_ids = await extract_live_observations(
                request.ra, request.dec, progress_hook=progress_hook
            )
            spec = extract_102_channel_spectrum(
                ra=request.ra,
                dec=request.dec,
                normalize=request.normalize,
                custom_observations=observations,
            )
            spec.provenance.update(_live_provenance(releases, exposure_ids, spec.channel_coverage))
            state.update(
                status="complete",
                stage="complete",
                progress=1.0,
                message="Archive spectrum ready",
                result=_response_from_spectrum(spec).model_dump(),
            )
    except Exception as exc:
        logger.exception("Live spectrum task %s failed", task_id)
        state.update(status="error", stage="error", message=str(exc))


@router.post("/spectrum/tasks", status_code=202, summary="Queue live IRSA spectrum extraction")
async def create_spectrum_task(request: SpectrumTaskRequest) -> dict[str, str]:
    """Queue costly multi-exposure archive extraction without synthetic fallback."""
    now = time.monotonic()
    expired = [key for key, state in _spectrum_tasks.items() if now - state["created_at"] > _SPECTRUM_TASK_TTL_SECONDS]
    for key in expired:
        _spectrum_tasks.pop(key, None)
    pending = sum(state["status"] in {"queued", "running"} for state in _spectrum_tasks.values())
    if pending >= _MAX_PENDING_SPECTRUM_TASKS:
        raise HTTPException(status_code=503, detail="Spectrum queue is full", headers={"Retry-After": "15"})
    task_id = f"spectrum_{uuid.uuid4().hex[:12]}"
    _spectrum_tasks[task_id] = {
        "created_at": now,
        "status": "queued",
        "stage": "queued",
        "progress": 0.0,
        "message": "Waiting for a spectrum worker",
    }
    asyncio.create_task(_run_spectrum_task(task_id, request))
    return {"task_id": task_id, "status": "queued"}


@router.get("/spectrum/tasks/{task_id}", summary="Get live spectrum extraction status")
async def get_spectrum_task(task_id: str) -> dict[str, Any]:
    state = _spectrum_tasks.get(task_id)
    if state is None or time.monotonic() - state["created_at"] > _SPECTRUM_TASK_TTL_SECONDS:
        raise HTTPException(status_code=404, detail="Spectrum task not found or expired")
    return {key: value for key, value in state.items() if key != "created_at"}
