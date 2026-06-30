"""Tree operations: slug derivation and sibling ordering.

These are the structural primitives shared by the item endpoints. They operate
on an open ``sqlite3.Connection`` (supplied by the caller's request-scoped
transaction) and never open their own connection, so a whole mutation commits
or rolls back atomically.

Sort-order scheme (column is ``REAL``)
--------------------------------------
Siblings are kept in a strictly increasing ``sort_order`` so the row order is
unambiguous and an item can be inserted after any sibling without renumbering
the rest:

* Empty sibling group -> the first child gets ``1.0``.
* Append at end (no ``after_id``) -> ``max(sibling sort_order) + 1.0``.
* Insert after ``after_id`` -> the midpoint between ``after_id`` and the next
  sibling, or ``after_id + 1.0`` when ``after_id`` is the last sibling.

Fractional midpoints keep insertion O(1) and local; only the inserted row's
value is written.

Slug derivation
---------------
See :func:`slugify` and :func:`derive_unique_slug`. Slugs are display/typing
identifiers only; references between items are always by ``id``.

Completeness
------------
See :func:`is_complete`: a leaf is complete iff its state is ``done`` or
``abandoned``; a container (>=1 child) is complete iff ALL its children are
complete, recursively. Dependency-satisfaction checks use this so a dependency
on a container is satisfied only when the whole container is complete.
"""

from __future__ import annotations

import re
import sqlite3

from models.enums import State
from models.enums import is_complete as state_is_complete

# A "word" run for slugs is one or more characters that are NOT lowercase
# ASCII letters or digits. Each such run collapses to a single hyphen.
_NON_SLUG_RUN = re.compile(r"[^a-z0-9]+")

# Fallback slug when a title has no slug-able characters at all.
_EMPTY_SLUG_FALLBACK = "item"


def slugify(title: str) -> str:
    """Derive the base slug for ``title`` (before uniqueness handling).

    Rules (spec "Slug derivation"): lowercase; trim; replace each run of
    characters outside ``[a-z0-9]`` with a single ``-``; strip leading/trailing
    ``-``. An empty result becomes ``"item"``.

    Examples:
        ``"Ship login"`` -> ``"ship-login"``;
        ``"  C++  &  Rust  "`` -> ``"c-rust"``; ``"***"`` -> ``"item"``.
    """
    lowered = title.lower().strip()
    hyphenated = _NON_SLUG_RUN.sub("-", lowered)
    trimmed = hyphenated.strip("-")
    return trimmed or _EMPTY_SLUG_FALLBACK


def _existing_slugs(conn: sqlite3.Connection, exclude_id: str | None) -> set[str]:
    """Return the set of slugs currently in use, optionally excluding one item.

    ``exclude_id`` lets an item that is re-deriving its own slug (on rename)
    ignore the slug it currently holds, so re-saving an unchanged title is a
    no-op rather than bumping to ``-2``.
    """
    if exclude_id is None:
        rows = conn.execute("SELECT slug FROM items").fetchall()
    else:
        rows = conn.execute(
            "SELECT slug FROM items WHERE id != ?", (exclude_id,)
        ).fetchall()
    return {row["slug"] for row in rows}


def derive_unique_slug(
    conn: sqlite3.Connection, title: str, exclude_id: str | None = None
) -> str:
    """Return a unique slug for ``title`` within the items table.

    Derives the base slug (:func:`slugify`); if it is already taken by another
    item, appends ``-2``, ``-3``, ... and returns the first free suffix (>= 2).
    The item that owns the bare slug is whichever claimed it first; a
    re-deriving item yields to existing slugs.

    Args:
        conn: Open connection (within the caller's transaction).
        title: The item title to slugify.
        exclude_id: An item id whose current slug is ignored when checking for
            collisions (used when re-deriving that item's own slug on rename).
    """
    base = slugify(title)
    taken = _existing_slugs(conn, exclude_id)
    if base not in taken:
        return base
    suffix = 2
    while f"{base}-{suffix}" in taken:
        suffix += 1
    return f"{base}-{suffix}"


def _children_in_order(conn: sqlite3.Connection, parent_id: str | None) -> list[str]:
    """Return the ids of ``parent_id``'s children ordered as siblings.

    Ordering is ``sort_order`` then ``id`` (tie-break). ``parent_id`` of
    ``None`` selects the root/product group (``parent_id IS NULL``; SQLite never
    matches ``= NULL``).
    """
    if parent_id is None:
        rows = conn.execute(
            "SELECT id FROM items WHERE parent_id IS NULL ORDER BY sort_order, id"
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id FROM items WHERE parent_id = ? ORDER BY sort_order, id",
            (parent_id,),
        ).fetchall()
    return [row["id"] for row in rows]


