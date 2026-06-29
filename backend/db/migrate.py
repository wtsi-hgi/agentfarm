"""Apply the SQLite schema idempotently at startup.

``schema.sql`` uses ``CREATE TABLE IF NOT EXISTS`` throughout, so applying it
repeatedly is a no-op: there are no versioned migrations in v1, the schema file
is the single source of truth and is reasserted on every startup.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from db.connection import get_connection

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"


def _read_schema() -> str:
    """Return the DDL text from ``schema.sql``."""
    return SCHEMA_PATH.read_text(encoding="utf-8")


def apply_schema(conn: sqlite3.Connection) -> None:
    """Execute the schema DDL against an open connection.

    Idempotent via ``CREATE TABLE IF NOT EXISTS``. Useful when a caller already
    holds a connection (e.g. tests sharing an in-memory or temporary DB).
    """
    conn.executescript(_read_schema())


def apply_migrations(db_path: Path | str | None = None) -> None:
    """Create/verify the schema in the database at ``db_path``.

    Args:
        db_path: Optional path override. Defaults to ``settings.db_path`` so the
            app lifespan initialises the DB under the configured ``data_dir``;
            tests pass a temporary path.
    """
    with get_connection(db_path) as conn:
        apply_schema(conn)
