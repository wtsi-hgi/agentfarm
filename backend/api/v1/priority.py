"""Priority endpoint for actionable leaves in unblock-leverage order."""

from __future__ import annotations

import sqlite3
from collections.abc import Mapping
from typing import Annotated, Any

from fastapi import APIRouter, Depends

from api.v1.authz import require_identity
from db.connection import get_db
from services import leverage

from ..schemas import PriorityItemOut

router = APIRouter()

_ITEM_COLUMNS = (
    "id, title, slug, parent_id, sort_order, state, mode, effort, "
    "blocked_external, blocked_note, blocked_followup_date, "
    "description, repo_url, usage, "
    "created_by, updated_by, created_at, updated_at, state_changed_at, "
    "completed_at"
)


def _row_to_priority_item(row: Mapping[str, Any], rank: int) -> PriorityItemOut:
    """Build a ranked priority entry from a persisted item row."""
    data = dict(row)
    data["blocked_external"] = bool(data["blocked_external"])
    if data["parent_id"] is not None:
        data["repo_url"] = None
        data["usage"] = ""
    data["rank"] = rank
    return PriorityItemOut(**data)


@router.get("/priority", response_model=list[PriorityItemOut])
async def get_priority(
    _identity: Annotated[object, Depends(require_identity)],
    conn: Annotated[sqlite3.Connection, Depends(get_db, scope="function")],
) -> list[PriorityItemOut]:
    """Return actionable leaves in descending unblock-leverage order."""
    projection = leverage.build_projection(conn)
    ranked: list[PriorityItemOut] = []
    for rank, item_id in enumerate(projection.priority_item_ids(), start=1):
        row = projection.item_rows.get(item_id)
        if row is not None:
            ranked.append(_row_to_priority_item(row, rank))
    return ranked
