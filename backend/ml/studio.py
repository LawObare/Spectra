"""Real 6-class SPHEREx spectrum classifier studio (training, Grad-CAM, Postgres weight persistence)."""

from __future__ import annotations

import io
import json
import logging
import math
import threading
import time
import uuid
from collections.abc import Callable
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F
import zstandard as zstd
from torch import nn

from .models import AstroFeatureSVM, LoraLinear, SpectralResNet102

logger = logging.getLogger(__name__)

SPHEREX_WAVELENGTHS_UM: list[float] = [
    round(float(w), 4) for w in np.geomspace(0.75, 5.0, 102)
]

STUDIO_CLASSES: list[dict[str, Any]] = [
    {
        "id": 0,
        "name": "Cool Brown Dwarf",
        "science_name": "Brown Dwarf (Y/T/L)",
        "color": "#38bdf8",
        "hint": "Deep 3.3 µm methane dip + red 4–5 µm glow",
    },
    {
        "id": 1,
        "name": "Fast-Moving Star",
        "science_name": "M-Dwarf / High-PM Star",
        "color": "#34d399",
        "hint": "Warm 1.6 µm H⁻ peak with smooth infrared decline",
    },
    {
        "id": 2,
        "name": "Flashing / Variable Star",
        "science_name": "Pulsating / T-Tauri Variable",
        "color": "#f59e0b",
        "hint": "Strong warm dust excess + bright infrared continuum",
    },
    {
        "id": 3,
        "name": "Icy / Dusty Star",
        "science_name": "Ice-Absorbed Protostar",
        "color": "#a78bfa",
        "hint": "Sharp H₂O (3.05 µm), CO₂ (4.27 µm) & CO (4.67 µm) dips",
    },
    {
        "id": 4,
        "name": "Solar System / Moving",
        "science_name": "Asteroid / Comet",
        "color": "#fb7185",
        "hint": "Reflected sunlight + steep thermal rise past 3.5 µm",
    },
    {
        "id": 5,
        "name": "Distant Galaxy / Field",
        "science_name": "Galaxy / AGN / Steady Field",
        "color": "#94a3b8",
        "hint": "Flat continuum with 3.3 µm PAH dust emission bump",
    },
]

NUM_STUDIO_CLASSES = len(STUDIO_CLASSES)
STUDIO_MODEL_NAMES = ("SpectralResNet102", "AstroFeatureSVM")

# In-memory mirrors (used as fast cache & offline fallback when DB pool is unavailable)
_STUDIO_TABLES_ENSURED = False
_ACTIVE_MODELS: dict[str, nn.Module] = {}
_ACTIVE_RUN_META: dict[str, dict[str, Any]] = {}
_MEMORY_EXAMPLES: dict[str, dict[str, Any]] = {}
_MEMORY_RUNS: list[dict[str, Any]] = []
_MEMORY_WEIGHTS: dict[str, bytes] = {}
_STUDIO_CANCEL_EVENT = threading.Event()


def request_studio_abort() -> None:
    """Signal any in-progress studio training loop to stop cleanly at the next epoch."""
    _STUDIO_CANCEL_EVENT.set()


def clear_studio_abort() -> None:
    _STUDIO_CANCEL_EVENT.clear()


def is_studio_abort_requested() -> bool:
    return _STUDIO_CANCEL_EVENT.is_set()


def build_studio_model(
    model_name: str = "SpectralResNet102",
    *,
    num_classes: int = NUM_STUDIO_CLASSES,
    lora_r: int = 0,
    freeze_backbone: bool = False,
) -> nn.Module:
    """Instantiate a real N-class PyTorch spectrum classifier."""
    n_cls = max(NUM_STUDIO_CLASSES, int(num_classes))
    if model_name == "AstroFeatureSVM":
        model: nn.Module = AstroFeatureSVM(in_dim=3, n_centers=32, num_classes=n_cls)
        if lora_r > 0:
            model.readout = LoraLinear(model.readout, r=lora_r, lora_alpha=max(8, lora_r * 2))
            if freeze_backbone:
                for p in model.rbf.parameters():
                    p.requires_grad_(False)
        return model

    model = SpectralResNet102(in_ch=2, width=16, num_classes=n_cls)
    if lora_r > 0:
        model.head = LoraLinear(model.head, r=lora_r, lora_alpha=max(8, lora_r * 2))
        if freeze_backbone:
            for name, p in model.named_parameters():
                if "lora_" not in name:
                    p.requires_grad_(False)
    return model


def serialize_weights_zst(model: nn.Module) -> bytes:
    """Serialize a PyTorch state_dict into compact zstd-compressed bytes (~15–35 KB)."""
    buf = io.BytesIO()
    torch.save(model.state_dict(), buf)
    cctx = zstd.ZstdCompressor(level=3)
    return cctx.compress(buf.getvalue())


def deserialize_weights_zst(blob: bytes) -> dict[str, torch.Tensor]:
    """Decompress zstd-packed PyTorch state_dict bytes."""
    dctx = zstd.ZstdDecompressor()
    raw = dctx.decompress(blob)
    return torch.load(io.BytesIO(raw), map_location="cpu", weights_only=True)


