"""Tests for the SQLite database foundation (spec: SQLite schema).

These assert observable behaviour of the public DB surface:

* ``apply_migrations`` creates the schema tables and is idempotent.
* ``get_connection`` enforces SQLite pragmas for foreign keys and request
  overlap, and sets a ``sqlite3.Row`` row factory, so the schema's ``ON DELETE
  CASCADE`` actually cascades (relied on by later delete-cascade stories).

All DB paths use pytest's ``tmp_path`` so nothing is written outside the test
sandbox.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from threading import Event, Thread

from db.connection import SQLITE_BUSY_TIMEOUT_MS, get_connection, get_write_connection
from db.migrate import apply_migrations

LEGACY_TIMESTAMP = "2026-01-01T00:00:00.000000Z"
PHASE_BALL_SPLIT_MIGRATION_ID = "20260707_phase_ball_split"

EXPECTED_TABLES = {
    "items",
    "dependencies",
    "comments",
    "item_notes",
    "prompt_response_entries",
    "scratchpad",
    "item_state_changes",
    "markers",
    "runs",
    "schema_migrations",
}
EXPECTED_INDEXES = {
    "idx_items_parent_sort",
    "idx_dependencies_from",
    "idx_dependencies_to",
    "idx_dependencies_kind_from",
    "idx_dependencies_auto_chain_from",
    "idx_item_notes_item_created",
    "idx_prompt_response_entries_item_created",
}
EXPECTED_INDEX_COLUMNS = {
    "idx_item_notes_item_created": ["item_id", "created_at", "id"],
    "idx_prompt_response_entries_item_created": ["item_id", "created_at", "id"],
}


def _create_legacy_items_table(conn: sqlite3.Connection) -> None:
    """Create the pre-ball items table used by legacy migration tests."""
    conn.execute(
        """
        CREATE TABLE items (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          parent_id TEXT REFERENCES items(id) ON DELETE CASCADE,
          sort_order REAL NOT NULL,
          state TEXT NOT NULL DEFAULT 'not-started',
          mode TEXT NOT NULL DEFAULT 'prompt-agent',
          effort TEXT NOT NULL DEFAULT 'medium',
          blocked_external INTEGER NOT NULL DEFAULT 0,
          blocked_note TEXT,
          blocked_followup_date TEXT,
          created_by TEXT NOT NULL,
          updated_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          state_changed_at TEXT NOT NULL,
          completed_at TEXT
        )
        """
    )


def _insert_legacy_item(
    conn: sqlite3.Connection,
    item_id: str,
    *,
    state: str,
    blocked_external: int,
    blocked_note: str | None = None,
    blocked_followup_date: str | None = None,
    state_changed_at: str = LEGACY_TIMESTAMP,
) -> None:
    """Insert a legacy item row before the phase/ball split migration."""
    conn.execute(
        """
        INSERT INTO items (
            id, title, slug, sort_order, state, blocked_external, blocked_note,
            blocked_followup_date, created_by, updated_by, created_at,
            updated_at, state_changed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            item_id,
            item_id,
            item_id,
            1.0,
            state,
            blocked_external,
            blocked_note,
            blocked_followup_date,
            "alice",
            "alice",
            LEGACY_TIMESTAMP,
            LEGACY_TIMESTAMP,
            state_changed_at,
        ),
    )


def _create_legacy_state_changes_table(conn: sqlite3.Connection) -> None:
    """Create the pre-kind activity table used by legacy migration tests."""
    conn.execute(
        """
        CREATE TABLE item_state_changes (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
          actor TEXT NOT NULL,
          from_state TEXT NOT NULL,
          to_state TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
        """
    )


def _insert_legacy_state_change(
    conn: sqlite3.Connection,
    change_id: str,
    item_id: str,
    *,
    from_state: str,
    to_state: str,
) -> None:
    """Insert a legacy activity row before the kind discriminator existed."""
    conn.execute(
        """
        INSERT INTO item_state_changes (
            id, item_id, actor, from_state, to_state, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            change_id,
            item_id,
            "alice",
            from_state,
            to_state,
            LEGACY_TIMESTAMP,
        ),
    )


def _table_names(db_path: Path) -> set[str]:
    """Return the user table names recorded in ``sqlite_master``."""
    with get_connection(db_path) as conn:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    return {row["name"] for row in rows}


def _index_names(db_path: Path) -> set[str]:
    """Return project-created index names recorded in ``sqlite_master``."""
    with get_connection(db_path) as conn:
        rows = conn.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%'
            """
        ).fetchall()
    return {row["name"] for row in rows}


