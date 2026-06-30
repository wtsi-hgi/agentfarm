"""Prompt/response timeline endpoints for item-agent interaction history."""

from __future__ import annotations

import sqlite3
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from api.v1.authz import require_identity, require_owner
from db.connection import get_db
from services.clock import now
from services.identity import current_actor

from ..schemas import PromptResponseEntryCreate, PromptResponseEntryOut

router = APIRouter()

_ENTRY_COLUMNS = "id, item_id, kind, created_by, body, created_at"


def _row_to_entry(row: sqlite3.Row) -> PromptResponseEntryOut:
    """Build a :class:`PromptResponseEntryOut` from a persisted row."""
    return PromptResponseEntryOut(**dict(row))


def _item_exists(conn: sqlite3.Connection, item_id: str) -> bool:
    """Return whether an item with ``item_id`` exists."""
    row = conn.execute("SELECT 1 FROM items WHERE id = ?", (item_id,)).fetchone()
    return row is not None


@router.post("/items/{item_id}/prompt-responses", response_model=PromptResponseEntryOut)
async def create_prompt_response_entry(
    item_id: str,
    payload: PromptResponseEntryCreate,
    _owner: Annotated[object, Depends(require_owner)],
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
) -> PromptResponseEntryOut:
    """Record one prompt or response entry for an existing item."""
    if not _item_exists(conn, item_id):
        raise HTTPException(status_code=404, detail="item not found")

    entry_id = str(uuid.uuid4())
    timestamp = now()
    conn.execute(
        f"""
        INSERT INTO prompt_response_entries ({_ENTRY_COLUMNS})
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (entry_id, item_id, payload.kind, current_actor(), payload.body, timestamp),
    )

    row = conn.execute(
        f"SELECT {_ENTRY_COLUMNS} FROM prompt_response_entries WHERE id = ?",
        (entry_id,),
    ).fetchone()
    return _row_to_entry(row)


@router.get(
    "/items/{item_id}/prompt-responses",
    response_model=list[PromptResponseEntryOut],
)
async def list_prompt_response_entries(
    item_id: str,
    _identity: Annotated[object, Depends(require_identity)],
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
) -> list[PromptResponseEntryOut]:
    """List an item's prompt/response timeline entries oldest first."""
    if not _item_exists(conn, item_id):
        raise HTTPException(status_code=404, detail="item not found")

    rows = conn.execute(
        f"""
        SELECT {_ENTRY_COLUMNS}
        FROM prompt_response_entries
        WHERE item_id = ?
        ORDER BY created_at ASC, id ASC
        """,
        (item_id,),
    ).fetchall()
    return [_row_to_entry(row) for row in rows]
