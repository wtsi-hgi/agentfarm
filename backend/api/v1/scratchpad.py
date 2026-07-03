"""Scratchpad endpoints for owner-authored cross-item notes."""

from __future__ import annotations

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends

from api.v1.authz import require_identity, require_owner
from db.connection import begin_immediate, get_db, get_write_db
from services.clock import now
from services.identity import current_actor

from ..schemas import ScratchpadOut, ScratchpadUpdate

router = APIRouter()

SCRATCHPAD_ID = "primary"
DEFAULT_HEIGHT = 220


def _default_scratchpad() -> ScratchpadOut:
    """Return the empty scratchpad state before the owner first saves it."""
    return ScratchpadOut(
        body="",
        height=DEFAULT_HEIGHT,
        minimized=True,
        updated_by=None,
        updated_at=None,
    )


def _scratchpad_row(conn: sqlite3.Connection) -> sqlite3.Row | None:
    """Return the singleton scratchpad row, if it has been saved."""
    return conn.execute(
        """
        SELECT body, height, minimized, updated_by, updated_at
        FROM scratchpad
        WHERE id = ?
        """,
        (SCRATCHPAD_ID,),
    ).fetchone()


def _row_to_scratchpad(row: sqlite3.Row | None) -> ScratchpadOut:
    """Build a response model from a persisted row or defaults."""
    if row is None:
        return _default_scratchpad()
    return ScratchpadOut(
        body=row["body"],
        height=row["height"],
        minimized=bool(row["minimized"]),
        updated_by=row["updated_by"],
        updated_at=row["updated_at"],
    )


@router.get("/scratchpad", response_model=ScratchpadOut)
async def get_scratchpad(
    _identity: Annotated[object, Depends(require_identity)],
    conn: Annotated[sqlite3.Connection, Depends(get_db, scope="function")],
) -> ScratchpadOut:
    """Return the saved scratchpad to any signed-in user."""
    return _row_to_scratchpad(_scratchpad_row(conn))


@router.patch("/scratchpad", response_model=ScratchpadOut)
async def update_scratchpad(
    payload: ScratchpadUpdate,
    _owner: Annotated[object, Depends(require_owner)],
    conn: Annotated[sqlite3.Connection, Depends(get_write_db, scope="function")],
) -> ScratchpadOut:
    """Persist owner scratchpad edits, size, and minimized state."""
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        current = _row_to_scratchpad(_scratchpad_row(conn))
        return current

    # Direct unit calls may pass a plain connection; the route dependency has
    # already claimed the write transaction before endpoint code runs.
    begin_immediate(conn)
    current = _row_to_scratchpad(_scratchpad_row(conn))
    saved = ScratchpadOut(
        body=updates.get("body", current.body),
        height=updates.get("height", current.height),
        minimized=updates.get("minimized", current.minimized),
        updated_by=current_actor(),
        updated_at=now(),
    )
    conn.execute(
        """
        INSERT INTO scratchpad (
            id, body, height, minimized, updated_by, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            body = excluded.body,
            height = excluded.height,
            minimized = excluded.minimized,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at
        """,
        (
            SCRATCHPAD_ID,
            saved.body,
            saved.height,
            int(saved.minimized),
            saved.updated_by,
            saved.updated_at,
        ),
    )
    return saved
