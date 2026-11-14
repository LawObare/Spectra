"""Persistent user-installed sky sections (cutout tensors + 102-channel spectra).

Allows users to explicitly select a sky region in the Celestial Navigator,
install its multi-epoch DR1/QR3 cutout tensor once to disk + PostgreSQL, and
reuse it across Time-Domain Comparator, Spectrophotometric Lab, and Molecular
Ice Studio without re-querying IRSA.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
import struct
import sys
from pathlib import Path
from typing import Any

import asyncpg
import numpy as np
import zstandard as zstd
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

try:
    from backend.api.cutout import (
        CutoutRequest,
        create_cutout,
        task_states,
        tensor_cache,
    )
    from backend.science.wave import (
        BENCHMARK_TARGETS,
        MJY_SR_TO_JY_PER_PIXEL,
        TOTAL_SPHEREX_CHANNELS,
        fit_chebyshev_continuum,
        get_standard_channel_grid,
    )
except ImportError:
    from api.cutout import (  # type: ignore
        CutoutRequest,
        create_cutout,
        task_states,
        tensor_cache,
    )
    from science.wave import (  # type: ignore
        BENCHMARK_TARGETS,
        MJY_SR_TO_JY_PER_PIXEL,
        TOTAL_SPHEREX_CHANNELS,
        fit_chebyshev_continuum,
        get_standard_channel_grid,
    )

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["sections"])

SECTIONS_DIR = Path(__file__).resolve().parent.parent / "data" / "installed_sections"
_BENCHMARKS_SEEDED_MARKER = SECTIONS_DIR / ".benchmarks_real_seeded"
_BAND_CENTERS_UM = np.array([0.93, 1.37, 2.02, 3.12, 4.12, 4.71], dtype=np.float64)
_BAND_CHANNEL_RANGES = [(0, 17), (17, 34), (34, 51), (51, 68), (68, 85), (85, 102)]

_pool: asyncpg.Pool | None = None
_active_installs: dict[str, asyncio.Task[None]] = {}
_active_task_ids: dict[str, str] = {}
_seed_lock = asyncio.Lock()
_seed_runner_task: asyncio.Task[None] | None = None


BENCHMARK_FOV_ARCSEC = 300.0


class SectionInstallRequest(BaseModel):
    ra: float = Field(..., ge=0.0, lt=360.0)
    dec: float = Field(..., ge=-90.0, le=90.0)
    fov_arcsec: float = Field(BENCHMARK_FOV_ARCSEC, ge=30.0, le=600.0)
    label: str = Field("", max_length=120)
    adaptive_window: bool = True
    zodi_subtracted: bool = True


def section_id_for(ra: float, dec: float, fov_arcsec: float) -> str:
    """Deterministic URL-safe ID for a sky region (ra, dec, fov_arcsec)."""
    key = f"{round(ra, 4):.4f}:{round(dec, 4):.4f}:{round(fov_arcsec)}"
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]
    return f"sec_{digest}"


async def _get_pool(request: Request) -> asyncpg.Pool | None:
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


def _parse_tensor_header(payload: bytes) -> tuple[dict[str, Any], memoryview]:
    if len(payload) < 4:
        raise ValueError("Invalid tensor payload")
    header_len = struct.unpack("<I", payload[:4])[0]
    header = json.loads(payload[4 : 4 + header_len].decode("utf-8"))
    return header, memoryview(payload)[4 + header_len :]


def _unpack_tensor_arrays(
    payload: bytes,
) -> tuple[dict[str, Any], np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Decode a 14 B/px binary tensor into (header, flux, variance, flags, n_exp)."""
    header, body = _parse_tensor_header(payload)
    n_epochs, n_bands, h, w = (int(v) for v in header["shape"])
    total_px = n_epochs * n_bands * h * w
    plane_bytes = total_px * 4
    n_exp_bytes = total_px * 2

    flux = np.frombuffer(body[0:plane_bytes], dtype="<f4").reshape((n_epochs, n_bands, h, w)).copy()
    offset = plane_bytes
    variance = (
        np.frombuffer(body[offset : offset + plane_bytes], dtype="<f4")
        .reshape((n_epochs, n_bands, h, w))
        .copy()
    )
    offset += plane_bytes
    flags = (
        np.frombuffer(body[offset : offset + plane_bytes], dtype="<u4")
        .reshape((n_epochs, n_bands, h, w))
        .copy()
    )
    offset += plane_bytes
    n_exp = (
        np.frombuffer(body[offset : offset + n_exp_bytes], dtype="<u2")
        .reshape((n_epochs, n_bands, h, w))
        .copy()
    )
    return header, flux, variance, flags, n_exp