def extract_102_tensor(spectrum_json: dict[str, Any] | list[float] | None) -> np.ndarray:
    """Normalize a 102-channel SPHEREx spectrum into a float32 [2, 102] tensor (flux, inv_var)."""
    flux = np.zeros(102, dtype=np.float32)
    var = np.ones(102, dtype=np.float32) * 0.05

    if isinstance(spectrum_json, list):
        arr = np.asarray(spectrum_json[:102], dtype=np.float32)
        flux[: len(arr)] = np.where(np.isfinite(arr), arr, 0.0)
    elif isinstance(spectrum_json, dict):
        raw_flux = spectrum_json.get("flux_jy") or spectrum_json.get("flux") or []
        raw_var = spectrum_json.get("variance_jy2") or spectrum_json.get("variance") or []
        if raw_flux:
            arr = np.asarray(raw_flux[:102], dtype=np.float32)
            flux[: len(arr)] = np.where(np.isfinite(arr), arr, 0.0)
        if raw_var:
            varr = np.asarray(raw_var[:102], dtype=np.float32)
            var[: len(varr)] = np.where(np.isfinite(varr) & (varr > 0), varr, 0.05)

    # Signed log1p compression + per-spectrum z-score so bright & faint stars share scale
    signed = np.sign(flux) * np.log1p(np.abs(flux) * 1e3)
    mean = float(np.mean(signed))
    std = float(np.std(signed))
    if std > 1e-6:
        signed = (signed - mean) / std
    signed = np.clip(signed, -5.0, 5.0)

    inv_var = 1.0 / np.clip(var, 1e-6, 1e3)
    inv_var = np.log1p(inv_var)
    iv_max = float(np.max(inv_var))
    if iv_max > 1e-6:
        inv_var = inv_var / iv_max

    return np.stack([signed.astype(np.float32), inv_var.astype(np.float32)], axis=0)


def extract_3d_features(tensor_2x102: np.ndarray) -> np.ndarray:
    """Derive 3 physical summary features in [-1, 1] for AstroFeatureSVM."""
    flux = tensor_2x102[0]
    # D2 (~1.1-1.6 um: idx 18..38), D5 (~3.8-4.4 um: idx 78..92), Ice/CH4 (~3.0-3.4 um: idx 66..75)
    d2 = float(np.mean(flux[18:38]))
    d5 = float(np.mean(flux[78:92]))
    cont = float(np.mean(flux[52:64]))
    dip = float(np.mean(flux[66:76]))
    ir_color = math.tanh((d5 - d2) * 0.6)
    slope = math.tanh((float(np.mean(flux[85:])) - float(np.mean(flux[:18]))) * 0.5)
    ice_depth = math.tanh((cont - dip) * 0.7)
    return np.asarray([ir_color, slope, ice_depth], dtype=np.float32)


def _simulate_class_spectrum(class_id: int, rng: np.random.Generator) -> dict[str, Any]:
    """Generate a physics-motivated 102-channel SPHEREx spectrum for demo seeding."""
    w = np.asarray(SPHEREX_WAVELENGTHS_UM, dtype=np.float64)
    amp = float(rng.uniform(0.015, 0.25))
    noise_lvl = amp * float(rng.uniform(0.03, 0.08))

    if class_id == 0:  # Cool Brown Dwarf: deep CH4 at 3.3 um + H2O at 2.7 um + red 4.5 um rise
        f = amp * (0.45 * np.exp(-((w - 1.25) / 0.45) ** 2) + 1.15 * np.exp(-((w - 4.55) / 0.75) ** 2))
        f *= 1.0 - 0.68 * np.exp(-((w - 3.32) / 0.22) ** 2)
        f *= 1.0 - 0.45 * np.exp(-((w - 2.68) / 0.20) ** 2)
    elif class_id == 1:  # Fast-Moving Star (M-dwarf): bright 1.6 um H- peak + smooth Rayleigh-Jeans tail
        f = amp * (1.25 * (1.6 / w) ** 1.35 * (1.0 + 0.25 * np.exp(-((w - 1.62) / 0.35) ** 2)))
    elif class_id == 2:  # Flashing / Variable Star (T-Tauri / Mira): warm dust excess + 2.3 um CO
        f = amp * (0.75 * (1.5 / w) ** 0.55 + 0.95 * np.exp(-((w - 3.6) / 1.4) ** 2))
        f *= 1.0 + 0.22 * np.exp(-((w - 2.16) / 0.14) ** 2)
    elif class_id == 3:  # Icy / Dusty Star: reddened continuum + deep 3.05 H2O, 4.27 CO2, 4.67 CO ice dips
        f = amp * (0.45 + 0.85 * ((w - 0.75) / 4.25) ** 1.1)
        f *= 1.0 - 0.62 * np.exp(-((w - 3.05) / 0.24) ** 2)
        f *= 1.0 - 0.55 * np.exp(-((w - 4.27) / 0.11) ** 2)
        f *= 1.0 - 0.40 * np.exp(-((w - 4.67) / 0.10) ** 2)
    elif class_id == 4:  # Solar System / Moving: reflected solar peak ~1.0 um + steep thermal > 3.5 um
        f = amp * (0.85 * np.exp(-((w - 1.05) / 0.65) ** 2) + 1.45 * np.clip((w - 3.1) / 1.9, 0.0, 2.0) ** 2.2)
    else:  # Distant Galaxy / Field: flat + 3.3 um PAH emission bump
        f = amp * (0.65 + 0.12 * np.sin(w * 0.7))
        f += amp * 0.48 * np.exp(-((w - 3.29) / 0.14) ** 2)

    jitter = rng.normal(0.0, noise_lvl, size=len(w))
    flux = np.clip(f + jitter, 1e-5, None)
    variance = np.full_like(flux, max(noise_lvl ** 2, 1e-8))
    return {
        "wavelengths_um": SPHEREX_WAVELENGTHS_UM,
        "flux_jy": [round(float(v), 6) for v in flux],
        "variance_jy2": [round(float(v), 8) for v in variance],
    }


