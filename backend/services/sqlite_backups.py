"""Automated online backups for the live SQLite database."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import sqlite3
import time
from collections.abc import Awaitable, Callable
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Lock

logger = logging.getLogger("agentfarm.backups")

_SQLITE_BUSY_TIMEOUT_MS = 30_000
_DEFAULT_RETENTION_DAYS = 30
_BACKUP_FILENAME_PATTERN = re.compile(
    r"^agentfarm-backup-(?P<timestamp>\d{8}T\d{12}Z)-\d{6}\.db$"
)
_BackupClock = Callable[[], float]
_BackupSleep = Callable[[float], Awaitable[None]]
_backup_clock: _BackupClock = time.monotonic
_state_lock = Lock()


@dataclass
class _BackupState:
    """Cadence state for one source database and backup directory."""

    dirty_generation: int = 0
    backed_up_generation: int = 0
    last_attempt_at: float | None = None
    last_success_at: float | None = None
    sequence: int = 0


_states: dict[tuple[Path, Path], _BackupState] = {}


def set_backup_clock(clock: _BackupClock) -> None:
    """Override the monotonic clock used for backup cadence tests."""
    global _backup_clock
    _backup_clock = clock


def reset_backup_state() -> None:
    """Reset backup cadence state and the injected clock."""
    global _backup_clock
    with _state_lock:
        _states.clear()
        _backup_clock = time.monotonic


def record_committed_write(
    db_path: Path | str,
    backup_dir: Path | str | None,
    interval_seconds: int,
    retention_days: int = _DEFAULT_RETENTION_DAYS,
) -> Path | None:
    """Mark the DB dirty and maybe create an online backup after a write commit.

    Args:
        db_path: Live SQLite database file.
        backup_dir: Directory where timestamped backup DB files are written.
            ``None`` or an empty string disables backups.
        interval_seconds: Minimum time between backup attempts for this source DB
            and destination. ``0`` means each committed write may try to back up.
        retention_days: Number of days to retain timestamped Agent Farm backup
            files after each successful backup. ``0`` disables pruning.

    Returns:
        The created backup file path, or ``None`` when disabled, throttled, or
        when the best-effort backup attempt fails.
    """
    destination_dir = _normalise_backup_dir(backup_dir)
    if destination_dir is None:
        return None

    source_path = Path(db_path)
    try:
        _mark_dirty(source_path, destination_dir)
        return flush_due_backup(
            source_path,
            destination_dir,
            interval_seconds,
            retention_days,
        )
    except Exception:
        logger.exception("SQLite backup scheduling failed for %s", source_path)
        return None


def flush_due_backup(
    db_path: Path | str,
    backup_dir: Path | str | None,
    interval_seconds: int,
    retention_days: int = _DEFAULT_RETENTION_DAYS,
) -> Path | None:
    """Create an online backup when dirty state is due for a flush.

    Backup work is deliberately best-effort. Any setup, SQLite, or replace
    failure is logged and converted to ``None`` so it cannot make a committed
    database write fail after the fact.
    """
    destination_dir = _normalise_backup_dir(backup_dir)
    if destination_dir is None:
        return None

    source_path = Path(db_path)
    temp_path: Path | None = None
    try:
        key = _state_key(source_path, destination_dir)
        now = _backup_clock()
        with _state_lock:
            state = _states.setdefault(key, _BackupState())
            if state.dirty_generation <= state.backed_up_generation:
                return None
            if _within_interval(
                now=now,
                last_attempt_at=state.last_attempt_at,
                interval_seconds=interval_seconds,
            ):
                return None
            state.last_attempt_at = now
            generation_to_backup = state.dirty_generation

        destination_dir.mkdir(parents=True, exist_ok=True)
        with _state_lock:
            state = _states.setdefault(key, _BackupState())
            backup_path = _next_backup_path(destination_dir, state)
        temp_path = backup_path.with_name(f".{backup_path.name}.tmp")

        _online_backup(source_path, temp_path)
        os.replace(temp_path, backup_path)

        with _state_lock:
            state = _states.setdefault(key, _BackupState())
            state.backed_up_generation = max(
                state.backed_up_generation, generation_to_backup
            )
            state.last_success_at = now

        logger.info("SQLite backup written to %s", backup_path)
        _prune_old_backups_best_effort(destination_dir, retention_days)
        return backup_path
    except Exception:
        if temp_path is not None:
            with suppress(OSError):
                temp_path.unlink(missing_ok=True)
        logger.exception("SQLite backup failed for %s", source_path)
        return None


async def run_backup_scheduler(
    db_path: Path | str,
    backup_dir: Path | str | None,
    interval_seconds: int,
    retention_days: int = _DEFAULT_RETENTION_DAYS,
    *,
    sleep: _BackupSleep = asyncio.sleep,
) -> None:
    """Flush dirty SQLite backups on a background cadence until cancelled."""
    if _normalise_backup_dir(backup_dir) is None:
        return

    delay = _scheduler_delay_seconds(interval_seconds)
    while True:
        await sleep(delay)
        await asyncio.to_thread(
            flush_due_backup,
            db_path,
            backup_dir,
            interval_seconds,
            retention_days,
        )


def start_backup_scheduler(
    db_path: Path | str,
    backup_dir: Path | str | None,
    interval_seconds: int,
    retention_days: int = _DEFAULT_RETENTION_DAYS,
) -> asyncio.Task[None] | None:
    """Start the background backup scheduler, or return ``None`` when disabled."""
    if _normalise_backup_dir(backup_dir) is None:
        return None
    return asyncio.create_task(
        run_backup_scheduler(db_path, backup_dir, interval_seconds, retention_days),
        name="sqlite-backup-scheduler",
    )


def _mark_dirty(source_path: Path, destination_dir: Path) -> None:
    """Record that a committed write needs a future backup."""
    key = _state_key(source_path, destination_dir)
    with _state_lock:
        state = _states.setdefault(key, _BackupState())
        state.dirty_generation += 1


def _state_key(source_path: Path, destination_dir: Path) -> tuple[Path, Path]:
    """Return the cache key for backup cadence state."""
    return (source_path.resolve(), destination_dir.resolve())


def _normalise_backup_dir(backup_dir: Path | str | None) -> Path | None:
    """Return a backup directory path, or ``None`` when backups are disabled."""
    if backup_dir is None:
        return None
    if isinstance(backup_dir, str) and not backup_dir.strip():
        return None
    return Path(backup_dir)


def _within_interval(
    *, now: float, last_attempt_at: float | None, interval_seconds: int
) -> bool:
    """Return whether a backup attempt would exceed the configured cadence."""
    return (
        last_attempt_at is not None
        and interval_seconds > 0
        and now - last_attempt_at < interval_seconds
    )


def _scheduler_delay_seconds(interval_seconds: int) -> float:
    """Return the background loop sleep delay without permitting a tight loop."""
    if interval_seconds <= 0:
        return 1.0
    return float(interval_seconds)


def _next_backup_path(backup_dir: Path, state: _BackupState) -> Path:
    """Return a unique timestamped backup path in ``backup_dir``."""
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    while True:
        state.sequence += 1
        candidate = backup_dir / f"agentfarm-backup-{timestamp}-{state.sequence:06d}.db"
        if not candidate.exists():
            return candidate


def _prune_old_backups_best_effort(backup_dir: Path, retention_days: int) -> None:
    """Prune old app-created backup files without affecting backup success."""
    try:
        _prune_old_backup_files(backup_dir, retention_days)
    except Exception:
        logger.exception("SQLite backup retention pruning failed in %s", backup_dir)


def _prune_old_backup_files(backup_dir: Path, retention_days: int) -> None:
    """Delete app-created backup files older than the configured retention."""
    if retention_days <= 0:
        return

    cutoff = datetime.now(UTC) - timedelta(days=retention_days)
    for path in backup_dir.iterdir():
        timestamp = _backup_timestamp_from_name(path.name)
        if timestamp is None or timestamp >= cutoff:
            continue
        try:
            path.unlink()
        except OSError:
            logger.exception("Failed to prune old SQLite backup %s", path)


def _backup_timestamp_from_name(name: str) -> datetime | None:
    """Extract the UTC timestamp from an Agent Farm backup filename."""
    match = _BACKUP_FILENAME_PATTERN.match(name)
    if match is None:
        return None
    try:
        return datetime.strptime(
            match.group("timestamp"),
            "%Y%m%dT%H%M%S%fZ",
        ).replace(tzinfo=UTC)
    except ValueError:
        return None


def _online_backup(source_path: Path, target_path: Path) -> None:
    """Copy ``source_path`` to ``target_path`` using SQLite's backup API."""
    target_path.unlink(missing_ok=True)
    source = sqlite3.connect(
        source_path,
        timeout=_SQLITE_BUSY_TIMEOUT_MS / 1000,
    )
    try:
        source.execute(f"PRAGMA busy_timeout = {_SQLITE_BUSY_TIMEOUT_MS}")
        destination = sqlite3.connect(target_path)
        try:
            source.backup(destination)
        finally:
            destination.close()
    finally:
        source.close()
