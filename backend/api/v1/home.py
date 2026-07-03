"""Aggregate payload for the authenticated home page."""

from __future__ import annotations

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends

from api.schemas import HomePayloadOut, TreeItemOut, WhoAmI
from api.v1.authz import require_identity
from config import settings
from db.connection import get_db
from services import leverage

from . import items, markers, priority, scratchpad

router = APIRouter()


@router.get("/home", response_model=HomePayloadOut)
async def get_home(
    identity: Annotated[WhoAmI, Depends(require_identity)],
    conn: Annotated[sqlite3.Connection, Depends(get_db, scope="function")],
) -> HomePayloadOut:
    """Return the verified session and initial home-page data in one read."""
    projection = leverage.build_projection(conn)
    needs_edges_by_item = items._explicit_needs_edges_by_item(conn)
    item_ids_with_notes = items._item_ids_with_notes(conn)
    item_ids_with_prompt_response_entries = (
        items._item_ids_with_prompt_response_entries(conn)
    )

    tree_items: list[TreeItemOut] = []
    for item_id in projection.tree_order_ids():
        row = projection.item_rows.get(item_id)
        if row is None:
            continue
        item = items._row_to_item(row)
        needs_edges = needs_edges_by_item.get(item_id, [])
        tree_items.append(
            TreeItemOut(
                **item.model_dump(),
                needs=[edge["slug"] for edge in needs_edges],
                needs_edges=needs_edges,
                actionable=projection.is_actionable(item_id),
                complete=projection.is_complete(item_id),
                has_notes=item_id in item_ids_with_notes,
                has_prompt_response_entries=(
                    item_id in item_ids_with_prompt_response_entries
                ),
            )
        )

    priority_items = [
        priority._row_to_priority_item(row, rank)
        for rank, item_id in enumerate(projection.priority_item_ids(), start=1)
        if (row := projection.item_rows.get(item_id)) is not None
    ]
    marker_rows = conn.execute(
        "SELECT * FROM markers ORDER BY at, created_at, id"
    ).fetchall()

    return HomePayloadOut(
        owner_username=settings.owner,
        session=identity,
        items=tree_items,
        priority_items=priority_items,
        markers=[markers._row_to_marker(row) for row in marker_rows],
        scratchpad=scratchpad._row_to_scratchpad(scratchpad._scratchpad_row(conn)),
    )