def build_demo_labeled_examples(per_class: int = 10, seed: int = 42) -> list[dict[str, Any]]:
    """Build 60 physics-realistic SPHEREx demo examples (10 per class, tagged demo_synthetic)."""
    rng = np.random.default_rng(seed)
    examples: list[dict[str, Any]] = []
    for cls in STUDIO_CLASSES:
        cid = int(cls["id"])
        cname = str(cls["name"])
        for idx in range(per_class):
            ra = round(float(rng.uniform(10.0, 350.0)), 4)
            dec = round(float(rng.uniform(-75.0, 75.0)), 4)
            examples.append(
                {
                    "example_id": f"demo_c{cid}_{idx + 1:02d}",
                    "section_id": None,
                    "target_name": f"Demo {cname} #{idx + 1}",
                    "ra": ra,
                    "dec": dec,
                    "px": 24,
                    "py": 24,
                    "class_id": cid,
                    "class_label": cname,
                    "spectrum_json": _simulate_class_spectrum(cid, rng),
                    "source": "demo_synthetic",
                    "note": "Physics-simulated SPHEREx 102-band demo spectrum",
                }
            )
    return examples


async def ensure_studio_tables(pool: Any) -> None:
    """Idempotently ensure ml_labeled_examples and new ml_training_runs columns exist."""
    global _STUDIO_TABLES_ENSURED
    if _STUDIO_TABLES_ENSURED or pool is None:
        return
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                CREATE TABLE IF NOT EXISTS ml_labeled_examples (
                    example_id TEXT PRIMARY KEY,
                    section_id TEXT,
                    target_name TEXT NOT NULL,
                    ra DOUBLE PRECISION,
                    dec DOUBLE PRECISION,
                    px INT,
                    py INT,
                    class_id INT NOT NULL,
                    class_label TEXT NOT NULL,
                    spectrum_json JSONB,
                    source TEXT NOT NULL DEFAULT 'user',
                    note TEXT,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            await conn.execute(
                "ALTER TABLE ml_training_runs ADD COLUMN IF NOT EXISTS weights_zst BYTEA"
            )
            await conn.execute(
                "ALTER TABLE ml_training_runs ADD COLUMN IF NOT EXISTS is_promoted BOOLEAN NOT NULL DEFAULT FALSE"
            )
            await conn.execute(
                "ALTER TABLE ml_training_runs ADD COLUMN IF NOT EXISTS confusion_matrix JSONB"
            )
            await conn.execute(
                "ALTER TABLE ml_training_runs ADD COLUMN IF NOT EXISTS class_counts JSONB"
            )
        _STUDIO_TABLES_ENSURED = True
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not auto-ensure studio tables: %s", exc)


async def list_labeled_examples(pool: Any) -> list[dict[str, Any]]:
    """Fetch all labeled examples from Postgres (or in-memory fallback when DB offline)."""
    if pool is None:
        return list(_MEMORY_EXAMPLES.values())
    await ensure_studio_tables(pool)
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT example_id, section_id, target_name, ra, dec, px, py,
                       class_id, class_label, spectrum_json, source, note, updated_at
                FROM ml_labeled_examples
                ORDER BY updated_at DESC
                """
            )
        out: list[dict[str, Any]] = []
        for r in rows:
            spec = r["spectrum_json"]
            if isinstance(spec, str):
                spec = json.loads(spec)
            out.append(
                {
                    "example_id": str(r["example_id"]),
                    "section_id": r["section_id"],
                    "target_name": str(r["target_name"]),
                    "ra": float(r["ra"]) if r["ra"] is not None else None,
                    "dec": float(r["dec"]) if r["dec"] is not None else None,
                    "px": int(r["px"]) if r["px"] is not None else None,
                    "py": int(r["py"]) if r["py"] is not None else None,
                    "class_id": int(r["class_id"]),
                    "class_label": str(r["class_label"]),
                    "spectrum_json": spec,
                    "source": str(r["source"] or "user"),
                    "note": r["note"],
                    "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
                }
            )
        return out
    except Exception:  # noqa: BLE001
        return list(_MEMORY_EXAMPLES.values())


async def upsert_labeled_example(pool: Any, example: dict[str, Any]) -> dict[str, Any]:
    """Insert or update a single labeled example in Postgres + memory mirror."""
    cid = max(0, min(24, int(example["class_id"])))
    default_name = STUDIO_CLASSES[cid]["name"] if cid < NUM_STUDIO_CLASSES else f"Custom Class {cid + 1}"
    cname = str(example.get("class_label") or "").strip() or default_name
    record = {
        "example_id": str(example.get("example_id") or f"ex_{uuid.uuid4().hex[:10]}"),
        "section_id": example.get("section_id"),
        "target_name": str(example.get("target_name") or "Labeled Sky Target"),
        "ra": float(example["ra"]) if example.get("ra") is not None else None,
        "dec": float(example["dec"]) if example.get("dec") is not None else None,
        "px": int(example["px"]) if example.get("px") is not None else None,
        "py": int(example["py"]) if example.get("py") is not None else None,
        "class_id": cid,
        "class_label": cname,
        "spectrum_json": example.get("spectrum_json"),
        "source": str(example.get("source") or "user"),
        "note": example.get("note"),
    }
    _MEMORY_EXAMPLES[record["example_id"]] = record
    if pool is not None:
        await ensure_studio_tables(pool)
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO ml_labeled_examples (
                    example_id, section_id, target_name, ra, dec, px, py,
                    class_id, class_label, spectrum_json, source, note, updated_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,NOW())
                ON CONFLICT (example_id) DO UPDATE SET
                    section_id = EXCLUDED.section_id,
                    target_name = EXCLUDED.target_name,
                    ra = EXCLUDED.ra,
                    dec = EXCLUDED.dec,
                    px = EXCLUDED.px,
                    py = EXCLUDED.py,
                    class_id = EXCLUDED.class_id,
                    class_label = EXCLUDED.class_label,
                    spectrum_json = COALESCE(EXCLUDED.spectrum_json, ml_labeled_examples.spectrum_json),
                    source = EXCLUDED.source,
                    note = EXCLUDED.note,
                    updated_at = NOW()
                """,
                record["example_id"],
                record["section_id"],
                record["target_name"],
                record["ra"],
                record["dec"],
                record["px"],
                record["py"],
                record["class_id"],
                record["class_label"],
                json.dumps(record["spectrum_json"]) if record["spectrum_json"] is not None else None,
                record["source"],
                record["note"],
            )
    return record


