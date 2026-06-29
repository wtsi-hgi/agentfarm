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


def _self_and_ancestor_ids(conn: sqlite3.Connection, item_id: str) -> list[str]:
    """Return ``item_id`` followed by its ancestors up to the root."""
    ids: list[str] = []
    current: str | None = item_id
    visited: set[str] = set()
    while current is not None and current not in visited:
        visited.add(current)
        row = conn.execute(
            "SELECT parent_id FROM items WHERE id = ?", (current,)
        ).fetchone()
        if row is None:
            break
        ids.append(current)
        current = row["parent_id"]
    return ids


def _descendant_ids(conn: sqlite3.Connection, item_id: str) -> list[str]:
    """Return every descendant id under ``item_id``."""
    descendants: list[str] = []
    frontier = [item_id]
    visited = {item_id}

    while frontier:
        current = frontier.pop()
        rows = conn.execute(
            "SELECT id FROM items WHERE parent_id = ?", (current,)
        ).fetchall()
        for row in rows:
            child_id = row["id"]
            if child_id in visited:
                continue
            visited.add(child_id)
            descendants.append(child_id)
            frontier.append(child_id)

    return descendants


def _self_and_descendant_ids(conn: sqlite3.Connection, item_id: str) -> set[str]:
    """Return ``item_id`` and every id nested below it."""
    return {item_id, *_descendant_ids(conn, item_id)}


def _dependency_target_ids(conn: sqlite3.Connection, item_ids: list[str]) -> list[str]:
    """Return explicit dependency targets originating from any supplied id."""
    if not item_ids:
        return []

    placeholders = ",".join("?" for _ in item_ids)
    rows = conn.execute(
        f"""
        SELECT DISTINCT to_id
        FROM dependencies
        WHERE from_id IN ({placeholders})
        """,
        tuple(item_ids),
    ).fetchall()
    return [row["to_id"] for row in rows]


def _reachable_successor_ids(conn: sqlite3.Connection, item_id: str) -> set[str]:
    """Return ids reachable from ``item_id`` in the effective dependency graph."""
    successors = set(_descendant_ids(conn, item_id))

    for target_id in _dependency_target_ids(
        conn, _self_and_ancestor_ids(conn, item_id)
    ):
        successors.add(target_id)
        successors.update(_descendant_ids(conn, target_id))

    return successors


def would_create_cycle(conn: sqlite3.Connection, from_id: str, to_id: str) -> bool:
    """Return whether adding edge ``from_id -> to_id`` would create a cycle.

    True if ``from_id == to_id`` (a self-edge), or if ``to_id`` can already
    reach ``from_id`` or one of its descendants over the effective dependency
    graph. Effective reachability includes explicit edges attached to the
    current item or any ancestor section, and a reached container includes its
    subtree because depending on a container waits for the whole container.
    """
    if from_id == to_id:
        return True

    cycle_targets = _self_and_descendant_ids(conn, from_id)
    visited: set[str] = set()
    frontier: list[str] = [to_id]
    while frontier:
        current = frontier.pop()
        if current in cycle_targets:
            return True
        if current in visited:
            continue
        visited.add(current)
        frontier.extend(_reachable_successor_ids(conn, current) - visited)
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