def _index_columns(db_path: Path, index_name: str) -> list[str]:
    """Return the indexed columns for ``index_name`` in order."""
    with get_connection(db_path) as conn:
        rows = conn.execute(f"PRAGMA index_info({index_name})").fetchall()
    return [row["name"] for row in rows]


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
    """Applying the migration to a fresh DB creates all expected tables."""
    db_path = tmp_path / "agentfarm.db"

    apply_migrations(db_path)

    assert _table_names(db_path) == EXPECTED_TABLES


def test_migration_is_idempotent(tmp_path) -> None:
    """Applying the migration twice raises nothing and yields the same schema."""
    db_path = tmp_path / "agentfarm.db"

    apply_migrations(db_path)
    first = _table_names(db_path)
    first_indexes = _index_names(db_path)
    # Second application must be a no-op (guaranteed by IF NOT EXISTS).
    apply_migrations(db_path)
    second = _table_names(db_path)
    second_indexes = _index_names(db_path)

    assert first == second == EXPECTED_TABLES
    assert first_indexes == second_indexes == EXPECTED_INDEXES


def test_migration_creates_projection_indexes(tmp_path) -> None:
    """Migrations add the indexes used by tree and priority projections."""
    db_path = tmp_path / "agentfarm.db"

    apply_migrations(db_path)

    assert _index_names(db_path) == EXPECTED_INDEXES
    assert {
        index_name: _index_columns(db_path, index_name)
        for index_name in EXPECTED_INDEX_COLUMNS
    } == EXPECTED_INDEX_COLUMNS


def test_migration_creates_parent_directory(tmp_path) -> None:
    """The migration creates a missing data dir before connecting."""
    db_path = tmp_path / "nested" / "data" / "agentfarm.db"

    apply_migrations(db_path)

    assert db_path.exists()
    assert _table_names(db_path) == EXPECTED_TABLES


def test_scratchpad_schema_defaults_to_minimized(tmp_path) -> None:
    """Scratchpad rows created with DB defaults match the app's empty state."""
    db_path = tmp_path / "agentfarm.db"

    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        conn.execute("INSERT INTO scratchpad (id) VALUES ('primary')")
        row = conn.execute(
            """
            SELECT body, height, minimized, updated_by, updated_at
            FROM scratchpad
            WHERE id = 'primary'
            """
        ).fetchone()

    assert row["body"] == ""
    assert row["height"] == 220
    assert row["minimized"] == 1
    assert row["updated_by"] is None
    assert row["updated_at"] is None


def test_migration_upgrades_existing_items_with_detail_columns(tmp_path) -> None:
    """Applying migrations to an old DB adds item detail fields safely."""
    db_path = tmp_path / "agentfarm.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE items (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              slug TEXT NOT NULL UNIQUE,
              parent_id TEXT REFERENCES items(id) ON DELETE CASCADE,
              sort_order REAL NOT NULL,
              state TEXT NOT NULL DEFAULT 'not-started',
              mode TEXT NOT NULL DEFAULT 'prompt-agent',
              effort TEXT NOT NULL DEFAULT 'medium',
              blocked_external INTEGER NOT NULL DEFAULT 0,
              blocked_note TEXT,
              blocked_followup_date TEXT,
              created_by TEXT NOT NULL,
              updated_by TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              state_changed_at TEXT NOT NULL,
              completed_at TEXT
            )
            """
        )
        conn.execute(
            """
            INSERT INTO items (
                id, title, slug, sort_order, created_by, updated_by,
                created_at, updated_at, state_changed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "old-root",
                "Old root",
                "old-root",
                1.0,
                "alice",
                "alice",
                "2026-01-01T00:00:00.000000Z",
                "2026-01-01T00:00:00.000000Z",
                "2026-01-01T00:00:00.000000Z",
            ),
        )

    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(items)").fetchall()
        }
        row = conn.execute(
            "SELECT description, repo_url, usage FROM items WHERE id = ?",
            ("old-root",),
        ).fetchone()

    assert "description" in columns
    assert "repo_url" in columns
    assert "usage" in columns
    assert row["description"] == ""
    assert row["repo_url"] is None
    assert row["usage"] == ""
    assert _index_names(db_path) == EXPECTED_INDEXES


