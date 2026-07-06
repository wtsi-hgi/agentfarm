"""Regression tests for automated SQLite online backups."""

from __future__ import annotations

import asyncio
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Event
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


def _write_timestamped_backup_file(
    backup_dir: Path,
    timestamp: datetime,
    *,
    sequence: int = 1,
) -> Path:
    """Write a file using the app's successful-backup filename shape."""
    path = (
        backup_dir / f"agentfarm-backup-{timestamp.strftime('%Y%m%dT%H%M%S%fZ')}"
        f"-{sequence:06d}.db"
    )
    path.write_text("existing backup", encoding="utf-8")
    return path


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


def test_concurrent_zero_interval_flushes_share_one_backup(
    monkeypatch, tmp_path
) -> None:
    """Overlapping immediate flushes do not duplicate a pending dirty backup."""
    db_path = tmp_path / "agentfarm.db"
    backup_dir = tmp_path / "backups"
    monotonic_now = 0.0
    apply_migrations(db_path)
    monkeypatch.setattr(config.settings, "backup_dir", backup_dir)
    monkeypatch.setattr(config.settings, "backup_interval_seconds", 600)
    sqlite_backups.set_backup_clock(lambda: monotonic_now)

    with get_write_connection(db_path) as conn:
        _insert_item(conn, "first")

    monotonic_now = 300.0
    with get_write_connection(db_path) as conn:
        _insert_item(conn, "second")

    assert len(_backup_files(backup_dir)) == 1

    original_online_backup = sqlite_backups._online_backup
    first_backup_started = Event()
    release_first_backup = Event()

    def slow_first_online_backup(source_path: Path, target_path: Path) -> None:
        if not first_backup_started.is_set():
            first_backup_started.set()
            assert release_first_backup.wait(timeout=5)
        original_online_backup(source_path, target_path)

    monkeypatch.setattr(sqlite_backups, "_online_backup", slow_first_online_backup)

    with ThreadPoolExecutor(max_workers=1) as executor:
        first_flush = executor.submit(
            sqlite_backups.flush_due_backup,
            db_path,
            backup_dir,
            0,
        )
        assert first_backup_started.wait(timeout=5)
        try:
            second_flush_path = sqlite_backups.flush_due_backup(db_path, backup_dir, 0)
        finally:
            release_first_backup.set()

        first_flush_path = first_flush.result(timeout=5)

    assert first_flush_path is not None
    assert second_flush_path is None
    backups = _backup_files(backup_dir)
    assert len(backups) == 2
    assert _item_ids(backups[-1]) == {"first", "second"}


def test_successful_backup_prunes_only_old_app_backup_files(
    monkeypatch, tmp_path
) -> None:
    """Retention prunes old app backups and preserves recent/unrelated files."""
    db_path = tmp_path / "agentfarm.db"
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    apply_migrations(db_path)
    now = datetime.now(UTC)
    old_backup = _write_timestamped_backup_file(
        backup_dir,
        now - timedelta(days=31),
        sequence=1,
    )
    recent_backup = _write_timestamped_backup_file(
        backup_dir,
        now - timedelta(days=2),
        sequence=2,
    )
    unrelated_db = backup_dir / "operator-snapshot.db"
    unrelated_db.write_text("keep me", encoding="utf-8")
    non_timestamped_agentfarm_db = backup_dir / "agentfarm-backup-manual.db"
    non_timestamped_agentfarm_db.write_text("keep me too", encoding="utf-8")
    monkeypatch.setattr(config.settings, "backup_dir", backup_dir)
    monkeypatch.setattr(config.settings, "backup_interval_seconds", 0)
    monkeypatch.setattr(config.settings, "backup_retention_days", 30)

    with get_write_connection(db_path) as conn:
        _insert_item(conn, "new-backup")

    created_backups = [
        path
        for path in _backup_files(backup_dir)
        if path not in {recent_backup, non_timestamped_agentfarm_db}
    ]
    assert not old_backup.exists()
    assert recent_backup.exists()
    assert unrelated_db.exists()
    assert non_timestamped_agentfarm_db.exists()
    assert len(created_backups) == 1
    assert _item_ids(created_backups[0]) == {"new-backup"}


def test_zero_retention_days_keeps_all_backup_files(monkeypatch, tmp_path) -> None:
    """A zero-day retention setting disables pruning after successful backups."""
    db_path = tmp_path / "agentfarm.db"
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    apply_migrations(db_path)
    old_backup = _write_timestamped_backup_file(
        backup_dir,
        datetime.now(UTC) - timedelta(days=365),
    )
    monkeypatch.setattr(config.settings, "backup_dir", backup_dir)
    monkeypatch.setattr(config.settings, "backup_interval_seconds", 0)
    monkeypatch.setattr(config.settings, "backup_retention_days", 0)

    with get_write_connection(db_path) as conn:
        _insert_item(conn, "kept-backups")

    assert old_backup.exists()
    assert len(_backup_files(backup_dir)) == 2


def test_pruning_failure_does_not_fail_successful_backup_or_write(
    monkeypatch, tmp_path
) -> None:
    """Retention cleanup is best-effort after the SQLite backup is written."""
    db_path = tmp_path / "agentfarm.db"
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    apply_migrations(db_path)
    old_backup = _write_timestamped_backup_file(
        backup_dir,
        datetime.now(UTC) - timedelta(days=60),
    )
    monkeypatch.setattr(config.settings, "backup_dir", backup_dir)
    monkeypatch.setattr(config.settings, "backup_interval_seconds", 0)
    monkeypatch.setattr(config.settings, "backup_retention_days", 30)
    original_unlink = Path.unlink

    def fail_old_backup_unlink(self: Path, *args, **kwargs) -> None:
        if self == old_backup:
            raise OSError("permission denied")
        original_unlink(self, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_old_backup_unlink)

    with get_write_connection(db_path) as conn:
        _insert_item(conn, "write-survives-prune-failure")

    assert _item_ids(db_path) == {"write-survives-prune-failure"}
    assert old_backup.exists()
    created_backups = [path for path in _backup_files(backup_dir) if path != old_backup]
    assert len(created_backups) == 1
    assert _item_ids(created_backups[0]) == {"write-survives-prune-failure"}


async def test_lifespan_starts_and_stops_backup_scheduler_when_enabled(
    monkeypatch, tmp_path
) -> None:
    """FastAPI lifespan owns the background SQLite backup scheduler."""
    import main
    from main import lifespan

    monkeypatch.setattr(config.settings, "data_dir", tmp_path)
    monkeypatch.setattr(config.settings, "backup_dir", tmp_path / "backups")
    monkeypatch.setattr(config.settings, "backup_interval_seconds", 123)
    monkeypatch.setattr(config.settings, "backup_retention_days", 14)
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
    started_with: list[tuple[Path, Path, int, int]] = []
    cancelled = asyncio.Event()

    async def idle_scheduler() -> None:
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    def fake_start_backup_scheduler(
        db_path: Path,
        backup_dir: Path | None,
        interval_seconds: int,
        retention_days: int,
    ) -> asyncio.Task[None] | None:
        assert backup_dir is not None
        started_with.append((db_path, backup_dir, interval_seconds, retention_days))
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
        assert started_with == [
            (tmp_path / "agentfarm.db", tmp_path / "backups", 123, 14)
        ]

    assert cancelled.is_set()