def items_in_tree_order(conn: sqlite3.Connection) -> list[str]:
    """Return every item id in tree order (preorder depth-first).

    Roots (``parent_id IS NULL``) come first ordered by ``sort_order`` then
    ``id``; each item is immediately followed by its descendants, recursively in
    the same sibling order. This is the order used by GET ``/tree`` and the
    markdown mirror (L1) so the rendered tree matches the read API.

    Args:
        conn: Open connection (within the caller's transaction).
    """
    ordered: list[str] = []

    def visit(parent_id: str | None) -> None:
        for child_id in _children_in_order(conn, parent_id):
            ordered.append(child_id)
            visit(child_id)

    visit(None)
    return ordered


def current_slug(conn: sqlite3.Connection, item_id: str) -> str | None:
    """Return ``item_id``'s current slug, or ``None`` if no such item exists.

    Edges are stored by ``to_id`` (an item id), never by slug, so a displayed
    ``>needs:`` label is always resolved live from the target id to whatever
    slug that target holds *now*. After a rename the stored edge is unchanged
    but this lookup yields the new slug automatically (Core domain rules / A3).
    """
    row = conn.execute("SELECT slug FROM items WHERE id = ?", (item_id,)).fetchone()
    return row["slug"] if row is not None else None


def is_complete(conn: sqlite3.Connection, item_id: str) -> bool:
    """Return whether ``item_id`` counts as complete (recursive for containers).

    A LEAF (no children) is complete iff its stored ``state`` is ``done`` or
    ``abandoned``. A CONTAINER (>=1 child) is complete iff EVERY child is
    complete, applied recursively to any depth (spec: "a container is complete
    iff all its children are complete (recursively)"). An empty container cannot
    occur in practice (an item is a container only by having children), and a
    missing id is treated as not complete.

    This is the dependency-satisfaction predicate: a dependency on a container
    is satisfied only when the whole container is complete.

    Args:
        conn: Open connection (within the caller's transaction).
        item_id: The item whose completeness is computed.
    """
    children = _children_in_order(conn, item_id)
    if children:
        # Container: complete iff all children are complete (recurse).
        return all(is_complete(conn, child_id) for child_id in children)

    # Leaf: complete iff its state is done/abandoned.
    row = conn.execute("SELECT state FROM items WHERE id = ?", (item_id,)).fetchone()
    if row is None:
        return False
    return state_is_complete(State(row["state"]))


def is_self_or_descendant(
    conn: sqlite3.Connection, item_id: str, candidate_id: str
) -> bool:
    """Return whether ``candidate_id`` is ``item_id`` itself or a descendant.

    Used by the move endpoint (G1) to reject reparenting an item under its own
    subtree, which would detach a cycle of items from the tree. The check walks
    UP the parent chain from ``candidate_id``: if it reaches ``item_id`` then
    ``candidate_id`` lies inside ``item_id``'s subtree (or is ``item_id``
    itself). A ``visited`` set guards against any malformed pre-existing parent
    cycle so the walk always terminates.

    Args:
        conn: Open connection (within the caller's transaction).
        item_id: The item being moved (the prospective ancestor).
        candidate_id: The proposed new parent to test.
    """
    current: str | None = candidate_id
    visited: set[str] = set()
    while current is not None:
        if current == item_id:
            return True
        if current in visited:
            return False
        visited.add(current)
        row = conn.execute(
            "SELECT parent_id FROM items WHERE id = ?", (current,)
        ).fetchone()
        if row is None:
            return False
        current = row["parent_id"]
    return False


def explicit_needs_slugs(conn: sqlite3.Connection, from_id: str) -> list[str]:
    """Return the current slugs of ``from_id``'s explicit dependency targets.

    Only ``kind='explicit'`` edges are considered; legacy implicit rows are not
    shown as ``>needs:`` labels. Each target id (``to_id``) is resolved to its
    current slug, so the labels track renames. The result is sorted by current
    slug for a stable, deterministic order.

    Reusable by the markdown mirror (L1), which renders the same
    ``(needs: slug, ...)`` suffix from these live slugs.

    Args:
        conn: Open connection (within the caller's transaction).
        from_id: The depending item whose explicit ``>needs:`` targets are read.
    """
    rows = conn.execute(
        """
        SELECT target.slug AS slug
        FROM dependencies AS dep
        JOIN items AS target ON target.id = dep.to_id
        WHERE dep.from_id = ? AND dep.kind = 'explicit'
        """,
        (from_id,),
    ).fetchall()
    return sorted(row["slug"] for row in rows)


def _sibling_sort_orders(
    conn: sqlite3.Connection, parent_id: str | None
) -> list[float]:
    """Return existing siblings' ``sort_order`` values in ascending order.

    ``parent_id`` of ``None`` selects the root group (product items). SQLite
    treats ``= NULL`` as never-true, so the root group uses ``IS NULL``.
    """
    if parent_id is None:
        rows = conn.execute(
            "SELECT sort_order FROM items WHERE parent_id IS NULL ORDER BY sort_order"
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT sort_order FROM items WHERE parent_id = ? ORDER BY sort_order",
            (parent_id,),
        ).fetchall()
    return [row["sort_order"] for row in rows]