def test_phase_ball_split_maps_implement_to_agent(tmp_path) -> None:
    """Legacy in-progress work remains implement and moves to the agent ball."""
    db_path = tmp_path / "agentfarm.db"
    with sqlite3.connect(db_path) as conn:
        _create_legacy_items_table(conn)
        _insert_legacy_item(
            conn,
            "legacy-implement",
            state="implement",
            blocked_external=0,
        )

    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        row = conn.execute(
            "SELECT state, ball FROM items WHERE id = 'legacy-implement'"
        ).fetchone()

    assert dict(row) == {"state": "implement", "ball": "agent"}


def test_phase_ball_split_maps_feedback_to_released_person(tmp_path) -> None:
    """Legacy feedback keeps its hand-off details and becomes released/person."""
    db_path = tmp_path / "agentfarm.db"
    with sqlite3.connect(db_path) as conn:
        _create_legacy_items_table(conn)
        _insert_legacy_item(
            conn,
            "legacy-feedback",
            state="feedback",
            blocked_external=0,
            blocked_note="n",
            blocked_followup_date="2026-01-01",
        )

    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        row = conn.execute(
            """
            SELECT state, ball, blocked_note, blocked_followup_date
            FROM items
            WHERE id = 'legacy-feedback'
            """
        ).fetchone()

    assert dict(row) == {
        "state": "released",
        "ball": "person",
        "blocked_note": "n",
        "blocked_followup_date": "2026-01-01",
    }


def test_phase_ball_split_maps_respond_to_released_you(tmp_path) -> None:
    """Legacy respond collapses into released but keeps the default you ball."""
    db_path = tmp_path / "agentfarm.db"
    with sqlite3.connect(db_path) as conn:
        _create_legacy_items_table(conn)
        _insert_legacy_item(
            conn,
            "legacy-respond",
            state="respond",
            blocked_external=0,
        )

    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        row = conn.execute(
            "SELECT state, ball FROM items WHERE id = 'legacy-respond'"
        ).fetchone()

    assert dict(row) == {"state": "released", "ball": "you"}


def test_phase_ball_split_external_block_overrides_implement_to_person(
    tmp_path,
) -> None:
    """The legacy external block flag takes precedence over implement/agent."""
    db_path = tmp_path / "agentfarm.db"
    with sqlite3.connect(db_path) as conn:
        _create_legacy_items_table(conn)
        _insert_legacy_item(
            conn,
            "legacy-blocked",
            state="implement",
            blocked_external=1,
            blocked_note="n",
        )

    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        row = conn.execute(
            """
            SELECT state, ball, blocked_note
            FROM items
            WHERE id = 'legacy-blocked'
            """
        ).fetchone()

    assert dict(row) == {
        "state": "implement",
        "ball": "person",
        "blocked_note": "n",
    }


def test_phase_ball_split_keeps_unmatched_state_on_you_ball(tmp_path) -> None:
    """Legacy states outside implement/feedback/respond keep the default ball."""
    db_path = tmp_path / "agentfarm.db"
    with sqlite3.connect(db_path) as conn:
        _create_legacy_items_table(conn)
        _insert_legacy_item(
            conn,
            "legacy-spec",
            state="spec",
            blocked_external=0,
        )

    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        row = conn.execute(
            "SELECT state, ball FROM items WHERE id = 'legacy-spec'"
        ).fetchone()

    assert dict(row) == {"state": "spec", "ball": "you"}


def test_phase_ball_split_rewrites_legacy_activity_states(tmp_path) -> None:
    """Legacy activity no longer references feedback or respond after upgrade."""
    db_path = tmp_path / "agentfarm.db"
    with sqlite3.connect(db_path) as conn:
        _create_legacy_items_table(conn)
        _insert_legacy_item(conn, "legacy-item", state="feedback", blocked_external=0)
        _create_legacy_state_changes_table(conn)
        _insert_legacy_state_change(
            conn,
            "change-feedback",
            "legacy-item",
            from_state="released",
            to_state="feedback",
        )
        _insert_legacy_state_change(
            conn,
            "change-respond",
            "legacy-item",
            from_state="respond",
            to_state="implement",
        )

    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        rows = conn.execute(
            """
            SELECT id, from_state, to_state
            FROM item_state_changes
            ORDER BY id
            """
        ).fetchall()
        legacy_state_count = conn.execute(
            """
            SELECT COUNT(*)
            FROM item_state_changes
            WHERE from_state IN ('feedback', 'respond')
               OR to_state IN ('feedback', 'respond')
            """
        ).fetchone()[0]

    assert [dict(row) for row in rows] == [
        {
            "id": "change-feedback",
            "from_state": "released",
            "to_state": "released",
        },
        {
            "id": "change-respond",
            "from_state": "released",
            "to_state": "implement",
        },
    ]
    assert legacy_state_count == 0


