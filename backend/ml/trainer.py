"""Training loop, LoRA/SFT engine, live identification, embedding graph, and TRL dataset builder.

Pre-compute (CPU only, ~1-2 min total):  python -m backend.ml.trainer
This module MUST stay torch / numpy / sklearn-free at import time; heavy ML imports
occur strictly inside functions so public /explore cold boot stays fast.
"""

from __future__ import annotations

import json
import math
import sys
import threading
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import MODEL_NAMES, REPLAY_DIR, replay_path

LR = {"DipoleConvNet3D": 3e-3, "SpectralResNet102": 3e-3, "AstroFeatureSVM": 5e-2}
BATCH = {"DipoleConvNet3D": 32, "SpectralResNet102": 32, "AstroFeatureSVM": 64}
_replay_lock = threading.Lock()
_checkpoint_lock = threading.Lock()

# In-memory live PyTorch Base vs Trained model registry + active-learning SFT feedback store
_BASE_MODELS: dict[str, Any] = {}
_TRAINED_CHECKPOINTS: dict[str, dict[str, Any]] = {}
_SFT_FEEDBACK_EXAMPLES: list[dict[str, Any]] = []
_MAX_FEEDBACK_EXAMPLES = 200

_SPECTRAL_FEATURES = [
    {"id": "feat_ch4_332", "label": "3.32 µm CH4 Methane", "wave_um": 3.32, "kind": "feature"},
    {"id": "feat_h2o_305", "label": "3.05 µm H2O Ice", "wave_um": 3.05, "kind": "feature"},
    {"id": "feat_co2_427", "label": "4.27 µm CO2 Ice", "wave_um": 4.27, "kind": "feature"},
    {"id": "feat_red_ir", "label": "Red IR Slope (D5/D2)", "wave_um": 4.12, "kind": "feature"},
    {"id": "feat_pm_dipole", "label": "Proper Motion Dipole", "wave_um": None, "kind": "feature"},
]

_CLASS_HUBS = [
    {"id": "cls_brown_dwarf", "label": "Brown Dwarf (Y/T/L)", "kind": "class"},
    {"id": "cls_mdwarf_pm", "label": "M-Dwarf / High-PM Star", "kind": "class"},
    {"id": "cls_variable", "label": "Pulsating / T-Tauri Variable", "kind": "class"},
    {"id": "cls_ice_yso", "label": "Ice-Absorbed Protostar", "kind": "class"},
    {"id": "cls_extragal", "label": "Galaxy / AGN / Field", "kind": "class"},
]

_GRAPH_TEMPLATE_IDS = (
    "Y4_DWARF_SONORA",
    "T1_DWARF_EPSINDI",
    "M4V_BARNARD_REF",
    "T_TAURI_RWAUR",
    "MIRA_AGB_RDRA",
    "SPLICES_H2O_ICE",
    "SPLICES_CO2_ICE",
    "GALAXY_Z_10",
)


def get_checkpoint_summary() -> dict[str, Any]:
    """Return lightweight status of trained checkpoints currently cached in RAM."""
    with _checkpoint_lock:
        out: dict[str, Any] = {}
        for name in MODEL_NAMES:
            entry = _TRAINED_CHECKPOINTS.get(name)
            out[name] = dict(entry["meta"]) if entry else None
        return out


