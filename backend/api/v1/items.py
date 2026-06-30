"""Item endpoints (spec: A. Data model and items).

Currently implements item CRUD and structure endpoints. Request and response
wiring lives here; the structural behaviour (slug derivation, sibling
ordering, dependency cleanup, the clock and the acting user) lives in
``services`` so it can be reused and extended by later stories.

Each request runs inside one transaction (the ``get_db`` dependency commits on
success, rolls back on error), so item mutations and dependency cleanup are
atomic.
"""

from __future__ import annotations

import sqlite3
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from api.v1.authz import require_identity, require_owner
from db.connection import get_db
from models.enums import State, is_complete
from services import graph, leverage, mirror, tree
from services.clock import now
from services.identity import current_actor

from ..schemas import (
    DeletedResponse,
    ItemCreate,
    ItemOut,
    ItemUpdate,
    MoveRequest,
    TreeItemOut,
)

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


def _item_exists(conn: sqlite3.Connection, item_id: str) -> bool:
    """Return whether an item with ``item_id`` exists."""
    row = conn.execute("SELECT 1 FROM items WHERE id = ?", (item_id,)).fetchone()
    return row is not None


def _parent_id_of(conn: sqlite3.Connection, item_id: str) -> str | None:
    """Return ``item_id``'s current ``parent_id`` (``None`` if root or missing)."""
    row = conn.execute(
        "SELECT parent_id FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    return row["parent_id"] if row is not None else None


def _is_in_sibling_group(
    conn: sqlite3.Connection, item_id: str, parent_id: str | None
) -> bool:
    """Return whether ``item_id`` belongs to the sibling group under ``parent_id``."""
    return _parent_id_of(conn, item_id) == parent_id


def _preceding_sibling_id(conn: sqlite3.Connection, item_id: str) -> str | None:
    """Return the id of ``item_id``'s immediately preceding sibling, or ``None``.

    Siblings share a ``parent_id`` and are ordered by ``sort_order`` then ``id``.
    Returns ``None`` when ``item_id`` is the first child of its parent or the
    item does not exist, i.e. there is no item to indent under.
    """
    row = conn.execute(
        "SELECT parent_id FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    if row is None:
        return None
    parent_id = row["parent_id"]
    if parent_id is None:
        siblings = conn.execute(
            "SELECT id FROM items WHERE parent_id IS NULL ORDER BY sort_order, id"
        ).fetchall()
    else:
        siblings = conn.execute(
            "SELECT id FROM items WHERE parent_id = ? ORDER BY sort_order, id",
            (parent_id,),
        ).fetchall()
    ordered = [sibling["id"] for sibling in siblings]
    position = ordered.index(item_id)
    if position == 0:
        return None
    return ordered[position - 1]


@router.post("/items", response_model=ItemOut)
async def create_item(
    payload: ItemCreate,
    _owner: Annotated[object, Depends(require_owner)],
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
) -> ItemOut:
    """Create an item with server-assigned id/slug/order/timestamps (A1).

    The server assigns the ``id`` (UUIDv4), derives a unique ``slug`` from the
    title, computes ``sort_order`` within the sibling group (appended, or after
    ``after_id`` when that anchor is in the requested sibling group), records
    the acting user as ``created_by``/``updated_by``, and stamps all four
    creation timestamps with one ``now`` (``completed_at`` stays null). Defaults
    fill any omitted field. Sibling order is organisational only: creation does
    not add a dependency on neighbouring items.
    """
    if payload.parent_id is not None and not _item_exists(conn, payload.parent_id):
        raise HTTPException(status_code=404, detail="item not found")
    if payload.after_id is not None:
        if not _item_exists(conn, payload.after_id):
            raise HTTPException(status_code=404, detail="item not found")
        if not _is_in_sibling_group(conn, payload.after_id, payload.parent_id):
            raise HTTPException(status_code=404, detail="item not found")

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

    # Clean any legacy generated edges for this sibling group; creation itself
    # does not derive dependencies from order.
    graph.regenerate_group(conn, payload.parent_id)

    row = conn.execute(
        f"SELECT {_ITEM_COLUMNS} FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    item = _row_to_item(row)
    mirror.commit_current_tree(conn)
    return item


@router.delete("/items/{item_id}", response_model=DeletedResponse)
async def delete_item(
    item_id: str,
    _owner: Annotated[object, Depends(require_owner)],
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
) -> DeletedResponse:
    """Delete an item and its whole subtree, then clean the group it left (A4).

    The item's ``parent_id`` is captured BEFORE the delete so the sibling group
    can be cleaned afterwards. A single ``DELETE FROM items`` then relies on
    the schema's ``ON DELETE CASCADE`` (with ``PRAGMA foreign_keys = ON`` set per
    connection in ``db.connection``) to remove, in cascade: all descendants (via
    ``parent_id``), every descendant's and the item's own ``comments`` and
    ``runs`` (via ``item_id``), and ALL incident dependency edges -- both where
    the item is ``from_id`` and where it is ``to_id``. Nothing the cascade covers
    is hand-deleted.

    Because the deleted item's incident dependency edges were cascade-removed,
    the captured sibling group only needs legacy implicit-edge cleanup. Sibling
    order does not create replacement dependencies. An unknown id is 404.
    """
    existing = conn.execute(
        "SELECT parent_id FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    if existing is None:
        raise HTTPException(status_code=404, detail="item not found")

    # Capture BEFORE deletion: the group this item leaves must be cleaned,
    # and the row (and thus its parent_id) is gone once the delete runs.
    parent_id = existing["parent_id"]

    # One delete; ON DELETE CASCADE removes the subtree, its comments/runs, and
    # every incident edge (from_id or to_id). foreign_keys=ON makes it fire.
    conn.execute("DELETE FROM items WHERE id = ?", (item_id,))

    # Clean the sibling group the item left. The deleted item's incident edges
    # are already gone via cascade; no order-derived replacement edge is added.
    graph.regenerate_group(conn, parent_id)

    mirror.commit_current_tree(conn)
    return DeletedResponse(deleted=True, id=item_id)


@router.post("/items/{item_id}/indent", response_model=ItemOut)
async def indent_item(
    item_id: str,
    _owner: Annotated[object, Depends(require_owner)],
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
) -> ItemOut:
    """Indent an item: make it the first child of its preceding sibling (F2 Tab).

    Spec 8.1 ("becomes the first child of the preceding item"): the item moves
    under its immediately-preceding sibling (which thereby becomes a container)
    and is positioned as that container's first child (lowest ``sort_order``).
    The item's whole subtree moves with it (only its own ``parent_id`` changes).

    Invalid when the item has no preceding sibling (it is the first child of its
    parent): there is nothing to indent under, so this is 422 ``"cannot indent
    first item"``. An unknown id is 404.

    Identity is preserved (same ``id``; explicit edges and comments, stored by
    id, are untouched). The affected groups -- the sibling group the item left
    AND the new parent's child group -- run legacy implicit-edge cleanup via
    :func:`services.tree.reparent_item`.
    """
    preceding = _preceding_sibling_id(conn, item_id)
    if preceding is None:
        # No preceding sibling: either a missing id or the first child. 404 wins
        # for a truly unknown id; otherwise the indent itself is invalid.
        if not _item_exists(conn, item_id):
            raise HTTPException(status_code=404, detail="item not found")
        raise HTTPException(status_code=422, detail="cannot indent first item")

    tree.reparent_item(conn, item_id, preceding, as_first_child=True)

    row = conn.execute(
        f"SELECT {_ITEM_COLUMNS} FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    item = _row_to_item(row)
    mirror.commit_current_tree(conn)
    return item


@router.post("/items/{item_id}/outdent", response_model=ItemOut)
async def outdent_item(
    item_id: str,
    _owner: Annotated[object, Depends(require_owner)],
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
) -> ItemOut:
    """Outdent an item: move it up one level, after its former parent (F2 Shift-Tab).

    The item becomes a sibling of its FORMER PARENT, positioned immediately
    after that parent. The item's whole subtree moves with it. If the former
    parent then has no children it becomes a leaf again (derived from having no
    children; nothing extra stored).

    Invalid when the item is already at root (no parent): there is no level to
    move up to, so this is 422 ``"cannot outdent root item"``. An unknown id is
    404.

    Identity is preserved (same ``id``; explicit edges and comments untouched).
    The affected groups -- the former parent's child group AND the destination
    group the item joined (the grandparent's group) -- run legacy implicit-edge
    cleanup by :func:`services.tree.reparent_item`.
    """
    existing = conn.execute(
        "SELECT parent_id FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    if existing is None:
        raise HTTPException(status_code=404, detail="item not found")

    former_parent_id = existing["parent_id"]
    if former_parent_id is None:
        raise HTTPException(status_code=422, detail="cannot outdent root item")

    # The destination is the grandparent's group; the item lands right after its
    # former parent to preserve the familiar outliner shape.
    grandparent_id = _parent_id_of(conn, former_parent_id)
    tree.reparent_item(conn, item_id, grandparent_id, after_id=former_parent_id)

    row = conn.execute(
        f"SELECT {_ITEM_COLUMNS} FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    item = _row_to_item(row)
    mirror.commit_current_tree(conn)
    return item


@router.post("/items/{item_id}/move", response_model=ItemOut)
async def move_item(
    item_id: str,
    payload: MoveRequest,
    _owner: Annotated[object, Depends(require_owner)],
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
) -> ItemOut:
    """Reparent and/or reorder an item (and its whole subtree) (G1).

    Moves ``item_id`` under ``new_parent_id`` (``None`` promotes it to a
    root/product). ``position="first"`` places it at the start of the
    destination group. The default ``position="after"`` preserves legacy
    callers: it positions the item immediately after ``after_id`` when supplied,
    or appends at the end when ``after_id`` is omitted/null. Cross-product moves
    are allowed. Identity is preserved (same ``id``; explicit edges and
    comments, stored by id, are untouched). Both the source and destination
    sibling groups run legacy implicit-edge cleanup via
    :func:`services.tree.reparent_item`.

    Validation runs BEFORE any mutation, in this order:

    1. **404** ``item not found`` if ``item_id`` is unknown, if a non-null
       ``new_parent_id`` / ``after_id`` references an unknown item, or if
       ``after_id`` is not in the destination sibling group (consistent with the
       spec's not-found policy).
    2. **422** ``cannot move into own descendant`` if ``new_parent_id`` is the
       item itself or any descendant of it -- such a move would detach a cycle of
       items from the tree.
    3. Moving/reordering does not create dependency edges, so dependency-cycle
       rejection is only needed when adding explicit dependency edges.

    G2 (merge) and G3 (split) are built from this endpoint plus create/delete and
    need no separate routes (spec: G2, G3).
    """
    if not _item_exists(conn, item_id):
        raise HTTPException(status_code=404, detail="item not found")

    new_parent_id = payload.new_parent_id
    after_id = payload.after_id
    place_first = payload.position == "first"

    # A referenced destination parent or anchor sibling must exist (404 policy).
    if new_parent_id is not None and not _item_exists(conn, new_parent_id):
        raise HTTPException(status_code=404, detail="item not found")
    if after_id is not None:
        if not _item_exists(conn, after_id):
            raise HTTPException(status_code=404, detail="item not found")
        if not _is_in_sibling_group(conn, after_id, new_parent_id):
            raise HTTPException(status_code=404, detail="item not found")

    # Reparenting into the item's own subtree (including itself) would corrupt
    # the tree; reject before mutating.
    if new_parent_id is not None and tree.is_self_or_descendant(
        conn, item_id, new_parent_id
    ):
        raise HTTPException(status_code=422, detail="cannot move into own descendant")

    # Kept as a compatibility seam; with order-independent siblings this is
    # always false because moves do not add dependency edges.
    if graph.move_would_create_cycle(conn, item_id, new_parent_id, after_id=after_id):
        raise HTTPException(status_code=409, detail="dependency cycle rejected")

    tree.reparent_item(
        conn,
        item_id,
        new_parent_id,
        after_id=after_id,
        as_first_child=place_first,
    )

    row = conn.execute(
        f"SELECT {_ITEM_COLUMNS} FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    item = _row_to_item(row)
    mirror.commit_current_tree(conn)
    return item


@router.get("/tree", response_model=list[TreeItemOut])
async def get_tree(
    _identity: Annotated[object, Depends(require_identity)],
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
) -> list[TreeItemOut]:
    """Return every item in tree order with live labels and work flags (A3/H1).

    Items are returned in preorder depth-first order (roots by ``sort_order``
    then ``id``, then each item's descendants recursively in the same order),
    so the payload reads top-to-bottom like the outline itself.

    Each entry carries its :class:`ItemOut` fields plus ``needs``: the *current*
    slugs of that item's EXPLICIT (``>needs:``) dependency targets. Because
    edges are stored by ``to_id`` (an item id) and the slug is looked up live,
    a renamed target's label updates automatically while the stored edge is
    unchanged. Implicit (tree-derived) edges are not shown as needs labels.

    H1 adds per-item ``actionable`` and ``complete`` booleans for the work-now
    projection. They are computed per item without filtering: every stored item
    remains present in the response, including collapsed/non-actionable ones.
    """
    rows = {
        row["id"]: row
        for row in conn.execute(f"SELECT {_ITEM_COLUMNS} FROM items").fetchall()
    }
    result: list[TreeItemOut] = []
    for item_id in tree.items_in_tree_order(conn):
        item = _row_to_item(rows[item_id])
        needs = tree.explicit_needs_slugs(conn, item_id)
        result.append(
            TreeItemOut(
                **item.model_dump(),
                needs=needs,
                actionable=leverage.is_actionable(conn, item_id),
                complete=tree.is_complete(conn, item_id),
            )
        )
    return result


@router.patch("/items/{item_id}", response_model=ItemOut)
async def update_item(
    item_id: str,
    payload: ItemUpdate,
    _owner: Annotated[object, Depends(require_owner)],
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
    item = _row_to_item(row)
    mirror.commit_current_tree(conn)
    return item