def compute_sort_order(
    conn: sqlite3.Connection, parent_id: str | None, after_id: str | None
) -> float:
    """Compute a new item's ``sort_order`` within its sibling group.

    With no ``after_id`` the item is appended after the current last sibling.
    With ``after_id`` it is placed immediately after that sibling: at the
    midpoint to the following sibling, or one unit past it when it is last.

    Args:
        conn: Open connection (within the caller's transaction).
        parent_id: The new item's parent (``None`` for a root/product item).
        after_id: Sibling to place the new item directly after, or ``None`` to
            append at the end of the group.

    Returns:
        The ``sort_order`` value to store for the new item.
    """
    orders = _sibling_sort_orders(conn, parent_id)

    if after_id is None:
        # Append at the end of the group (or start the group at 1.0).
        return (orders[-1] + 1.0) if orders else 1.0

    after_row = conn.execute(
        "SELECT sort_order FROM items WHERE id = ?", (after_id,)
    ).fetchone()
    if after_row is None:
        # Unknown anchor: fall back to appending at the end.
        return (orders[-1] + 1.0) if orders else 1.0

    after_order = after_row["sort_order"]
    # The next sibling strictly after the anchor, if any.
    next_orders = [order for order in orders if order > after_order]
    if not next_orders:
        return after_order + 1.0
    return (after_order + min(next_orders)) / 2.0


def compute_first_child_sort_order(
    conn: sqlite3.Connection, parent_id: str | None
) -> float:
    """Compute a ``sort_order`` placing an item FIRST in its sibling group.

    The value is strictly below every existing sibling's ``sort_order`` so the
    item leads the group (used for the "first child" placement of an indent,
    spec 8.1: "becomes the first child of the preceding item"). An empty group
    starts at ``1.0``; otherwise the value is one unit below the current minimum,
    keeping insertion local (only the moved row is written).

    Args:
        conn: Open connection (within the caller's transaction).
        parent_id: The destination parent (``None`` for the root/product group).
    """
    orders = _sibling_sort_orders(conn, parent_id)
    if not orders:
        return 1.0
    return orders[0] - 1.0


def reparent_item(
    conn: sqlite3.Connection,
    item_id: str,
    new_parent_id: str | None,
    *,
    after_id: str | None = None,
    as_first_child: bool = False,
) -> None:
    """Reparent ``item_id`` under ``new_parent_id`` and clean affected groups.

    This is the shared reposition primitive behind indent, outdent (F2) and the
    move endpoint (G1). It performs the structural mutation only; callers
    validate preconditions (e.g. rejecting a cycle or a first-item indent) before
    calling. The item keeps its ``id`` and all explicit edges and comments
    (stored separately, by id), so identity is preserved across the move.

    Placement of the moved item within the destination sibling group:

    * ``as_first_child=True`` -> first in the group (lowest ``sort_order``); used
      by indent and explicit first-position moves. ``after_id`` is ignored in
      this mode.
    * otherwise -> immediately after ``after_id`` (used by outdent and move), or
      appended at the end of the group when ``after_id`` is ``None``.

    The ``sort_order`` is computed BEFORE the row's ``parent_id`` is changed so
    the destination group's existing membership (which excludes the still-moving
    item) drives the placement, then the row's ``parent_id`` and ``sort_order``
    are written together. Finally both the source group (the item left) and the
    destination group (the item joined) run legacy implicit-edge cleanup via
    :func:`services.graph.regenerate_groups`. Explicit edges and comments are
    untouched. The two parents may be equal (a pure reorder);
    :func:`~services.graph.regenerate_groups` deduplicates, and ``None`` (the
    root group) is a valid distinct key.

    Args:
        conn: Open connection (within the caller's transaction).
        item_id: The item to move (assumed to exist; callers 404 otherwise).
        new_parent_id: Destination parent (``None`` promotes to root/product).
        after_id: Sibling to place the item directly after (ignored when
            ``as_first_child`` is set); ``None`` appends at the group's end.
        as_first_child: Place the item first in the destination group instead of
            after ``after_id``.
    """
    # Imported here (not at module top) to avoid a circular import: services.graph
    # imports nothing from this module, but keeping the dependency one-directional
    # and local makes the layering obvious and tooling-safe.
    from services import graph

    old_row = conn.execute(
        "SELECT parent_id FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    old_parent_id = old_row["parent_id"] if old_row is not None else None

    if as_first_child:
        new_sort_order = compute_first_child_sort_order(conn, new_parent_id)
    else:
        new_sort_order = compute_sort_order(conn, new_parent_id, after_id)

    conn.execute(
        "UPDATE items SET parent_id = ?, sort_order = ? WHERE id = ?",
        (new_parent_id, new_sort_order, item_id),
    )

    # Clean both the group the item left and the group it joined (deduplicated
    # if equal). Explicit dependencies are preserved.
    graph.regenerate_groups(conn, (old_parent_id, new_parent_id))
