"""Item endpoints (spec: A. Data model and items).

Currently implements ``POST /items`` (A1: create with defaults). Request and
response wiring lives here; the structural behaviour (slug derivation, sibling
ordering, implicit-edge generation, the clock and the acting user) lives in
``services`` so it can be reused and extended by later stories.

Each request runs inside one transaction (the ``get_db`` dependency commits on
success, rolls back on error), so inserting the item and regenerating its
sibling group's implicit edges are atomic.
"""

from __future__ import annotations

import sqlite3
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from db.connection import get_db
from models.enums import State, is_complete
from services import graph, tree
from services.clock import now
from services.identity import current_actor

from ..schemas import DeletedResponse, ItemCreate, ItemOut, ItemUpdate, TreeItemOut

router = APIRouter()

# Columns selected to hydrate an ``ItemOut``; kept in one place so the insert
# and the read-back stay in sync.
_ITEM_COLUMNS = (
    "id, title, slug, parent_id, sort_order, state, mode, effort, "
    "blocked_external, blocked_note, blocked_followup_date, "
    "created_by, updated_by, created_at, updated_at, state_changed_at, "
    "completed_at"
)


def _row_to_item(row: sqlite3.Row) -> ItemOut:
    """Build an :class:`ItemOut` from a persisted ``items`` row.

    The stored ``blocked_external`` integer (0/1) is mapped to a Python bool so
    the response is a JSON boolean; the remaining columns map straight across.
    """
    data = dict(row)
    data["blocked_external"] = bool(data["blocked_external"])
    return ItemOut(**data)


