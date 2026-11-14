"""Same-origin API for archive exposure footprints shown by the navigator."""

from __future__ import annotations

import asyncio
import json
import math
import os
import sys
from typing import Any

import asyncpg
from fastapi import APIRouter, HTTPException, Query, Request

try:
    from backend.science.ingest import query_sia2_cone
except ImportError:
    from science.ingest import query_sia2_cone  # type: ignore

router = APIRouter(prefix="/api", tags=["coverage"])
_COLLECTIONS = ("spherex_dr1", "spherex_qr3")

# SPHEREx Deep Field Reference Geometry (SPECIFICATION.md §1.1, §4.2)
def _build_deep_field_caps(radius_deg: float = 5.64) -> list[dict[str, Any]]:
    """Build true spherical cap polygons for North and South Ecliptic Pole Deep Fields."""
    caps: list[dict[str, Any]] = []
    poles = [
        ("spx_deep_nep", "NEP Deep Field (Multi-Pass Hub)", 270.0, 66.5607),
        ("spx_deep_sep", "SEP Deep Field (Multi-Pass Hub)", 90.0, -66.5607),
    ]
    r_rad = math.radians(radius_deg)
    sin_r = math.sin(r_rad)
    cos_r = math.cos(r_rad)

    for obs_id, label, c_ra_deg, c_dec_deg in poles:
        c_ra = math.radians(c_ra_deg)
        c_dec = math.radians(c_dec_deg)
        sin_c = math.sin(c_dec)
        cos_c = math.cos(c_dec)
        coords: list[str] = []
        for step in range(36):
            az = (2.0 * math.pi * step) / 36.0
            sin_dec = max(-1.0, min(1.0, sin_c * cos_r + cos_c * sin_r * math.cos(az)))
            dec = math.asin(sin_dec)
            ra = c_ra + math.atan2(
                math.sin(az) * sin_r * cos_c,
                cos_r - sin_c * sin_dec,
            )
            ra_deg = math.degrees(ra) % 360.0
            dec_deg = math.degrees(dec)
            coords.append(f"{ra_deg:.4f} {dec_deg:.4f}")
        stcs = f"POLYGON ICRS {' '.join(coords)}"
        caps.append(
            {
                "obs_id": obs_id,
                "instrument_name": label,
                "energy_bandpassname": "Deep Survey (>50 passes)",
                "s_region": stcs,
                "collection": "spherex_deep_fields",
                "t_min": "Multi-Epoch Hub",
                "access_url": "https://irsa.ipac.caltech.edu/Missions/spherex.html",
            }
        )
    return caps


_DEEP_FIELD_CAPS = _build_deep_field_caps(radius_deg=5.64)

_pool: asyncpg.Pool | None = None


async def _get_pool(request: Request) -> asyncpg.Pool | None:
    """Return a shared asyncpg pool for coverage queries, or None if unavailable."""
    app_pool = getattr(request.app.state, "db_pool", None)
    if app_pool is not None:
        return app_pool
    if "pytest" in sys.modules and not getattr(request.app.state, "use_real_db_in_test", False):
        return None
    global _pool
    if _pool is not None:
        return _pool
    dsn = os.environ.get(
        "DATABASE_URL",
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    )
    try:
        _pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=4, command_timeout=10.0)
        return _pool
    except Exception:  # noqa: BLE001
        return None


@router.get("/coverage/full")
async def get_all_coverage_footprints(request: Request) -> dict[str, Any]:
    """Return real precomputed QR2/QR3 HEALPix MOCs and cached footprints from the database."""
    pool = await _get_pool(request)
    if not pool:
        return {
            "status": "offline",
            "mode": "offline_deep_fields",
            "count": 0,
            "zones": [],
            "mocs": {},
            "deep_fields": _DEEP_FIELD_CAPS,
            "exposures": [],
        }

    try:
        async with pool.acquire() as conn:
            moc_rows = await conn.fetch(
                """
                SELECT collection, moc_order, moc_json, sky_fraction, cell_count, exposure_count, updated_at
                FROM coverage_mocs
                ORDER BY collection ASC
                """
            )
            rows = await conn.fetch(
                """
                SELECT obs_id, collection, detector, mjd, wavelength, ra_center, dec_center, s_region, access_url
                FROM coverage_footprints
                ORDER BY created_at DESC
                LIMIT 2000
                """
            )
            zone_rows = await conn.fetch(
                """
                SELECT
                    round(ra_center::numeric, 4) as ra,
                    round(dec_center::numeric, 4) as dec,
                    count(*) as count
                FROM coverage_footprints
                GROUP BY round(ra_center::numeric, 4), round(dec_center::numeric, 4)
                ORDER BY count DESC
                """
            )

        mocs: dict[str, dict[str, Any]] = {}
        for m in moc_rows:
            raw_moc = m["moc_json"]
            moc_json = json.loads(raw_moc) if isinstance(raw_moc, str) else dict(raw_moc)
            mocs[str(m["collection"])] = {
                "moc_order": int(m["moc_order"]),
                "moc_json": moc_json,
                "sky_fraction": float(m["sky_fraction"]),
                "cell_count": int(m["cell_count"]),
                "exposure_count": int(m["exposure_count"]),
                "updated_at": m["updated_at"].isoformat() if m["updated_at"] else None,
            }

        exposures = [
            {
                "obs_id": str(r["obs_id"]),
                "instrument_name": str(r["detector"] or "SPHEREx"),
                "t_min": str(r["mjd"] or ""),
                "energy_bandpassname": str(r["detector"] or ""),
                "access_url": str(r["access_url"] or ""),
                "s_region": str(r["s_region"] or ""),
                "collection": str(r["collection"] or "spherex_qr2"),
                "ra_center": float(r["ra_center"]) if r["ra_center"] is not None else None,
                "dec_center": float(r["dec_center"]) if r["dec_center"] is not None else None,
            }
            for r in rows
        ]
        zones = [
            {
                "ra": float(z["ra"]),
                "dec": float(z["dec"]),
                "count": int(z["count"]),
            }
            for z in zone_rows
        ]
        return {
            "status": "ready",
            "source": "database",
            "mode": "real_qr2_qr3_database",
            "count": len(exposures),
            "zones": zones,
            "mocs": mocs,
            "deep_fields": _DEEP_FIELD_CAPS,
            "exposures": exposures,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "error",
            "error": str(exc),
            "mode": "offline_deep_fields",
            "count": 0,
            "zones": [],
            "mocs": {},
            "deep_fields": _DEEP_FIELD_CAPS,
            "exposures": [],
        }


