"""Apply the SQLite schema idempotently at startup.

``schema.sql`` uses ``CREATE TABLE IF NOT EXISTS`` throughout, so applying it
repeatedly creates any missing tables. Additive column migrations live here so
existing SQLite files pick up new nullable/defaulted columns after startup.
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

    Idempotent via ``CREATE TABLE IF NOT EXISTS`` plus additive column checks.
    Useful when a caller already holds a connection (e.g. tests sharing an
    in-memory or temporary DB).
    """
    conn.executescript(_read_schema())
    _ensure_column(
        conn,
        table="items",
        column="description",
        definition="description TEXT NOT NULL DEFAULT ''",
    )
    _ensure_column(
        conn,
        table="items",
        column="repo_url",
        definition="repo_url TEXT",
    )


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    """Return column names for ``table`` from SQLite metadata."""
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {row["name"] if isinstance(row, sqlite3.Row) else row[1] for row in rows}


def _ensure_column(
    conn: sqlite3.Connection, *, table: str, column: str, definition: str
) -> None:
    """Add ``column`` to ``table`` when an existing DB predates it."""
    if column in _columns(conn, table):
        return
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")


def apply_migrations(db_path: Path | str | None = None) -> None:
    """Create/verify the schema in the database at ``db_path``.

    Args:
        db_path: Optional path override. Defaults to ``settings.db_path`` so the
            app lifespan initialises the DB under the configured ``data_dir``;
            tests pass a temporary path.
    """
    with get_connection(db_path) as conn:
        apply_schema(conn)