@router.post("/items", response_model=ItemOut)
async def create_item(
    payload: ItemCreate,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
) -> ItemOut:
    """Create an item with server-assigned id/slug/order/timestamps (A1).

    The server assigns the ``id`` (UUIDv4), derives a unique ``slug`` from the
    title, computes ``sort_order`` within the sibling group (appended, or after
    ``after_id``), records the acting user as ``created_by``/``updated_by``, and
    stamps all four creation timestamps with one ``now`` (``completed_at`` stays
    null). Defaults fill any omitted field. After insertion the sibling group's
    implicit edges are regenerated so sequencing follows the tree.
    """
    item_id = str(uuid.uuid4())
    slug = tree.derive_unique_slug(conn, payload.title)
    sort_order = tree.compute_sort_order(conn, payload.parent_id, payload.after_id)
    actor = current_actor()
    timestamp = now()

    conn.execute(
        f"""
        INSERT INTO items ({_ITEM_COLUMNS})
        VALUES (
            :id, :title, :slug, :parent_id, :sort_order, :state, :mode, :effort,
            :blocked_external, :blocked_note, :blocked_followup_date,
            :created_by, :updated_by, :created_at, :updated_at,
            :state_changed_at, :completed_at
        )
        """,
        {
            "id": item_id,
            "title": payload.title,
            "slug": slug,
            "parent_id": payload.parent_id,
            "sort_order": sort_order,
            "state": payload.state.value,
            "mode": payload.mode.value,
            "effort": payload.effort.value,
            # Defaults that are not part of the create contract yet.
            "blocked_external": 0,
            "blocked_note": None,
            "blocked_followup_date": None,
            "created_by": actor,
            "updated_by": actor,
            # One instant for all creation timestamps; completed_at stays null.
            "created_at": timestamp,
            "updated_at": timestamp,
            "state_changed_at": timestamp,
            "completed_at": None,
        },
    )

    # Re-chain the affected sibling group's implicit edges (A1 / Core rules).
    graph.regenerate_sibling_chain(conn, payload.parent_id)

    row = conn.execute(
        f"SELECT {_ITEM_COLUMNS} FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    return _row_to_item(row)


@router.delete("/items/{item_id}", response_model=DeletedResponse)
async def delete_item(
    item_id: str,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
) -> DeletedResponse:
    """Delete an item and its whole subtree, then re-chain the group it left (A4).

    The item's ``parent_id`` is captured BEFORE the delete so the sibling group
    can be re-chained afterwards. A single ``DELETE FROM items`` then relies on
    the schema's ``ON DELETE CASCADE`` (with ``PRAGMA foreign_keys = ON`` set per
    connection in ``db.connection``) to remove, in cascade: all descendants (via
    ``parent_id``), every descendant's and the item's own ``comments`` and
    ``runs`` (via ``item_id``), and ALL incident dependency edges -- both where
    the item is ``from_id`` and where it is ``to_id``. Nothing the cascade covers
    is hand-deleted.

    Because the deleted item's incident implicit edges were cascade-removed,
    regenerating the implicit chain for the captured ``parent_id`` (which may be
    ``None`` for a root/product group) re-derives a single clean chain over the
    remaining siblings (e.g. ``[a,b,c]`` minus ``b`` becomes ``c->a``). An
    unknown id is 404.
    """
    existing = conn.execute(
        "SELECT parent_id FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    if existing is None:
        raise HTTPException(status_code=404, detail="item not found")

    # Capture BEFORE deletion: the group this item leaves must be re-chained,
    # and the row (and thus its parent_id) is gone once the delete runs.
    parent_id = existing["parent_id"]

    # One delete; ON DELETE CASCADE removes the subtree, its comments/runs, and
    # every incident edge (from_id or to_id). foreign_keys=ON makes it fire.
    conn.execute("DELETE FROM items WHERE id = ?", (item_id,))

    # Re-chain the sibling group the item left so order stays a single chain.
    # The deleted item's incident implicit edges are already gone (cascade), so
    # regeneration over the survivors yields one clean chain (root group when
    # parent_id is None).
    graph.regenerate_sibling_chain(conn, parent_id)

    return DeletedResponse(deleted=True, id=item_id)


@router.get("/tree", response_model=list[TreeItemOut])
async def get_tree(
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
) -> list[TreeItemOut]:
    """Return every item in tree order, each with its live ``needs`` labels (A3).

    Items are returned in preorder depth-first order (roots by ``sort_order``
    then ``id``, then each item's descendants recursively in the same order),
    so the payload reads top-to-bottom like the outline itself.

    Each entry carries its :class:`ItemOut` fields plus ``needs``: the *current*
    slugs of that item's EXPLICIT (``>needs:``) dependency targets. Because
    edges are stored by ``to_id`` (an item id) and the slug is looked up live,
    a renamed target's label updates automatically while the stored edge is
    unchanged. Implicit (tree-derived) edges are not shown as needs labels.
    """
    rows = {
        row["id"]: row
        for row in conn.execute(f"SELECT {_ITEM_COLUMNS} FROM items").fetchall()
    }
    result: list[TreeItemOut] = []
    for item_id in tree.items_in_tree_order(conn):
        item = _row_to_item(rows[item_id])
        needs = tree.explicit_needs_slugs(conn, item_id)
        result.append(TreeItemOut(**item.model_dump(), needs=needs))
    return result


@router.patch("/items/{item_id}", response_model=ItemOut)
async def update_item(
    item_id: str,
    payload: ItemUpdate,
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
) -> ItemOut:
    """Edit any subset of an item's fields (A2).

    Applies ONLY the fields the client actually sent (``exclude_unset``), so an
    omitted field is left unchanged while an explicit ``null`` for a nullable
    field (``blocked_note`` / ``blocked_followup_date``) clears it. A bad enum
    token is rejected by request validation as 422 (naming the field); an
    unknown id is 404.

    Side effects on the columns that were sent:

    * Any change stamps ``updated_at = now`` and ``updated_by`` = the actor.
    * A ``title`` change re-derives the unique ``slug`` (``exclude_id`` is this
      item, so it yields to other items' slugs but never collides with itself).
    * A ``state`` change stamps ``state_changed_at = now`` and sets
      ``completed_at`` to ``now`` for ``done``/``abandoned`` or clears it
      otherwise.

    Identity, parent, ``sort_order``, edges, and comments are never touched
    here, so a rename or re-categorisation is lossless.
    """
    existing = conn.execute("SELECT id FROM items WHERE id = ?", (item_id,)).fetchone()
    if existing is None:
        raise HTTPException(status_code=404, detail="item not found")

    # Only the fields the client actually sent; an explicit null is kept (and
    # clears a nullable column) while an omitted field is simply absent here.
    provided = payload.model_dump(exclude_unset=True)

    # Columns to write, built from the provided fields plus derived side effects.
    updates: dict[str, object] = {}

    if "title" in provided:
        updates["title"] = provided["title"]
        # Re-derive slug on rename; exclude self so an unchanged title is a
        # no-op and a collision yields to other items (Core domain rules / A3).
        updates["slug"] = tree.derive_unique_slug(
            conn, provided["title"], exclude_id=item_id
        )

    if "mode" in provided:
        updates["mode"] = provided["mode"].value
    if "effort" in provided:
        updates["effort"] = provided["effort"].value

    if "state" in provided:
        new_state: State = provided["state"]
        updates["state"] = new_state.value
        updates["state_changed_at"] = now()
        # done/abandoned record completion; any other state clears it.
        updates["completed_at"] = now() if is_complete(new_state) else None

    if "blocked_external" in provided:
        # Stored as integer 0/1 (schema), exposed as a JSON bool on read-back.
        updates["blocked_external"] = 1 if provided["blocked_external"] else 0
    if "blocked_note" in provided:
        updates["blocked_note"] = provided["blocked_note"]
    if "blocked_followup_date" in provided:
        updates["blocked_followup_date"] = provided["blocked_followup_date"]

    if updates:
        # Any change updates the audit columns with one shared instant.
        updates["updated_at"] = now()
        updates["updated_by"] = current_actor()

        assignments = ", ".join(f"{column} = :{column}" for column in updates)
        conn.execute(
            f"UPDATE items SET {assignments} WHERE id = :id",
            {**updates, "id": item_id},
        )

    row = conn.execute(
        f"SELECT {_ITEM_COLUMNS} FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    return _row_to_item(row)
