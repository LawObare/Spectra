"""Same-origin API for archive exposure footprints shown by the navigator."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, Query

try:
    from backend.science.ingest import query_sia2_cone
except ImportError:
    from science.ingest import query_sia2_cone  # type: ignore

router = APIRouter(prefix="/api", tags=["coverage"])
_COLLECTIONS = ("spherex_qr2", "spherex_qr3")


@router.get("/coverage")
async def get_archive_coverage(
    ra: float = Query(..., ge=0, lt=360),
    dec: float = Query(..., ge=-90, le=90),
    radius_deg: float = Query(..., gt=0, le=180),
) -> dict[str, Any]:
    """Return archive footprints without asking the browser to cross IRSA CORS."""
    results = await asyncio.gather(
        *(
            query_sia2_cone(
                ra,
                dec,
                radius_deg=radius_deg,
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

    exposures: list[dict[str, str]] = []
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
            exposures.append(
                {
                    "obs_id": str(obs_id),
                    "instrument_name": str(bands[index] or "SPHEREx") if index < len(bands) else "SPHEREx",
                    "t_min": str(mjds[index] or "") if index < len(mjds) else "",
                    "energy_bandpassname": str(bands[index] or "") if index < len(bands) else "",
                    "access_url": access_url,
                    "s_region": str(footprints[index] or "") if index < len(footprints) else "",
                    "collection": collection,
                }
            )

    status = "partial" if unavailable else "ready" if exposures else "empty"
    return {
        "status": status,
        "exposures": exposures,
        "collections": list(available),
        "unavailable_collections": unavailable,
    }