async def delete_labeled_example(pool: Any, example_id: str) -> bool:
    removed = _MEMORY_EXAMPLES.pop(example_id, None) is not None
    if pool is not None:
        await ensure_studio_tables(pool)
        async with pool.acquire() as conn:
            res = await conn.execute("DELETE FROM ml_labeled_examples WHERE example_id = $1", example_id)
            if res and res.endswith("1"):
                removed = True
    return removed


async def delete_class_examples(pool: Any, class_id: int) -> int:
    """Delete all labeled examples belonging to a specific class_id from memory and Postgres."""
    mem_keys = [k for k, v in _MEMORY_EXAMPLES.items() if int(v.get("class_id", -1)) == int(class_id)]
    for k in mem_keys:
        _MEMORY_EXAMPLES.pop(k, None)
    deleted = len(mem_keys)
    if pool is not None:
        await ensure_studio_tables(pool)
        async with pool.acquire() as conn:
            res = await conn.execute("DELETE FROM ml_labeled_examples WHERE class_id = $1", int(class_id))
            try:
                deleted = int(str(res).split()[-1])
            except (ValueError, IndexError):
                pass
    return deleted


async def seed_demo_examples(pool: Any, per_class: int = 10) -> int:
    """Seed 60 physics-realistic demo examples into Postgres (idempotent)."""
    demos = build_demo_labeled_examples(per_class=per_class)
    for ex in demos:
        await upsert_labeled_example(pool, ex)
    return len(demos)


async def clear_demo_examples(pool: Any) -> int:
    """Remove ONLY demo_synthetic rows, preserving real benchmarks and user labels."""
    mem_keys = [k for k, v in _MEMORY_EXAMPLES.items() if v.get("source") == "demo_synthetic"]
    for k in mem_keys:
        _MEMORY_EXAMPLES.pop(k, None)
    deleted = len(mem_keys)
    if pool is not None:
        await ensure_studio_tables(pool)
        async with pool.acquire() as conn:
            res = await conn.execute("DELETE FROM ml_labeled_examples WHERE source = 'demo_synthetic'")
            try:
                deleted = int(str(res).split()[-1])
            except (ValueError, IndexError):
                pass
    return deleted


