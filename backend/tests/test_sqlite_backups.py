"""Regression tests for automated SQLite online backups."""

from __future__ import annotations

import asyncio
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import pytest

import config
from db.connection import get_write_connection
from db.migrate import apply_migrations
from services import sqlite_backups


@pytest.fixture(autouse=True)
def reset_backup_state():
    """Keep backup cadence state from leaking across tests."""
    sqlite_backups.reset_backup_state()
    yield
    sqlite_backups.reset_backup_state()


def _insert_item(conn: sqlite3.Connection, item_id: str) -> None:
    """Insert a minimal valid item row."""
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
            item_id,
            1.0,
            "alice",
            "alice",
            "2026-01-01T00:00:00.000000Z",
            "2026-01-01T00:00:00.000000Z",
            "2026-01-01T00:00:00.000000Z",
        ),
    )


def _backup_files(backup_dir: Path) -> list[Path]:
    """Return backup files newest-agnostically."""
    return sorted(backup_dir.glob("agentfarm-backup-*.db"))


def _item_ids(db_path: Path) -> set[str]:
    """Return item IDs visible in a SQLite database file."""
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute("SELECT id FROM items").fetchall()
    return {row[0] for row in rows}


def test_blank_backup_location_disables_backup(monkeypatch, tmp_path) -> None:
    """No backup is created when the configured location is empty."""
    db_path = tmp_path / "agentfarm.db"
    backup_dir = tmp_path / "backups"
    apply_migrations(db_path)
    monkeypatch.setattr(config.settings, "backup_dir", None)
    monkeypatch.setattr(config.settings, "backup_interval_seconds", 600)

    with get_write_connection(db_path) as conn:
        _insert_item(conn, "no-backup")

    assert not backup_dir.exists()


def test_enabled_backup_captures_committed_wal_write_online(
    monkeypatch, tmp_path
) -> None:
    """The backup contains a committed write even while another reader is open."""
    db_path = tmp_path / "agentfarm.db"
    backup_dir = tmp_path / "backups"
    apply_migrations(db_path)
    monkeypatch.setattr(config.settings, "backup_dir", backup_dir)
    monkeypatch.setattr(config.settings, "backup_interval_seconds", 600)

    reader = sqlite3.connect(db_path)
    try:
        reader.execute("BEGIN")
        reader.execute("SELECT COUNT(*) FROM items").fetchone()

        with get_write_connection(db_path) as conn:
            _insert_item(conn, "online-write")
    finally:
        reader.rollback()
        reader.close()

    backups = _backup_files(backup_dir)
    assert len(backups) == 1
    assert "online-write" in _item_ids(backups[0])


def test_backup_setup_failure_does_not_fail_committed_write(
    monkeypatch, tmp_path
) -> None:
    """A bad backup target is best-effort: the committed write still persists."""
    db_path = tmp_path / "agentfarm.db"
    backup_path_that_is_a_file = tmp_path / "not-a-directory"
    backup_path_that_is_a_file.write_text("not a directory", encoding="utf-8")
    apply_migrations(db_path)
    monkeypatch.setattr(config.settings, "backup_dir", backup_path_that_is_a_file)
    monkeypatch.setattr(config.settings, "backup_interval_seconds", 600)

    with get_write_connection(db_path) as conn:
        _insert_item(conn, "survives-backup-failure")

    assert _item_ids(db_path) == {"survives-backup-failure"}
    assert backup_path_that_is_a_file.read_text(encoding="utf-8") == "not a directory"


def test_backup_requires_a_committed_write(monkeypatch, tmp_path) -> None:
    """Opening a write transaction without changes does not create a backup."""
    db_path = tmp_path / "agentfarm.db"
    backup_dir = tmp_path / "backups"
    apply_migrations(db_path)
    monkeypatch.setattr(config.settings, "backup_dir", backup_dir)
    monkeypatch.setattr(config.settings, "backup_interval_seconds", 600)

    with get_write_connection(db_path) as conn:
        conn.execute("SELECT 1").fetchone()

    assert _backup_files(backup_dir) == []

    with get_write_connection(db_path) as conn:
        _insert_item(conn, "written")

    assert len(_backup_files(backup_dir)) == 1


