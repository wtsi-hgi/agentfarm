"""Time marker and change-window endpoints (spec: I1)."""

from __future__ import annotations

import sqlite3
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from api.v1.authz import require_identity, require_owner
from db.connection import get_db
from services import mirror
from services.clock import now

from ..schemas import ItemOut, MarkerCreate, MarkerOut

router = APIRouter()

_ITEM_COLUMNS = (
    "id, title, slug, parent_id, sort_order, state, mode, effort, "
    "blocked_external, blocked_note, blocked_followup_date, "
    "description, repo_url, "
    "created_by, updated_by, created_at, updated_at, state_changed_at, "
    "completed_at"
)

_FIELD_COLUMNS: dict[str, str] = {
    "created": "created_at",
    "changed": "updated_at",
    "completed": "completed_at",
}


def _row_to_marker(row: sqlite3.Row) -> MarkerOut:
    """Build a :class:`MarkerOut` from a persisted marker row."""
    return MarkerOut(**dict(row))


def _row_to_item(row: sqlite3.Row) -> ItemOut:
    """Build an :class:`ItemOut` from a persisted item row."""
    data = dict(row)
    data["blocked_external"] = bool(data["blocked_external"])
    if data["parent_id"] is not None:
        data["repo_url"] = None
    return ItemOut(**data)


def _marker_at(conn: sqlite3.Connection, marker_id: str) -> str:
    """Return a marker's timestamp or raise 404 when the id is unknown."""
    row = conn.execute("SELECT at FROM markers WHERE id = ?", (marker_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="marker not found")
    return str(row["at"])


@router.post("/markers", response_model=MarkerOut)
async def create_marker(
    payload: MarkerCreate,
    _owner: Annotated[object, Depends(require_owner)],
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
) -> MarkerOut:
    """Create a named marker, defaulting ``at`` to the current clock instant."""
    timestamp = now()
    marker_id = str(uuid.uuid4())
    marker_at = payload.at if payload.at is not None else timestamp

    conn.execute("DELETE FROM markers WHERE name = ?", (payload.name,))
    conn.execute(
        """
        INSERT INTO markers (id, name, at, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (marker_id, payload.name, marker_at, timestamp),
    )

    row = conn.execute("SELECT * FROM markers WHERE id = ?", (marker_id,)).fetchone()
    marker = _row_to_marker(row)
    mirror.commit_current_tree(conn)
    return marker


@router.get("/markers", response_model=list[MarkerOut])
async def list_markers(
    _identity: Annotated[object, Depends(require_identity)],
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
) -> list[MarkerOut]:
    """List markers in deterministic chronological order."""
    rows = conn.execute("SELECT * FROM markers ORDER BY at, created_at, id").fetchall()
    return [_row_to_marker(row) for row in rows]


@router.get("/changes", response_model=list[ItemOut])
async def list_changes(
    _identity: Annotated[object, Depends(require_identity)],
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
    since: Annotated[str | None, Query()] = None,
    between: Annotated[str | None, Query()] = None,
    field: Literal["created", "changed", "completed"] = "changed",
) -> list[ItemOut]:
    """Return items whose selected timestamp falls within a marker window.

    ``since`` uses an exclusive lower bound: items must be after the marker.
    ``between`` uses an exclusive lower and inclusive upper bound:
    ``(first_marker.at, second_marker.at]``. That keeps adjacent windows from
    double-counting the first marker instant while including the closing marker.
    """
    if (since is None) == (between is None):
        raise HTTPException(
            status_code=422,
            detail="provide exactly one of since or between",
        )

    column = _FIELD_COLUMNS[field]

    if since is not None:
        lower = _marker_at(conn, since)
        predicate = f"{column} > ?"
        params = (lower,)
    else:
        marker_ids = between.split(",") if between is not None else []
        if len(marker_ids) != 2 or not all(marker_ids):
            raise HTTPException(
                status_code=422,
                detail="between must contain two marker ids",
            )
        lower = _marker_at(conn, marker_ids[0])
        upper = _marker_at(conn, marker_ids[1])
        predicate = f"{column} > ? AND {column} <= ?"
        params = (lower, upper)

    rows = conn.execute(
        f"""
        SELECT {_ITEM_COLUMNS}
        FROM items
        WHERE {column} IS NOT NULL AND {predicate}
        ORDER BY {column}, created_at, id
        """,
        params,
    ).fetchall()
    return [_row_to_item(row) for row in rows]