def _augment_batch(x_train: np.ndarray, y_train: np.ndarray, copies: int = 4, seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """Generate physics-valid augmented copies (noise jitter, small scale, 5% channel mask)."""
    rng = np.random.default_rng(seed)
    xs = [x_train]
    ys = [y_train]
    for _ in range(copies):
        noise = rng.normal(0.0, 0.14, size=x_train[:, 0, :].shape).astype(np.float32)
        scale = rng.uniform(0.92, 1.08, size=(x_train.shape[0], 1)).astype(np.float32)
        mask = (rng.random(size=x_train[:, 0, :].shape) > 0.05).astype(np.float32)
        aug = x_train.copy()
        aug[:, 0, :] = np.clip((aug[:, 0, :] * scale + noise) * mask, -5.0, 5.0)
        aug[:, 1, :] = aug[:, 1, :] * mask
        xs.append(aug)
        ys.append(y_train.copy())
    return np.concatenate(xs, axis=0), np.concatenate(ys, axis=0)


def train_studio_model(
    examples: list[dict[str, Any]],
    *,
    model_name: str = "SpectralResNet102",
    epochs: int = 12,
    learning_rate: float = 8e-3,
    batch_size: int = 64,
    use_lora: bool = False,
    lora_r: int = 8,
    augment: bool = True,
    base_weights_zst: bytes | None = None,
    seed: int = 42,
    on_epoch: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Train a real N-class PyTorch classifier on real/seeded SPHEREx spectra."""
    clear_studio_abort()
    try:
        torch.set_num_threads(2)
    except RuntimeError:
        pass
    torch.manual_seed(seed)
    np.random.seed(seed)

    # Group examples by class for stratified 80/20 train/val split (supports custom classes >= 6)
    by_class: dict[int, list[np.ndarray]] = {}
    class_name_map: dict[int, str] = {c["id"]: c["name"] for c in STUDIO_CLASSES}
    for ex in examples:
        cid = int(ex["class_id"])
        if cid < 0 or cid > 24:
            continue
        spec = ex.get("spectrum_json")
        if not spec:
            continue
        by_class.setdefault(cid, []).append(extract_102_tensor(spec))
        if ex.get("class_label"):
            class_name_map[cid] = str(ex["class_label"])

    n_total_classes = max(NUM_STUDIO_CLASSES, (max(by_class.keys()) + 1) if by_class else NUM_STUDIO_CLASSES)
    populated_classes = sorted(c for c, items in by_class.items() if len(items) >= 2)
    if len(populated_classes) < 2:
        raise ValueError(
            "Need at least 2 classes with 2 or more labeled examples each before training."
        )

    rng = np.random.default_rng(seed)
    train_x_list: list[np.ndarray] = []
    train_y_list: list[int] = []
    val_x_list: list[np.ndarray] = []
    val_y_list: list[int] = []
    class_counts: dict[str, int] = {str(c): len(by_class.get(c, [])) for c in range(n_total_classes)}

    for cid in populated_classes:
        items = list(by_class[cid])
        idx = rng.permutation(len(items))
        n_val = max(1, round(len(items) * 0.2))
        val_idx = set(idx[:n_val].tolist())
        for i, arr in enumerate(items):
            if i in val_idx:
                val_x_list.append(arr)
                val_y_list.append(cid)
            else:
                train_x_list.append(arr)
                train_y_list.append(cid)

    x_tr = np.stack(train_x_list, axis=0)
    y_tr = np.asarray(train_y_list, dtype=np.int64)
    x_va = np.stack(val_x_list, axis=0)
    y_va = np.asarray(val_y_list, dtype=np.int64)

    if augment:
        # Adaptive augmentation: keep tiny datasets rich without bloating larger ones on CPU
        n_raw_tr = len(x_tr)
        aug_copies = 3 if n_raw_tr < 36 else (1 if n_raw_tr < 120 else 0)
        if aug_copies > 0:
            x_tr, y_tr = _augment_batch(x_tr, y_tr, copies=aug_copies, seed=seed)

    if model_name == "AstroFeatureSVM":
        x_tr_t = torch.from_numpy(np.stack([extract_3d_features(a) for a in x_tr], axis=0))
        x_va_t = torch.from_numpy(np.stack([extract_3d_features(a) for a in x_va], axis=0))
    else:
        x_tr_t = torch.from_numpy(x_tr)
        x_va_t = torch.from_numpy(x_va)
    y_tr_t = torch.from_numpy(y_tr)
    y_va_t = torch.from_numpy(y_va)

    model = build_studio_model(
        model_name,
        num_classes=n_total_classes,
        lora_r=lora_r if use_lora else 0,
        freeze_backbone=use_lora,
    )
    if base_weights_zst is not None:
        try:
            sd = deserialize_weights_zst(base_weights_zst)
            model.load_state_dict(sd, strict=False)
        except Exception as exc:  # noqa: BLE001
            logger.debug("Could not warm-start base weights: %s", exc)

    trainable_params = [p for p in model.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(trainable_params, lr=learning_rate, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max(1, int(epochs)))
    criterion = nn.CrossEntropyLoss()

    run_id = f"run_{uuid.uuid4().hex[:8]}"
    frames: list[dict[str, Any]] = []
    t0 = time.perf_counter()
    aborted = False
    n_samples = len(x_tr_t)
    eff_bs = max(2, min(int(batch_size), n_samples))
    converged_streak = 0

    for ep in range(1, int(epochs) + 1):
        if is_studio_abort_requested():
            aborted = True
            break
        model.train()
        perm = torch.randperm(n_samples)
        ep_loss = 0.0
        ep_correct = 0
        for start in range(0, n_samples, eff_bs):
            batch_idx = perm[start : start + eff_bs]
            xb = x_tr_t[batch_idx]
            yb = y_tr_t[batch_idx]
            optimizer.zero_grad(set_to_none=True)
            logits = model(xb)
            loss = criterion(logits, yb)
            loss.backward()
            optimizer.step()
            ep_loss += float(loss.item()) * len(yb)
            ep_correct += int((logits.argmax(dim=1) == yb).sum().item())
        scheduler.step()

        train_loss = ep_loss / max(1, n_samples)
        train_acc = ep_correct / max(1, n_samples)

        model.eval()
        with torch.no_grad():
            val_logits = model(x_va_t)
            val_loss = float(criterion(val_logits, y_va_t).item())
            val_preds = val_logits.argmax(dim=1)
            val_acc = float((val_preds == y_va_t).float().mean().item())

        frame = {
            "type": "epoch",
            "run_id": run_id,
            "mode": "live",
            "model": model_name,
            "epoch": ep,
            "epochs": int(epochs),
            "loss": round(train_loss, 5),
            "acc": round(train_acc, 4),
            "val_loss": round(val_loss, 5),
            "val_acc": round(val_acc, 4),
            "elapsed_s": round(time.perf_counter() - t0, 3),
        }
        frames.append(frame)
        if on_epoch is not None:
            on_epoch(frame)

        # Smart early-stop once model has cleanly converged
        if ep >= 4 and val_acc >= 0.98 and val_loss < 0.15:
            converged_streak += 1
            if converged_streak >= 2:
                break
        else:
            converged_streak = 0

    # Final validation confusion matrix
    model.eval()
    cm = [[0 for _ in range(n_total_classes)] for _ in range(n_total_classes)]
    with torch.no_grad():
        val_preds = model(x_va_t).argmax(dim=1).tolist()
        for true_c, pred_c in zip(y_va.tolist(), val_preds, strict=True):
            cm[int(true_c)][int(pred_c)] += 1

    weights_zst = serialize_weights_zst(model)
    last = frames[-1] if frames else {"loss": 0.0, "val_loss": 0.0, "val_acc": 0.0, "epoch": 0}
    run_meta = {
        "run_id": run_id,
        "model_architecture": model_name,
        "hyperparameters": {
            "num_classes": n_total_classes,
            "class_names": {str(k): v for k, v in class_name_map.items()},
            "epochs": int(epochs),
            "learning_rate": float(learning_rate),
            "batch_size": eff_bs,
            "use_lora": bool(use_lora),
            "lora_r": int(lora_r) if use_lora else 0,
            "augment": bool(augment),
            "seed": int(seed),
            "train_samples": int(n_samples),
            "val_samples": len(x_va_t),
        },
        "epochs_completed": int(last["epoch"]),
        "final_train_loss": float(last["loss"]),
        "final_val_loss": float(last["val_loss"]),
        "final_val_acc": float(last["val_acc"]),
        "confusion_matrix": cm,
        "class_counts": class_counts,
        "telemetry_frames": frames,
        "status": "aborted" if aborted else "complete",
        "is_promoted": not aborted,
        "weights_size_bytes": len(weights_zst),
    }

    if not aborted:
        _ACTIVE_MODELS[model_name] = model
        _ACTIVE_RUN_META[model_name] = {k: v for k, v in run_meta.items() if k != "telemetry_frames"}
        _MEMORY_WEIGHTS[run_id] = weights_zst
        for prev in _MEMORY_RUNS:
            if prev["model_architecture"] == model_name:
                prev["is_promoted"] = False
        _MEMORY_RUNS.insert(0, run_meta)

    return {"run_meta": run_meta, "weights_zst": weights_zst, "aborted": aborted}


async def save_studio_run(pool: Any, run_meta: dict[str, Any], weights_zst: bytes) -> None:
    """Persist a completed studio training run & compressed weights to Postgres."""
    if pool is None:
        return
    await ensure_studio_tables(pool)
    async with pool.acquire() as conn:
        if run_meta.get("is_promoted"):
            await conn.execute(
                "UPDATE ml_training_runs SET is_promoted = FALSE WHERE model_architecture = $1",
                run_meta["model_architecture"],
            )
        await conn.execute(
            """
            INSERT INTO ml_training_runs (
                run_id, model_architecture, hyperparameters, epochs_completed,
                final_train_loss, final_val_loss, final_val_f1, telemetry_frames,
                weights_zst, is_promoted, confusion_matrix, class_counts, status, created_at
            ) VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb,$12::jsonb,$13,NOW())
            ON CONFLICT (run_id) DO UPDATE SET
                epochs_completed = EXCLUDED.epochs_completed,
                final_train_loss = EXCLUDED.final_train_loss,
                final_val_loss = EXCLUDED.final_val_loss,
                final_val_f1 = EXCLUDED.final_val_f1,
                telemetry_frames = EXCLUDED.telemetry_frames,
                weights_zst = EXCLUDED.weights_zst,
                is_promoted = EXCLUDED.is_promoted,
                confusion_matrix = EXCLUDED.confusion_matrix,
                class_counts = EXCLUDED.class_counts,
                status = EXCLUDED.status
            """,
            run_meta["run_id"],
            run_meta["model_architecture"],
            json.dumps(run_meta["hyperparameters"]),
            int(run_meta["epochs_completed"]),
            float(run_meta["final_train_loss"]),
            float(run_meta["final_val_loss"]),
            float(run_meta["final_val_acc"]),
            json.dumps(run_meta["telemetry_frames"]),
            weights_zst,
            bool(run_meta.get("is_promoted", False)),
            json.dumps(run_meta["confusion_matrix"]),
            json.dumps(run_meta["class_counts"]),
            str(run_meta["status"]),
        )


async def list_studio_runs(pool: Any, limit: int = 20) -> list[dict[str, Any]]:
    """Return persisted training runs (metadata + confusion matrix, omitting BYTEA weights)."""
    if pool is None:
        return [
            {k: v for k, v in r.items() if k != "telemetry_frames"}
            for r in _MEMORY_RUNS[:limit]
        ]
    await ensure_studio_tables(pool)
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT run_id, model_architecture, hyperparameters, epochs_completed,
                       final_train_loss, final_val_loss, final_val_f1, is_promoted,
                       confusion_matrix, class_counts, status,
                       octet_length(weights_zst) AS weights_size_bytes, created_at
                FROM ml_training_runs
                ORDER BY created_at DESC
                LIMIT $1
                """,
                limit,
            )
        out: list[dict[str, Any]] = []
        for r in rows:
            hp = r["hyperparameters"]
            cm = r["confusion_matrix"]
            cc = r["class_counts"]
            out.append(
                {
                    "run_id": str(r["run_id"]),
                    "model_architecture": str(r["model_architecture"]),
                    "hyperparameters": json.loads(hp) if isinstance(hp, str) else (hp or {}),
                    "epochs_completed": int(r["epochs_completed"] or 0),
                    "final_train_loss": float(r["final_train_loss"]) if r["final_train_loss"] is not None else None,
                    "final_val_loss": float(r["final_val_loss"]) if r["final_val_loss"] is not None else None,
                    "final_val_acc": float(r["final_val_f1"]) if r["final_val_f1"] is not None else None,
                    "is_promoted": bool(r["is_promoted"]),
                    "confusion_matrix": json.loads(cm) if isinstance(cm, str) else cm,
                    "class_counts": json.loads(cc) if isinstance(cc, str) else cc,
                    "status": str(r["status"] or "complete"),
                    "weights_size_bytes": int(r["weights_size_bytes"] or 0),
                    "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                }
            )
        return out
    except Exception:  # noqa: BLE001
        return [
            {k: v for k, v in r.items() if k != "telemetry_frames"}
            for r in _MEMORY_RUNS[:limit]
        ]


async def load_promoted_studio_model(
    pool: Any, model_name: str = "SpectralResNet102"
) -> tuple[nn.Module | None, dict[str, Any] | None]:
    """Load the active promoted model from RAM cache or Postgres BYTEA weights."""
    if model_name in _ACTIVE_MODELS:
        return _ACTIVE_MODELS[model_name], _ACTIVE_RUN_META.get(model_name)

    if pool is not None:
        await ensure_studio_tables(pool)
        try:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    """
                    SELECT run_id, model_architecture, hyperparameters, epochs_completed,
                           final_val_f1, confusion_matrix, weights_zst, created_at
                    FROM ml_training_runs
                    WHERE model_architecture = $1 AND is_promoted = TRUE AND weights_zst IS NOT NULL
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    model_name,
                )
            if row and row["weights_zst"]:
                hp = row["hyperparameters"]
                if isinstance(hp, str):
                    hp = json.loads(hp)
                hp = hp or {}
                model = build_studio_model(
                    model_name,
                    num_classes=int(hp.get("num_classes") or NUM_STUDIO_CLASSES),
                    lora_r=int(hp.get("lora_r") or 0) if hp.get("use_lora") else 0,
                    freeze_backbone=bool(hp.get("use_lora")),
                )
                sd = deserialize_weights_zst(bytes(row["weights_zst"]))
                model.load_state_dict(sd, strict=False)
                model.eval()
                meta = {
                    "run_id": str(row["run_id"]),
                    "model_architecture": model_name,
                    "epochs_completed": int(row["epochs_completed"] or 0),
                    "final_val_acc": float(row["final_val_f1"]) if row["final_val_f1"] is not None else None,
                    "is_promoted": True,
                    "created_at": row["created_at"].isoformat() if row["created_at"] else None,
                }
                _ACTIVE_MODELS[model_name] = model
                _ACTIVE_RUN_META[model_name] = meta
                return model, meta
        except Exception as exc:  # noqa: BLE001
            logger.debug("Could not warm-start base weights: %s", exc)
    return None, None


async def promote_studio_run(pool: Any, run_id: str) -> dict[str, Any] | None:
    """Promote a saved run_id as the active model by loading its real weights from Postgres."""
    if pool is not None:
        await ensure_studio_tables(pool)
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT run_id, model_architecture, hyperparameters, epochs_completed,
                       final_val_f1, weights_zst
                FROM ml_training_runs
                WHERE run_id = $1
                """,
                run_id,
            )
            if not row or not row["weights_zst"]:
                return None
            model_name = str(row["model_architecture"])
            hp = row["hyperparameters"]
            if isinstance(hp, str):
                hp = json.loads(hp)
            hp = hp or {}
            model = build_studio_model(
                model_name,
                num_classes=int(hp.get("num_classes") or NUM_STUDIO_CLASSES),
                lora_r=int(hp.get("lora_r") or 0) if hp.get("use_lora") else 0,
                freeze_backbone=bool(hp.get("use_lora")),
            )
            sd = deserialize_weights_zst(bytes(row["weights_zst"]))
            model.load_state_dict(sd, strict=False)
            model.eval()
            await conn.execute(
                "UPDATE ml_training_runs SET is_promoted = FALSE WHERE model_architecture = $1",
                model_name,
            )
            await conn.execute(
                "UPDATE ml_training_runs SET is_promoted = TRUE WHERE run_id = $1",
                run_id,
            )
            meta = {
                "run_id": run_id,
                "model_architecture": model_name,
                "epochs_completed": int(row["epochs_completed"] or 0),
                "final_val_acc": float(row["final_val_f1"]) if row["final_val_f1"] is not None else None,
                "is_promoted": True,
            }
            _ACTIVE_MODELS[model_name] = model
            _ACTIVE_RUN_META[model_name] = meta
            return meta

    # Memory fallback
    weights = _MEMORY_WEIGHTS.get(run_id)
    target = next((r for r in _MEMORY_RUNS if r["run_id"] == run_id), None)
    if not weights or not target:
        return None
    model_name = str(target["model_architecture"])
    hp = target.get("hyperparameters") or {}
    model = build_studio_model(
        model_name,
        lora_r=int(hp.get("lora_r") or 0) if hp.get("use_lora") else 0,
        freeze_backbone=bool(hp.get("use_lora")),
    )
    model.load_state_dict(deserialize_weights_zst(weights), strict=False)
    model.eval()
    for r in _MEMORY_RUNS:
        if r["model_architecture"] == model_name:
            r["is_promoted"] = r["run_id"] == run_id
    _ACTIVE_MODELS[model_name] = model
    _ACTIVE_RUN_META[model_name] = {k: v for k, v in target.items() if k != "telemetry_frames"}
    return _ACTIVE_RUN_META[model_name]


