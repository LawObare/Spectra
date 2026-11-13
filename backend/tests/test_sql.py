"""SQL query validation tests.

SPECIFICATION.md §5.3: Validates every parameterized SQL query in queries.py
against schema.sql using PostgreSQL PREPARE/EXPLAIN-style binding checks.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

if shutil.which("psql") is None:
    pytest.skip("psql CLI tool not installed", allow_module_level=True)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCHEMA_PATH = REPO_ROOT / "backend" / "db" / "schema.sql"
QUERIES_PATH = REPO_ROOT / "backend" / "db" / "queries.py"
SUPABASE_DSN = "postgresql://postgres:postgres@localhost:5432/postgres"

QUERY_NAMES = [
    "GET_SUBJECT_BY_ID",
    "GET_NEXT_ACTIVE_LEARNING_SUBJECT",
    "UPSERT_OBSERVER",
    "UPDATE_OBSERVER_CALIBRATION",
    "CREATE_CLASSIFICATION",
    "UPDATE_SUBJECT_CONSENSUS",
    "CREATE_DISCUSSION_THREAD",
    "GET_DISCUSSION_THREADS",
    "ADD_DISCUSSION_REPLY",
    "PING_HEARTBEAT",
    "GET_SUBJECT",
]


def _load_queries() -> dict[str, str]:
    try:
        from backend.db import queries
    except ImportError:
        from db import queries
    return {name: getattr(queries, name) for name in QUERY_NAMES}


@pytest.fixture(scope="session")
def schema_path() -> Path:
    assert SCHEMA_PATH.exists(), f"Schema not found at {SCHEMA_PATH}"
    return SCHEMA_PATH


@pytest.fixture(scope="session")
def queries_map() -> dict[str, str]:
    return _load_queries()


@pytest.mark.db
@pytest.mark.parametrize("query_name", QUERY_NAMES)
def test_all_queries_explain(schema_path: Path, queries_map: dict[str, str], query_name: str) -> None:
    """PREPARE validates every parameterized query against the applied schema (AC2)."""
    _ = schema_path
    query = queries_map[query_name].strip().rstrip(";")
    sql = f"PREPARE q AS {query}; DEALLOCATE q;"
    result = subprocess.run(
        ["psql", SUPABASE_DSN, "-v", "ON_ERROR_STOP=1", "-c", sql],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, (
        f"PREPARE failed for {query_name}\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
