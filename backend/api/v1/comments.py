"""Comment endpoints for flat item discussions (spec: J1)."""

from __future__ import annotations

import sqlite3
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from api.v1.authz import require_identity
from db.connection import get_db
from services.clock import now
from services.identity import current_actor

from ..schemas import CommentCreate, CommentOut, CommentUpdate, DeletedResponse

router = APIRouter()

_COMMENT_COLUMNS = "id, item_id, author, body, created_at, updated_at"
_OWNERSHIP_ERROR = "cannot modify another user's comment"


def _row_to_comment(row: sqlite3.Row) -> CommentOut:
    """Build a :class:`CommentOut` from a persisted comments row."""
    return CommentOut(**dict(row))


def _item_exists(conn: sqlite3.Connection, item_id: str) -> bool:
    """Return whether an item with ``item_id`` exists."""
    row = conn.execute("SELECT 1 FROM items WHERE id = ?", (item_id,)).fetchone()
    return row is not None


def _comment_row_or_404(conn: sqlite3.Connection, comment_id: str) -> sqlite3.Row:
    """Return a comment row or raise the API's not-found error."""
    row = conn.execute(
        f"SELECT {_COMMENT_COLUMNS} FROM comments WHERE id = ?",
        (comment_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="comment not found")
    return row


def _ensure_author(row: sqlite3.Row) -> None:
    """Reject attempts to mutate a comment created by another actor."""
    if current_actor() != row["author"]:
        raise HTTPException(status_code=403, detail=_OWNERSHIP_ERROR)


@router.post("/items/{item_id}/comments", response_model=CommentOut)
async def create_comment(
    item_id: str,
    payload: CommentCreate,
    _identity: Annotated[object, Depends(require_identity)],
    conn: Annotated[sqlite3.Connection, Depends(get_db, scope="function")],
) -> CommentOut:
    """Create a comment on an existing item, authored by the current actor."""
    if not _item_exists(conn, item_id):
        raise HTTPException(status_code=404, detail="item not found")

    comment_id = str(uuid.uuid4())
    timestamp = now()
    conn.execute(
        f"""
        INSERT INTO comments ({_COMMENT_COLUMNS})
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (comment_id, item_id, current_actor(), payload.body, timestamp, timestamp),
    )

    row = _comment_row_or_404(conn, comment_id)
    return _row_to_comment(row)


@router.get("/items/{item_id}/comments", response_model=list[CommentOut])
async def list_comments(
    item_id: str,
    _identity: Annotated[object, Depends(require_identity)],
    conn: Annotated[sqlite3.Connection, Depends(get_db, scope="function")],
) -> list[CommentOut]:
    """List an item's comments flat, ordered by creation time ascending."""
    if not _item_exists(conn, item_id):
        raise HTTPException(status_code=404, detail="item not found")

    rows = conn.execute(
        f"""
        SELECT {_COMMENT_COLUMNS}
        FROM comments
        WHERE item_id = ?
        ORDER BY created_at ASC, id ASC
        """,
        (item_id,),
    ).fetchall()
    return [_row_to_comment(row) for row in rows]


@router.patch("/comments/{comment_id}", response_model=CommentOut)
async def update_comment(
    comment_id: str,
    payload: CommentUpdate,
    _identity: Annotated[object, Depends(require_identity)],
    conn: Annotated[sqlite3.Connection, Depends(get_db, scope="function")],
) -> CommentOut:
    """Edit a comment body, allowed only for its original author."""
    existing = _comment_row_or_404(conn, comment_id)
    _ensure_author(existing)

    timestamp = now()
    conn.execute(
        "UPDATE comments SET body = ?, updated_at = ? WHERE id = ?",
        (payload.body, timestamp, comment_id),
    )

    row = _comment_row_or_404(conn, comment_id)
    return _row_to_comment(row)


@router.delete("/comments/{comment_id}", response_model=DeletedResponse)
async def delete_comment(
    comment_id: str,
    _identity: Annotated[object, Depends(require_identity)],
    conn: Annotated[sqlite3.Connection, Depends(get_db, scope="function")],
) -> DeletedResponse:
    """Delete a comment, allowed only for its original author."""
    existing = _comment_row_or_404(conn, comment_id)
    _ensure_author(existing)

    conn.execute("DELETE FROM comments WHERE id = ?", (comment_id,))
    return DeletedResponse(deleted=True, id=comment_id)