def test_phase_ball_split_drops_blocked_external_and_backfills_columns(
    tmp_path,
) -> None:
    """The upgraded item schema has ball/ship fields and stamped ball times."""
    db_path = tmp_path / "agentfarm.db"
    with sqlite3.connect(db_path) as conn:
        _create_legacy_items_table(conn)
        _insert_legacy_item(
            conn,
            "legacy-with-state-time",
            state="spec",
            blocked_external=0,
            state_changed_at="2026-02-03T04:05:06.000000Z",
        )
        _insert_legacy_item(
            conn,
            "legacy-without-state-time",
            state="spec",
            blocked_external=0,
            state_changed_at="",
        )

    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(items)").fetchall()
        }
        rows = conn.execute(
            """
            SELECT id, ball_changed_at
            FROM items
            ORDER BY id
            """
        ).fetchall()

    assert "blocked_external" not in columns
    assert {
        "ball",
        "ball_changed_at",
        "dev_updated",
        "prod_updated",
        "docs_updated",
        "announced",
    } <= columns
    assert [dict(row) for row in rows] == [
        {
            "id": "legacy-with-state-time",
            "ball_changed_at": "2026-02-03T04:05:06.000000Z",
        },
        {
            "id": "legacy-without-state-time",
            "ball_changed_at": rows[1]["ball_changed_at"],
        },
    ]
    assert all(row["ball_changed_at"] for row in rows)


def test_phase_ball_split_is_idempotent(tmp_path) -> None:
    """The one-time marker prevents subsequent phase/ball split rewrites."""
    db_path = tmp_path / "agentfarm.db"
    with sqlite3.connect(db_path) as conn:
        _create_legacy_items_table(conn)
        _insert_legacy_item(conn, "legacy-item", state="feedback", blocked_external=0)
        _create_legacy_state_changes_table(conn)
        _insert_legacy_state_change(
            conn,
            "change-feedback",
            "legacy-item",
            from_state="released",
            to_state="feedback",
        )

    apply_migrations(db_path)
    with get_connection(db_path) as conn:
        first_items = conn.execute("SELECT * FROM items ORDER BY id").fetchall()
        first_activity = conn.execute(
            "SELECT * FROM item_state_changes ORDER BY id"
        ).fetchall()
        first_migrations = conn.execute(
            "SELECT id FROM schema_migrations ORDER BY id"
        ).fetchall()

    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        second_items = conn.execute("SELECT * FROM items ORDER BY id").fetchall()
        second_activity = conn.execute(
            "SELECT * FROM item_state_changes ORDER BY id"
        ).fetchall()
        second_migrations = conn.execute(
            "SELECT id FROM schema_migrations ORDER BY id"
        ).fetchall()

    assert [dict(row) for row in second_items] == [dict(row) for row in first_items]
    assert [dict(row) for row in second_activity] == [
        dict(row) for row in first_activity
    ]
    assert [row["id"] for row in second_migrations] == [
        row["id"] for row in first_migrations
    ]
    assert [row["id"] for row in second_migrations].count(
        PHASE_BALL_SPLIT_MIGRATION_ID
    ) == 1


def test_phase_ball_split_records_noop_on_fresh_database(tmp_path) -> None:
    """A fresh DB has the new schema and records the migration with no rows."""
    db_path = tmp_path / "agentfarm.db"

    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        item_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(items)").fetchall()
        }
        item_count = conn.execute("SELECT COUNT(*) FROM items").fetchone()[0]
        migration = conn.execute(
            """
            SELECT id
            FROM schema_migrations
            WHERE id = ?
            """,
            (PHASE_BALL_SPLIT_MIGRATION_ID,),
        ).fetchone()

    assert "blocked_external" not in item_columns
    assert item_count == 0
    assert migration is not None


