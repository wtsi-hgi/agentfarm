"""Aggregate payload for the authenticated home page."""

from __future__ import annotations

import sqlite3
from typing import Annotated

from fastapi import APIRouter, Depends

from api.schemas import HomePayloadOut, HomePriorityItemOut, TreeItemOut, WhoAmI
from api.v1.authz import require_identity
from config import settings
from db.connection import get_db
from services import leverage, tree

from . import items, markers, scratchpad

router = APIRouter()


def _row_to_home_tree_item(
    row: sqlite3.Row,
    *,
    needs_edges: list[tree.ExplicitNeedsEdge],
    actionable: bool,
    complete: bool,
    has_notes: bool,
    has_prompt_response_entries: bool,
) -> TreeItemOut:
    data = dict(row)
    data["blocked_external"] = bool(data["blocked_external"])
    if data["parent_id"] is not None:
        data["repo_url"] = None
        data["usage"] = ""
    return TreeItemOut(
        **data,
        needs=[edge["slug"] for edge in needs_edges],
        needs_edges=needs_edges,
        actionable=actionable,
        complete=complete,
        has_notes=has_notes,
        has_prompt_response_entries=has_prompt_response_entries,
    )


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
        needs_edges = needs_edges_by_item.get(item_id, [])
        tree_items.append(
            _row_to_home_tree_item(
                row,
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
        HomePriorityItemOut(id=item_id, rank=rank)
        for rank, item_id in enumerate(projection.priority_item_ids(), start=1)
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
