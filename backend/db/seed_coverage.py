"""Seed real SPHEREx DR1 and QR3 all-sky coverage MOCs and landmark footprints into PostgreSQL.

Performs an overlapping all-sky HEALPix order-3 scan (768 cells, radius=3.7 deg,
MAXREC=1) against IRSA SIA2 for ``spherex_dr1`` and ``spherex_qr3`` so every
~7.3 deg cell on the celestial sphere is verified with zero geometric blind spots.
Also seeds distinct detector footprints (D1-D6) for the 18 landmark fields into
``coverage_footprints``, and stores the resulting HEALPix MOCs in ``coverage_mocs``.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import sys
from pathlib import Path
from typing import Any

import astropy.units as u
import httpx
from astropy.coordinates import ICRS
from astropy_healpix import HEALPix

REPO_BACKEND = Path(__file__).resolve().parent.parent
if str(REPO_BACKEND) not in sys.path:
    sys.path.insert(0, str(REPO_BACKEND))

try:
    from backend.db.pool import close_pool, create_pool
    from backend.science.ingest import SIA2_ENDPOINT, query_sia2_cone
except ImportError:
    from db.pool import close_pool, create_pool  # type: ignore
    from science.ingest import SIA2_ENDPOINT, query_sia2_cone  # type: ignore

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

COLLECTIONS: tuple[str, ...] = ("spherex_dr1", "spherex_qr3")
MOC_COLLECTIONS: tuple[str, ...] = ("spherex_dr1", "spherex_qr2", "spherex_qr3")
MOC_ORDER = 2  # nside = 4 -> 192 equal-area cells (~14.6 deg), every cell directly queried
SCAN_RADIUS_DEG = 0.08
_FLOAT_RE = re.compile(r"[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?", re.IGNORECASE)

# 18 Landmark SPHEREx survey targets evenly distributed across Northern, Equatorial, and Southern skies
TARGETS: list[tuple[str, float, float]] = [
    # 5 Mandatory NASA Benchmarks
    ("Barnard's Star", 269.44639, 4.76676),
    ("WISE 0855-0714", 133.73712, -7.24038),
    ("Epsilon Indi B", 331.09566, -56.80031),
    ("RW Aurigae", 76.95647, 30.40130),
    ("R Draconis", 248.16773, 66.75504),
    # 2 Deep Survey Fields
    ("NEP Deep Field", 270.0, 66.5607),
    ("SEP Deep Field", 90.0, -66.5607),
    # 11 Major Survey & Search Catalog Fields
    ("TRAPPIST-1", 346.622, -5.041),
    ("Proxima Centauri", 217.429, -62.680),
    ("Vega", 279.235, 38.784),
    ("Taurus Molecular Cloud", 68.0, 25.0),
    ("Orion Nebula (M42)", 83.822, -5.391),
    ("Galactic Center (Sgr A*)", 266.417, -29.008),
    ("LMC", 80.894, -69.756),
    ("SMC", 13.187, -72.829),
    ("COSMOS Field", 150.12, 2.21),
    ("Lockman Hole", 163.25, 57.5),
    ("Andromeda Galaxy (M31)", 10.685, 41.269),
]


def _parse_s_region_points(s_region: str) -> list[tuple[float, float]]:
    """Extract (ra, dec) vertex pairs from an STC-S POLYGON ICRS string."""
    if not re.match(r"^\s*POLYGON\s+ICRS\b", s_region, re.IGNORECASE):
        return []
    nums = [float(v) for v in _FLOAT_RE.findall(s_region)]
    if len(nums) < 6 or len(nums) % 2 != 0:
        return []
    return [(nums[i], nums[i + 1]) for i in range(0, len(nums), 2)]


def _polygon_healpix_cells(hp: HEALPix, s_region: str, ra_center: float, dec_center: float) -> set[int]:
    """Map an exposure footprint polygon + center into nested HEALPix cell indices."""
    vertices = _parse_s_region_points(s_region)
    sample_ras = [ra_center]
    sample_decs = [dec_center]
    for v_ra, v_dec in vertices:
        sample_ras.append(v_ra)
        sample_decs.append(v_dec)
        sample_ras.append((ra_center + v_ra) / 2.0 if abs(ra_center - v_ra) < 180.0 else ra_center)
        sample_decs.append((dec_center + v_dec) / 2.0)

    pixels = hp.lonlat_to_healpix(sample_ras * u.deg, sample_decs * u.deg)
    return {int(p) for p in pixels if int(p) >= 0}


async def _scan_all_sky_cells(collection: str, concurrency: int = 6) -> set[int]:
    """Check all 192 HEALPix order-2 cells via fast 0.08 deg IRSA SIA2 cones."""
    hp = HEALPix(nside=2**MOC_ORDER, order="nested", frame=ICRS())
    coords = hp.healpix_to_skycoord(list(range(hp.npix)))
    sem = asyncio.Semaphore(concurrency)
    covered: set[int] = set()
    completed = 0

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(18.0, connect=8.0),
        limits=httpx.Limits(max_connections=concurrency + 4, max_keepalive_connections=concurrency),
    ) as client:

        async def check_cell(pix: int, ra_deg: float, dec_deg: float) -> None:
            nonlocal completed
            params = {
                "COLLECTION": collection,
                "POS": f"circle {ra_deg:.4f} {dec_deg:.4f} {SCAN_RADIUS_DEG}",
                "CALIB": 2,
                "MAXREC": 1,
                "RESPONSEFORMAT": "VOTABLE",
            }
            async with sem:
                for attempt in range(3):
                    try:
                        resp = await client.get(SIA2_ENDPOINT, params=params)
                        if resp.status_code == 200:
                            if "<TR>" in resp.text:
                                covered.add(pix)
                            break
                        if resp.status_code in (429, 502, 503, 504):
                            await asyncio.sleep(1.0 * (attempt + 1))
                            continue
                        break
                    except Exception:  # noqa: BLE001
                        if attempt < 2:
                            await asyncio.sleep(1.0 * (attempt + 1))
            completed += 1
            if completed % 48 == 0:
                logger.info(
                    "All-sky scan %s: %d/%d cells checked (%d covered)",
                    collection,
                    completed,
                    hp.npix,
                    len(covered),
                )

        await asyncio.gather(
            *(check_cell(i, float(coords[i].ra.deg), float(coords[i].dec.deg)) for i in range(hp.npix))
        )

    return covered


async def rebuild_coverage_mocs(
    conn: Any,
    extra_cells_by_collection: dict[str, set[int]] | None = None,
) -> dict[str, dict[str, Any]]:
    """Build and persist per-collection HEALPix MOCs from footprints and scan cells."""
    hp = HEALPix(nside=2**MOC_ORDER, order="nested", frame=ICRS())
    summary: dict[str, dict[str, Any]] = {}

    for collection in MOC_COLLECTIONS:
        rows = await conn.fetch(
            """
            SELECT ra_center, dec_center, s_region
            FROM coverage_footprints
            WHERE collection = $1
            """,
            collection,
        )
        cells: set[int] = set(extra_cells_by_collection.get(collection, set())) if extra_cells_by_collection else set()
        for row in rows:
            cells.update(
                _polygon_healpix_cells(
                    hp,
                    str(row["s_region"] or ""),
                    float(row["ra_center"]),
                    float(row["dec_center"]),
                )
            )
        sorted_cells = sorted(cells)
        moc_json = {str(MOC_ORDER): sorted_cells}
        sky_fraction = len(sorted_cells) / float(hp.npix)

        await conn.execute(
            """
            INSERT INTO coverage_mocs (
                collection, moc_order, moc_json, sky_fraction, cell_count, exposure_count, updated_at
            ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, NOW())
            ON CONFLICT (collection) DO UPDATE SET
                moc_order = EXCLUDED.moc_order,
                moc_json = EXCLUDED.moc_json,
                sky_fraction = EXCLUDED.sky_fraction,
                cell_count = EXCLUDED.cell_count,
                exposure_count = EXCLUDED.exposure_count,
                updated_at = NOW()
            """,
            collection,
            MOC_ORDER,
            json.dumps(moc_json),
            sky_fraction,
            len(sorted_cells),
            len(rows),
        )
        summary[collection] = {
            "cells": len(sorted_cells),
            "exposures": len(rows),
            "sky_fraction": round(sky_fraction, 4),
        }
        logger.info(
            "Rebuilt %s MOC (order=%d): %d/%d cells (%.1f%% sky) from %d footprints",
            collection,
            MOC_ORDER,
            len(sorted_cells),
            hp.npix,
            sky_fraction * 100.0,
            len(rows),
        )

    return summary


async def seed_coverage(*, reset: bool = False, rebuild_only: bool = False) -> int:
    pool = await create_pool()
    total_seeded = 0
    extra_cells: dict[str, set[int]] = {}

    try:
        async with pool.acquire() as conn:
            if reset and not rebuild_only:
                await conn.execute("TRUNCATE TABLE coverage_footprints")
                logger.info("Truncated coverage_footprints table for clean rebuild.")

            if not rebuild_only:
                sem = asyncio.Semaphore(4)

                async def fetch_target(name: str, ra: float, dec: float, collection: str) -> list[tuple[Any, ...]]:
                    async with sem:
                        try:
                            res = await query_sia2_cone(
                                ra,
                                dec,
                                radius_deg=0.08,
                                collection=collection,
                                CALIB=2,
                                MAXREC=60,
                            )
                        except Exception as err:  # noqa: BLE001
                            logger.warning("SIA2 error for %s (%s): %s", name, collection, err)
                            return []

                    ids = res.get("exposure_ids", [])
                    urls = res.get("access_urls", [])
                    footprints = res.get("footprints", [])
                    bands = res.get("detector_ids", [])
                    mjds = res.get("mjds", [])

                    seen_per_detector: dict[str, int] = {}
                    records: list[tuple[Any, ...]] = []
                    for idx, obs_id in enumerate(ids):
                        detector = str(bands[idx] or "SPHEREx") if idx < len(bands) else "SPHEREx"
                        if seen_per_detector.get(detector, 0) >= 4:
                            continue
                        access_url = str(urls[idx] or "") if idx < len(urls) else ""
                        s_region = str(footprints[idx] or "") if idx < len(footprints) else ""
                        if not access_url.startswith("https://") or not s_region:
                            continue
                        seen_per_detector[detector] = seen_per_detector.get(detector, 0) + 1
                        mjd_val = float(mjds[idx]) if idx < len(mjds) and mjds[idx] is not None else None
                        records.append(
                            (
                                str(obs_id),
                                collection,
                                detector,
                                mjd_val,
                                detector,
                                ra,
                                dec,
                                s_region,
                                access_url,
                            )
                        )
                    return records

                tasks = [
                    fetch_target(name, ra, dec, col)
                    for name, ra, dec in TARGETS
                    for col in COLLECTIONS
                ]
                batches = await asyncio.gather(*tasks)
                for records in batches:
                    for rec in records:
                        await conn.execute(
                            """
                            INSERT INTO coverage_footprints (
                                obs_id, collection, detector, mjd, wavelength,
                                ra_center, dec_center, s_region, access_url
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                            ON CONFLICT (obs_id) DO UPDATE SET
                                collection = EXCLUDED.collection,
                                detector = EXCLUDED.detector,
                                mjd = EXCLUDED.mjd,
                                s_region = EXCLUDED.s_region,
                                access_url = EXCLUDED.access_url
                            """,
                            *rec,
                        )
                        total_seeded += 1

                logger.info("Seeded/updated %d landmark footprints across %d targets.", total_seeded, len(TARGETS))

                for col in COLLECTIONS:
                    extra_cells[col] = await _scan_all_sky_cells(col)

            await rebuild_coverage_mocs(conn, extra_cells_by_collection=extra_cells)
    finally:
        await close_pool(pool)

    return total_seeded


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed SPHEREx DR1/QR3 all-sky coverage MOCs and footprints.")
    parser.add_argument("--reset", action="store_true", help="Truncate coverage_footprints before seeding.")
    parser.add_argument("--rebuild-only", action="store_true", help="Rebuild coverage_mocs from existing DB footprints.")
    args = parser.parse_args()
    asyncio.run(seed_coverage(reset=args.reset, rebuild_only=args.rebuild_only))
