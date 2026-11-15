"""Citizen Science Classification Endpoint with Bayesian Consensus Update.

SPECIFICATION.md §4.2.2, §5.1: Classification submission with zero-auth session
fingerprinting, Bayesian reliability weight updates, and Shannon entropy computation.
"""
from __future__ import annotations

import math
from collections import Counter
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

try:
    import backend.api.auth as _auth
except ImportError:
    import api.auth as _auth  # type: ignore

verify_observer_session = _auth.verify_observer_session
get_observer_queue_next = _auth.get_observer_queue_next

router = APIRouter(prefix="/api", tags=["classify"])


def _db_imports():
    try:
        from backend.db.pool import close_pool as _cl
        from backend.db.pool import create_pool as _cp
        from backend.db.queries import (
            CREATE_CLASSIFICATION,
            UPDATE_OBSERVER_CALIBRATION,
            UPDATE_SUBJECT_CONSENSUS,
        )
    except ImportError:
        from db.pool import close_pool as _cl
        from db.pool import create_pool as _cp  # type: ignore
        from db.queries import (  # type: ignore
            CREATE_CLASSIFICATION,
            UPDATE_OBSERVER_CALIBRATION,
            UPDATE_SUBJECT_CONSENSUS,
        )
    return _cp, _cl, CREATE_CLASSIFICATION, UPDATE_OBSERVER_CALIBRATION, UPDATE_SUBJECT_CONSENSUS


async def create_pool(*args: Any, **kwargs: Any):
    return await _db_imports()[0](*args, **kwargs)


async def close_pool(pool: Any):
    return await _db_imports()[1](pool)


def _shannon_entropy(labels: list[str]) -> float:
    if not labels:
        return 1.0
    n = len(labels)
    counts = Counter(labels)
    h = 0.0
    for c in counts.values():
        p = c / n
        if p > 0:
            h -= p * math.log2(p)
    return h


def _bayesian_reliability(calibration_seen: int, calibration_correct: int) -> float:
    # simple Bayesian smoothing around prior 0.85
    alpha, beta = 0.85 * 4 + 1, 0.15 * 4 + 1
    return (alpha + calibration_correct) / (alpha + beta + calibration_seen)


