"""Tests for the SQLite database foundation (spec: SQLite schema).

These assert observable behaviour of the public DB surface:

* ``apply_migrations`` creates the five tables and is idempotent.
* ``get_connection`` enforces ``PRAGMA foreign_keys = ON`` and sets a
  ``sqlite3.Row`` row factory, so the schema's ``ON DELETE CASCADE`` actually
  cascades (relied on by later delete-cascade stories).

All DB paths use pytest's ``tmp_path`` so nothing is written outside the test
sandbox.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from db.connection import get_connection
from db.migrate import apply_migrations

EXPECTED_TABLES = {"items", "dependencies", "comments", "markers", "runs"}


def _table_names(db_path: Path) -> set[str]:
    """Return the user table names recorded in ``sqlite_master``."""
    with get_connection(db_path) as conn:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    return {row["name"] for row in rows}


def _insert_item(conn: sqlite3.Connection, item_id: str) -> None:
    """Insert a minimal valid ``items`` row for cascade tests."""
    conn.execute(
        """
        INSERT INTO items (
            id, title, slug, sort_order, created_by, updated_by,
            created_at, updated_at, state_changed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            item_id,
            item_id,
            item_id,  # slug must be unique per item (items.slug is UNIQUE)
            1.0,
            "alice",
            "alice",
            "2026-01-01T00:00:00.000000Z",
            "2026-01-01T00:00:00.000000Z",
            "2026-01-01T00:00:00.000000Z",
        ),
    )


def test_migration_creates_all_tables(tmp_path) -> None:
    """Applying the migration to a fresh DB creates all five tables."""
    db_path = tmp_path / "agentfarm.db"

    apply_migrations(db_path)

    assert _table_names(db_path) == EXPECTED_TABLES


def test_migration_is_idempotent(tmp_path) -> None:
    """Applying the migration twice raises nothing and yields the same schema."""
    db_path = tmp_path / "agentfarm.db"

    apply_migrations(db_path)
    first = _table_names(db_path)
    # Second application must be a no-op (guaranteed by IF NOT EXISTS).
    apply_migrations(db_path)
    second = _table_names(db_path)

    assert first == second == EXPECTED_TABLES


def test_migration_creates_parent_directory(tmp_path) -> None:
    """The migration creates a missing data dir before connecting."""
    db_path = tmp_path / "nested" / "data" / "agentfarm.db"

    apply_migrations(db_path)

    assert db_path.exists()
    assert _table_names(db_path) == EXPECTED_TABLES


def test_connection_has_foreign_keys_enabled(tmp_path) -> None:
    """Every connection enforces PRAGMA foreign_keys = ON (default is OFF)."""
    db_path = tmp_path / "agentfarm.db"
    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        (foreign_keys,) = conn.execute("PRAGMA foreign_keys").fetchone()

    assert foreign_keys == 1


def test_connection_row_factory_is_sqlite_row(tmp_path) -> None:
    """Connections return mapping-style rows (sqlite3.Row)."""
    db_path = tmp_path / "agentfarm.db"
    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        row = conn.execute("SELECT 1 AS one").fetchone()

    assert isinstance(row, sqlite3.Row)
    assert row["one"] == 1


def test_delete_item_cascades_to_dependencies(tmp_path) -> None:
    """Deleting an item removes dependency rows referencing it (ON DELETE CASCADE)."""
    db_path = tmp_path / "agentfarm.db"
    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        _insert_item(conn, "item-a")
        _insert_item(conn, "item-b")
        conn.execute(
            """
            INSERT INTO dependencies (id, from_id, to_id, kind)
            VALUES (?, ?, ?, ?)
            """,
            ("dep-1", "item-a", "item-b", "explicit"),
        )

    # Deleting item-b must cascade-delete the dependency that targets it.
    with get_connection(db_path) as conn:
        conn.execute("DELETE FROM items WHERE id = ?", ("item-b",))

    with get_connection(db_path) as conn:
        remaining = conn.execute("SELECT COUNT(*) FROM dependencies").fetchone()[0]

    assert remaining == 0


def test_delete_item_cascades_to_comments(tmp_path) -> None:
    """Deleting an item removes its comments (ON DELETE CASCADE)."""
    db_path = tmp_path / "agentfarm.db"
    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        _insert_item(conn, "item-a")
        conn.execute(
            """
            INSERT INTO comments (id, item_id, author, body, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                "comment-1",
                "item-a",
                "alice",
                "hello",
                "2026-01-01T00:00:00.000000Z",
                "2026-01-01T00:00:00.000000Z",
            ),
        )

    with get_connection(db_path) as conn:
        conn.execute("DELETE FROM items WHERE id = ?", ("item-a",))

    with get_connection(db_path) as conn:
        remaining = conn.execute("SELECT COUNT(*) FROM comments").fetchone()[0]

    assert remaining == 0


def test_duplicate_edge_rejected_by_unique_constraint(tmp_path) -> None:
    """UNIQUE (from_id, to_id) prevents a duplicate edge regardless of kind."""
    db_path = tmp_path / "agentfarm.db"
    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        _insert_item(conn, "item-a")
        _insert_item(conn, "item-b")
        conn.execute(
            "INSERT INTO dependencies (id, from_id, to_id, kind) VALUES (?, ?, ?, ?)",
            ("dep-1", "item-a", "item-b", "implicit"),
        )

    duplicate_rejected = False
    try:
        with get_connection(db_path) as conn:
            conn.execute(
                "INSERT INTO dependencies (id, from_id, to_id, kind) "
                "VALUES (?, ?, ?, ?)",
                ("dep-2", "item-a", "item-b", "explicit"),
            )
    except sqlite3.IntegrityError:
        duplicate_rejected = True

    assert duplicate_rejected


def test_apply_migrations_defaults_to_settings_db_path(tmp_path, monkeypatch) -> None:
    """With no path argument, the migration targets ``settings.db_path``.

    ``data_dir`` is redirected to ``tmp_path`` so no real filesystem location is
    touched; this proves the default wiring (used by the app lifespan) resolves
    through config rather than a hardcoded path.
    """
    import config

    monkeypatch.setattr(config.settings, "data_dir", tmp_path)

    apply_migrations()

    assert config.settings.db_path == tmp_path / "agentfarm.db"
    assert _table_names(config.settings.db_path) == EXPECTED_TABLES


async def test_app_lifespan_initialises_database(tmp_path, monkeypatch) -> None:
    """Entering the app lifespan creates the schema under ``data_dir``.

    This proves the DB initialisation is wired into startup (not only callable
    directly). ``data_dir`` is redirected to ``tmp_path`` so the real ``data/``
    directory is never written.
    """
    import config
    from main import app, lifespan

    monkeypatch.setattr(config.settings, "data_dir", tmp_path)

    async with lifespan(app):
        # The schema must exist while the application is "running".
        assert _table_names(config.settings.db_path) == EXPECTED_TABLES
        # The existing scaffold lifespan resource is preserved.
        assert app.state.http_client is not None