@router.get("/coverage")
async def get_archive_coverage(
    request: Request,
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    radius_deg: float = Query(..., gt=0, le=180),
) -> dict[str, Any]:
    """Return archive footprints from local database cache or live IRSA query."""
    # Step 1: Check database cache first for instantaneous (<5ms) response
    pool = await _get_pool(request)
    if pool:
        try:
            pad = max(radius_deg, 0.05) + 3.5  # SPHEREx detectors span ~3.5 degrees
            cos_dec = max(abs(math.cos(math.radians(dec))), 0.1)
            ra_pad = pad / cos_dec
            async with pool.acquire() as conn:
                db_rows = await conn.fetch(
                    """
                    SELECT obs_id, collection, detector, mjd, wavelength, ra_center, dec_center, s_region, access_url
                    FROM coverage_footprints
                    WHERE abs(dec_center - $2) <= $3
                      AND abs(ra_center - $1) <= $4
                    LIMIT 200
                    """,
                    ra,
                    dec,
                    pad,
                    ra_pad,
                )
            if db_rows:
                db_exposures = [
                    {
                        "obs_id": str(r["obs_id"]),
                        "instrument_name": str(r["detector"] or "SPHEREx"),
                        "t_min": str(r["mjd"] or ""),
                        "energy_bandpassname": str(r["detector"] or ""),
                        "access_url": str(r["access_url"] or ""),
                        "s_region": str(r["s_region"] or ""),
                        "collection": str(r["collection"] or "spherex_qr2"),
                        "ra_center": float(r["ra_center"]) if r["ra_center"] is not None else None,
                        "dec_center": float(r["dec_center"]) if r["dec_center"] is not None else None,
                    }
                    for r in db_rows
                ]
                collections = list({r["collection"] for r in db_rows if r["collection"]})
                return {
                    "status": "ready",
                    "source": "database",
                    "exposures": db_exposures,
                    "collections": collections or list(_COLLECTIONS),
                    "unavailable_collections": [],
                }
        except Exception:  # noqa: BLE001, S110
            pass  # Fall back to live IRSA query if DB query fails

    # Step 2: Fall back to live IRSA query with bounded radius (prevents 45s IRSA timeouts)
    clamped_radius = min(radius_deg, 0.08)
    results = await asyncio.gather(
        *(
            query_sia2_cone(
                ra,
                dec,
                radius_deg=clamped_radius,
                collection=collection,
                CALIB=2,
                MAXREC=500,
            )
            for collection in _COLLECTIONS
        )
    )
    available = {
        collection: result
        for collection, result in zip(_COLLECTIONS, results, strict=True)
        if result
    }
    unavailable = [collection for collection in _COLLECTIONS if collection not in available]
    if not available:
        raise HTTPException(status_code=502, detail="IRSA coverage lookup failed for QR2 and QR3")

    exposures: list[dict[str, Any]] = []
    to_cache: list[tuple[Any, ...]] = []
    for collection, result in available.items():
        ids = result.get("exposure_ids", [])
        urls = result.get("access_urls", [])
        footprints = result.get("footprints", [])
        bands = result.get("detector_ids", [])
        mjds = result.get("mjds", [])
        for index, obs_id in enumerate(ids):
            access_url = str(urls[index] or "") if index < len(urls) else ""
            if not access_url.startswith("https://"):
                continue
            s_reg = str(footprints[index] or "") if index < len(footprints) else ""
            detector = str(bands[index] or "SPHEREx") if index < len(bands) else "SPHEREx"
            mjd_val = float(mjds[index]) if index < len(mjds) and mjds[index] is not None else None
            exposures.append(
                {
                    "obs_id": str(obs_id),
                    "instrument_name": detector,
                    "t_min": str(mjd_val or ""),
                    "energy_bandpassname": detector,
                    "access_url": access_url,
                    "s_region": s_reg,
                    "collection": collection,
                }
            )
            to_cache.append(
                (str(obs_id), collection, detector, mjd_val, detector, ra, dec, s_reg, access_url)
            )

    status = "partial" if unavailable else "ready" if exposures else "empty"
    return {
        "status": status,
        "source": "irsa_live",
        "exposures": exposures,
        "collections": list(available),
        "unavailable_collections": unavailable,
    }
