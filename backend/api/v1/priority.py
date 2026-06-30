"""Priority endpoint for actionable leaves in unblock-leverage order."""

from __future__ import annotations

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends

from api.v1.authz import require_identity
from db.connection import get_db
from services import leverage

from ..schemas import PriorityItemOut

router = APIRouter()

_ITEM_COLUMNS = (
    "id, title, slug, parent_id, sort_order, state, mode, effort, "
    "blocked_external, blocked_note, blocked_followup_date, "
    "created_by, updated_by, created_at, updated_at, state_changed_at, "
    "completed_at"
)


def _row_to_priority_item(row: sqlite3.Row, rank: int) -> PriorityItemOut:
    """Build a ranked priority entry from a persisted item row."""
    data = dict(row)
    data["blocked_external"] = bool(data["blocked_external"])
    data["rank"] = rank
    return PriorityItemOut(**data)


@router.get("/priority", response_model=list[PriorityItemOut])
async def get_priority(
    _identity: Annotated[object, Depends(require_identity)],
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
) -> list[PriorityItemOut]:
    """Return actionable leaves in descending unblock-leverage order."""
    ranked: list[PriorityItemOut] = []
    for rank, item_id in enumerate(leverage.priority_item_ids(conn), start=1):
        row = conn.execute(
            f"SELECT {_ITEM_COLUMNS} FROM items WHERE id = ?", (item_id,)
        ).fetchone()
        if row is not None:
            ranked.append(_row_to_priority_item(row, rank))
    return ranked