async def _apply_consensus_updates(
    conn: Any,
    subject_id: str,
    observer_id: str,
    primary_class: str,
    feature_tags: list[str],
    motion_telemetry: dict[str, Any] | None,
    ice_aperture_telemetry: dict[str, Any] | None,
    tab_workflow: str,
    confidence: float,
) -> dict[str, Any]:
    create_pool, close_pool, CREATE_CLASSIFICATION, UPDATE_OBSERVER_CALIBRATION, UPDATE_SUBJECT_CONSENSUS = _db_imports()
    _ = (create_pool, close_pool)

    observer = await conn.fetchrow("SELECT * FROM observers WHERE observer_id = $1", observer_id)
    if observer is None:
        raise HTTPException(status_code=404, detail="Observer not found")

    # calibration handling: treat subjects.is_calibration as ground-truth check
    subject = await conn.fetchrow(
        "SELECT subject_id, is_calibration, expert_ground_truth FROM subjects WHERE subject_id = $1",
        subject_id,
    )
    if subject is None:
        sec = await conn.fetchrow(
            "SELECT section_id, label FROM installed_sections WHERE section_id = $1",
            subject_id,
        )
        if sec or subject_id.startswith("triage_"):
            title = str(sec["label"]) if sec else f"Triage Subject {subject_id}"
            await conn.execute(
                """
                INSERT INTO subjects (subject_id, title, category, ra, dec, is_calibration, verification_status, data_release)
                VALUES ($1, $2, 'triage_queue', 0.0, 0.0, FALSE, 'pending', 'spherex_dr1')
                ON CONFLICT (subject_id) DO NOTHING
                """,
                subject_id,
                title,
            )
            subject = await conn.fetchrow(
                "SELECT subject_id, is_calibration, expert_ground_truth FROM subjects WHERE subject_id = $1",
                subject_id,
            )
        if subject is None:
            raise HTTPException(status_code=404, detail="Subject not found")

    calibration_increment = 0
    if subject["is_calibration"] and subject["expert_ground_truth"]:
        calibration_increment = 1 if primary_class == subject["expert_ground_truth"] else 0

    seen = int(observer["calibration_seen"]) + (1 if subject["is_calibration"] else 0)
    correct = int(observer["calibration_correct"]) + calibration_increment
    w_u = _bayesian_reliability(seen, correct)

    await conn.fetchrow(
        UPDATE_OBSERVER_CALIBRATION,
        observer_id,
        calibration_increment,
        w_u,
    )

    await conn.fetchrow(
        CREATE_CLASSIFICATION,
        subject_id,
        observer_id,
        tab_workflow,
        primary_class,
        feature_tags,
        motion_telemetry,
        ice_aperture_telemetry,
        confidence,
        w_u,
    )

    rows = await conn.fetch(
        "SELECT primary_class, observer_weight_snapshot FROM classifications WHERE subject_id = $1",
        subject_id,
    )
    labels = [r["primary_class"] for r in rows]
    Counter(labels)
    total_w = sum(float(r["observer_weight_snapshot"] or 1.0) for r in rows) or 1.0
    class_weights: Counter[str] = Counter()
    for r in rows:
        class_weights[r["primary_class"]] += float(r["observer_weight_snapshot"] or 1.0)

    consensus_class, consensus_w = class_weights.most_common(1)[0] if class_weights else (None, 0.0)
    consensus_score = float(consensus_w / total_w) if consensus_class else 0.0
    shannon = _shannon_entropy(labels)
    status = "verified_discovery" if consensus_score >= 0.8 and len(rows) >= 3 else (
        "consensus_reached" if consensus_score >= 0.6 else "pending"
    )

    updated = await conn.fetchrow(
        UPDATE_SUBJECT_CONSENSUS,
        subject_id,
        consensus_class,
        consensus_score,
        shannon,
        status,
    )
    return {"w_u": w_u, "shannon_entropy": shannon, "subject": dict(updated) if updated else None}


class ClassifyRequest(BaseModel):
    subject_id: str
    tab_workflow: str = "comparator"
    primary_class: str = "unknown"
    feature_tags: list[str] = Field(default_factory=list)
    motion_telemetry: dict[str, Any] | None = None
    ice_aperture_telemetry: dict[str, Any] | None = None
    confidence: float = 0.5


@router.post("/classify")
async def submit_classification(
    request: Request,
    body: ClassifyRequest,
) -> dict[str, Any]:
    observer_id = await verify_observer_session(request)
    create_pool, close_pool, *_ = _db_imports()
    pool = await create_pool(min_size=1, max_size=5)
    try:
        async with pool.acquire() as conn, conn.transaction():
            out = await _apply_consensus_updates(
                conn,
                body.subject_id,
                observer_id,
                body.primary_class,
                body.feature_tags,
                body.motion_telemetry,
                body.ice_aperture_telemetry,
                body.tab_workflow,
                body.confidence,
            )
    finally:
        await close_pool(pool)

    return {
        "success": True,
        "observer_id": observer_id,
        "subject_id": body.subject_id,
        "observer_weight_w_u": out["w_u"],
        "shannon_entropy": out["shannon_entropy"],
        "subject": out["subject"],
    }


@router.get("/queue/next")
async def get_next_classification_task(
    observer_id: str, tab_workflow: str = "comparator"
) -> dict[str, Any] | None:
    try:
        task = await get_observer_queue_next(observer_id, tab_workflow=tab_workflow)
    except TypeError:
        task = await get_observer_queue_next(observer_id)
    if task:
        return {
            "success": True,
            "subject_id": task["subject_id"],
            "title": task.get("title"),
            "entropy": task.get("shannon_entropy", 0.0),
            "queue_position": 1,
            "task": task,
        }
    return {"success": False, "detail": "No classification tasks remaining in queue"}
