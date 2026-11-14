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
