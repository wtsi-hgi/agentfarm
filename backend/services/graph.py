"""Dependency graph helpers and the shared cycle-rejection predicate.

A dependency edge ``from_id -> to_id`` means "``from_id`` depends on (needs)
``to_id``". Explicit user edges are stored in ``dependencies``. Plain leaf
items inside the same non-root section also form a live implicit chain by
current sibling order, but that chain is derived when evaluating graph
semantics rather than persisted as rows. Root items and container siblings stay
independent unless the user records an explicit ``>needs:`` edge.

The ``dependencies.kind`` discriminator is retained for compatibility with the
phase-1 schema and earlier phase work, but v1 creates user-authored
``explicit`` edges only. Structural mutations call :func:`regenerate_group` to
discard any stale ``implicit`` rows left by older code paths; the function
deliberately does not write new edges from sibling order.
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


def _is_leaf(conn: sqlite3.Connection, item_id: str) -> bool:
    """Return whether ``item_id`` has no children."""
    return (
        conn.execute(
            "SELECT 1 FROM items WHERE parent_id = ? LIMIT 1", (item_id,)
        ).fetchone()
        is None
    )


def _implicit_previous_leaf_id(conn: sqlite3.Connection, item_id: str) -> str | None:
    """Return the previous plain leaf in ``item_id``'s section, if any."""
    row = conn.execute(
        "SELECT parent_id FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    if row is None or row["parent_id"] is None or not _is_leaf(conn, item_id):
        return None

    leaf_ids = [
        child_id
        for child_id in _child_ids_in_order(conn, row["parent_id"])
        if _is_leaf(conn, child_id)
    ]
    try:
        index = leaf_ids.index(item_id)
    except ValueError:
        return None
    return leaf_ids[index - 1] if index > 0 else None


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

    implicit_target_id = _implicit_previous_leaf_id(conn, item_id)
    if implicit_target_id is not None:
        successors.add(implicit_target_id)

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
    as_first_child: bool = False,
) -> bool:
    """Return whether moving ``item_id`` would create a dependency cycle.

    The move is evaluated against the effective graph that would exist after
    the structural change. Explicit dependency rows are preserved, inherited
    section dependencies are recomputed through the prospective parent chain,
    and plain leaf siblings inside non-root sections get prospective implicit
    predecessor links from their new sibling order. No rows are written here.
    """
    rows = {
        row["id"]: dict(row)
        for row in conn.execute(
            "SELECT id, parent_id, sort_order FROM items ORDER BY sort_order, id"
        ).fetchall()
    }
    if item_id not in rows:
        return False

    def current_children(parent_id: str | None) -> list[str]:
        return [
            candidate_id
            for candidate_id, row in sorted(
                rows.items(),
                key=lambda entry: (entry[1]["sort_order"], entry[0]),
            )
            if row["parent_id"] == parent_id and candidate_id != item_id
        ]

    parent_ids = {None, new_parent_id}
    parent_ids.update(row["parent_id"] for row in rows.values())
    parent_ids.update(rows)

    children_after: dict[str | None, list[str]] = {}
    for parent_id in parent_ids:
        ordered = current_children(parent_id)
        if parent_id == new_parent_id:
            if as_first_child:
                insertion_index = 0
            elif after_id is not None and after_id in ordered:
                insertion_index = ordered.index(after_id) + 1
            else:
                insertion_index = len(ordered)
            ordered.insert(insertion_index, item_id)
        children_after[parent_id] = ordered

    parent_after = {
        candidate_id: row["parent_id"] for candidate_id, row in rows.items()
    }
    parent_after[item_id] = new_parent_id

    def descendants_after(root_id: str) -> set[str]:
        descendants: set[str] = set()
        frontier = list(children_after.get(root_id, []))
        while frontier:
            current = frontier.pop()
            if current in descendants:
                continue
            descendants.add(current)
            frontier.extend(children_after.get(current, []))
        return descendants

    def self_and_ancestors_after(candidate_id: str) -> list[str]:
        ids: list[str] = []
        current: str | None = candidate_id
        visited: set[str] = set()
        while current is not None and current not in visited and current in rows:
            visited.add(current)
            ids.append(current)
            current = parent_after.get(current)
        return ids

    def is_leaf_after(candidate_id: str) -> bool:
        return len(children_after.get(candidate_id, [])) == 0

    implicit_targets_after: dict[str, set[str]] = {}
    for parent_id, child_ids in children_after.items():
        if parent_id is None:
            continue
        leaf_ids = [child_id for child_id in child_ids if is_leaf_after(child_id)]
        for previous_id, dependent_id in zip(leaf_ids, leaf_ids[1:]):
            targets = implicit_targets_after.setdefault(dependent_id, set())
            targets.add(previous_id)

    def dependency_targets(item_ids: list[str]) -> set[str]:
        if not item_ids:
            return set()
        placeholders = ",".join("?" for _ in item_ids)
        dependency_rows = conn.execute(
            f"""
            SELECT DISTINCT to_id
            FROM dependencies
            WHERE from_id IN ({placeholders})
            """,
            tuple(item_ids),
        ).fetchall()
        return {row["to_id"] for row in dependency_rows}

    def successor_ids(candidate_id: str) -> set[str]:
        successors = descendants_after(candidate_id)
        for target_id in dependency_targets(self_and_ancestors_after(candidate_id)):
            successors.add(target_id)
            successors.update(descendants_after(target_id))
        successors.update(implicit_targets_after.get(candidate_id, set()))
        return successors

    for start_id in rows:
        visited: set[str] = set()
        frontier = list(successor_ids(start_id))
        while frontier:
            current = frontier.pop()
            if current == start_id:
                return True
            if current in visited:
                continue
            visited.add(current)
            frontier.extend(successor_ids(current) - visited)

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
