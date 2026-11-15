"""Admin telemetry hub: WS /api/admin/ws/training, SFT Studio, Knowledge Graph & Co-Pilot.

Top-level imports are stdlib + FastAPI only. torch/sklearn load lazily, inside
backend/ml, the first time an /admin route actually needs them.
"""
import asyncio
import hmac
import json
import os
import sys
import threading
from collections import deque
from typing import Any

from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from pydantic import BaseModel, Field

try:
    from .ml import MODEL_NAMES, RING_SIZE
except ImportError:  # running with backend/ on sys.path
    from ml import MODEL_NAMES, RING_SIZE

router = APIRouter(prefix="/api/admin")
_training_lock = threading.Lock()
_tasks: set = set()


def _ml_trainer():
    try:
        from .ml import trainer
    except ImportError:
        from ml import trainer
    return trainer


def _ml_studio():
    try:
        from .ml import studio
    except ImportError:
        from ml import studio
    return studio


def _sections_api():
    try:
        from .api import sections as sec_api
    except ImportError:
        from api import sections as sec_api
    return sec_api


def _studio_write_status() -> dict[str, bool]:
    # Demo mode: interactive AI Studio writes are open without an admin token lock.
    # Re-enable ADMIN_MUTATIONS_ENABLED / ADMIN_TOKEN gating before production launch.
    return {"mutations_enabled": True, "requires_token": False, "studio_writable": True}


def require_studio_write(
    x_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
):
    """Demo mode: interactive studio writes are open (re-lock with ADMIN_TOKEN for production)."""
    _ = (x_admin_token, authorization)


def _replay_exists(model: str) -> bool:
    try:
        from .ml import replay_exists
    except ImportError:
        from ml import replay_exists
    return replay_exists(model)


def mutations_enabled() -> bool:
    return os.getenv("ADMIN_MUTATIONS_ENABLED", "false").strip().lower() == "true"


def require_admin(x_admin_token: str | None = Header(default=None), authorization: str | None = Header(default=None)):
    """403 unless mutations are enabled AND a valid ADMIN_TOKEN is supplied."""
    expected = os.getenv("ADMIN_TOKEN", "")
    supplied = x_admin_token or ""
    if not supplied and authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:]
    if not mutations_enabled() or not expected or not hmac.compare_digest(supplied.encode(), expected.encode()):
        raise HTTPException(status_code=403, detail="Forbidden")


class AdminTelemetryHub:
    """Per-model 100-frame ring buffers fanned out to WebSocket clients."""

    def __init__(self, size: int = RING_SIZE):
        self.size = size
        self._buffers: dict = {}
        self._clients: dict = {}
        self._seq = 0
        self._fill_lock = asyncio.Lock()

    def buffer(self, model: str) -> deque:
        return self._buffers.setdefault(model, deque(maxlen=self.size))

    def _append(self, model: str, frame: dict) -> str:
        self._seq += 1
        frame["seq"] = self._seq  # clients de-duplicate on seq
        self.buffer(model).append(frame)
        return json.dumps(frame, separators=(",", ":"))

    def reset(self, model: str):
        self.buffer(model).clear()

    async def connect(self, ws: WebSocket, model: str):
        await ws.accept()
        self._clients.setdefault(model, set()).add(ws)

    def disconnect(self, ws: WebSocket, model: str):
        self._clients.get(model, set()).discard(ws)

    async def send_status(self, ws: WebSocket, model: str, detail: str = "", mode_override: str | None = None):
        mode = mode_override or ("live" if _training_lock.locked() else "replay")
        await ws.send_text(json.dumps({
            "type": "status", "model": model, "mutations_enabled": mutations_enabled(),
            "mode": mode, "ring_size": self.size, "detail": detail,
        }))

    async def broadcast_status(self, model: str, detail: str = "", mode: str = "complete"):
        payload = json.dumps({
            "type": "status", "model": model, "mutations_enabled": mutations_enabled(),
            "mode": mode, "ring_size": self.size, "detail": detail,
        })
        for ws in list(self._clients.get(model, ())):
            try:
                await ws.send_text(payload)
            except Exception:  # noqa: BLE001
                self.disconnect(ws, model)

    async def ensure_replay(self, model: str, ws: WebSocket):
        """Fill an empty ring buffer from the pre-computed trajectory (CPU only)."""
        async with self._fill_lock:
            if self.buffer(model):
                return
            if not _replay_exists(model):
                await self.send_status(ws, model, "generating replay on CPU (first run only)")
            frames = await asyncio.to_thread(_ml_trainer().load_replay, model)
            for frame in frames[-self.size:]:
                self._append(model, dict(frame))

    async def replay(self, ws: WebSocket, model: str):
        for frame in list(self.buffer(model)):
            await ws.send_text(json.dumps(frame, separators=(",", ":")))

    async def publish(self, model: str, frame: dict):
        payload = self._append(model, frame)
        for ws in list(self._clients.get(model, ())):
            try:
                await ws.send_text(payload)
            except Exception:  # noqa: BLE001
                self.disconnect(ws, model)


