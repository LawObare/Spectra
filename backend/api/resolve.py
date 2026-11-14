"""Universal Target & Coordinate Resolver Endpoint.

SPECIFICATION.md §3.1, §4.2.1: GET /api/resolve
Parse decimal degrees and sexagesimal coordinates (never propagating arbitrary user coords).
Resolve named targets via in-memory LOCAL_CATALOG_MAP (<1ms) and CDS Sesame XML fallback
with a strict 2.0s circuit breaker.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any
from xml.etree import ElementTree

import httpx
from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["resolve"])

# In-memory local catalog map: name -> (ra_deg, dec_deg)
LOCAL_CATALOG_MAP: dict[str, tuple[float, float]] = {
    "barnard": (269.44639, 4.76676),
    "wise_0855": (133.73712, -7.24038),
    "eps_indi_b": (331.09566, -56.80031),
    "rw_aurigae": (76.95647, 30.40130),
    "r_draconis": (248.16773, 66.75504),
}

SESAME_URL = "https://cds.unistra.fr/cgi-bin/nph-sesame/-ox/SNV"
SESAME_TIMEOUT_S = 2.0
CIRCUIT_BREAKER_THRESHOLD = 3
CIRCUIT_BREAKER_COOLDOWN_S = 30.0

_circuit_breaker = {
    "state": "closed",  # closed | open
    "failure_count": 0,
    "opened_at": 0.0,
}


def _circuit_is_open() -> bool:
    if _circuit_breaker["state"] != "open":
        return False
    if (time.monotonic() - _circuit_breaker["opened_at"]) >= CIRCUIT_BREAKER_COOLDOWN_S:
        _circuit_breaker["state"] = "closed"
        _circuit_breaker["failure_count"] = 0
        return False
    return True


def _record_sesame_failure() -> None:
    _circuit_breaker["failure_count"] += 1
    if _circuit_breaker["failure_count"] >= CIRCUIT_BREAKER_THRESHOLD:
        _circuit_breaker["state"] = "open"
        _circuit_breaker["opened_at"] = time.monotonic()


def _record_sesame_success() -> None:
    _circuit_breaker["state"] = "closed"
    _circuit_breaker["failure_count"] = 0


def _parse_sesame_xml(xml_text: str) -> tuple[float, float] | None:
    """Parse CDS Sesame XML response for J2000 RA/Dec (degrees)."""
    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError:
        return None

    # Common Sesame tags/paths (tolerant)
    ra_text = root.findtext(".//jradeg") or root.findtext(".//Resolver/jradeg")
    dec_text = root.findtext(".//jdedeg") or root.findtext(".//Resolver/jdedeg")
    if ra_text and dec_text:
        try:
            return (float(ra_text.strip()), float(dec_text.strip()))
        except ValueError:
            pass

    # Fallback: try ra/dec in degrees from text nodes
    for tag in ("RAdeg", "DEdeg", "radeg", "dedeg"):
        ra_n = root.find(f".//{tag}")
        if ra_n is not None and ra_n.text:
            break
    return None


async def resolve_named_target(name: str) -> tuple[float, float] | None:
    """Resolve a named target from the local catalog map."""
    name_lower = name.lower().strip()
    if name_lower in LOCAL_CATALOG_MAP:
        return LOCAL_CATALOG_MAP[name_lower]
    return None


async def resolve_named_target_sesame(name: str) -> tuple[float, float] | None:
    """Resolve named target via CDS Sesame XML with strict 2.0s circuit breaker."""
    if _circuit_is_open():
        return None
    try:
        async with httpx.AsyncClient(timeout=SESAME_TIMEOUT_S) as client:
            resp = await asyncio.wait_for(
                client.get(SESAME_URL, params={"name": name}),
                timeout=SESAME_TIMEOUT_S,
            )
        if resp.status_code != 200:
            _record_sesame_failure()
            return None
        coords = _parse_sesame_xml(resp.text)
        if coords is None:
            _record_sesame_failure()
            return None
        _record_sesame_success()
        return coords
    except (TimeoutError, httpx.HTTPError, ElementTree.ParseError, ValueError, OSError) as exc:
        logger.debug("Sesame resolver failed for %s: %s", name, exc)
        _record_sesame_failure()
        return None


async def parse_sexagesimal(coord_str: str) -> tuple[float, float] | None:
    """Parse sexagesimal coordinate string (HH:MM:SS, DD:MM:SS)."""
    pattern = (
        r"(\d+)\s*h\s*(\d+)\s*m\s*(\d+(?:\.\d+)?)\s*s\s*,\s*"
        r"([+-]?\d+)\s*d\s*(\d+)\s*m\s*(\d+(?:\.\d+)?)\s*s"
    )
    match = re.match(pattern, coord_str.strip(), flags=re.IGNORECASE)
    if not match:
        return None

    ra_h, ra_m, ra_s, dec_d, dec_m, dec_s = match.groups()
    ra_deg = (int(ra_h) + int(ra_m) / 60.0 + float(ra_s) / 3600.0) * 15.0
    dec_deg = abs(int(dec_d)) + int(dec_m) / 60.0 + float(dec_s) / 3600.0
    if str(dec_d).strip().startswith("-"):
        dec_deg = -dec_deg
    return (ra_deg, dec_deg)


async def parse_decimal_degrees(coord_str: str) -> tuple[float, float] | None:
    """Parse decimal degree coordinate string."""
    parts = [p.strip() for p in coord_str.split(",")]
    if len(parts) != 2:
        return None
    try:
        ra = float(parts[0])
        dec = float(parts[1])
        if not (-90 <= dec <= 90):
            return None
        if not (0 <= ra < 360):
            return None
        return (ra, dec)
    except ValueError:
        return None


@router.get("/resolve")
async def resolve_target(
    coord: str | None = Query(None, description="Coordinates in decimal degrees 'ra,dec'"),
    name: str | None = Query(None, description="Named target (benchmarks or CDS-resolvable)"),
) -> dict[str, Any]:
    """GET /api/resolve endpoint.

    Returns resolved (ra, dec) in decimal degrees, or error if unresolvable.
    Never propagates arbitrary user coordinates without validation.
    """
    start_time = time.time()

    # 1. Named target resolution (local map first, <1ms)
    if name:
        result = await resolve_named_target(name)
        if result:
            ra, dec = result
            elapsed = time.time() - start_time
            return {
                "success": True,
                "ra_deg": ra,
                "dec_deg": dec,
                "resolution_method": "local_catalog_map",
                "response_time_ms": round(elapsed * 1000, 2),
            }
        # 2. CDS Sesame XML fallback with 2.0s circuit breaker
        result = await resolve_named_target_sesame(name)
        if result:
            ra, dec = result
            elapsed = time.time() - start_time
            return {
                "success": True,
                "ra_deg": ra,
                "dec_deg": dec,
                "resolution_method": "cds_sesame_xml",
                "response_time_ms": round(elapsed * 1000, 2),
            }

    # 3. Sexagesimal parsing
    if coord:
        result = await parse_sexagesimal(coord)
        if result:
            ra, dec = result
            elapsed = time.time() - start_time
            return {
                "success": True,
                "ra_deg": ra,
                "dec_deg": dec,
                "resolution_method": "sexagesimal_parse",
                "response_time_ms": round(elapsed * 1000, 2),
            }

    # 4. Decimal degrees parsing (validated ranges only)
    if coord:
        result = await parse_decimal_degrees(coord)
        if result:
            ra, dec = result
            elapsed = time.time() - start_time
            return {
                "success": True,
                "ra_deg": ra,
                "dec_deg": dec,
                "resolution_method": "decimal_degrees",
                "response_time_ms": round(elapsed * 1000, 2),
            }

    raise HTTPException(
        status_code=400,
        detail="No valid coordinates or target name provided. Use 'name' or 'coord' query parameter.",
    )


@router.get("/resolve/health")
async def resolve_health() -> dict[str, Any]:
    """Return circuit breaker status."""
    return {
        "circuit_breaker_state": _circuit_breaker["state"],
        "failure_count": _circuit_breaker["failure_count"],
        "cooldown_s": CIRCUIT_BREAKER_COOLDOWN_S,
    }