def test_phase_ball_split_adds_default_kind_to_legacy_activity(tmp_path) -> None:
    """Activity tables that predate kind read back as state-change activity."""
    db_path = tmp_path / "agentfarm.db"
    with sqlite3.connect(db_path) as conn:
        _create_legacy_items_table(conn)
        _insert_legacy_item(conn, "legacy-item", state="spec", blocked_external=0)
        _create_legacy_state_changes_table(conn)
        _insert_legacy_state_change(
            conn,
            "change-spec",
            "legacy-item",
            from_state="not-started",
            to_state="spec",
        )

    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(item_state_changes)").fetchall()
        }
        rows = conn.execute(
            "SELECT kind FROM item_state_changes ORDER BY id"
        ).fetchall()

    assert "kind" in columns
    assert [row["kind"] for row in rows] == ["state-change"]


def test_migration_backfills_automatic_leaf_chain_once(tmp_path) -> None:
    """Upgrading an old DB creates explicit automatic sibling edges once.

    The backfill assumes there are no pre-existing user-created dependency rows
    in the user's real pre-UI database. If a row does already exist for a pair,
    the migration preserves it as user-owned instead of relabelling it.
    """
    db_path = tmp_path / "agentfarm.db"
    timestamp = "2026-01-01T00:00:00.000000Z"
    with sqlite3.connect(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE items (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              slug TEXT NOT NULL UNIQUE,
              parent_id TEXT REFERENCES items(id) ON DELETE CASCADE,
              sort_order REAL NOT NULL,
              state TEXT NOT NULL DEFAULT 'not-started',
              mode TEXT NOT NULL DEFAULT 'prompt-agent',
              effort TEXT NOT NULL DEFAULT 'medium',
              blocked_external INTEGER NOT NULL DEFAULT 0,
              blocked_note TEXT,
              blocked_followup_date TEXT,
              created_by TEXT NOT NULL,
              updated_by TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              state_changed_at TEXT NOT NULL,
              completed_at TEXT
            );
            CREATE TABLE dependencies (
              id TEXT PRIMARY KEY,
              from_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
              to_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
              kind TEXT NOT NULL,
              UNIQUE (from_id, to_id)
            );
            """
        )
        rows = [
            ("parent", "Parent", "parent", None, 1.0),
            ("a", "A", "a", "parent", 1.0),
            ("b", "B", "b", "parent", 2.0),
            ("c", "C", "c", "parent", 3.0),
        ]
        for item_id, title, slug, parent_id, sort_order in rows:
            conn.execute(
                """
                INSERT INTO items (
                    id, title, slug, parent_id, sort_order, created_by,
                    updated_by, created_at, updated_at, state_changed_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item_id,
                    title,
                    slug,
                    parent_id,
                    sort_order,
                    "alice",
                    "alice",
                    timestamp,
                    timestamp,
                    timestamp,
                ),
            )
        conn.execute(
            """
            INSERT INTO dependencies (id, from_id, to_id, kind)
            VALUES ('existing-user-edge', 'c', 'b', 'explicit')
            """
        )

    apply_migrations(db_path)
    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        rows = conn.execute(
            """
            SELECT id, from_id, to_id, kind, automatic_chain
            FROM dependencies
            ORDER BY id
            """
        ).fetchall()
        migrations = conn.execute(
            "SELECT id FROM schema_migrations ORDER BY id"
        ).fetchall()

    assert [dict(row) for row in rows] == [
        {
            "id": "auto-chain-b-a",
            "from_id": "b",
            "to_id": "a",
            "kind": "explicit",
            "automatic_chain": 1,
        },
        {
            "id": "existing-user-edge",
            "from_id": "c",
            "to_id": "b",
            "kind": "explicit",
            "automatic_chain": 0,
        },
    ]
    assert [row["id"] for row in migrations] == [
        "20260701_automatic_sibling_chain",
        PHASE_BALL_SPLIT_MIGRATION_ID,
    ]


