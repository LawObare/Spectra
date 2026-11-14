"""Zero-auth discussion API for the public observation forum.

The application entry point must include ``router`` and provide an asyncpg pool
as ``app.state.db_pool``. The router uses the immutable discussion and observer
tables; class vote totals live in ``discussion_threads.preview_metrics``.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import re
import time
from collections import defaultdict, deque
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter(prefix="/api/forum", tags=["forum"])

CLASSIFICATION_VOTES: dict[str, tuple[str, str, str]] = {
    "mover": ("moving_brown_dwarf", "#mover", "V_mover"),
    "variable": ("variable_star", "#variable", "V_var"),
    "ice_source": ("interstellar_ice", "#ice_source", "V_ice"),
    "blend_artifact": ("optical_blend_artifact", "#blend_artifact", "V_artifact"),
}
VALID_CHANNELS = {"movers", "spectra", "ices", "artifacts", "confirmed", "discoveries"}
_OBSERVER_KEY_RE = re.compile(r"^[0-9a-fA-F]{64}$")
_HASHTAG_RE = re.compile(r"^#[A-Za-z0-9_-]{1,48}$")
_write_times: dict[UUID, deque[float]] = defaultdict(deque)
_subscribers: set[asyncio.Queue[dict[str, Any]]] = set()


class ThreadCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=1, max_length=4000)
    ra: float = Field(ge=0, lt=360)
    dec: float = Field(ge=-90, le=90)
    fov_arcsec: float = Field(default=180, gt=0, alias="fovArcsec")
    render_mode: Literal["blink", "difference", "coadd"] = Field(
        default="blink", alias="renderMode"
    )
    target_name: str = Field(default="Selected Field", max_length=120, alias="targetName")
    classification: str = Field(default="unclassified", max_length=80)
    confidence_pct: int = Field(default=90, ge=0, le=100, alias="confidencePct")
    classification_vote: str | None = Field(default=None, alias="classificationVote")
    channel: str = "discoveries"
    hashtags: list[str] = Field(default_factory=list, max_length=20)
    state_query: str | None = Field(default=None, alias="stateQuery", max_length=500)
    preview_metrics: dict[str, Any] = Field(default_factory=dict, alias="previewMetrics")


class ReplyCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    thread_id: int = Field(gt=0, alias="threadId")
    body: str = Field(min_length=1, max_length=2000)


class ClassificationVote(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    classification_vote: str = Field(alias="classificationVote")


def _db_pool(request: Request) -> Any:
    pool = getattr(request.app.state, "db_pool", None)
    if pool is None:
        raise HTTPException(status_code=503, detail="Forum database is not configured")
    return pool


def _check_write_rate(observer_id: UUID) -> None:
    now = time.monotonic()
    events = _write_times[observer_id]
    while events and now - events[0] >= 60:
        events.popleft()
    if len(events) >= 60:
        retry_after = max(1, int(60 - (now - events[0])))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Forum write limit exceeded",
            headers={"Retry-After": str(retry_after)},
        )
    events.append(now)


async def _verify_observer(conn: Any, observer_id: UUID, observer_key: str) -> str:
    if observer_id.version != 4 or not _OBSERVER_KEY_RE.fullmatch(observer_key):
        raise HTTPException(status_code=401, detail="Invalid observer credentials")

    key_hash = hashlib.sha256(observer_key.encode("utf-8")).hexdigest()
    handle = f"Obs-{observer_id.hex[:4].upper()}"
    row = await conn.fetchrow(
        """
        INSERT INTO observers (observer_id, key_hash, handle)
        VALUES ($1, $2, $3)
        ON CONFLICT (observer_id) DO UPDATE SET handle = observers.handle
        WHERE observers.key_hash = EXCLUDED.key_hash
        RETURNING observer_id, handle
        """,
        observer_id,
        key_hash,
        handle,
    )
    if row is None:
        raise HTTPException(status_code=401, detail="Invalid observer credentials")
    return str(row["handle"])


def _parse_json(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default
    return value


def _thread_payload(row: Any, replies: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    values = dict(row)
    metrics = _parse_json(values.get("preview_metrics"), {})
    hashtags = _parse_json(values.get("hashtags"), [])
    created_at = values.get("created_at")
    timestamp = (
        created_at.astimezone(UTC).isoformat().replace("+00:00", "Z")
        if isinstance(created_at, datetime)
        else str(created_at or "")
    )
    return {
        "id": str(values["thread_id"]),
        "title": values["title"],
        "authorHandle": values["author_handle"],
        "isModerator": bool(values.get("moderator_verified", False)),
        "timestampIso": timestamp,
        "classification": metrics.get("classification", "unclassified"),
        "confidencePct": int(metrics.get("confidence_pct", 0)),
        "ra": float(values["ra"]),
        "dec": float(values["dec"]),
        "fovArcsec": float(values["fov_arcsec"]),
        "renderMode": metrics.get("render_mode", "blink"),
        "targetName": metrics.get("target_name", "Selected Field"),
        "body": values["body"],
        "upvotes": int(values.get("upvotes", 0)),
        "replies": replies or [],
        "hashtags": hashtags if isinstance(hashtags, list) else [],
        "classVotes": metrics.get("class_votes", {}),
    }


async def _get_thread(conn: Any, thread_id: int) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        """
        SELECT thread_id, author_handle, moderator_verified, title, body, hashtags,
               ra, dec, fov_arcsec, preview_metrics, upvotes, created_at
        FROM discussion_threads WHERE thread_id = $1
        """,
        thread_id,
    )
    if row is None:
        return None
    reply_rows = await conn.fetch(
        """
        SELECT reply_id, author_handle, moderator_verified, body, created_at
        FROM discussion_replies WHERE thread_id = $1 ORDER BY created_at
        """,
        thread_id,
    )
    replies = [
        {
            "id": str(reply["reply_id"]),
            "authorHandle": reply["author_handle"],
            "isModerator": bool(reply["moderator_verified"]),
            "timestampIso": reply["created_at"].astimezone(UTC).isoformat().replace(
                "+00:00", "Z"
            ),
            "body": reply["body"],
        }
        for reply in reply_rows
    ]
    return _thread_payload(row, replies)


def _publish(event_name: str, thread: dict[str, Any]) -> None:
    message = {"event": event_name, "thread": thread}
    for queue in tuple(_subscribers):
        if queue.full():
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
        try:
            queue.put_nowait(message)
        except asyncio.QueueFull:
            continue


def _safe_hashtags(tags: list[str], required_tag: str | None = None) -> list[str]:
    cleaned: list[str] = []
    for tag in tags:
        normalized = tag if tag.startswith("#") else f"#{tag}"
        if _HASHTAG_RE.fullmatch(normalized) and normalized not in cleaned:
            cleaned.append(normalized)
    if required_tag and required_tag not in cleaned:
        cleaned.append(required_tag)
    return cleaned


@router.get("/threads")
async def list_threads(
    request: Request,
    channel: str = Query(default="all", max_length=20),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, list[dict[str, Any]]]:
    if channel != "all" and channel not in VALID_CHANNELS:
        raise HTTPException(status_code=422, detail="Unknown discussion channel")
    pool = _db_pool(request)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT thread_id, author_handle, moderator_verified, title, body, hashtags,
                   ra, dec, fov_arcsec, preview_metrics, upvotes, created_at
            FROM discussion_threads
            WHERE channel = $1 OR $1 = 'all'
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            """,
            channel,
            limit,
            offset,
        )
        threads = [await _get_thread(conn, int(row["thread_id"])) for row in rows]
    return {"threads": [thread for thread in threads if thread is not None]}