async def test_scheduler_flushes_dirty_write_after_interval_without_later_write(
    monkeypatch, tmp_path
) -> None:
    """A dirty DB is backed up on the interval even without another write."""
    db_path = tmp_path / "agentfarm.db"
    backup_dir = tmp_path / "backups"
    monotonic_now = 0.0
    apply_migrations(db_path)
    monkeypatch.setattr(config.settings, "backup_dir", backup_dir)
    monkeypatch.setattr(config.settings, "backup_interval_seconds", 600)
    sqlite_backups.set_backup_clock(lambda: monotonic_now)

    with get_write_connection(db_path) as conn:
        _insert_item(conn, "first")

    assert len(_backup_files(backup_dir)) == 1

    monotonic_now = 300.0
    with get_write_connection(db_path) as conn:
        _insert_item(conn, "second")

    backups_after_second = _backup_files(backup_dir)
    assert len(backups_after_second) == 1
    assert _item_ids(backups_after_second[0]) == {"first"}

    sleep_count = 0

    async def one_scheduler_tick(delay: float) -> None:
        nonlocal monotonic_now, sleep_count
        assert delay == 600
        if sleep_count == 0:
            sleep_count += 1
            monotonic_now = 600.0
            return
        raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        await sqlite_backups.run_backup_scheduler(
            db_path,
            backup_dir,
            600,
            sleep=one_scheduler_tick,
        )

    backups = _backup_files(backup_dir)
    assert len(backups) == 2
    assert _item_ids(backups[-1]) == {"first", "second"}


def test_backup_throttles_writes_until_interval_passes(monkeypatch, tmp_path) -> None:
    """Writes inside the interval share one backup; later writes can back up."""
    db_path = tmp_path / "agentfarm.db"
    backup_dir = tmp_path / "backups"
    monotonic_now = 0.0
    apply_migrations(db_path)
    monkeypatch.setattr(config.settings, "backup_dir", backup_dir)
    monkeypatch.setattr(config.settings, "backup_interval_seconds", 600)
    sqlite_backups.set_backup_clock(lambda: monotonic_now)

    with get_write_connection(db_path) as conn:
        _insert_item(conn, "first")

    assert len(_backup_files(backup_dir)) == 1

    monotonic_now = 300.0
    with get_write_connection(db_path) as conn:
        _insert_item(conn, "second")

    backups_after_second = _backup_files(backup_dir)
    assert len(backups_after_second) == 1
    assert _item_ids(backups_after_second[0]) == {"first"}

    monotonic_now = 601.0
    assert sqlite_backups.flush_due_backup(db_path, backup_dir, 600) is not None

    with get_write_connection(db_path) as conn:
        _insert_item(conn, "third")

    assert len(_backup_files(backup_dir)) == 2

    monotonic_now = 1202.0
    assert sqlite_backups.flush_due_backup(db_path, backup_dir, 600) is not None

    backups = _backup_files(backup_dir)
    assert len(backups) == 3
    assert _item_ids(backups[-1]) == {"first", "second", "third"}


async def test_lifespan_starts_and_stops_backup_scheduler_when_enabled(
    monkeypatch, tmp_path
) -> None:
    """FastAPI lifespan owns the background SQLite backup scheduler."""
    import main
    from main import lifespan

    monkeypatch.setattr(config.settings, "data_dir", tmp_path)
    monkeypatch.setattr(config.settings, "backup_dir", tmp_path / "backups")
    monkeypatch.setattr(config.settings, "backup_interval_seconds", 123)
    monkeypatch.setattr(config.settings, "ldap_dn_template", None)
    monkeypatch.setattr(main, "apply_migrations", lambda: None)
    monkeypatch.setattr(
        main,
        "prepare_tls_paths",
        lambda *, data_dir, configured_cert, configured_key: SimpleNamespace(
            cert=Path(data_dir) / "cert.pem",
            key=Path(data_dir) / "key.pem",
        ),
    )
    started_with: list[tuple[Path, Path, int]] = []
    cancelled = asyncio.Event()

    async def idle_scheduler() -> None:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    def fake_start_backup_scheduler(
        db_path: Path, backup_dir: Path | None, interval_seconds: int
    ) -> asyncio.Task[None] | None:
        assert backup_dir is not None
        started_with.append((db_path, backup_dir, interval_seconds))
        return asyncio.create_task(idle_scheduler())

    monkeypatch.setattr(
        main,
        "start_backup_scheduler",
        fake_start_backup_scheduler,
        raising=False,
    )

    app = SimpleNamespace(state=SimpleNamespace())
    async with lifespan(app):
        await asyncio.sleep(0)
        assert started_with == [(tmp_path / "agentfarm.db", tmp_path / "backups", 123)]

    assert cancelled.is_set()