def test_migration_records_run_once_marker_in_legacy_timestamped_table(
    tmp_path,
) -> None:
    """Existing DBs may have a non-null timestamp on migration markers."""
    db_path = tmp_path / "agentfarm.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE schema_migrations (
              id TEXT PRIMARY KEY,
              applied_at TEXT NOT NULL
            )
            """
        )

    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        row = conn.execute(
            """
            SELECT id, applied_at
            FROM schema_migrations
            WHERE id = '20260701_automatic_sibling_chain'
            """
        ).fetchone()

    assert row is not None
    assert row["applied_at"]


def test_connection_has_foreign_keys_enabled(tmp_path) -> None:
    """Every connection enforces PRAGMA foreign_keys = ON (default is OFF)."""
    db_path = tmp_path / "agentfarm.db"
    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        (foreign_keys,) = conn.execute("PRAGMA foreign_keys").fetchone()

    assert foreign_keys == 1


def test_connection_waits_for_short_lived_sqlite_locks(tmp_path) -> None:
    """Connections tolerate normal overlapping request reads and writes."""
    db_path = tmp_path / "agentfarm.db"
    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        (busy_timeout,) = conn.execute("PRAGMA busy_timeout").fetchone()
        (journal_mode,) = conn.execute("PRAGMA journal_mode").fetchone()

    assert busy_timeout == SQLITE_BUSY_TIMEOUT_MS
    assert journal_mode == "wal"


def test_write_connection_serializes_until_commit(tmp_path) -> None:
    """Overlapping write requests enter SQLite one at a time through commit."""
    db_path = tmp_path / "agentfarm.db"
    apply_migrations(db_path)
    holder_ready = Event()
    release_holder = Event()
    contender_entered = Event()
    errors: list[BaseException] = []

    def hold_write_transaction() -> None:
        try:
            with get_write_connection(db_path) as conn:
                _insert_item(conn, "held-writer")
                holder_ready.set()
                release_holder.wait(timeout=2)
        except BaseException as exc:
            errors.append(exc)
            holder_ready.set()

    def contend_for_write_transaction() -> None:
        try:
            with get_write_connection(db_path) as conn:
                contender_entered.set()
                _insert_item(conn, "waiting-writer")
        except BaseException as exc:
            errors.append(exc)

    holder = Thread(target=hold_write_transaction)
    contender = Thread(target=contend_for_write_transaction)
    holder.start()
    assert holder_ready.wait(timeout=1)

    contender.start()
    assert not contender_entered.wait(timeout=0.05)

    release_holder.set()
    holder.join(timeout=1)
    contender.join(timeout=1)

    assert not holder.is_alive()
    assert not contender.is_alive()
    assert not errors
    assert contender_entered.is_set()

    with get_connection(db_path) as conn:
        rows = conn.execute("SELECT id FROM items ORDER BY id").fetchall()

    assert [row["id"] for row in rows] == ["held-writer", "waiting-writer"]


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


def test_delete_item_cascades_to_prompt_response_entries(tmp_path) -> None:
    """Deleting an item removes its prompt/response timeline entries."""
    db_path = tmp_path / "agentfarm.db"
    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        _insert_item(conn, "item-a")
        conn.execute(
            """
            INSERT INTO prompt_response_entries (
                id, item_id, kind, created_by, body, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                "entry-1",
                "item-a",
                "response",
                "alice",
                "$ make test\nPASS",
                "2026-01-01T00:00:00.000000Z",
            ),
        )

    with get_connection(db_path) as conn:
        conn.execute("DELETE FROM items WHERE id = ?", ("item-a",))

    with get_connection(db_path) as conn:
        remaining = conn.execute(
            "SELECT COUNT(*) FROM prompt_response_entries"
        ).fetchone()[0]

    assert remaining == 0


def test_delete_item_cascades_to_notes(tmp_path) -> None:
    """Deleting an item removes its dated notes."""
    db_path = tmp_path / "agentfarm.db"
    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        _insert_item(conn, "item-a")
        conn.execute(
            """
            INSERT INTO item_notes (
                id, item_id, created_by, body, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                "note-1",
                "item-a",
                "alice",
                "# Note",
                "2026-01-01T00:00:00.000000Z",
                "2026-01-01T00:00:00.000000Z",
            ),
        )

    with get_connection(db_path) as conn:
        conn.execute("DELETE FROM items WHERE id = ?", ("item-a",))

    with get_connection(db_path) as conn:
        remaining = conn.execute("SELECT COUNT(*) FROM item_notes").fetchone()[0]

    assert remaining == 0


def test_duplicate_edge_rejected_by_unique_constraint(tmp_path) -> None:
    """UNIQUE (from_id, to_id) prevents duplicate dependency edges."""
    db_path = tmp_path / "agentfarm.db"
    apply_migrations(db_path)

    with get_connection(db_path) as conn:
        _insert_item(conn, "item-a")
        _insert_item(conn, "item-b")
        conn.execute(
            "INSERT INTO dependencies (id, from_id, to_id, kind) VALUES (?, ?, ?, ?)",
            ("dep-1", "item-a", "item-b", "explicit"),
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
