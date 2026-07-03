"""Note endpoints for dated item notes."""

from __future__ import annotations

import sqlite3
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from api.v1.authz import require_identity, require_owner
from db.connection import get_db
from services.clock import now
from services.identity import current_actor

from ..schemas import NoteCreate, NoteOut, NoteUpdate

router = APIRouter()

_NOTE_COLUMNS = "id, item_id, created_by, body, created_at, updated_at"


def _row_to_note(row: sqlite3.Row) -> NoteOut:
    """Build a :class:`NoteOut` from a persisted row."""
    return NoteOut(**dict(row))


def _item_exists(conn: sqlite3.Connection, item_id: str) -> bool:
    """Return whether an item with ``item_id`` exists."""
    row = conn.execute("SELECT 1 FROM items WHERE id = ?", (item_id,)).fetchone()
    return row is not None


def _note_row_or_404(conn: sqlite3.Connection, note_id: str) -> sqlite3.Row:
    """Return a note row or raise the API's not-found error."""
    row = conn.execute(
        f"SELECT {_NOTE_COLUMNS} FROM item_notes WHERE id = ?",
        (note_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="note not found")
    return row


@router.post("/items/{item_id}/notes", response_model=NoteOut)
async def create_note(
    item_id: str,
    payload: NoteCreate,
    _owner: Annotated[object, Depends(require_owner)],
    conn: Annotated[sqlite3.Connection, Depends(get_db, scope="function")],
) -> NoteOut:
    """Record one dated note for an existing item."""
    if not _item_exists(conn, item_id):
        raise HTTPException(status_code=404, detail="item not found")

    note_id = str(uuid.uuid4())
    timestamp = now()
    conn.execute(
        f"""
        INSERT INTO item_notes ({_NOTE_COLUMNS})
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (note_id, item_id, current_actor(), payload.body, timestamp, timestamp),
    )

    row = _note_row_or_404(conn, note_id)
    return _row_to_note(row)


@router.get("/items/{item_id}/notes", response_model=list[NoteOut])
async def list_notes(
    item_id: str,
    _identity: Annotated[object, Depends(require_identity)],
    conn: Annotated[sqlite3.Connection, Depends(get_db, scope="function")],
) -> list[NoteOut]:
    """List an item's notes oldest first."""
    if not _item_exists(conn, item_id):
        raise HTTPException(status_code=404, detail="item not found")

    rows = conn.execute(
        f"""
        SELECT {_NOTE_COLUMNS}
        FROM item_notes
        WHERE item_id = ?
        ORDER BY created_at ASC, id ASC
        """,
        (item_id,),
    ).fetchall()
    return [_row_to_note(row) for row in rows]


@router.patch("/notes/{note_id}", response_model=NoteOut)
async def update_note(
    note_id: str,
    payload: NoteUpdate,
    _owner: Annotated[object, Depends(require_owner)],
    conn: Annotated[sqlite3.Connection, Depends(get_db, scope="function")],
) -> NoteOut:
    """Edit a note body while preserving its original creation timestamp."""
    _note_row_or_404(conn, note_id)

    timestamp = now()
    conn.execute(
        "UPDATE item_notes SET body = ?, updated_at = ? WHERE id = ?",
        (payload.body, timestamp, note_id),
    )

    row = _note_row_or_404(conn, note_id)
    return _row_to_note(row)