@router.get("/stream")
async def stream_threads(request: Request) -> StreamingResponse:
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
    _subscribers.add(queue)

    async def events():
        try:
            yield ": connected\n\n"
            while not await request.is_disconnected():
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=15)
                except TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                event_name = message["event"]
                yield f"event: {event_name}\ndata: {json.dumps(message)}\n\n"
        finally:
            _subscribers.discard(queue)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _extract_observer_credentials(request: Request) -> tuple[UUID, str]:
    obs_id_str = request.headers.get("X-Observer-ID")
    obs_key = request.headers.get("X-Observer-Key")
    if not obs_id_str or not obs_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Observer-ID or X-Observer-Key header",
        )
    try:
        obs_id = UUID(obs_id_str)
    except (ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid X-Observer-ID UUID: {exc}",
        ) from exc
    return obs_id, obs_key


@router.post("/threads", status_code=status.HTTP_201_CREATED)
async def create_thread(
    payload: ThreadCreate,
    request: Request,
) -> dict[str, Any]:
    observer_id, observer_key = _extract_observer_credentials(request)
    if not payload.title.strip() or not payload.body.strip():
        raise HTTPException(status_code=422, detail="Title and body cannot be blank")
    if payload.channel not in VALID_CHANNELS:
        raise HTTPException(status_code=422, detail="Unknown discussion channel")
    vote = CLASSIFICATION_VOTES.get(payload.classification_vote or "")
    if payload.classification_vote and vote is None:
        raise HTTPException(status_code=422, detail="Unknown structured classification")
    required_tag = vote[1] if vote else None
    hashtags = _safe_hashtags(payload.hashtags, required_tag)
    metrics = dict(payload.preview_metrics)
    metrics.update(
        {
            "classification": payload.classification,
            "confidence_pct": payload.confidence_pct,
            "target_name": payload.target_name,
            "render_mode": payload.render_mode,
            "class_votes": {vote[2]: 1} if vote else {},
        }
    )
    if not payload.state_query:
        metrics_state = (
            f"?tab=navigator&ra={payload.ra:.6f}&dec={payload.dec:.6f}"
            f"&fov={payload.fov_arcsec:g}&mode={payload.render_mode}"
        )
    else:
        metrics_state = payload.state_query

    pool = _db_pool(request)
    async with pool.acquire() as conn, conn.transaction():
        author_handle = await _verify_observer(conn, observer_id, observer_key)
        _check_write_rate(observer_id)
        row = await conn.fetchrow(
            """
                INSERT INTO discussion_threads (
                    author_id, author_handle, channel, title, body, hashtags,
                    ra, dec, fov_arcsec, state_query, preview_metrics
                ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11::jsonb)
                RETURNING thread_id, author_handle, moderator_verified, title, body,
                          hashtags, ra, dec, fov_arcsec, preview_metrics, upvotes, created_at
                """,
            observer_id,
            author_handle,
            payload.channel,
            payload.title.strip(),
            payload.body.strip(),
            json.dumps(hashtags),
            payload.ra,
            payload.dec,
            payload.fov_arcsec,
            metrics_state,
            json.dumps(metrics),
        )
        thread = _thread_payload(row)
    _publish("new_thread", thread)
    return {"thread": thread}


