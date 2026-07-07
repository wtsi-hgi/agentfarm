"""Apply the SQLite schema idempotently at startup.

``schema.sql`` uses ``CREATE TABLE/INDEX IF NOT EXISTS`` throughout, so applying
it repeatedly creates any missing tables and indexes. Additive column migrations
live here so existing SQLite files pick up new nullable/defaulted columns after
startup.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from pathlib import Path

from db.connection import get_connection
from services import graph

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"
AUTOMATIC_CHAIN_MIGRATION_ID = "20260701_automatic_sibling_chain"
PHASE_BALL_SPLIT_MIGRATION_ID = "20260707_phase_ball_split"


def _read_schema() -> str:
    """Return the DDL text from ``schema.sql``."""
    return SCHEMA_PATH.read_text(encoding="utf-8")


def apply_schema(conn: sqlite3.Connection) -> None:
    """Execute the schema DDL against an open connection.

    Idempotent via ``CREATE TABLE IF NOT EXISTS`` plus additive column checks.
    Useful when a caller already holds a connection (e.g. tests sharing an
    in-memory or temporary DB).
    """
    _ensure_column_if_table_exists(
        conn,
        table="dependencies",
        column="automatic_chain",
        definition="automatic_chain INTEGER NOT NULL DEFAULT 0",
    )
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
    _ensure_column(
        conn,
        table="items",
        column="usage",
        definition="usage TEXT NOT NULL DEFAULT ''",
    )
    _ensure_column(
        conn,
        table="items",
        column="ball",
        definition="ball TEXT NOT NULL DEFAULT 'you'",
    )
    _ensure_column(
        conn,
        table="items",
        column="ball_changed_at",
        definition="ball_changed_at TEXT NOT NULL DEFAULT ''",
    )
    _ensure_column(
        conn,
        table="items",
        column="dev_updated",
        definition="dev_updated INTEGER NOT NULL DEFAULT 0",
    )
    _ensure_column(
        conn,
        table="items",
        column="prod_updated",
        definition="prod_updated INTEGER NOT NULL DEFAULT 0",
    )
    _ensure_column(
        conn,
        table="items",
        column="docs_updated",
        definition="docs_updated INTEGER NOT NULL DEFAULT 0",
    )
    _ensure_column(
        conn,
        table="items",
        column="announced",
        definition="announced INTEGER NOT NULL DEFAULT 0",
    )
    _ensure_column(
        conn,
        table="item_state_changes",
        column="kind",
        definition="kind TEXT NOT NULL DEFAULT 'state-change'",
    )
    _ensure_column(
        conn,
        table="dependencies",
        column="automatic_chain",
        definition="automatic_chain INTEGER NOT NULL DEFAULT 0",
    )
    _run_once(
        conn,
        AUTOMATIC_CHAIN_MIGRATION_ID,
        graph.backfill_automatic_sibling_chains,
    )
    _run_once(
        conn,
        PHASE_BALL_SPLIT_MIGRATION_ID,
        _migrate_phase_ball_split,
    )


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    """Return column names for ``table`` from SQLite metadata."""
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {row["name"] if isinstance(row, sqlite3.Row) else row[1] for row in rows}


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    """Return whether ``table`` exists in the current SQLite database."""
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def _ensure_column_if_table_exists(
    conn: sqlite3.Connection, *, table: str, column: str, definition: str
) -> None:
    """Add ``column`` when upgrading a legacy table before schema DDL runs."""
    if not _table_exists(conn, table):
        return
    _ensure_column(conn, table=table, column=column, definition=definition)


def _ensure_column(
    conn: sqlite3.Connection, *, table: str, column: str, definition: str
) -> None:
    """Add ``column`` to ``table`` when an existing DB predates it."""
    if column in _columns(conn, table):
        return
    conn.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")


def _run_once(
    conn: sqlite3.Connection,
    migration_id: str,
    callback: Callable[[sqlite3.Connection], None],
) -> None:
    """Run a data migration once, recording completion in ``schema_migrations``."""
    existing = conn.execute(
        "SELECT 1 FROM schema_migrations WHERE id = ?", (migration_id,)
    ).fetchone()
    if existing is not None:
        return
    callback(conn)
    if "applied_at" in _columns(conn, "schema_migrations"):
        conn.execute(
            """
            INSERT INTO schema_migrations (id, applied_at)
            VALUES (?, CURRENT_TIMESTAMP)
            """,
            (migration_id,),
        )
    else:
        conn.execute("INSERT INTO schema_migrations (id) VALUES (?)", (migration_id,))


def _migrate_phase_ball_split(conn: sqlite3.Connection) -> None:
    """Upgrade legacy phase/external-block rows to phase plus ball columns."""
    item_columns = _columns(conn, "items")
    if "blocked_external" in item_columns:
        conn.executescript(
            """
            UPDATE items
            SET ball = 'agent'
            WHERE blocked_external = 0 AND state = 'implement';

            UPDATE items
            SET ball = 'person'
            WHERE blocked_external = 0 AND state = 'feedback';

            UPDATE items
            SET ball = 'person'
            WHERE blocked_external = 1;
            """
        )

    conn.execute(
        """
        UPDATE items
        SET state = 'released'
        WHERE state IN ('feedback', 'respond')
        """
    )
    conn.execute(
        """
        UPDATE item_state_changes
        SET from_state = 'released'
        WHERE from_state IN ('feedback', 'respond')
        """
    )
    conn.execute(
        """
        UPDATE item_state_changes
        SET to_state = 'released'
        WHERE to_state IN ('feedback', 'respond')
        """
    )
    conn.execute(
        """
        UPDATE items
        SET ball_changed_at = COALESCE(
            NULLIF(state_changed_at, ''),
            STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
        )
        WHERE ball_changed_at IS NULL OR ball_changed_at = ''
        """
    )

    if "blocked_external" in item_columns:
        conn.execute("ALTER TABLE items DROP COLUMN blocked_external")


def apply_migrations(db_path: Path | str | None = None) -> None:
    """Create/verify the schema in the database at ``db_path``.

    Args:
        db_path: Optional path override. Defaults to ``settings.db_path`` so the
            app lifespan initialises the DB under the configured ``data_dir``;
            tests pass a temporary path.
    """
    with get_connection(db_path) as conn:
        apply_schema(conn)
