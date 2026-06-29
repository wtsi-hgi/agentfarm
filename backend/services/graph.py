"""Dependency graph helpers and the shared cycle-rejection predicate.

A dependency edge ``from_id -> to_id`` means "``from_id`` depends on (needs)
``to_id``". Tree structure is organisational only in the corrected v1 model:
sibling order does not create dependency edges. Root items and subsections are
therefore independent until the user records an explicit ``>needs:`` edge.

The ``dependencies.kind`` discriminator is retained for compatibility with the
phase-1 schema and earlier phase work, but v1 creates user-authored
``explicit`` edges only. Structural mutations call :func:`regenerate_group` to
discard any stale ``implicit`` rows left by older code paths; the function
deliberately does not derive new edges from sibling order.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterable


def _child_ids_in_order(conn: sqlite3.Connection, parent_id: str | None) -> list[str]:
    """Return the ids of ``parent_id``'s children ordered as siblings.

    Ordering is ``sort_order`` then ``id`` for deterministic cleanup. ``None``
    selects the root/product group (``parent_id IS NULL``).
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


def _delete_group_implicit_edges(
    conn: sqlite3.Connection, child_ids: list[str]
) -> None:
    """Delete stale implicit edges originating from one sibling group."""
    if not child_ids:
        return
    placeholders = ",".join("?" for _ in child_ids)
    conn.execute(
        f"""
        DELETE FROM dependencies
        WHERE kind = 'implicit'
          AND from_id IN ({placeholders})
        """,
        tuple(child_ids),
    )


def would_create_cycle(conn: sqlite3.Connection, from_id: str, to_id: str) -> bool:
    """Return whether adding edge ``from_id -> to_id`` would create a cycle.

    True if ``from_id == to_id`` (a self-edge), or if ``to_id`` can already
    reach ``from_id`` over the dependency graph. In that case, adding
    ``from_id -> to_id`` would close a directed cycle.
    """
    if from_id == to_id:
        return True

    visited: set[str] = set()
    frontier: list[str] = [to_id]
    while frontier:
        current = frontier.pop()
        if current == from_id:
            return True
        if current in visited:
            continue
        visited.add(current)
        rows = conn.execute(
            "SELECT to_id FROM dependencies WHERE from_id = ?", (current,)
        ).fetchall()
        frontier.extend(row["to_id"] for row in rows)
    return False


def move_would_create_cycle(
    conn: sqlite3.Connection,
    item_id: str,
    new_parent_id: str | None,
    *,
    after_id: str | None = None,
) -> bool:
    """Return whether moving ``item_id`` would create a dependency cycle.

    Moving or reordering items no longer creates dependency edges. Dependency
    cycles are introduced only by dependency-edge insertion, guarded by
    :func:`would_create_cycle`, while tree parent cycles are guarded by
    :func:`services.tree.is_self_or_descendant`.
    """
    return False


def regenerate_group(conn: sqlite3.Connection, parent_id: str | None) -> None:
    """Discard stale generated edges for one parent's sibling group.

    Structural edits preserve explicit dependencies and do not derive new
    dependencies from sibling order. This function is idempotent and safe to
    call after create/delete/move operations; it only removes legacy
    ``kind='implicit'`` rows originating from members of the affected group.
    """
    _delete_group_implicit_edges(conn, _child_ids_in_order(conn, parent_id))


def regenerate_groups(
    conn: sqlite3.Connection, parent_ids: Iterable[str | None]
) -> None:
    """Run legacy implicit-edge cleanup for several sibling groups."""
    seen: set[str | None] = set()
    for parent_id in parent_ids:
        if parent_id in seen:
            continue
        seen.add(parent_id)
        regenerate_group(conn, parent_id)


def regenerate_sibling_chain(conn: sqlite3.Connection, parent_id: str | None) -> None:
    """Deprecated alias for :func:`regenerate_group` (legacy cleanup only)."""
    regenerate_group(conn, parent_id)
