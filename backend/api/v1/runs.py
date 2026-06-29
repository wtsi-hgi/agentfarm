"""Run endpoints for the stubbed v2 seam (spec: M1)."""

from __future__ import annotations

import sqlite3
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from api.v1.authz import require_owner
from db.connection import get_db
from services.clock import now

from ..schemas import RunOut

router = APIRouter()

_RUN_COLUMNS = "id, item_id, status, created_at"


def _row_to_run(row: sqlite3.Row) -> RunOut:
    """Build a :class:`RunOut` from a persisted runs row."""
    return RunOut(**dict(row))


def _item_exists(conn: sqlite3.Connection, item_id: str) -> bool:
    """Return whether an item with ``item_id`` exists."""
    row = conn.execute("SELECT 1 FROM items WHERE id = ?", (item_id,)).fetchone()
    return row is not None


@router.post("/items/{item_id}/runs", response_model=RunOut)
async def create_run(
    item_id: str,
    _owner: Annotated[object, Depends(require_owner)],
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
) -> RunOut:
    """Create a pending stub run row for an existing item."""
    if not _item_exists(conn, item_id):
        raise HTTPException(status_code=404, detail="item not found")

    run_id = str(uuid.uuid4())
    timestamp = now()
    conn.execute(
        f"""
        INSERT INTO runs ({_RUN_COLUMNS})
        VALUES (?, ?, 'pending', ?)
        """,
        (run_id, item_id, timestamp),
    )

    row = conn.execute(
        f"SELECT {_RUN_COLUMNS} FROM runs WHERE id = ?",
        (run_id,),
    ).fetchone()
    return _row_to_run(row)


@router.get("/items/{item_id}/runs", response_model=list[RunOut])
async def list_runs(
    item_id: str,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
) -> list[RunOut]:
    """List an item's stub runs in creation order."""
    if not _item_exists(conn, item_id):
        raise HTTPException(status_code=404, detail="item not found")

    rows = conn.execute(
        f"""
        SELECT {_RUN_COLUMNS}
        FROM runs
        WHERE item_id = ?
        ORDER BY created_at ASC, id ASC
        """,
        (item_id,),
    ).fetchall()
    return [_row_to_run(row) for row in rows]