@router.post("/replies", status_code=status.HTTP_201_CREATED)
async def create_reply(
    payload: ReplyCreate,
    request: Request,
) -> dict[str, Any]:
    observer_id, observer_key = _extract_observer_credentials(request)
    authorization = request.headers.get("Authorization")
    if not payload.body.strip():
        raise HTTPException(status_code=422, detail="Reply body cannot be blank")
    admin_token = os.environ.get("ADMIN_TOKEN")
    is_moderator = bool(
        admin_token
        and authorization
        and hmac.compare_digest(authorization, f"Bearer {admin_token}")
    )
    pool = _db_pool(request)
    async with pool.acquire() as conn, conn.transaction():
        author_handle = await _verify_observer(conn, observer_id, observer_key)
        _check_write_rate(observer_id)
        existing = await conn.fetchrow(
            "SELECT thread_id FROM discussion_threads WHERE thread_id = $1",
            payload.thread_id,
        )
        if existing is None:
            raise HTTPException(status_code=404, detail="Discussion thread not found")
        reply = await conn.fetchrow(
            """
                INSERT INTO discussion_replies (
                    thread_id, author_id, author_handle, body, moderator_verified
                ) VALUES ($1, $2, $3, $4, $5)
                RETURNING reply_id
                """,
            payload.thread_id,
            observer_id,
            author_handle,
            payload.body.strip(),
            is_moderator,
        )
        thread = await _get_thread(conn, payload.thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Discussion thread not found")
    _publish("new_reply", thread)
    return {"replyId": str(reply["reply_id"]), "thread": thread}


@router.post("/threads/{thread_id}/classifications")
async def vote_classification(
    thread_id: int,
    payload: ClassificationVote,
    request: Request,
) -> dict[str, Any]:
    observer_id, observer_key = _extract_observer_credentials(request)
    vote = CLASSIFICATION_VOTES.get(payload.classification_vote)
    if vote is None:
        raise HTTPException(status_code=422, detail="Unknown structured classification")
    _, hashtag, vote_key = vote
    pool = _db_pool(request)
    async with pool.acquire() as conn, conn.transaction():
        await _verify_observer(conn, observer_id, observer_key)
        _check_write_rate(observer_id)
        await conn.execute(
            """
            UPDATE discussion_threads
            SET hashtags = CASE
                    WHEN hashtags @> to_jsonb(ARRAY[$2::text]) THEN hashtags
                    ELSE hashtags || to_jsonb(ARRAY[$2::text])
                END,
                preview_metrics = jsonb_set(
                    COALESCE(preview_metrics, '{}'::jsonb),
                    '{class_votes}',
                    jsonb_set(
                        COALESCE(preview_metrics->'class_votes', '{}'::jsonb),
                        ARRAY[$3::text],
                        to_jsonb(COALESCE((preview_metrics->'class_votes'->>$3)::integer, 0) + 1),
                        true
                    ),
                    true
                )
            WHERE thread_id = $1
            """,
            thread_id,
            hashtag,
            vote_key,
        )
        thread = await _get_thread(conn, thread_id)
    if thread is None:
        raise HTTPException(status_code=404, detail="Discussion thread not found")
    _publish("classification_update", thread)
    return {"thread": thread}