hub = AdminTelemetryHub()


def _launch_training_job(
    model_name: str,
    epochs: int,
    seed: int = 0,
    mode: str = "live",
    **sft_kwargs: Any,
) -> None:
    """Acquire non-blocking lock, spawn background CPU training, stream frames to WS hub."""
    if model_name not in MODEL_NAMES:
        raise HTTPException(status_code=422, detail=f"model must be one of {list(MODEL_NAMES)}")
    if not _training_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Training already running")

    loop = asyncio.get_running_loop()
    hub.reset(model_name)

    async def _run():
        try:
            await hub.broadcast_status(model_name, detail="training started", mode="live")
            trainer = _ml_trainer()

            def on_frame(frame):
                asyncio.run_coroutine_threadsafe(hub.publish(model_name, frame), loop)

            await asyncio.to_thread(
                trainer.run_training,
                model_name,
                epochs,
                seed,
                mode,
                on_frame,
                **sft_kwargs,
            )
            await hub.broadcast_status(model_name, detail="training complete", mode="complete")
        except Exception as exc:  # noqa: BLE001
            await hub.publish(model_name, {"type": "error", "detail": str(exc)})
            await hub.broadcast_status(model_name, detail=str(exc), mode="error")
        finally:
            _training_lock.release()

    task = asyncio.create_task(_run())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _fetch_sections_and_forum(request: Request) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Read installed_sections and discussion_threads from app.state.db_pool if available."""
    pool = getattr(request.app.state, "db_pool", None)
    if pool is None or ("pytest" in sys.modules and not getattr(request.app.state, "use_real_db_in_test", False)):
        return [], []
    try:
        async with pool.acquire() as conn:
            sec_rows = await conn.fetch(
                """
                SELECT section_id, label, ra, dec, fov_arcsec, source_badge, tensor_path, spectrum_json
                FROM installed_sections
                WHERE status = 'ready'
                ORDER BY updated_at DESC
                LIMIT 32
                """
            )
            forum_rows = await conn.fetch(
                """
                SELECT thread_id, channel, title, body, ra, dec, upvotes
                FROM discussion_threads
                ORDER BY upvotes DESC, created_at DESC
                LIMIT 30
                """
            )
        return [dict(r) for r in sec_rows], [dict(r) for r in forum_rows]
    except Exception:  # noqa: BLE001
        return [], []


@router.websocket("/ws/training")
async def training_ws(ws: WebSocket, model: str = "DipoleConvNet3D"):
    if model not in MODEL_NAMES:
        await ws.close(code=1008)
        return
    await hub.connect(ws, model)
    try:
        await hub.send_status(ws, model)
        await hub.ensure_replay(model, ws)
        await hub.replay(ws, model)
        while True:
            raw_msg = (await ws.receive_text()).strip()
            if raw_msg == "replay":
                await hub.replay(ws, model)
            elif raw_msg.startswith("{"):
                try:
                    cmd = json.loads(raw_msg)
                except json.JSONDecodeError:
                    continue
                if cmd.get("action") == "train":
                    target_model = str(cmd.get("model") or model)
                    try:
                        _launch_training_job(
                            model_name=target_model,
                            epochs=max(1, min(100, int(cmd.get("epochs") or 25))),
                            seed=int(cmd.get("seed") or 0),
                            mode="studio",
                            learning_rate=cmd.get("learning_rate"),
                            batch_size=cmd.get("batch_size"),
                            lora_r=max(0, min(64, int(cmd.get("lora_r") or 8))),
                            lora_alpha=max(1, min(128, int(cmd.get("lora_alpha") or 32))),
                            lora_dropout=float(cmd.get("lora_dropout") or 0.05),
                            freeze_backbone=bool(cmd.get("freeze_backbone", False)),
                            loss_type=str(cmd.get("loss_type") or "nll"),
                            completion_only_loss=bool(cmd.get("completion_only_loss", True)),
                            packing=bool(cmd.get("packing", True)),
                            quantization_bits=int(cmd.get("quantization_bits") or 16),
                        )
                    except HTTPException as exc:
                        await ws.send_text(json.dumps({"type": "error", "detail": exc.detail}))
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(ws, model)


class RetrainRequest(BaseModel):
    model: str = "DipoleConvNet3D"
    epochs: int = Field(default=50, ge=1, le=200)
    seed: int = 0


@router.post("/retrain", status_code=202, dependencies=[Depends(require_admin)])
async def retrain(req: RetrainRequest):
    _launch_training_job(req.model, req.epochs, req.seed, "live")
    return {"status": "started", "model": req.model, "epochs": req.epochs}


class StudioTrainRequest(BaseModel):
    model: str = "SpectralResNet102"
    custom_name: str = Field(default="", max_length=80)
    epochs: int = Field(default=25, ge=1, le=100)
    seed: int = 0
    learning_rate: float | None = Field(default=None, gt=0.0, le=0.5)
    batch_size: int | None = Field(default=None, ge=8, le=128)
    lora_r: int = Field(default=8, ge=0, le=64)
    lora_alpha: int = Field(default=32, ge=1, le=128)
    lora_dropout: float = Field(default=0.05, ge=0.0, le=0.5)
    freeze_backbone: bool = False
    loss_type: str = Field(default="nll", pattern="^(nll|dft)$")
    completion_only_loss: bool = True
    packing: bool = True
    quantization_bits: int = Field(default=4, ge=4, le=32)


@router.get("/models")
async def list_models():
    """Return all Base Models + Trained LoRA/SFT Model Checkpoints with full architecture specs."""
    registry = await asyncio.to_thread(_ml_trainer().list_models_registry)
    return {**registry, "training_active": _training_lock.locked()}


class PromoteModelRequest(BaseModel):
    model_id: str = Field(..., min_length=3, max_length=120)


@router.post("/models/promote")
async def promote_model(req: PromoteModelRequest):
    """Promote a trained LoRA/SFT checkpoint in run history as the active identification endpoint."""
    try:
        registry = await asyncio.to_thread(_ml_trainer().promote_checkpoint, req.model_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {**registry, "promoted_model_id": req.model_id, "training_active": _training_lock.locked()}


@router.post("/studio/train", status_code=202)
async def studio_train(req: StudioTrainRequest):
    """Interactive PyTorch + LoRA SFT studio sandbox execution (streams to WS hub)."""
    _launch_training_job(
        req.model,
        req.epochs,
        req.seed,
        "studio",
        learning_rate=req.learning_rate,
        batch_size=req.batch_size,
        lora_r=req.lora_r,
        lora_alpha=req.lora_alpha,
        lora_dropout=req.lora_dropout,
        freeze_backbone=req.freeze_backbone,
        loss_type=req.loss_type,
        completion_only_loss=req.completion_only_loss,
        packing=req.packing,
        quantization_bits=req.quantization_bits,
        custom_name=req.custom_name or None,
    )
    return {
        "status": "started",
        "model": req.model,
        "epochs": req.epochs,
        "config": req.model_dump(),
    }


@router.get("/studio/frames")
async def studio_frames(model: str = Query("SpectralResNet102")):
    """HTTP fallback returning current hub ring buffer frames + checkpoint meta."""
    if model not in MODEL_NAMES:
        raise HTTPException(status_code=422, detail=f"model must be one of {list(MODEL_NAMES)}")
    frames = list(hub.buffer(model))
    if not frames and _replay_exists(model):
        replay_frames = await asyncio.to_thread(_ml_trainer().load_replay, model)
        for frame in replay_frames[-hub.size:]:
            hub._append(model, dict(frame))
        frames = list(hub.buffer(model))
    checkpoints = await asyncio.to_thread(_ml_trainer().get_checkpoint_summary)
    return {
        "model": model,
        "training_active": _training_lock.locked(),
        "frames": frames,
        "checkpoints": checkpoints,
    }


@router.get("/graph")
async def knowledge_graph(
    request: Request,
    model: str = Query("SpectralResNet102"),
    space: str = Query("trained", pattern="^(base|trained)$"),
    min_similarity: float = Query(0.25, ge=0.0, le=0.99),
):
    """AI Knowledge & Relationship Graph using real PyTorch Base/Trained embeddings + 102-ch SEDs."""
    if model not in MODEL_NAMES:
        raise HTTPException(status_code=422, detail=f"model must be one of {list(MODEL_NAMES)}")
    sec_rows, _ = await _fetch_sections_and_forum(request)
    trainer = _ml_trainer()
    return await asyncio.to_thread(
        trainer.build_relationship_graph,
        sec_rows,
        model_name=model,
        use_trained=(space == "trained"),
        min_similarity=min_similarity,
    )


@router.get("/identify")
async def identify_targets(
    request: Request,
    model: str = Query("SpectralResNet102"),
    target_id: str | None = Query(None),
):
    """Run Base vs Trained PyTorch identification + Grad-CAM + 102-ch saliency + <think> Co-Pilot."""
    if model not in MODEL_NAMES:
        raise HTTPException(status_code=422, detail=f"model must be one of {list(MODEL_NAMES)}")
    sec_rows, _ = await _fetch_sections_and_forum(request)
    trainer = _ml_trainer()
    return await asyncio.to_thread(
        trainer.run_identification_scan,
        sec_rows,
        model_name=model,
        target_id=target_id,
    )


@router.get("/sft-dataset")
async def sft_dataset(
    request: Request,
    schema: str = Query("prompt_completion", pattern="^(prompt_completion|conversational|vlm|tool_calling)$"),
):
    """Generate HF TRL SFTTrainer JSONL records from installed sections, forum notes, and Co-Pilot feedback."""
    sec_rows, forum_rows = await _fetch_sections_and_forum(request)
    trainer = _ml_trainer()
    return await asyncio.to_thread(
        trainer.build_sft_dataset_records,
        sec_rows,
        forum_rows,
        schema=schema,
    )


class FeedbackRequest(BaseModel):
    target_id: str = Field(..., min_length=1, max_length=120)
    label: str = Field(..., min_length=1, max_length=120)
    predicted_class: str = Field(..., min_length=1, max_length=120)
    human_class: str = Field(..., min_length=1, max_length=120)
    action: str = Field(default="confirmed", pattern="^(confirmed|overridden)$")
    reasoning: str = Field(default="", max_length=1500)
    metrics: dict[str, Any] = Field(default_factory=dict)


@router.post("/sft-dataset/feedback")
async def post_sft_feedback(body: FeedbackRequest):
    """Append operator Confirm/Override feedback into the SFT dataset buffer."""
    trainer = _ml_trainer()
    return await asyncio.to_thread(
        trainer.add_feedback_example,
        target_id=body.target_id,
        label=body.label,
        predicted_class=body.predicted_class,
        human_class=body.human_class,
        action=body.action,
        reasoning=body.reasoning,
        metrics=body.metrics,
    )


# ---------------------------------------------------------------------------
# Plain-English 6-Class Real Classifier Studio API (/admin/studio, /admin/review)
# ---------------------------------------------------------------------------
_studio_job_lock = threading.Lock()
_studio_live_frames: list[dict[str, Any]] = []
_studio_live_status: dict[str, Any] = {"running": False, "run_id": None, "error": None}


class LabelExampleRequest(BaseModel):
    example_id: str | None = Field(default=None, max_length=120)
    section_id: str | None = Field(default=None, max_length=120)
    target_name: str = Field(..., min_length=1, max_length=140)
    ra: float | None = None
    dec: float | None = None
    px: int | None = Field(default=None, ge=0, le=512)
    py: int | None = Field(default=None, ge=0, le=512)
    class_id: int = Field(..., ge=0, le=24)
    class_label: str | None = Field(default=None, max_length=80)
    note: str | None = Field(default=None, max_length=500)


class RealStudioTrainRequest(BaseModel):
    model_architecture: str = Field(default="SpectralResNet102", pattern="^(SpectralResNet102|AstroFeatureSVM)$")
    epochs: int = Field(default=12, ge=3, le=100)
    learning_rate: float = Field(default=0.008, gt=0.0, le=0.2)
    batch_size: int = Field(default=64, ge=4, le=128)
    use_lora: bool = False
    lora_r: int = Field(default=8, ge=1, le=32)
    augment: bool = True
    seed: int = 42


class PromoteRunRequest(BaseModel):
    run_id: str = Field(..., min_length=3, max_length=120)


async def _get_app_pool(request: Request):
    pool = getattr(request.app.state, "db_pool", None)
    if pool is None and "pytest" not in sys.modules:
        try:
            pool = await _sections_api()._get_pool(request)
        except Exception:  # noqa: BLE001
            pool = None
    return pool


@router.get("/dataset")
async def get_studio_dataset(request: Request):
    """Return labeled sky examples, per-class counts, empty-state flag, and demo-data flag."""
    studio = _ml_studio()
    pool = await _get_app_pool(request)
    examples = await studio.list_labeled_examples(pool)
    class_map: dict[int, dict[str, Any]] = {
        c["id"]: {**c, "count": 0} for c in studio.STUDIO_CLASSES
    }
    extra_colors = ["#22d3ee", "#c084fc", "#f472b6", "#facc15", "#4ade80", "#fb923c"]
    demo_count = 0
    for ex in examples:
        cid = int(ex["class_id"])
        if cid not in class_map:
            class_map[cid] = {
                "id": cid,
                "name": str(ex.get("class_label") or f"Custom Class {cid + 1}"),
                "science_name": "Custom User Class",
                "color": extra_colors[cid % len(extra_colors)],
                "hint": "User-defined custom sky class",
                "count": 0,
            }
        class_map[cid]["count"] += 1
        if ex.get("class_label") and cid >= len(studio.STUDIO_CLASSES):
            class_map[cid]["name"] = str(ex["class_label"])
        if ex.get("source") == "demo_synthetic":
            demo_count += 1
    classes_out = [class_map[k] for k in sorted(class_map.keys())]
    populated_classes = sum(1 for c in classes_out if c["count"] >= 2)
    slim_examples = [
        {k: v for k, v in ex.items() if k != "spectrum_json"}
        for ex in examples
    ]
    return {
        "classes": classes_out,
        "examples": slim_examples,
        "total_examples": len(examples),
        "demo_count": demo_count,
        "has_demo_data": demo_count > 0,
        "can_train": populated_classes >= 2,
        "is_empty_state": populated_classes < 2,
        **_studio_write_status(),
    }


@router.post("/labels", dependencies=[Depends(require_studio_write)])
async def create_or_update_label(body: LabelExampleRequest, request: Request):
    """Attach a real SPHEREx cutout pixel/spectrum to a class and persist in Postgres."""
    studio = _ml_studio()
    pool = await _get_app_pool(request)
    spectrum_json: dict[str, Any] | None = None
    ra_val = body.ra
    dec_val = body.dec

    if body.section_id:
        sec_api = _sections_api()
        try:
            spec = await sec_api.get_installed_section_spectrum(
                body.section_id,
                request=request,
                px=body.px,
                py=body.py,
                epoch=None,
                normalize=False,
                aperture_radius=None,
                annulus_inner=None,
                annulus_outer=None,
                sample_mode="primary",
            )
            spectrum_json = {
                "wavelengths_um": spec.get("wavelengths_um", studio.SPHEREX_WAVELENGTHS_UM),
                "flux_jy": spec.get("flux_jy", []),
                "variance_jy2": spec.get("variance_jy2", []),
            }
            if ra_val is None and spec.get("ra") is not None:
                ra_val = float(spec["ra"])
            if dec_val is None and spec.get("dec") is not None:
                dec_val = float(spec["dec"])
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Could not extract spectrum for section {body.section_id}: {exc}",
            ) from exc

    saved = await studio.upsert_labeled_example(
        pool,
        {
            "example_id": body.example_id,
            "section_id": body.section_id,
            "target_name": body.target_name,
            "ra": ra_val,
            "dec": dec_val,
            "px": body.px,
            "py": body.py,
            "class_id": body.class_id,
            "class_label": body.class_label,
            "spectrum_json": spectrum_json,
            "source": "user",
            "note": body.note,
        },
    )
    return {"status": "saved", "example": {k: v for k, v in saved.items() if k != "spectrum_json"}}


@router.delete("/labels/{example_id}", dependencies=[Depends(require_studio_write)])
async def remove_label(example_id: str, request: Request):
    studio = _ml_studio()
    pool = await _get_app_pool(request)
    ok = await studio.delete_labeled_example(pool, example_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Example {example_id} not found")
    return {"status": "deleted", "example_id": example_id}


@router.delete("/classes/{class_id}", dependencies=[Depends(require_studio_write)])
async def remove_class_examples(class_id: int, request: Request):
    """Remove all labeled examples belonging to class_id from Postgres and RAM."""
    if class_id < 0 or class_id > 24:
        raise HTTPException(status_code=400, detail="Invalid class_id")
    studio = _ml_studio()
    pool = await _get_app_pool(request)
    deleted = await studio.delete_class_examples(pool, class_id)
    return {"status": "deleted", "class_id": class_id, "deleted_count": deleted}


@router.post("/demo/seed", dependencies=[Depends(require_studio_write)])
async def seed_demo_data(request: Request, per_class: int = Query(default=10, ge=3, le=25)):
    """Seed physics-realistic SPHEREx demo examples (explicitly tagged demo_synthetic) into Postgres."""
    studio = _ml_studio()
    pool = await _get_app_pool(request)
    count = await studio.seed_demo_examples(pool, per_class=per_class)
    return {"status": "seeded", "seeded_count": count, "source": "demo_synthetic"}


@router.post("/demo/clear", dependencies=[Depends(require_studio_write)])
async def clear_demo_data(request: Request):
    """Remove only demo_synthetic rows from Postgres, preserving real labels and benchmarks."""
    studio = _ml_studio()
    pool = await _get_app_pool(request)
    deleted = await studio.clear_demo_examples(pool)
    remaining = await studio.list_labeled_examples(pool)
    if len(remaining) == 0:
        await studio.reset_promoted_studio_models(pool)
    return {"status": "cleared", "deleted_count": deleted, "remaining_count": len(remaining)}


@router.get("/studio/live")
async def get_studio_live_status():
    """Zero-DB fast RAM poll for active training progress & epoch telemetry."""
    return {
        "running": _studio_live_status["running"],
        "run_id": _studio_live_status["run_id"],
        "error": _studio_live_status["error"],
        "frames": list(_studio_live_frames),
    }


@router.post("/studio/reset", dependencies=[Depends(require_studio_write)])
async def reset_studio_active_model(request: Request):
    """Un-promote the active model so the Preview card returns to its untrained state."""
    studio = _ml_studio()
    pool = await _get_app_pool(request)
    await studio.reset_promoted_studio_models(pool)
    return {"status": "reset", "active_run": None}


@router.post("/studio/run", status_code=202, dependencies=[Depends(require_studio_write)])
async def start_real_studio_run(req: RealStudioTrainRequest, request: Request):
    """Train a real 6-class PyTorch spectrum classifier on Postgres labeled examples."""
    studio = _ml_studio()
    if not _studio_job_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="A training run is already in progress.")

    pool = await _get_app_pool(request)
    examples = await studio.list_labeled_examples(pool)
    base_weights: bytes | None = None
    if req.use_lora:
        _, active_meta = await studio.load_promoted_studio_model(pool, req.model_architecture)
        if active_meta and active_meta.get("run_id"):
            base_weights = await studio.get_run_weights_pt_bytes(pool, str(active_meta["run_id"]))
            if base_weights is not None:
                import zstandard as zstd_mod

                base_weights = zstd_mod.ZstdCompressor(level=3).compress(base_weights)

    _studio_live_frames.clear()
    _studio_live_status.update({"running": True, "run_id": None, "error": None})

    async def _runner() -> None:
        try:
            def _on_epoch(frame: dict[str, Any]) -> None:
                _studio_live_frames.append(frame)
                _studio_live_status["run_id"] = frame["run_id"]

            result = await asyncio.to_thread(
                studio.train_studio_model,
                examples,
                model_name=req.model_architecture,
                epochs=req.epochs,
                learning_rate=req.learning_rate,
                batch_size=req.batch_size,
                use_lora=req.use_lora,
                lora_r=req.lora_r,
                augment=req.augment,
                base_weights_zst=base_weights,
                seed=req.seed,
                on_epoch=_on_epoch,
            )
            await studio.save_studio_run(pool, result["run_meta"], result["weights_zst"])
            _studio_live_status.update(
                {"running": False, "run_id": result["run_meta"]["run_id"], "error": None}
            )
        except Exception as exc:  # noqa: BLE001
            _studio_live_status.update({"running": False, "error": str(exc)})
        finally:
            _studio_job_lock.release()

    task = asyncio.create_task(_runner())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return {"status": "started", "model_architecture": req.model_architecture, "epochs": req.epochs}


@router.post("/studio/abort", dependencies=[Depends(require_studio_write)])
async def abort_real_studio_run():
    """Cooperatively stop an active studio training job at the next epoch boundary."""
    _ml_studio().request_studio_abort()
    return {"status": "abort_requested"}


@router.get("/runs")
async def get_studio_runs(request: Request, limit: int = Query(default=20, ge=1, le=50)):
    """Return persisted training runs, live epoch frames, and active model status."""
    studio = _ml_studio()
    pool = await _get_app_pool(request)
    runs = await studio.list_studio_runs(pool, limit=limit)
    _, active_meta = await studio.load_promoted_studio_model(pool, "SpectralResNet102")
    return {
        "runs": runs,
        "active_run": active_meta,
        "live": {
            "running": _studio_live_status["running"],
            "run_id": _studio_live_status["run_id"],
            "error": _studio_live_status["error"],
            "frames": list(_studio_live_frames),
        },
        **_studio_write_status(),
    }


@router.post("/studio/promote", dependencies=[Depends(require_studio_write)])
async def promote_studio_checkpoint(body: PromoteRunRequest, request: Request):
    """Load and promote a persisted run_id as the active inference model."""
    studio = _ml_studio()
    pool = await _get_app_pool(request)
    meta = await studio.promote_studio_run(pool, body.run_id)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"Saved run {body.run_id} not found or has no weights")
    return {"status": "promoted", "active_run": meta}


@router.delete("/runs/{run_id}", dependencies=[Depends(require_studio_write)])
async def delete_studio_checkpoint(run_id: str, request: Request):
    """Permanently delete/discard a saved model checkpoint."""
    studio = _ml_studio()
    pool = await _get_app_pool(request)
    deleted = await studio.delete_studio_run(pool, run_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Saved run {run_id} not found")
    return {"status": "deleted", "run_id": run_id}


@router.get("/models/{run_id}/download")
async def download_model_weights(run_id: str, request: Request):
    """Download the real PyTorch .pt state_dict file for a persisted training run."""
    studio = _ml_studio()
    pool = await _get_app_pool(request)
    pt_bytes = await studio.get_run_weights_pt_bytes(pool, run_id)
    if pt_bytes is None:
        raise HTTPException(status_code=404, detail=f"Weights for run {run_id} not found")
    return Response(
        content=pt_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="spectra_{run_id}.pt"'},
    )


@router.get("/predict")
async def predict_section_spectrum(
    request: Request,
    section_id: str = Query(..., min_length=1, max_length=120),
    px: int | None = Query(default=None, ge=0, le=512),
    py: int | None = Query(default=None, ge=0, le=512),
    model_architecture: str = Query(default="SpectralResNet102", pattern="^(SpectralResNet102|AstroFeatureSVM)$"),
):
    """Run real PyTorch inference + 1D Grad-CAM explanation on any installed cutout pixel."""
    studio = _ml_studio()
    sec_api = _sections_api()
    pool = await _get_app_pool(request)
    spec = await sec_api.get_installed_section_spectrum(
        section_id,
        request=request,
        px=px,
        py=py,
        epoch=None,
        normalize=False,
        aperture_radius=None,
        annulus_inner=None,
        annulus_outer=None,
        sample_mode="primary",
    )
    model, active_meta = await studio.load_promoted_studio_model(pool, model_architecture)
    pred = await asyncio.to_thread(
        studio.predict_spectrum_with_gradcam,
        model,
        spec,
        model_name=model_architecture,
    )
    return {
        "section_id": section_id,
        "target_name": spec.get("target_name", section_id),
        "ra": spec.get("ra"),
        "dec": spec.get("dec"),
        "px": px,
        "py": py,
        "flux_jy": spec.get("flux_jy", []),
        "active_run": active_meta,
        **pred,
    }


_REVIEW_SPEC_CACHE: dict[str, dict[str, Any]] = {}


@router.get("/review-queue")
async def get_review_queue(
    request: Request,
    model_architecture: str = Query(default="SpectralResNet102", pattern="^(SpectralResNet102|AstroFeatureSVM)$"),
):
    """Score real installed cutouts with the active model and sort by lowest confidence first."""
    studio = _ml_studio()
    sec_api = _sections_api()
    pool = await _get_app_pool(request)

    (model, active_meta), sec_resp, labeled, runs = await asyncio.gather(
        studio.load_promoted_studio_model(pool, model_architecture),
        sec_api.list_installed_sections(request=request, q=None, status="ready", limit=40, offset=0),
        studio.list_labeled_examples(pool),
        studio.list_studio_runs(pool, limit=1),
    )

    ready_sections = sec_resp.get("sections", [])
    label_by_section = {
        str(ex["section_id"]): ex
        for ex in labeled
        if ex.get("section_id")
    }

    async def _get_cached_spec(sid: str) -> dict[str, Any] | None:
        cached = _REVIEW_SPEC_CACHE.get(sid)
        if cached is not None:
            return cached
        try:
            spec = await sec_api.get_installed_section_spectrum(
                sid,
                request=request,
                px=None,
                py=None,
                epoch=None,
                normalize=False,
                aperture_radius=None,
                annulus_inner=None,
                annulus_outer=None,
                sample_mode="primary",
            )
            _REVIEW_SPEC_CACHE[sid] = spec
            return spec
        except Exception:  # noqa: BLE001
            return None

    specs = await asyncio.gather(*(_get_cached_spec(str(sec["section_id"])) for sec in ready_sections))

    def _score_all() -> list[dict[str, Any]]:
        scored: list[dict[str, Any]] = []
        for sec, spec in zip(ready_sections, specs, strict=True):
            if spec is None:
                continue
            sid = str(sec["section_id"])
            try:
                pred = studio.predict_spectrum_with_gradcam(
                    model,
                    spec,
                    model_name=model_architecture,
                )
                existing = label_by_section.get(sid)
                top_cid = pred["top_class_id"]
                disagreement = bool(
                    existing is not None and top_cid is not None and int(existing["class_id"]) != int(top_cid)
                )
                scored.append(
                    {
                        "section": sec,
                        "section_id": sid,
                        "target_name": sec.get("label", sid),
                        "ra": sec.get("ra"),
                        "dec": sec.get("dec"),
                        "predicted_class_id": top_cid,
                        "predicted_class_name": pred["top_class_name"],
                        "confidence": pred["confidence"],
                        "probabilities": pred["probabilities"],
                        "explanation": pred["explanation"],
                        "wavelengths_um": pred["wavelengths_um"],
                        "flux_jy": spec.get("flux_jy", []),
                        "gradcam_102": pred["gradcam_102"],
                        "human_label": existing["class_label"] if existing else None,
                        "human_class_id": existing["class_id"] if existing else None,
                        "example_id": existing["example_id"] if existing else None,
                        "disagreement": disagreement,
                    }
                )
            except Exception:  # noqa: BLE001, S112
                continue
        scored.sort(key=lambda x: (not x["disagreement"], float(x["confidence"])))
        return scored

    items = await asyncio.to_thread(_score_all)
    latest_cm = runs[0].get("confusion_matrix") if runs else None
    return {
        "items": items,
        "classes": studio.STUDIO_CLASSES,
        "active_run": active_meta,
        "confusion_matrix": latest_cm,
        **_studio_write_status(),
    }