async def reset_promoted_studio_models(pool: Any) -> None:
    """Un-promote all active studio models in RAM and Postgres so Preview returns to untrained state."""
    _ACTIVE_MODELS.clear()
    _ACTIVE_RUN_META.clear()
    for r in _MEMORY_RUNS:
        r["is_promoted"] = False
    if pool is not None:
        await ensure_studio_tables(pool)
        try:
            async with pool.acquire() as conn:
                await conn.execute("UPDATE ml_training_runs SET is_promoted = FALSE WHERE is_promoted = TRUE")
        except Exception as exc:  # noqa: BLE001
            logger.debug("Could not reset promoted models in Postgres: %s", exc)


async def delete_studio_run(pool: Any, run_id: str) -> bool:
    """Permanently delete a saved model checkpoint from memory and Postgres."""
    removed = _MEMORY_WEIGHTS.pop(run_id, None) is not None
    before_len = len(_MEMORY_RUNS)
    _MEMORY_RUNS[:] = [r for r in _MEMORY_RUNS if r.get("run_id") != run_id]
    if len(_MEMORY_RUNS) < before_len:
        removed = True
    for arch, meta in list(_ACTIVE_RUN_META.items()):
        if meta.get("run_id") == run_id:
            _ACTIVE_RUN_META.pop(arch, None)
            _ACTIVE_MODELS.pop(arch, None)
    if pool is not None:
        await ensure_studio_tables(pool)
        try:
            async with pool.acquire() as conn:
                res = await conn.execute("DELETE FROM ml_training_runs WHERE run_id = $1", run_id)
                if res and not res.endswith("0"):
                    removed = True
        except Exception as exc:  # noqa: BLE001
            logger.debug("Could not delete run %s from Postgres: %s", run_id, exc)
    return removed


