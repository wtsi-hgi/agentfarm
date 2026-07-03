"""SQLite connection helpers (the project's "session factory").

Every connection produced here:

* enables ``PRAGMA foreign_keys = ON`` -- SQLite defaults this *off*, and the
  schema's ``ON DELETE CASCADE`` constraints (relied on by the delete-cascade
  stories) only fire when it is on. It must be set per connection, not once
  globally, because the pragma is connection-scoped.
* enables WAL journal mode and a busy timeout so normal overlap between the
  browser, the Next.js server layer, and FastAPI request cleanup waits for
  short-lived SQLite locks instead of surfacing ``database is locked``.
* uses ``sqlite3.Row`` as the row factory so rows are accessed by column name.

The parent directory of the database file (``settings.data_dir``) is created
on demand so a first connection on a fresh deployment succeeds.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from config import settings

SQLITE_BUSY_TIMEOUT_MS = 30_000


def _resolve_db_path(db_path: Path | str | None) -> Path:
    """Return the configured DB path, defaulting to ``settings.db_path``."""
    if db_path is None:
        return Path(settings.db_path)
    return Path(db_path)


def connect(db_path: Path | str | None = None) -> sqlite3.Connection:
    """Open a SQLite connection with project pragmas applied.

    Ensures the parent directory exists, enables foreign-key enforcement, and
    sets a ``sqlite3.Row`` row factory. Callers are responsible for committing
    and closing; prefer :func:`get_connection` which handles that.

    Args:
        db_path: Optional path override. Defaults to ``settings.db_path`` so the
            running app uses the configured ``data_dir``; tests pass a temporary
            path.
    """
    resolved = _resolve_db_path(db_path)
    resolved.parent.mkdir(parents=True, exist_ok=True)

    # ``check_same_thread=False``: the ``get_db`` request dependency is a sync
    # generator, which FastAPI runs in a worker thread, while the connection may
    # be used from the event-loop thread of an ``async`` endpoint. Each request
    # still gets its own connection (see ``get_db``), so the connection is never
    # shared concurrently; relaxing the thread check just permits this in-request
    # hand-off that SQLite otherwise forbids.
    conn = sqlite3.connect(
        resolved,
        check_same_thread=False,
        timeout=SQLITE_BUSY_TIMEOUT_MS / 1000,
    )
    conn.row_factory = sqlite3.Row
    conn.execute(f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA journal_mode = WAL").fetchone()
    # Connection-scoped: must run for every connection, every time.
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def get_connection(db_path: Path | str | None = None) -> Iterator[sqlite3.Connection]:
    """Yield a configured connection, committing on success and always closing.

    On a successful ``with`` block the transaction is committed; if the block
    raises, the transaction is rolled back. The connection is closed either way.

    Args:
        db_path: Optional path override (see :func:`connect`).
    """
    conn = connect(db_path)
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_db() -> Iterator[sqlite3.Connection]:
    """FastAPI dependency yielding a connection bound to ``settings.db_path``.

    Use with ``Depends(get_db, scope="function")`` in endpoints so the
    transaction is committed or rolled back before the response is sent.
    Semantics match :func:`get_connection` (commit on success, rollback on
    error, always close).
    """
    with get_connection() as conn:
        yield conn