def _extract_spectrum_from_tensor_payload(
    payload: bytes,
    *,
    ra: float,
    dec: float,
    label: str,
    px: int | None = None,
    py: int | None = None,
    epoch: int | None = None,
    normalize: bool = False,
) -> dict[str, Any]:
    """Derive a 102-channel spectrum at (px, py) directly from an installed tensor."""
    header, flux, variance, flags, n_exp = _unpack_tensor_arrays(payload)
    n_epochs, n_bands, h, w = flux.shape
    cx = max(0, min(w - 1, w // 2 if px is None else px))
    cy = max(0, min(h - 1, h // 2 if py is None else py))

    # Inverse-variance weighted coadd across epochs (or selected epoch) for each of D1..D6
    band_flux_jy = np.zeros(n_bands, dtype=np.float64)
    band_var_jy2 = np.zeros(n_bands, dtype=np.float64)
    band_flags = np.zeros(n_bands, dtype=np.int64)
    band_valid = np.zeros(n_bands, dtype=bool)
    fallback_bands: list[str] = []
    epoch_indices = [max(0, min(n_epochs - 1, epoch))] if epoch is not None else list(range(n_epochs))

    for b in range(min(n_bands, 6)):
        weights_sum = 0.0
        weighted_flux = 0.0
        combined_flag = 0
        for e in epoch_indices:
            f_val = float(flux[e, b, cy, cx])
            v_val = float(variance[e, b, cy, cx])
            flg_val = int(flags[e, b, cy, cx])
            cnt_val = int(n_exp[e, b, cy, cx])
            if not math.isfinite(f_val) or cnt_val == 0:
                continue
            combined_flag |= flg_val
            w_inv = 1.0 / max(v_val, 1e-8) if math.isfinite(v_val) and v_val > 0 else 1.0
            weighted_flux += f_val * w_inv
            weights_sum += w_inv

        # Saturated/masked source cores (bright stars like Barnard's Star or R Draconis)
        # can have n_exp=0 / NaN at the exact center pixel; recover flux from unmasked PSF wings.
        if weights_sum <= 0.0:
            for radius in (1, 2, 3, 4):
                y_lo, y_hi = max(0, cy - radius), min(h, cy + radius + 1)
                x_lo, x_hi = max(0, cx - radius), min(w, cx + radius + 1)
                for ny in range(y_lo, y_hi):
                    for nx in range(x_lo, x_hi):
                        if max(abs(nx - cx), abs(ny - cy)) != radius:
                            continue
                        dist2 = float((nx - cx) ** 2 + (ny - cy) ** 2)
                        spatial_w = 1.0 / (1.0 + dist2)
                        for e in epoch_indices:
                            f_val = float(flux[e, b, ny, nx])
                            v_val = float(variance[e, b, ny, nx])
                            flg_val = int(flags[e, b, ny, nx])
                            cnt_val = int(n_exp[e, b, ny, nx])
                            if not math.isfinite(f_val) or cnt_val == 0:
                                continue
                            combined_flag |= flg_val
                            w_inv = (1.0 / max(v_val, 1e-8) if math.isfinite(v_val) and v_val > 0 else 1.0) * spatial_w
                            weighted_flux += f_val * w_inv
                            weights_sum += w_inv
                if weights_sum > 0.0:
                    fallback_bands.append(f"D{b + 1}")
                    break

        if weights_sum > 0:
            mean_mjy_sr = weighted_flux / weights_sum
            band_flux_jy[b] = mean_mjy_sr * MJY_SR_TO_JY_PER_PIXEL
            band_var_jy2[b] = (1.0 / weights_sum) * (MJY_SR_TO_JY_PER_PIXEL**2)
            band_flags[b] = combined_flag
            band_valid[b] = True

    grid_waves = get_standard_channel_grid()
    valid_idx = np.where(band_valid)[0]
    if len(valid_idx) >= 2:
        interp_flux = np.interp(grid_waves, _BAND_CENTERS_UM[valid_idx], band_flux_jy[valid_idx])
        interp_var = np.interp(grid_waves, _BAND_CENTERS_UM[valid_idx], band_var_jy2[valid_idx])
    elif len(valid_idx) == 1:
        interp_flux = np.full(TOTAL_SPHEREX_CHANNELS, band_flux_jy[valid_idx[0]], dtype=np.float64)
        interp_var = np.full(TOTAL_SPHEREX_CHANNELS, band_var_jy2[valid_idx[0]], dtype=np.float64)
    else:
        interp_flux = np.zeros(TOTAL_SPHEREX_CHANNELS, dtype=np.float64)
        interp_var = np.ones(TOTAL_SPHEREX_CHANNELS, dtype=np.float64) * 1e-10

    channel_cov = [False] * TOTAL_SPHEREX_CHANNELS
    channel_flags = [0] * TOTAL_SPHEREX_CHANNELS
    for b_idx, (c_start, c_end) in enumerate(_BAND_CHANNEL_RANGES):
        if b_idx < n_bands and band_valid[b_idx]:
            for ch in range(c_start, c_end):
                channel_cov[ch] = True
                channel_flags[ch] = int(band_flags[b_idx])

    mjd_ranges = header.get("mjd_ranges") or []
    mjd_flat = [
        float(val)
        for ep_list in mjd_ranges
        for band_pair in ep_list
        for val in band_pair
        if isinstance(val, (int, float))
    ]
    mjd_min = min(mjd_flat) if mjd_flat else 60789.85
    mjd_max = max(mjd_flat) if mjd_flat else mjd_min
    mjd_mid = 0.5 * (mjd_min + mjd_max)

    cont_flux = None
    tau = None
    if normalize and np.any(interp_flux > 0):
        cont_arr, tau_arr = fit_chebyshev_continuum(grid_waves, interp_flux, interp_var)
        cont_flux = [float(v) for v in np.round(cont_arr, 6)]
        tau = [float(v) for v in np.round(tau_arr, 4)]

    source_badge = str(header.get("source_badge") or "[Installed Section]")
    return {
        "ra": float(ra),
        "dec": float(dec),
        "target_name": label or f"Installed ({ra:.4f}, {dec:+.4f})",
        "channels": TOTAL_SPHEREX_CHANNELS,
        "wavelengths_um": [float(v) for v in grid_waves],
        "flux_jy": [float(v) for v in np.round(interp_flux, 6)],
        "variance_jy2": [float(v) for v in np.round(interp_var, 12)],
        "flags": channel_flags,
        "channel_coverage": channel_cov,
        "mjd_per_channel": [round(mjd_mid, 2)] * TOTAL_SPHEREX_CHANNELS,
        "mjd_span": [round(mjd_min, 2), round(mjd_max, 2)],
        "is_simultaneous": (mjd_max - mjd_min) <= 1.0,
        "continuum_flux_jy": cont_flux,
        "optical_depth_tau": tau,
        "provenance": {
            "source_badge": f"[Installed] {source_badge}",
            "release": str(header.get("release") or "spherex"),
            "probe_pixel": [cx, cy],
            "epoch": epoch,
            "covered_channels": sum(channel_cov),
            "channel_count": TOTAL_SPHEREX_CHANNELS,
            "aperture_fallback_bands": fallback_bands,
            "method": "Installed Section Tensor (6-band inverse-variance)",
        },
    }


def _read_installed_tensor_bytes(tensor_path: str) -> bytes:
    path = Path(tensor_path)
    if not path.exists():
        raise FileNotFoundError(f"Installed tensor file missing: {path}")
    compressed = path.read_bytes()
    dctx = zstd.ZstdDecompressor()
    return dctx.decompress(compressed)


def _write_installed_tensor_bytes(section_id: str, payload: bytes) -> tuple[str, int]:
    SECTIONS_DIR.mkdir(parents=True, exist_ok=True)
    target = SECTIONS_DIR / f"{section_id}.spx.zst"
    cctx = zstd.ZstdCompressor(level=3)
    compressed = cctx.compress(payload)
    target.write_bytes(compressed)
    return str(target), len(compressed)


async def _extract_and_cache_spectrum(
    ra: float, dec: float, label: str, payload: bytes
) -> dict[str, Any]:
    """Extract cached 102-channel spectrum directly from the downloaded real Float32 tensor.

    Avoids issuing a duplicate 30-exposure IRSA fetch during cutout finalization.
    """
    return await asyncio.to_thread(
        _extract_spectrum_from_tensor_payload,
        payload,
        ra=ra,
        dec=dec,
        label=label,
        normalize=False,
    )


async def _finalize_section_install(
    pool: asyncpg.Pool,
    section_id: str,
    task_id: str,
    ra: float,
    dec: float,
    label: str,
) -> None:
    """Wait for cutout task completion, then persist compressed tensor & spectrum."""
    try:
        for _ in range(9000):  # up to 30 minutes for real IRSA archive downloads
            state = task_states.get(task_id) or {}
            status = state.get("status")
            if status == "complete":
                break
            if status == "error":
                raise RuntimeError(str(state.get("message") or "Cutout install failed"))
            await asyncio.sleep(0.2)
        else:
            raise TimeoutError("Section install timed out waiting for cutout worker")

        cached = await tensor_cache.get(f"tensor:{task_id}")
        if cached is None:
            raise RuntimeError("Completed cutout tensor missing from cache")

        payload, metadata = cached
        header, _ = _parse_tensor_header(payload)
        shape = header.get("shape") or [0, 6, 0, 0]
        tensor_path, size_bytes = await asyncio.to_thread(
            _write_installed_tensor_bytes, section_id, payload
        )
        spectrum_dict = await _extract_and_cache_spectrum(ra, dec, label, payload)
        source_badge = str((metadata or {}).get("source_badge") or header.get("source_badge") or "[IRSA Live]")

        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE installed_sections
                SET status = 'ready',
                    epochs = $2,
                    bands = $3,
                    height = $4,
                    width = $5,
                    source_badge = $6,
                    tensor_path = $7,
                    spectrum_json = $8::jsonb,
                    size_bytes = $9,
                    error_message = NULL,
                    updated_at = NOW()
                WHERE section_id = $1
                """,
                section_id,
                int(shape[0]),
                int(shape[1]),
                int(shape[2]),
                int(shape[3]),
                source_badge,
                tensor_path,
                json.dumps(spectrum_dict),
                size_bytes,
            )
        logger.info("Installed section %s (%s, %d bytes)", section_id, label, size_bytes)
    except Exception as exc:
        logger.exception("Failed finalizing section %s", section_id)
        try:
            async with pool.acquire() as conn:
                await conn.execute(
                    """
                    UPDATE installed_sections
                    SET status = 'error', error_message = $2, updated_at = NOW()
                    WHERE section_id = $1
                    """,
                    section_id,
                    str(exc),
                )
        except (OSError, asyncpg.PostgresError) as db_exc:
            logger.warning("Could not persist error state for section %s: %s", section_id, db_exc)
    finally:
        _active_installs.pop(section_id, None)
        _active_task_ids.pop(section_id, None)


async def find_installed_section_for_coord(
    pool: asyncpg.Pool | None, ra: float, dec: float
) -> dict[str, Any] | None:
    """Return the nearest ready installed section containing (ra, dec), if any."""
    if pool is None:
        return None
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT section_id, label, ra, dec, fov_arcsec, source_badge, tensor_path, spectrum_json
            FROM installed_sections
            WHERE status = 'ready'
            ORDER BY updated_at DESC
            """
        )
    cos_dec = max(0.05, math.cos(math.radians(dec)))
    for row in rows:
        half_deg = (float(row["fov_arcsec"]) / 3600.0) * 0.55
        dra = ((float(row["ra"]) - ra + 180.0) % 360.0) - 180.0
        ddec = float(row["dec"]) - dec
        if abs(dra * cos_dec) <= half_deg and abs(ddec) <= half_deg:
            return dict(row)
    return None


async def _enqueue_real_section_install(
    pool: asyncpg.Pool,
    *,
    ra: float,
    dec: float,
    fov_arcsec: float,
    label: str,
    adaptive_window: bool = True,
    zodi_subtracted: bool = True,
) -> tuple[str, str]:
    """Create DB row and enqueue real IRSA cutout task with retries if queue is temporarily full."""
    section_id = section_id_for(ra, dec, fov_arcsec)
    if section_id in _active_installs and not _active_installs[section_id].done() and section_id in _active_task_ids:
        return section_id, _active_task_ids[section_id]

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO installed_sections (section_id, label, ra, dec, fov_arcsec, status, updated_at)
            VALUES ($1, $2, $3, $4, $5, 'installing', NOW())
            ON CONFLICT (section_id) DO UPDATE SET
                label = EXCLUDED.label,
                status = 'installing',
                error_message = NULL,
                updated_at = NOW()
            """,
            section_id,
            label,
            ra,
            dec,
            fov_arcsec,
        )

    while True:
        try:
            cutout_res = await create_cutout(
                CutoutRequest(
                    ra=ra,
                    dec=dec,
                    fov_arcsec=round(fov_arcsec),
                    adaptive_window=adaptive_window,
                    zodi_subtracted=zodi_subtracted,
                    real_only=True,
                    emit_partial=False,
                ),
                BackgroundTasks(),
            )
            break
        except HTTPException as exc:
            if exc.status_code == 503:
                await asyncio.sleep(5.0)
                continue
            raise

    task_id = str(cutout_res["task_id"])
    _active_task_ids[section_id] = task_id
    if section_id not in _active_installs or _active_installs[section_id].done():
        _active_installs[section_id] = asyncio.create_task(
            _finalize_section_install(pool, section_id, task_id, ra, dec, label)
        )
    return section_id, task_id


async def _run_benchmark_seed_queue(pool: asyncpg.Pool, targets: list[dict[str, Any]]) -> None:
    """Install benchmark sections sequentially from real IRSA DR1/QR3 archives to avoid HTTP 503 throttling."""
    semaphore = asyncio.Semaphore(1)

    async def _install_one(target: dict[str, Any]) -> None:
        async with semaphore:
            ra = float(target["ra"])
            dec = float(target["dec"])
            label = str(target["name"])
            section_id, _ = await _enqueue_real_section_install(
                pool,
                ra=ra,
                dec=dec,
                fov_arcsec=BENCHMARK_FOV_ARCSEC,
                label=label,
            )
            install_task = _active_installs.get(section_id)
            if install_task is not None:
                await install_task

    try:
        await asyncio.gather(*(_install_one(t) for t in targets))
        benchmark_ids = [
            section_id_for(float(t["ra"]), float(t["dec"]), BENCHMARK_FOV_ARCSEC)
            for t in BENCHMARK_TARGETS.values()
        ]
        legacy_ids = [
            section_id_for(float(t["ra"]), float(t["dec"]), 180.0)
            for t in BENCHMARK_TARGETS.values()
        ]
        async with pool.acquire() as conn:
            ready_rows = await conn.fetch(
                """
                SELECT section_id, tensor_path
                FROM installed_sections
                WHERE section_id = ANY($1::text[]) AND status = 'ready'
                """,
                benchmark_ids,
            )
        ready_valid = sum(
            1 for r in ready_rows if r["tensor_path"] and Path(str(r["tensor_path"])).exists()
        )
        if ready_valid >= len(benchmark_ids):
            async with pool.acquire() as conn:
                removed = await conn.fetch(
                    "DELETE FROM installed_sections WHERE section_id = ANY($1::text[]) RETURNING tensor_path",
                    legacy_ids,
                )
            for row in removed:
                tp = row["tensor_path"]
                if tp:
                    Path(str(tp)).unlink(missing_ok=True)
            SECTIONS_DIR.mkdir(parents=True, exist_ok=True)
            _BENCHMARKS_SEEDED_MARKER.write_text(
                f"fov={int(BENCHMARK_FOV_ARCSEC)};gap=25;ready={ready_valid}\n",
                encoding="utf-8",
            )
            logger.info("All %d real IRSA benchmark sections installed and verified.", ready_valid)
        else:
            logger.warning(
                "Real IRSA benchmark seed finished with %d/%d ready; will resume missing targets on next check.",
                ready_valid,
                len(benchmark_ids),
            )
    except Exception:
        logger.exception("Real IRSA benchmark pre-install runner encountered an error")


async def ensure_benchmarks_preinstalled(
    pool: asyncpg.Pool | None,
    *,
    force: bool = False,
    wait: bool = False,
) -> int:
    """Ensure the 5 NASA benchmark coordinates are installed using real IRSA data (never simulation)."""
    global _seed_runner_task
    if pool is None:
        return 0
    expected_marker = f"fov={int(BENCHMARK_FOV_ARCSEC)};gap=25;"
    if (
        not force
        and _BENCHMARKS_SEEDED_MARKER.exists()
        and expected_marker in _BENCHMARKS_SEEDED_MARKER.read_text(encoding="utf-8")
    ):
        return 0
    if not force and _seed_runner_task is not None and not _seed_runner_task.done():
        if wait:
            await _seed_runner_task
        return 0

    async with _seed_lock:
        if (
            not force
            and _BENCHMARKS_SEEDED_MARKER.exists()
            and expected_marker in _BENCHMARKS_SEEDED_MARKER.read_text(encoding="utf-8")
        ):
            return 0
        if not force and _seed_runner_task is not None and not _seed_runner_task.done():
            return 0

        # Remove any old simulated Pre-cached rows so real IRSA data replaces them cleanly
        async with pool.acquire() as conn:
            await conn.execute(
                """
                DELETE FROM installed_sections
                WHERE source_badge LIKE '%Pre-cached%' OR source_badge LIKE '%Simulated%'
                """
            )
            existing_rows = await conn.fetch(
                "SELECT section_id, status, tensor_path, source_badge FROM installed_sections"
            )
        existing_map = {str(r["section_id"]): dict(r) for r in existing_rows}

        to_install: list[dict[str, Any]] = []
        for target in BENCHMARK_TARGETS.values():
            ra = float(target["ra"])
            dec = float(target["dec"])
            sid = section_id_for(ra, dec, BENCHMARK_FOV_ARCSEC)
            row = existing_map.get(sid)
            is_real_ready = bool(
                not force
                and row
                and row["status"] == "ready"
                and row["tensor_path"]
                and Path(str(row["tensor_path"])).exists()
                and "Simulated" not in str(row["source_badge"])
                and "Pre-cached" not in str(row["source_badge"])
            )
            if not is_real_ready:
                to_install.append(target)

        if not to_install:
            SECTIONS_DIR.mkdir(parents=True, exist_ok=True)
            _BENCHMARKS_SEEDED_MARKER.write_text(
                f"fov={int(BENCHMARK_FOV_ARCSEC)};gap=25;ready={len(BENCHMARK_TARGETS)}\n",
                encoding="utf-8",
            )
            return 0

        _BENCHMARKS_SEEDED_MARKER.unlink(missing_ok=True)
        _seed_runner_task = asyncio.create_task(_run_benchmark_seed_queue(pool, to_install))
        if wait:
            await _seed_runner_task
        return len(to_install)


@router.get("/sections")
async def list_installed_sections(request: Request) -> dict[str, Any]:
    """Return all user-installed sky sections stored in PostgreSQL."""
    pool = await _get_pool(request)
    if pool is None:
        return {"sections": [], "status": "offline"}
    if "pytest" not in sys.modules and not _BENCHMARKS_SEEDED_MARKER.exists():
        await ensure_benchmarks_preinstalled(pool)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT section_id, label, ra, dec, fov_arcsec, status, epochs, bands,
                   height, width, source_badge, size_bytes, error_message, created_at, updated_at
            FROM installed_sections
            ORDER BY updated_at DESC
            """
        )
    sections = [
        {
            "section_id": str(r["section_id"]),
            "label": str(r["label"]),
            "ra": float(r["ra"]),
            "dec": float(r["dec"]),
            "fov_arcsec": float(r["fov_arcsec"]),
            "status": str(r["status"]),
            "epochs": int(r["epochs"]),
            "bands": int(r["bands"]),
            "height": int(r["height"]),
            "width": int(r["width"]),
            "source_badge": str(r["source_badge"]),
            "size_bytes": int(r["size_bytes"]),
            "task_id": _active_task_ids.get(str(r["section_id"])),
            "error_message": r["error_message"],
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
        }
        for r in rows
    ]
    return {"sections": sections, "status": "ready"}


@router.post("/sections/install", status_code=202)
async def install_section(
    body: SectionInstallRequest,
    request: Request,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    """Install a selected sky section by running the cutout pipeline and persisting it."""
    pool = await _get_pool(request)
    if pool is None:
        raise HTTPException(status_code=503, detail="Database unavailable for persisting installed sections")

    section_id = section_id_for(body.ra, body.dec, body.fov_arcsec)
    label = body.label.strip() or f"Field ({body.ra:.4f}°, {body.dec:+.4f}°)"

    if section_id in _active_installs and not _active_installs[section_id].done() and section_id in _active_task_ids:
        return {
            "section_id": section_id,
            "task_id": _active_task_ids[section_id],
            "status": "installing",
            "already_installed": False,
            "already_installing": True,
        }

    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT section_id, status, tensor_path, epochs, bands, source_badge FROM installed_sections WHERE section_id = $1",
            section_id,
        )
        if existing and existing["status"] == "ready" and existing["tensor_path"] and Path(existing["tensor_path"]).exists():
            return {
                "section_id": section_id,
                "status": "ready",
                "already_installed": True,
                "epochs": int(existing["epochs"]),
                "bands": int(existing["bands"]),
                "source_badge": str(existing["source_badge"]),
            }

        await conn.execute(
            """
            INSERT INTO installed_sections (section_id, label, ra, dec, fov_arcsec, status, updated_at)
            VALUES ($1, $2, $3, $4, $5, 'installing', NOW())
            ON CONFLICT (section_id) DO UPDATE SET
                label = EXCLUDED.label,
                status = 'installing',
                error_message = NULL,
                updated_at = NOW()
            """,
            section_id,
            label,
            body.ra,
            body.dec,
            body.fov_arcsec,
        )

    cutout_res = await create_cutout(
        CutoutRequest(
            ra=body.ra,
            dec=body.dec,
            fov_arcsec=round(body.fov_arcsec),
            adaptive_window=body.adaptive_window,
            zodi_subtracted=body.zodi_subtracted,
            real_only=True,
            emit_partial=False,
        ),
        background_tasks,
    )
    task_id = str(cutout_res["task_id"])
    _active_task_ids[section_id] = task_id

    if section_id not in _active_installs or _active_installs[section_id].done():
        _active_installs[section_id] = asyncio.create_task(
            _finalize_section_install(pool, section_id, task_id, body.ra, body.dec, label)
        )

    return {
        "section_id": section_id,
        "task_id": task_id,
        "status": "installing",
        "already_installed": False,
    }


@router.get("/sections/{section_id}/tensor")
async def get_installed_section_tensor(section_id: str, request: Request) -> Response:
    """Serve the persisted 14 B/px binary tensor for an installed section."""
    pool = await _get_pool(request)
    if pool is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status, tensor_path FROM installed_sections WHERE section_id = $1",
            section_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail=f"Installed section {section_id} not found")
    if row["status"] != "ready" or not row["tensor_path"]:
        raise HTTPException(status_code=202, detail=f"Section {section_id} is {row['status']}")

    try:
        payload = await asyncio.to_thread(_read_installed_tensor_bytes, str(row["tensor_path"]))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return Response(
        content=payload,
        media_type="application/octet-stream",
        headers={"X-Section-ID": section_id, "X-Compression": "none", "Cache-Control": "no-cache"},
    )


@router.get("/sections/{section_id}/spectrum")
async def get_installed_section_spectrum(
    section_id: str,
    request: Request,
    px: int | None = Query(None, ge=0),
    py: int | None = Query(None, ge=0),
    epoch: int | None = Query(None, ge=0),
    normalize: bool = Query(False),
) -> dict[str, Any]:
    """Return the 102-channel spectrum for an installed section (or probed pixel)."""
    pool = await _get_pool(request)
    if pool is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT label, ra, dec, status, tensor_path, spectrum_json FROM installed_sections WHERE section_id = $1",
            section_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail=f"Installed section {section_id} not found")
    if row["status"] != "ready":
        raise HTTPException(status_code=202, detail=f"Section {section_id} is {row['status']}")

    # If caller probes a specific pixel/epoch, compute directly from persisted tensor
    if (px is not None or py is not None or epoch is not None) and row["tensor_path"]:
        payload = await asyncio.to_thread(_read_installed_tensor_bytes, str(row["tensor_path"]))
        return _extract_spectrum_from_tensor_payload(
            payload,
            ra=float(row["ra"]),
            dec=float(row["dec"]),
            label=str(row["label"]),
            px=px,
            py=py,
            epoch=epoch,
            normalize=normalize,
        )

    raw_spec = row["spectrum_json"]
    if raw_spec:
        spec = json.loads(raw_spec) if isinstance(raw_spec, str) else dict(raw_spec)
        prov = spec.get("provenance") or {}
        covered = int(prov.get("covered_channels") or 0)
        needs_refresh = covered == 0 or (covered < TOTAL_SPHEREX_CHANNELS and "aperture_fallback_bands" not in prov)
        if not needs_refresh or not row["tensor_path"]:
            if normalize and not spec.get("continuum_flux_jy"):
                waves = np.asarray(spec["wavelengths_um"], dtype=np.float64)
                flux = np.asarray(spec["flux_jy"], dtype=np.float64)
                var = np.asarray(spec["variance_jy2"], dtype=np.float64)
                if np.any(flux > 0):
                    cont_arr, tau_arr = fit_chebyshev_continuum(waves, flux, var)
                    spec["continuum_flux_jy"] = [float(v) for v in np.round(cont_arr, 6)]
                    spec["optical_depth_tau"] = [float(v) for v in np.round(tau_arr, 4)]
            return spec

    if not row["tensor_path"]:
        raise HTTPException(status_code=404, detail="Section spectrum unavailable")
    payload = await asyncio.to_thread(_read_installed_tensor_bytes, str(row["tensor_path"]))
    spec = await asyncio.to_thread(
        _extract_spectrum_from_tensor_payload,
        payload,
        ra=float(row["ra"]),
        dec=float(row["dec"]),
        label=str(row["label"]),
        normalize=normalize,
    )
    if (
        raw_spec
        and int((spec.get("provenance") or {}).get("covered_channels") or 0) > 0
        and "pytest" not in sys.modules
    ):
        try:
            async with pool.acquire() as conn:
                await conn.execute(
                    "UPDATE installed_sections SET spectrum_json = $2::jsonb, updated_at = NOW() WHERE section_id = $1",
                    section_id,
                    json.dumps(spec),
                )
        except Exception as exc:  # noqa: BLE001
            logger.debug("Failed refreshing cached section spectrum for %s: %s", section_id, exc)
    return spec


@router.delete("/sections/{section_id}")
@router.post("/sections/{section_id}/uninstall")
async def uninstall_section(section_id: str, request: Request) -> dict[str, Any]:
    """Remove an installed section and its persisted tensor file."""
    pool = await _get_pool(request)
    if pool is None:
        raise HTTPException(status_code=503, detail="Database unavailable")
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "DELETE FROM installed_sections WHERE section_id = $1 RETURNING tensor_path",
            section_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail=f"Installed section {section_id} not found")
    tensor_path = row["tensor_path"]
    if tensor_path:
        try:
            Path(str(tensor_path)).unlink(missing_ok=True)
        except OSError:
            pass
    return {"section_id": section_id, "status": "uninstalled"}