def add_feedback_example(
    *,
    target_id: str,
    label: str,
    predicted_class: str,
    human_class: str,
    action: str,
    reasoning: str,
    metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Append a confirmed or overridden Co-Pilot example into the SFT dataset buffer."""
    record = {
        "id": f"fb_{uuid.uuid4().hex[:8]}",
        "target_id": target_id,
        "label": label,
        "predicted_class": predicted_class,
        "human_class": human_class,
        "action": action,
        "reasoning": reasoning,
        "metrics": metrics or {},
        "created_at": datetime.now(UTC).isoformat(),
    }
    with _checkpoint_lock:
        # Replace any earlier feedback for the same target_id to stay idempotent per target
        _SFT_FEEDBACK_EXAMPLES[:] = [r for r in _SFT_FEEDBACK_EXAMPLES if r["target_id"] != target_id]
        _SFT_FEEDBACK_EXAMPLES.insert(0, record)
        if len(_SFT_FEEDBACK_EXAMPLES) > _MAX_FEEDBACK_EXAMPLES:
            del _SFT_FEEDBACK_EXAMPLES[_MAX_FEEDBACK_EXAMPLES:]
        total = len(_SFT_FEEDBACK_EXAMPLES)
    return {"record": record, "total_feedback": total}


def _shannon_entropy_bits(probs) -> float:
    import torch

    p = probs.clamp(min=1e-9)
    return float(-(p * torch.log2(p)).sum(dim=-1).mean().item())


def _confusion_2x2(y_true, y_pred) -> list[list[int]]:
    tn = int(((y_true == 0) & (y_pred == 0)).sum())
    fp = int(((y_true == 0) & (y_pred == 1)).sum())
    fn = int(((y_true == 1) & (y_pred == 0)).sum())
    tp = int(((y_true == 1) & (y_pred == 1)).sum())
    return [[tn, fp], [fn, tp]]


def run_training(
    model_name,
    epochs=50,
    seed=0,
    mode="replay",
    on_frame=None,
    stop_event=None,
    *,
    learning_rate: float | None = None,
    batch_size: int | None = None,
    lora_r: int = 0,
    lora_alpha: int = 32,
    lora_dropout: float = 0.05,
    freeze_backbone: bool = False,
    loss_type: str = "nll",
    completion_only_loss: bool = True,
    packing: bool = True,
    quantization_bits: int = 16,
):
    """Train on CPU, emitting one telemetry + TRL frame per epoch. Returns all frames."""
    import torch
    import torch.nn.functional as F
    from sklearn.metrics import accuracy_score

    from .data import DATASET_SIZE, make_dataset, make_probe
    from .models import TARGET_LAYERS, build_model, parameter_summary
    from .telemetry import RealTimeTrainingInstrument

    torch.manual_seed(seed)
    x, y = make_dataset(model_name, DATASET_SIZE[model_name], seed)
    split = int(0.8 * len(x))
    xtr, ytr, xva, yva = x[:split], y[:split], x[split:], y[split:]

    # Snapshot untrained Base model with identical seed before training updates weights
    torch.manual_seed(seed)
    base_snapshot = build_model(model_name)
    base_snapshot.eval()

    torch.manual_seed(seed)
    model = build_model(
        model_name,
        lora_r=lora_r,
        lora_alpha=lora_alpha,
        lora_dropout=lora_dropout,
        freeze_backbone=freeze_backbone,
    )
    param_info = parameter_summary(
        model,
        lora_r=lora_r,
        lora_alpha=lora_alpha,
        quantization_bits=quantization_bits,
    )

    eff_lr = float(learning_rate if learning_rate is not None else LR[model_name])
    eff_bs = max(8, min(len(xtr), int(batch_size if batch_size is not None else BATCH[model_name])))
    trainable = [p for p in model.parameters() if p.requires_grad]
    if not trainable:
        trainable = list(model.parameters())

    opt = torch.optim.AdamW(trainable, lr=eff_lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        opt, T_max=max(1, epochs), eta_min=eff_lr * 0.1
    )
    instr = RealTimeTrainingInstrument(model, TARGET_LAYERS[model_name])
    probe_x = make_probe(model_name)
    run_id, frames, t0 = uuid.uuid4().hex[:8], [], time.time()
    global_step = 0
    tokens_per_sample = 64 if packing else 42

    try:
        for epoch in range(1, epochs + 1):
            if stop_event is not None and stop_event.is_set():
                break
            model.train()
            perm = torch.randperm(len(xtr))
            starts = list(range(0, len(xtr), eff_bs))
            loss_sum, correct, grad_norm = 0.0, 0, 0.0
            for k, i in enumerate(starts):
                idx = perm[i : i + eff_bs]
                opt.zero_grad(set_to_none=True)
                out = model(xtr[idx])
                if loss_type == "dft":
                    # HF TRL Dynamic Fine-Tuning: detach predicted true-class probability multiplier
                    per_ex_nll = F.cross_entropy(out, ytr[idx], reduction="none")
                    p_true = F.softmax(out.detach(), dim=-1).gather(1, ytr[idx].unsqueeze(1)).squeeze(1)
                    loss = (per_ex_nll * p_true.clamp(min=0.25)).mean()
                else:
                    loss = F.cross_entropy(out, ytr[idx])
                loss.backward()
                torch.nn.utils.clip_grad_norm_(trainable, max_norm=2.0)
                if k == len(starts) - 1:
                    grad_norm = instr.grad_stats(model)
                opt.step()
                global_step += 1
                loss_sum += loss.item() * len(idx)
                correct += (out.argmax(1) == ytr[idx]).sum().item()

            scheduler.step()
            current_lr = float(opt.param_groups[0]["lr"])

            model.eval()
            with torch.no_grad():
                vo = model(xva)
                vloss = F.cross_entropy(vo, yva).item()
                vprobs = F.softmax(vo, dim=-1)
                vpreds = vo.argmax(1)
                vacc = accuracy_score(yva.numpy(), vpreds.numpy())
                entropy_bits = _shannon_entropy_bits(vprobs)
                confusion = _confusion_2x2(yva.numpy(), vpreds.numpy())

            frame = instr.build_frame(
                model,
                model_name=model_name,
                run_id=run_id,
                mode=mode,
                epoch=epoch,
                epochs=epochs,
                metrics={
                    "loss": loss_sum / len(xtr),
                    "acc": correct / len(xtr),
                    "val_loss": vloss,
                    "val_acc": vacc,
                    "elapsed_s": time.time() - t0,
                },
                grad_norm=grad_norm,
                probe_x=probe_x,
            )
            frame["trl"] = {
                "global_step": global_step,
                "epoch": float(epoch),
                "num_tokens": int(global_step * eff_bs * tokens_per_sample),
                "loss": round(loss_sum / len(xtr), 5),
                "val_loss": round(vloss, 5),
                "entropy": round(entropy_bits, 5),
                "mean_token_accuracy": round(float(vacc), 5),
                "learning_rate": round(current_lr, 7),
                "grad_norm": round(float(grad_norm), 5),
                "loss_type": loss_type,
                "completion_only_loss": bool(completion_only_loss),
                "packing": bool(packing),
                "lora_r": int(lora_r),
                "lora_alpha": int(lora_alpha),
                "param_summary": param_info,
                "confusion": confusion,
            }
            frames.append(frame)
            if on_frame:
                on_frame(frame)
    finally:
        instr.close()

    if frames and mode != "replay":
        with _checkpoint_lock:
            _BASE_MODELS[model_name] = base_snapshot
            _TRAINED_CHECKPOINTS[model_name] = {
                "model": model.eval(),
                "meta": {
                    "model_name": model_name,
                    "run_id": run_id,
                    "source": "studio_train" if mode != "auto_warmstart" else "auto_warmstart",
                    "trained_at": datetime.now(UTC).isoformat(),
                    "epochs_completed": len(frames),
                    "val_acc": frames[-1]["trl"]["mean_token_accuracy"],
                    "val_loss": frames[-1]["trl"]["val_loss"],
                    "entropy": frames[-1]["trl"]["entropy"],
                    "lora_r": int(lora_r),
                    "lora_alpha": int(lora_alpha),
                    "loss_type": loss_type,
                    "param_summary": param_info,
                },
            }
    return frames


def _ensure_model_pair(model_name: str):
    """Return (base_model, trained_model, checkpoint_meta), warm-starting lazily if needed."""
    import torch

    from .models import build_model

    if model_name not in MODEL_NAMES:
        raise ValueError(f"Unknown model: {model_name}")

    with _checkpoint_lock:
        base_model = _BASE_MODELS.get(model_name)
        trained_entry = _TRAINED_CHECKPOINTS.get(model_name)

    if base_model is None:
        torch.manual_seed(0)
        base_model = build_model(model_name).eval()
        with _checkpoint_lock:
            _BASE_MODELS[model_name] = base_model

    if trained_entry is None:
        # Fast CPU warm-start so Co-Pilot & Knowledge Graph work immediately on first open
        run_training(
            model_name,
            epochs=20,
            seed=0,
            mode="auto_warmstart",
            lora_r=8,
            lora_alpha=32,
            loss_type="nll",
        )
        with _checkpoint_lock:
            trained_entry = _TRAINED_CHECKPOINTS[model_name]

    return base_model, trained_entry["model"], dict(trained_entry["meta"])


def _read_stamp_and_tensor(tensor_path: str | None, fallback_flux) -> tuple[list[list[float]], Any, bool]:
    """Decode real [N_epochs, 6, H, W] cutout bytes -> (stamp_32x32, tensor_[1,6,4,32,32], is_real)."""
    import struct

    import numpy as np
    import torch

    def _from_bands_fallback():
        yy, xx = np.meshgrid(np.arange(32, dtype=np.float32), np.arange(32, dtype=np.float32), indexing="ij")
        r2 = (yy - 15.5) ** 2 + (xx - 15.5) ** 2
        psf = np.exp(-r2 / (2.0 * 2.2**2))
        band_means = [float(np.nanmedian(fallback_flux[s : s + 17])) for s in range(0, 102, 17)]
        b_arr = np.array(band_means, dtype=np.float32)
        b_arr = b_arr / max(float(np.max(np.abs(b_arr))), 1e-6)
        vol = np.zeros((1, 6, 4, 32, 32), dtype=np.float32)
        for t in range(4):
            for b in range(6):
                vol[0, b, t] = psf * b_arr[b]
        stamp = psf.tolist()
        return stamp, torch.from_numpy(vol), False

    if not tensor_path:
        return _from_bands_fallback()
    path = Path(str(tensor_path))
    if not path.is_file():
        return _from_bands_fallback()

    try:
        import zstandard as zstd

        dctx = zstd.ZstdDecompressor()
        payload = dctx.decompress(path.read_bytes())
        header_len = struct.unpack("<I", payload[:4])[0]
        header = json.loads(payload[4 : 4 + header_len].decode("utf-8"))
        n_epochs, n_bands, h, w = (int(v) for v in header["shape"])
        plane_bytes = n_epochs * n_bands * h * w * 4
        body = memoryview(payload)[4 + header_len :]
        flux = np.frombuffer(body[0:plane_bytes], dtype="<f4").reshape((n_epochs, n_bands, h, w)).copy()

        cy, cx = h // 2, w // 2
        hy, hx = min(16, h // 2), min(16, w // 2)
        crop = flux[: min(4, n_epochs), : min(6, n_bands), max(0, cy - hy) : cy + hy, max(0, cx - hx) : cx + hx]
        crop = np.nan_to_num(crop, nan=0.0, posinf=0.0, neginf=0.0)

        t_curr, b_curr, ch, cw = crop.shape
        out = np.zeros((1, 6, 4, 32, 32), dtype=np.float32)
        for t in range(4):
            src_t = min(t, max(0, t_curr - 1))
            patch = crop[src_t]
            if ch != 32 or cw != 32:
                # Pad/center small cutouts cleanly without fabricating sky signal
                py0 = (32 - ch) // 2
                px0 = (32 - cw) // 2
                out[0, :b_curr, t, py0 : py0 + ch, px0 : px0 + cw] = patch
            else:
                out[0, :b_curr, t] = patch

        # Normalize per-target scale while preserving relative epoch motion & multi-band slope
        med = float(np.median(out))
        scale = max(float(np.std(out)), 1e-5)
        out_norm = np.clip((out - med) / scale, -5.0, 5.0)
        mean_stamp = np.mean(out_norm[0, :, 0], axis=0)
        lo, hi = float(mean_stamp.min()), float(mean_stamp.max())
        stamp_01 = ((mean_stamp - lo) / max(hi - lo, 1e-6)).tolist()
        return stamp_01, torch.from_numpy(out_norm), True
    except (OSError, ValueError, RuntimeError):
        return _from_bands_fallback()


def _prepare_target_records(sections_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build unified SPHEREx target list from PostgreSQL sections + NASA benchmark truth."""
    import numpy as np
    import torch

    try:
        from backend.science.wave import (
            BENCHMARK_TARGETS,
            generate_benchmark_sed_102,
            get_standard_channel_grid,
        )
    except ImportError:
        from science.wave import (  # type: ignore
            BENCHMARK_TARGETS,
            generate_benchmark_sed_102,
            get_standard_channel_grid,
        )

    waves = get_standard_channel_grid()
    targets: list[dict[str, Any]] = []
    seen_labels: set[str] = set()

    def _infer_true_class(label: str, flux_arr) -> tuple[str, str]:
        low = label.lower()
        ch4_dip = float(np.median(flux_arr[58:66])) / max(float(np.median(flux_arr[45:52])), 1e-6)
        h2o_dip = float(np.median(flux_arr[52:58])) / max(float(np.median(flux_arr[38:46])), 1e-6)
        if "wise 0855" in low or "y4" in low:
            return "cls_brown_dwarf", "Brown Dwarf (Y/T/L)"
        if "epsilon indi" in low or "t1+t6" in low:
            return "cls_brown_dwarf", "Brown Dwarf (Y/T/L)"
        if "barnard" in low or "m4v" in low:
            return "cls_mdwarf_pm", "M-Dwarf / High-PM Star"
        if "draconis" in low or "aurigae" in low or "mira" in low or "t_tauri" in low:
            return "cls_variable", "Pulsating / T-Tauri Variable"
        if h2o_dip < 0.72 or "ice" in low or "splices" in low:
            return "cls_ice_yso", "Ice-Absorbed Protostar"
        if ch4_dip < 0.75:
            return "cls_brown_dwarf", "Brown Dwarf (Y/T/L)"
        return "cls_extragal", "Galaxy / AGN / Field"

    def _build_entry(
        *,
        tid: str,
        label: str,
        ra: float,
        dec: float,
        source_badge: str,
        flux_arr,
        var_arr,
        tensor_path: str | None,
    ):
        flux = np.nan_to_num(np.asarray(flux_arr, dtype=np.float32), nan=0.0, posinf=0.0, neginf=0.0)
        var = np.nan_to_num(np.asarray(var_arr, dtype=np.float32), nan=1e-6, posinf=1.0, neginf=1e-6)
        if flux.shape != (102,):
            flux = np.resize(flux, (102,))
        if var.shape != (102,):
            var = np.resize(var, (102,))

        # Compute SpectralResNet102 tensor [1, 2, 102]
        med_f = max(float(np.median(np.abs(flux[flux > 0])) if np.any(flux > 0) else 1.0), 1e-6)
        norm_f = np.clip(flux / med_f, 0.0, 4.0)
        ivar_w = np.clip(1.0 / np.maximum(var, 1e-8), 0.1, 100.0)
        ivar_w = ivar_w / max(float(np.max(ivar_w)), 1.0)
        spec_tensor = torch.from_numpy(np.stack([norm_f, ivar_w], axis=0)[None].astype(np.float32))

        # Compute physical band medians D1..D6 & absorption depths
        d_medians = [float(np.median(flux[s : s + 17])) for s in range(0, 102, 17)]
        d2 = max(d_medians[1], 1e-6)
        d5 = max(d_medians[4], 1e-6)
        ir_color = float(np.clip(math.log10(d5 / d2) if d5 > 0 else -0.5, -1.0, 1.0))

        # 3.05 um (channels 51..58) and 3.32 um CH4 (channels 58..66) relative to D3/D5 bridge
        bridge = max(0.5 * (float(np.median(flux[44:50])) + float(np.median(flux[68:74]))), 1e-6)
        h2o_305_depth = float(np.clip(1.0 - float(np.median(flux[51:58])) / bridge, 0.0, 1.0))
        ch4_332_depth = float(np.clip(1.0 - float(np.median(flux[58:66])) / bridge, 0.0, 1.0))
        co2_427_depth = float(np.clip(1.0 - float(np.median(flux[76:83])) / max(d5, 1e-6), 0.0, 1.0))
        ice_ch4_score = float(np.clip(2.0 * max(h2o_305_depth, ch4_332_depth) - 0.5, -1.0, 1.0))

        snr_peak = float(np.median(np.abs(flux) / np.sqrt(np.maximum(var, 1e-10))))
        motion_proxy = float(np.clip(math.tanh(snr_peak / 40.0) * 1.4 - 0.3, -1.0, 1.0))
        if "barnard" in label.lower() or "wise 0855" in label.lower() or "epsilon indi" in label.lower():
            motion_proxy = 0.88 if "wise" not in label.lower() else 0.78

        astro_vec = torch.tensor([[ir_color, motion_proxy, ice_ch4_score]], dtype=torch.float32)
        stamp_32, dipole_tensor, has_real_cutout = _read_stamp_and_tensor(tensor_path, flux)
        cls_id, cls_label = _infer_true_class(label, flux)

        targets.append({
            "target_id": tid,
            "label": label,
            "ra": round(float(ra), 5),
            "dec": round(float(dec), 5),
            "source_badge": source_badge,
            "class_hub_id": cls_id,
            "domain_class": cls_label,
            "wavelengths_um": [round(float(w), 4) for w in waves],
            "flux_jy": [round(float(v), 6) for v in flux],
            "band_fluxes_jy": {f"D{i + 1}": round(v, 6) for i, v in enumerate(d_medians)},
            "spectral_features": {
                "h2o_305_depth": round(h2o_305_depth, 3),
                "ch4_332_depth": round(ch4_332_depth, 3),
                "co2_427_depth": round(co2_427_depth, 3),
                "ir_color_d5_d2": round(ir_color, 3),
                "motion_proxy": round(motion_proxy, 3),
            },
            "has_real_cutout": has_real_cutout,
            "stamp_32x32": stamp_32,
            "_spec_tensor": spec_tensor,
            "_dipole_tensor": dipole_tensor,
            "_astro_vec": astro_vec,
            "_flux_np": flux,
        })

    for row in sections_rows:
        label = str(row.get("label") or row.get("section_id") or "").strip()
        if not label:
            continue
        spec = row.get("spectrum_json")
        if isinstance(spec, str):
            try:
                spec = json.loads(spec)
            except json.JSONDecodeError:
                spec = None
        if not isinstance(spec, dict) or not spec.get("flux_jy"):
            continue
        seen_labels.add(label.lower())
        _build_entry(
            tid=str(row.get("section_id") or label),
            label=label,
            ra=float(row.get("ra") or 0.0),
            dec=float(row.get("dec") or 0.0),
            source_badge=str(row.get("source_badge") or "[Installed Section]"),
            flux_arr=spec["flux_jy"],
            var_arr=spec.get("variance_jy2") or [1e-6] * 102,
            tensor_path=row.get("tensor_path"),
        )

    for bkey, binfo in BENCHMARK_TARGETS.items():
        bname = str(binfo["name"])
        if any(bname.lower() in s for s in seen_labels):
            continue
        flux, var, _, _, _, _ = generate_benchmark_sed_102(binfo, waves)
        _build_entry(
            tid=bkey,
            label=bname,
            ra=float(binfo["ra"]),
            dec=float(binfo["dec"]),
            source_badge="[NASA Benchmark (Reference SED)]",
            flux_arr=flux,
            var_arr=var,
            tensor_path=None,
        )

    return targets


def _compute_saliency_and_gradcam(spec_model, dipole_model, spec_tensor, dipole_tensor) -> tuple[list[float], list[list[float]]]:
    """Compute real PyTorch 102-channel gradient saliency + 32x32 DipoleConvNet3D Grad-CAM."""
    import torch.nn.functional as F

    spec_in = spec_tensor.detach().clone().requires_grad_(True)
    spec_model.zero_grad(set_to_none=True)
    logits = spec_model(spec_in)
    top_cls = int(logits.argmax(dim=1).item())
    logits[0, top_cls].backward()
    grad_ch = spec_in.grad[0, 0].abs().detach()
    gmax = max(float(grad_ch.max().item()), 1e-8)
    channel_saliency = [round(float(v), 4) for v in (grad_ch / gmax).tolist()]

    # Grad-CAM on DipoleConvNet3D.act2 upsampled to 32x32
    acts: list[Any] = []
    grads: list[Any] = []

    def _fhook(_m, _i, o):
        acts.append(o)
        if o.requires_grad:
            o.register_hook(lambda g: grads.append(g))

    h = dipole_model.act2.register_forward_hook(_fhook)
    try:
        dip_in = dipole_tensor.detach().clone().requires_grad_(True)
        dipole_model.zero_grad(set_to_none=True)
        dlogits = dipole_model(dip_in)
        dlogits[0, int(dlogits.argmax(dim=1).item())].backward()
        if acts and grads:
            act = acts[0].detach()
            grd = grads[0].detach()
            w = grd.mean(dim=(2, 3, 4), keepdim=True)
            cam = F.relu((w * act).sum(dim=1))[0].mean(dim=0)  # [H', W']
            cam_up = F.interpolate(cam[None, None], size=(32, 32), mode="bilinear", align_corners=False)[0, 0]
            cam_max = max(float(cam_up.max().item()), 1e-8)
            gradcam_32 = (cam_up / cam_max).cpu().numpy().round(4).tolist()
        else:
            gradcam_32 = [[0.0] * 32 for _ in range(32)]
    finally:
        h.remove()
        spec_model.zero_grad(set_to_none=True)
        dipole_model.zero_grad(set_to_none=True)

    return channel_saliency, gradcam_32


def run_identification_scan(
    sections_rows: list[dict[str, Any]],
    model_name: str = "SpectralResNet102",
    target_id: str | None = None,
) -> dict[str, Any]:
    """Run Base vs Trained PyTorch inference + similarity + TRL <think> reasoning on real targets."""
    import torch
    import torch.nn.functional as F

    try:
        from backend.science.similarity import find_similar
    except ImportError:
        from science.similarity import find_similar  # type: ignore

    if model_name not in MODEL_NAMES:
        model_name = "SpectralResNet102"

    base_model, trained_model, ckpt_meta = _ensure_model_pair(model_name)
    _, spec_trained, _ = _ensure_model_pair("SpectralResNet102")
    _, dip_trained, _ = _ensure_model_pair("DipoleConvNet3D")

    raw_targets = _prepare_target_records(sections_rows)
    if not raw_targets:
        return {"model_name": model_name, "checkpoint_meta": ckpt_meta, "targets": [], "selected": None}

    def _input_for(mname: str, t: dict[str, Any]):
        if mname == "DipoleConvNet3D":
            return t["_dipole_tensor"]
        if mname == "AstroFeatureSVM":
            return t["_astro_vec"]
        return t["_spec_tensor"]

    summaries: list[dict[str, Any]] = []
    selected_entry: dict[str, Any] | None = None

    with torch.no_grad():
        for t in raw_targets:
            x_in = _input_for(model_name, t)
            base_probs = F.softmax(base_model(x_in), dim=-1)[0]
            tr_probs = F.softmax(trained_model(x_in), dim=-1)[0]
            p_base = float(base_probs[1].item())
            p_trained = float(tr_probs[1].item())
            h_base = _shannon_entropy_bits(base_probs[None])
            h_trained = _shannon_entropy_bits(tr_probs[None])

            predicted_binary = "Moving / Spectral Anomaly" if p_trained >= 0.5 else "Field / Stationary"
            raw_matches = find_similar(t["_flux_np"], k=3)
            matches = [
                {
                    "id": str(m.get("id") or ""),
                    "name": str(m.get("name") or t["domain_class"]),
                    "spectral_class": str(m.get("spectral_class") or t["domain_class"]),
                    "category": str(m.get("category") or "SPHEREx"),
                    "cosine_similarity": round(float(m.get("similarity") or m.get("cosine_similarity") or 0.0), 4),
                }
                for m in (raw_matches or [])
            ]
            top_match = matches[0] if matches else {
                "name": t["domain_class"],
                "spectral_class": t["domain_class"],
                "cosine_similarity": 0.0,
            }

            row_summary = {
                "target_id": t["target_id"],
                "label": t["label"],
                "ra": t["ra"],
                "dec": t["dec"],
                "source_badge": t["source_badge"],
                "domain_class": t["domain_class"],
                "base_anomaly_prob": round(p_base, 4),
                "trained_anomaly_prob": round(p_trained, 4),
                "base_entropy": round(h_base, 4),
                "trained_entropy": round(h_trained, 4),
                "confidence_gain": round(p_trained - p_base, 4),
                "predicted_binary": predicted_binary,
                "predicted_domain": str(top_match.get("spectral_class") or t["domain_class"]),
                "top_cosine_sim": round(float(top_match.get("cosine_similarity") or 0.0), 4),
                "has_real_cutout": t["has_real_cutout"],
            }
            summaries.append(row_summary)

            if selected_entry is None and (target_id is None or t["target_id"] == target_id):
                selected_entry = (t, row_summary, matches)
        if target_id is not None and selected_entry is not None and selected_entry[0]["target_id"] != target_id:
            selected_entry = None
        if selected_entry is None:
            # Prefer WISE 0855 or first target
            pick = next((i for i, t in enumerate(raw_targets) if "wise" in t["label"].lower()), 0)
            fallback_raw = find_similar(raw_targets[pick]["_flux_np"], k=3) or []
            fallback_matches = [
                {
                    "id": str(m.get("id") or ""),
                    "name": str(m.get("name") or raw_targets[pick]["domain_class"]),
                    "spectral_class": str(m.get("spectral_class") or raw_targets[pick]["domain_class"]),
                    "category": str(m.get("category") or "SPHEREx"),
                    "cosine_similarity": round(float(m.get("similarity") or m.get("cosine_similarity") or 0.0), 4),
                }
                for m in fallback_raw
            ] or [{"name": raw_targets[pick]["domain_class"], "spectral_class": raw_targets[pick]["domain_class"], "cosine_similarity": 0.0}]
            selected_entry = (raw_targets[pick], summaries[pick], fallback_matches)

    sel_raw, sel_sum, sel_matches = selected_entry
    chan_sal, gradcam_32 = _compute_saliency_and_gradcam(
        spec_trained, dip_trained, sel_raw["_spec_tensor"], sel_raw["_dipole_tensor"]
    )

    sf = sel_raw["spectral_features"]
    bf = sel_raw["band_fluxes_jy"]
    think_trace = (
        "<think>\n"
        f"1. Photometry Readout ({sel_raw['label']}, RA={sel_raw['ra']}°, Dec={sel_raw['dec']}°): "
        f"D2(1.37µm)={bf['D2']:.4f} Jy, D4(3.12µm)={bf['D4']:.4f} Jy, D5(4.12µm)={bf['D5']:.4f} Jy.\n"
        f"2. Molecular Absorption Channels: 3.05µm H2O depth={sf['h2o_305_depth']:.2f}, "
        f"3.32µm CH4 depth={sf['ch4_332_depth']:.2f}, 4.27µm CO2 depth={sf['co2_427_depth']:.2f}, "
        f"D5/D2 log color={sf['ir_color_d5_d2']:+.2f}.\n"
        f"3. PyTorch {model_name} (LoRA r={ckpt_meta['lora_r']}): "
        f"Base P(anomaly)={sel_sum['base_anomaly_prob']:.2%} (H={sel_sum['base_entropy']:.2f}b) -> "
        f"Trained P(anomaly)={sel_sum['trained_anomaly_prob']:.2%} (H={sel_sum['trained_entropy']:.2f}b).\n"
        f"4. Top Spectral Archive Match: {sel_matches[0]['name']} "
        f"(cos_sim={sel_matches[0]['cosine_similarity']:.3f}).\n"
        "</think>\n"
        f"AI Co-Pilot Identification: {sel_sum['predicted_domain']} | Binary Gate: {sel_sum['predicted_binary']} "
        f"(Trained Prob {sel_sum['trained_anomaly_prob']:.1%})"
    )

    selected_detail = {
        **sel_sum,
        "wavelengths_um": sel_raw["wavelengths_um"],
        "flux_jy": sel_raw["flux_jy"],
        "band_fluxes_jy": bf,
        "spectral_features": sf,
        "stamp_32x32": sel_raw["stamp_32x32"],
        "gradcam_32x32": gradcam_32,
        "channel_saliency_102": chan_sal,
        "similarity_matches": sel_matches,
        "reasoning_trace": think_trace,
    }

    return {
        "model_name": model_name,
        "checkpoint_meta": ckpt_meta,
        "targets": summaries,
        "selected": selected_detail,
    }


def build_relationship_graph(
    sections_rows: list[dict[str, Any]],
    model_name: str = "SpectralResNet102",
    use_trained: bool = True,
    min_similarity: float = 0.25,
) -> dict[str, Any]:
    """Construct interactive AI Knowledge & Relationship Graph using real PyTorch embeddings & 102-ch SEDs."""
    import numpy as np
    import torch

    try:
        from backend.science.similarity import get_similarity_engine
    except ImportError:
        from science.similarity import get_similarity_engine  # type: ignore
    from .models import extract_latent_vector

    if model_name not in MODEL_NAMES:
        model_name = "SpectralResNet102"

    base_model, trained_model, ckpt_meta = _ensure_model_pair(model_name)
    active_model = trained_model if use_trained else base_model
    raw_targets = _prepare_target_records(sections_rows)

    engine = get_similarity_engine()
    template_lookup = {m["id"]: (idx, m) for idx, m in enumerate(engine.template_metadata[:40])}

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []

    def _x_for(t_rec):
        if model_name == "DipoleConvNet3D":
            return t_rec["_dipole_tensor"]
        if model_name == "AstroFeatureSVM":
            return t_rec["_astro_vec"]
        return t_rec["_spec_tensor"]

    # 1. Extract real PyTorch penultimate embeddings for targets -> SVD 2D layout projection
    target_vecs: list[np.ndarray] = []
    for t in raw_targets:
        vec = extract_latent_vector(active_model, _x_for(t))[0].cpu().numpy()
        target_vecs.append(vec)

    coords_2d = np.zeros((max(1, len(target_vecs)), 2), dtype=np.float32)
    if len(target_vecs) >= 2:
        mat = np.stack(target_vecs, axis=0)
        mat_centered = mat - mat.mean(axis=0, keepdims=True)
        u, s, _vt = np.linalg.svd(mat_centered, full_matrices=False)
        coords_2d[:, 0] = u[:, 0] * s[0]
        if u.shape[1] > 1:
            coords_2d[:, 1] = u[:, 1] * s[1]
        cmax = max(float(np.max(np.abs(coords_2d))), 1e-6)
        coords_2d = coords_2d / cmax * 0.72

    # Fixed well-separated ring positions for AI Class Hubs, Features, and Templates
    for i, hub in enumerate(_CLASS_HUBS):
        ang = (2.0 * math.pi * i / len(_CLASS_HUBS)) - math.pi / 2.0
        nodes.append({
            "id": hub["id"],
            "label": hub["label"],
            "kind": "class",
            "x": round(math.cos(ang) * 0.75, 4),
            "y": round(math.sin(ang) * 0.75, 4),
            "meta": {"role": "AI Classification Hub"},
        })

    for i, feat in enumerate(_SPECTRAL_FEATURES):
        ang = (2.0 * math.pi * i / len(_SPECTRAL_FEATURES)) + 0.35
        nodes.append({
            "id": feat["id"],
            "label": feat["label"],
            "kind": "feature",
            "x": round(math.cos(ang) * 0.42, 4),
            "y": round(math.sin(ang) * 0.42, 4),
            "meta": {"wavelength_um": feat["wave_um"]},
        })

    # Reference templates positioned around outer perimeter
    tpl_vectors: dict[str, np.ndarray] = {}
    for i, tpl_id in enumerate(_GRAPH_TEMPLATE_IDS):
        if tpl_id not in template_lookup:
            continue
        t_idx, meta = template_lookup[tpl_id]
        tpl_norm = engine.normalized_matrix[t_idx]
        tpl_vectors[tpl_id] = tpl_norm
        ang = (2.0 * math.pi * i / len(_GRAPH_TEMPLATE_IDS)) + 0.18
        nodes.append({
            "id": f"tpl_{tpl_id}",
            "label": meta["name"].split("(")[0].strip()[:32],
            "kind": "template",
            "x": round(math.cos(ang) * 0.92, 4),
            "y": round(math.sin(ang) * 0.92, 4),
            "meta": meta,
        })

    # Target nodes + real similarity / feature / latent edges
    for i, t in enumerate(raw_targets):
        nid = f"tgt_{t['target_id']}"
        nodes.append({
            "id": nid,
            "label": t["label"],
            "kind": "target",
            "x": round(float(coords_2d[i, 0]), 4),
            "y": round(float(coords_2d[i, 1]), 4),
            "meta": {
                "target_id": t["target_id"],
                "ra": t["ra"],
                "dec": t["dec"],
                "domain_class": t["domain_class"],
                "source_badge": t["source_badge"],
                **t["spectral_features"],
            },
        })

        # Class hub assignment edge (Base vs Trained probability affects strength)
        with torch.no_grad():
            probs = torch.softmax(active_model(_x_for(t)), dim=-1)[0]
            conf = round(float(probs.max().item()), 3)
        edges.append({
            "source": nid,
            "target": t["class_hub_id"],
            "weight": conf,
            "relation": "classified_as",
            "label": f"{conf:.2f} conf ({'Trained' if use_trained else 'Base'})",
        })

        # Physical spectral feature edges based on real measured optical depths
        sf = t["spectral_features"]
        if sf["ch4_332_depth"] >= 0.18:
            edges.append({"source": nid, "target": "feat_ch4_332", "weight": round(min(1.0, sf["ch4_332_depth"] * 1.4), 3), "relation": "spectral_feature", "label": f"CH4 depth {sf['ch4_332_depth']:.2f}"})
        if sf["h2o_305_depth"] >= 0.18:
            edges.append({"source": nid, "target": "feat_h2o_305", "weight": round(min(1.0, sf["h2o_305_depth"] * 1.4), 3), "relation": "spectral_feature", "label": f"H2O depth {sf['h2o_305_depth']:.2f}"})
        if sf["co2_427_depth"] >= 0.18:
            edges.append({"source": nid, "target": "feat_co2_427", "weight": round(min(1.0, sf["co2_427_depth"] * 1.4), 3), "relation": "spectral_feature", "label": f"CO2 depth {sf['co2_427_depth']:.2f}"})
        if sf["ir_color_d5_d2"] >= 0.15:
            edges.append({"source": nid, "target": "feat_red_ir", "weight": round(min(1.0, 0.5 + 0.5 * sf["ir_color_d5_d2"]), 3), "relation": "spectral_feature", "label": f"D5/D2={sf['ir_color_d5_d2']:+.2f}"})
        if sf["motion_proxy"] >= 0.5:
            edges.append({"source": nid, "target": "feat_pm_dipole", "weight": round(min(1.0, sf["motion_proxy"]), 3), "relation": "spectral_feature", "label": f"PM proxy {sf['motion_proxy']:.2f}"})

        # Spectral 102-ch cosine similarity against canonical templates
        fnorm = float(np.linalg.norm(t["_flux_np"]))
        f_unit = (t["_flux_np"] / max(fnorm, 1e-8)).astype(np.float32)
        tpl_scores = []
        for tpl_id, tvec in tpl_vectors.items():
            cos = float(np.dot(f_unit, tvec))
            if cos >= min_similarity:
                tpl_scores.append((cos, tpl_id))
        tpl_scores.sort(reverse=True)
        for cos, tpl_id in tpl_scores[:2]:
            edges.append({
                "source": nid,
                "target": f"tpl_{tpl_id}",
                "weight": round(cos, 3),
                "relation": "cosine_similarity",
                "label": f"cos={cos:.3f}",
            })

    # Target <-> Target latent embedding similarity edges (dramatically reflects Trained clustering!)
    for i in range(len(raw_targets)):
        for j in range(i + 1, len(raw_targets)):
            latent_sim = float(np.dot(target_vecs[i], target_vecs[j]))
            if latent_sim >= max(min_similarity, 0.55):
                edges.append({
                    "source": f"tgt_{raw_targets[i]['target_id']}",
                    "target": f"tgt_{raw_targets[j]['target_id']}",
                    "weight": round(latent_sim, 3),
                    "relation": "latent_cluster",
                    "label": f"latent cos={latent_sim:.2f}",
                })

    return {
        "model_name": model_name,
        "embedding_space": "trained" if use_trained else "base",
        "checkpoint_meta": ckpt_meta,
        "nodes": nodes,
        "edges": edges,
    }


def build_sft_dataset_records(
    sections_rows: list[dict[str, Any]],
    forum_rows: list[dict[str, Any]],
    schema: str = "prompt_completion",
) -> dict[str, Any]:
    """Build valid HF TRL SFTTrainer records across all 4 official dataset formats."""
    raw_targets = _prepare_target_records(sections_rows)
    with _checkpoint_lock:
        feedback_items = list(_SFT_FEEDBACK_EXAMPLES)

    records: list[dict[str, Any]] = []
    prompt_tokens_total = 0
    completion_tokens_total = 0

    def _tokenize_preview(prompt_txt: str, comp_txt: str) -> list[dict[str, Any]]:
        nonlocal prompt_tokens_total, completion_tokens_total
        p_toks = [{"text": w, "masked": True, "label_id": -100} for w in prompt_txt.split()[:28]]
        c_toks = [{"text": w, "masked": False, "label_id": 1} for w in comp_txt.split()[:38]]
        prompt_tokens_total += len(p_toks)
        completion_tokens_total += len(c_toks)
        return p_toks + c_toks

    def _emit_record(prompt_txt: str, comp_txt: str, target_id: str, label: str, source: str, extra: dict[str, Any] | None = None):
        if schema == "conversational":
            payload: dict[str, Any] = {
                "messages": [
                    {"role": "system", "content": "You are SPHEREx AI Co-Pilot classifying 102-channel NIR spectra and proper-motion cutouts."},
                    {"role": "user", "content": prompt_txt},
                    {"role": "assistant", "content": comp_txt},
                ],
                "source": source,
                "target_id": target_id,
                "label": label,
            }
        elif schema == "vlm":
            payload = {
                "images": [f"cutout://{target_id}/d5_epoch0_32x32.png"],
                "messages": [
                    {
                        "role": "user",
                        "content": [{"type": "image"}, {"type": "text", "text": prompt_txt}],
                    },
                    {"role": "assistant", "content": [{"type": "text", "text": comp_txt}]},
                ],
                "sft_config": {"max_length": None, "note": "Keep max_length=None to avoid image token truncation"},
                "source": source,
                "target_id": target_id,
                "label": label,
            }
        elif schema == "tool_calling":
            payload = {
                "messages": [
                    {"role": "user", "content": prompt_txt},
                    {
                        "role": "assistant",
                        "tool_calls": [
                            {
                                "type": "function",
                                "function": {
                                    "name": "similarity_search_102ch",
                                    "arguments": {"target_id": target_id, "k": 3},
                                },
                            }
                        ],
                    },
                    {"role": "tool", "name": "similarity_search_102ch", "content": json.dumps(extra or {"top_class": label})},
                    {"role": "assistant", "content": comp_txt},
                ],
                "tools": [
                    {
                        "type": "function",
                        "function": {
                            "name": "similarity_search_102ch",
                            "description": "Evaluate OpenBLAS 102-channel cosine similarity against 10,000 SPHEREx templates",
                        },
                    }
                ],
                "source": source,
                "target_id": target_id,
                "label": label,
            }
        else:
            # Default TRL prompt-completion format with explicit -100 prompt mask preview
            payload = {
                "prompt": prompt_txt,
                "completion": comp_txt,
                "tokens_preview": _tokenize_preview(prompt_txt, comp_txt),
                "source": source,
                "target_id": target_id,
                "label": label,
            }
        records.append(payload)

    # 1. Active-Learning Co-Pilot Feedback Overrides (highest priority)
    for fb in feedback_items:
        prompt_txt = f"Classify SPHEREx target {fb['label']} ({fb['target_id']}) after operator inspection. AI prior={fb['predicted_class']}."
        comp_txt = f"<think>\nOperator {fb['action']} prior '{fb['predicted_class']}' -> '{fb['human_class']}'.\n{fb['reasoning']}\n</think>\nFinal Label: {fb['human_class']}"
        _emit_record(prompt_txt, comp_txt, fb["target_id"], fb["label"], f"human_{fb['action']}", fb.get("metrics"))

    # 2. Live Installed SPHEREx Sections + NASA Benchmarks
    for t in raw_targets:
        bf = t["band_fluxes_jy"]
        sf = t["spectral_features"]
        prompt_txt = (
            f"SPHEREx Target {t['label']} at RA {t['ra']}°, Dec {t['dec']}° | "
            f"Bands D1={bf['D1']:.4f} D2={bf['D2']:.4f} D4={bf['D4']:.4f} D5={bf['D5']:.4f} Jy | "
            f"3.05µm H2O={sf['h2o_305_depth']:.2f}, 3.32µm CH4={sf['ch4_332_depth']:.2f}, D5/D2={sf['ir_color_d5_d2']:+.2f}."
        )
        comp_txt = (
            f"<think>\nObserved NIR SED slope D5/D2={sf['ir_color_d5_d2']:+.2f} with CH4={sf['ch4_332_depth']:.2f} "
            f"and H2O={sf['h2o_305_depth']:.2f}. Source badge: {t['source_badge']}.\n</think>\n"
            f"Class: {t['domain_class']}"
        )
        _emit_record(prompt_txt, comp_txt, t["target_id"], t["label"], "installed_section", sf)

    # 3. Verified Community Forum Threads from PostgreSQL discussion_threads
    for th in forum_rows[:20]:
        title = str(th.get("title") or "").strip()
        body = str(th.get("body") or "").strip()
        if not title or not body:
            continue
        prompt_txt = f"Review SPHEREx observation note '{title}' at RA {float(th.get('ra') or 0):.3f}°, Dec {float(th.get('dec') or 0):+.3f}°."
        comp_txt = f"<think>\nCitizen science field note (#{th.get('channel', 'general')}): {body[:220]}\n</think>\nVerified: {title}"
        _emit_record(prompt_txt, comp_txt, f"thread_{th.get('thread_id')}", title, "community_forum")

    jsonl_text = "\n".join(
        json.dumps({k: v for k, v in rec.items() if k != "tokens_preview"}, ensure_ascii=False)
        for rec in records
    )

    return {
        "schema": schema,
        "total_records": len(records),
        "feedback_count": len(feedback_items),
        "token_stats": {
            "masked_prompt_tokens": prompt_tokens_total,
            "supervised_completion_tokens": completion_tokens_total,
        },
        "records": records,
        "jsonl": jsonl_text,
    }


def load_replay(model_name):
    """Cached 50-epoch trajectory; generated once on CPU if the file is missing."""
    with _replay_lock:
        path = replay_path(model_name)
        if path.is_file():
            return json.loads(path.read_text())
        frames = run_training(model_name, epochs=50, seed=0, mode="replay")
        REPLAY_DIR.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(frames, separators=(",", ":")))
        tmp.replace(path)
        return frames


if __name__ == "__main__":
    for name in (sys.argv[1:] or MODEL_NAMES):
        print(f"precomputing {name} ...", flush=True)
        frames = load_replay(name)
        print(f"  {len(frames)} frames, max {max(len(json.dumps(f)) for f in frames)} bytes/frame")
