"""Forum API tests use an in-memory asyncpg-compatible pool."""

import hashlib
import json
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.forum import router


class FakeConnection:
    def __init__(self, observer_id: UUID, observer_key: str) -> None:
        self.expected_observer_id = observer_id
        self.expected_key_hash = hashlib.sha256(observer_key.encode("utf-8")).hexdigest()
        self.thread: dict | None = None
        self.next_thread_id = 1

    @asynccontextmanager
    async def transaction(self):
        yield

    async def fetchrow(self, query: str, *args):
        if "INSERT INTO observers" in query:
            if args[0] != self.expected_observer_id or args[1] != self.expected_key_hash:
                return None
            return {"observer_id": args[0], "handle": args[2]}

        if "INSERT INTO discussion_threads" in query:
            metrics = json.loads(args[10])
            self.thread = {
                "thread_id": self.next_thread_id,
                "author_handle": args[1],
                "moderator_verified": False,
                "title": args[3],
                "body": args[4],
                "hashtags": json.loads(args[5]),
                "ra": args[6],
                "dec": args[7],
                "fov_arcsec": args[8],
                "preview_metrics": metrics,
                "upvotes": 0,
                "created_at": datetime.now(UTC),
            }
            self.next_thread_id += 1
            return self.thread

        if "SELECT thread_id FROM discussion_threads" in query:
            if self.thread and args[0] == self.thread["thread_id"]:
                return {"thread_id": self.thread["thread_id"]}
            return None

        if "FROM discussion_threads WHERE thread_id" in query:
            if self.thread and args[0] == self.thread["thread_id"]:
                return self.thread
            return None

        if "INSERT INTO discussion_replies" in query:
            return {"reply_id": 1}

        raise AssertionError(f"Unexpected fetchrow query: {query}")

    async def fetch(self, query: str, *args):
        if "FROM discussion_replies" in query:
            return []
        if "FROM discussion_threads" in query:
            return [self.thread] if self.thread else []
        raise AssertionError(f"Unexpected fetch query: {query}")

    async def execute(self, query: str, *args):
        if "UPDATE discussion_threads" not in query:
            raise AssertionError(f"Unexpected execute query: {query}")
        if not self.thread or args[0] != self.thread["thread_id"]:
            return "UPDATE 0"
        if "SET upvotes" in query:
            self.thread["upvotes"] = int(self.thread.get("upvotes", 0)) + 1
            return "UPDATE 1"
        metrics = self.thread["preview_metrics"]
        counts = metrics.setdefault("class_votes", {})
        counts[args[2]] = counts.get(args[2], 0) + 1
        if args[1] not in self.thread["hashtags"]:
            self.thread["hashtags"].append(args[1])
        return "UPDATE 1"


class FakePool:
    def __init__(self, conn: FakeConnection) -> None:
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    def acquire(self):
        return self


def make_client(observer_id: UUID, observer_key: str) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    conn = FakeConnection(observer_id, observer_key)
    app.state.db_pool = FakePool(conn)
    app.state.forum_test_connection = conn
    return TestClient(app)


def test_create_thread_attaches_structured_tag_and_vote() -> None:
    observer_id = UUID("12345678-1234-4234-8234-123456789abc")
    observer_key = "a1" * 32
    client = make_client(observer_id, observer_key)

    response = client.post(
        "/api/forum/threads",
        headers={
            "X-Observer-ID": str(observer_id),
            "X-Observer-Key": observer_key,
        },
        json={
            "title": "Dipole in the active field",
            "body": "Candidate moves west across epochs.",
            "ra": 133.73712,
            "dec": -7.24038,
            "classification": "moving_brown_dwarf",
            "classificationVote": "mover",
            "hashtags": [],
        },
    )

    assert response.status_code == 201
    thread = response.json()["thread"]
    assert thread["hashtags"] == ["#mover"]
    assert thread["classVotes"] == {"V_mover": 1}
    assert thread["authorHandle"] == "Obs-1234"
    assert observer_key not in response.text


def test_invalid_observer_key_is_rejected() -> None:
    observer_id = UUID("22345678-1234-4234-8234-123456789abc")
    observer_key = "b2" * 32
    client = make_client(observer_id, observer_key)

    response = client.post(
        "/api/forum/threads",
        headers={
            "X-Observer-ID": str(observer_id),
            "X-Observer-Key": "c3" * 32,
        },
        json={
            "title": "Rejected note",
            "body": "The observer key does not match.",
            "ra": 10,
            "dec": 20,
        },
    )

    assert response.status_code == 401


def test_classification_vote_updates_counter_and_tag() -> None:
    observer_id = UUID("32345678-1234-4234-8234-123456789abc")
    observer_key = "d4" * 32
    client = make_client(observer_id, observer_key)
    headers = {
        "X-Observer-ID": str(observer_id),
        "X-Observer-Key": observer_key,
    }
    created = client.post(
        "/api/forum/threads",
        headers=headers,
        json={
            "title": "Optical cross-match candidate",
            "body": "Check the archival stack.",
            "ra": 76.95647,
            "dec": 30.4013,
        },
    )
    assert created.status_code == 201

    response = client.post(
        "/api/forum/threads/1/classifications",
        headers=headers,
        json={"classificationVote": "blend_artifact"},
    )

    assert response.status_code == 200
    thread = response.json()["thread"]
    assert thread["hashtags"] == ["#blend_artifact"]
    assert thread["classVotes"] == {"V_artifact": 1}


def test_upvote_thread_increments_counter() -> None:
    observer_id = UUID("42345678-1234-4234-8234-123456789abc")
    observer_key = "e5" * 32
    client = make_client(observer_id, observer_key)
    headers = {
        "X-Observer-ID": str(observer_id),
        "X-Observer-Key": observer_key,
    }
    created = client.post(
        "/api/forum/threads",
        headers=headers,
        json={
            "title": "High-PM Barnard detection",
            "body": "Confirmed north shift across epochs.",
            "ra": 269.44639,
            "dec": 4.76676,
        },
    )
    assert created.status_code == 201

    response = client.post("/api/forum/threads/1/upvote", headers=headers)
    assert response.status_code == 200
    assert response.json()["thread"]["upvotes"] == 1