async def get_run_weights_pt_bytes(pool: Any, run_id: str) -> bytes | None:
    """Return uncompressed PyTorch .pt checkpoint bytes for a saved run_id."""
    blob = _MEMORY_WEIGHTS.get(run_id)
    if blob is None and pool is not None:
        await ensure_studio_tables(pool)
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT weights_zst FROM ml_training_runs WHERE run_id = $1",
                run_id,
            )
            if row and row["weights_zst"]:
                blob = bytes(row["weights_zst"])
    if not blob:
        return None
    dctx = zstd.ZstdDecompressor()
    return dctx.decompress(blob)


def predict_spectrum_with_gradcam(
    model: nn.Module | None,
    spectrum_json: dict[str, Any] | list[float] | None,
    *,
    model_name: str = "SpectralResNet102",
) -> dict[str, Any]:
    """Run a genuine PyTorch forward pass + 1D Grad-CAM wavelength explanation (refuses untrained guesses)."""
    if model is None:
        return {
            "is_trained": False,
            "model_architecture": model_name,
            "top_class_id": None,
            "top_class_name": "Not Trained Yet",
            "confidence": 0.0,
            "probabilities": [],
            "wavelengths_um": SPHEREX_WAVELENGTHS_UM,
            "gradcam_102": [0.0] * 102,
            "peak_wavelength_um": None,
            "explanation": "Train a model in the middle card first to preview live predictions here.",
        }

    arr_2x102 = extract_102_tensor(spectrum_json)
    is_trained = True
    active_model = model
    active_model.eval()

    gradcam_102 = [0.0] * 102
    if model_name == "AstroFeatureSVM":
        feat = torch.from_numpy(extract_3d_features(arr_2x102)).unsqueeze(0)
        with torch.no_grad():
            logits = active_model(feat)
            probs = F.softmax(logits, dim=1)[0].tolist()
    else:
        x = torch.from_numpy(arr_2x102).unsqueeze(0).requires_grad_(True)
        activations: list[torch.Tensor] = []
        gradients: list[torch.Tensor] = []

        def _fwd_hook(_m: nn.Module, _inp: Any, out: torch.Tensor) -> None:
            activations.append(out)

        def _bwd_hook(_m: nn.Module, _gin: Any, gout: tuple[torch.Tensor, ...]) -> None:
            gradients.append(gout[0])

        target_layer = getattr(getattr(active_model, "block2", None), "out_act", None)
        h1 = target_layer.register_forward_hook(_fwd_hook) if target_layer is not None else None
        h2 = target_layer.register_full_backward_hook(_bwd_hook) if target_layer is not None else None
        try:
            active_model.zero_grad(set_to_none=True)
            logits = active_model(x)
            probs_t = F.softmax(logits, dim=1)[0]
            probs = probs_t.detach().tolist()
            top_idx = int(torch.argmax(probs_t).item())
            logits[0, top_idx].backward()
            if activations and gradients:
                act = activations[0].detach()[0]  # [C, 102]
                grad = gradients[0].detach()[0]   # [C, 102]
                weights = grad.mean(dim=1, keepdim=True)  # [C, 1]
                cam = torch.relu((weights * act).sum(dim=0)).numpy()
                cmax = float(np.max(cam))
                if cmax > 1e-8:
                    cam = cam / cmax
                gradcam_102 = [round(float(v), 4) for v in cam.tolist()]
        finally:
            if h1 is not None:
                h1.remove()
            if h2 is not None:
                h2.remove()

    extra_palette = ["#22d3ee", "#c084fc", "#f472b6", "#facc15", "#4ade80", "#fb923c"]
    ranked = sorted(
        [
            {
                "class_id": cid,
                "name": STUDIO_CLASSES[cid]["name"] if cid < NUM_STUDIO_CLASSES else f"Custom Class {cid + 1}",
                "science_name": STUDIO_CLASSES[cid]["science_name"] if cid < NUM_STUDIO_CLASSES else "Custom User Class",
                "color": STUDIO_CLASSES[cid]["color"] if cid < NUM_STUDIO_CLASSES else extra_palette[cid % len(extra_palette)],
                "probability": round(float(probs[cid]), 4),
            }
            for cid in range(len(probs))
        ],
        key=lambda item: item["probability"],
        reverse=True,
    )
    top = ranked[0]
    peak_idx = int(np.argmax(gradcam_102)) if any(v > 0 for v in gradcam_102) else 50
    peak_um = SPHEREX_WAVELENGTHS_UM[peak_idx]
    if peak_um < 1.65:
        region_note = "short near-IR starlight (0.75–1.6 µm)"
    elif peak_um < 2.6:
        region_note = "mid near-IR continuum (1.6–2.6 µm)"
    elif peak_um < 3.6:
        region_note = "water-ice & methane absorption zone (2.6–3.6 µm)"
    else:
        region_note = "cold thermal & CO₂/CO ice zone (3.6–5.0 µm)"

    return {
        "is_trained": is_trained,
        "model_architecture": model_name,
        "top_class_id": top["class_id"],
        "top_class_name": top["name"],
        "confidence": top["probability"],
        "probabilities": ranked,
        "wavelengths_um": SPHEREX_WAVELENGTHS_UM,
        "gradcam_102": gradcam_102,
        "peak_wavelength_um": peak_um,
        "explanation": (
            f"Focused strongest around {peak_um:.2f} µm ({region_note})."
            if is_trained
            else "No trained model yet — showing untrained random baseline. Train a model first."
        ),
    }
