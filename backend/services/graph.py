"""Dependency graph helpers and the shared cycle-rejection predicate.

A dependency edge ``from_id -> to_id`` means "``from_id`` depends on (needs)
``to_id``". User-authored dependencies and the automatic ordinary-leaf chain
inside non-root sections are both persisted as ``kind='explicit'`` rows so the
Details dependency UI can show and remove either kind. The storage-level
``automatic_chain`` flag records ownership: structural repair may delete and
recreate automatic rows, but it must never relabel or remove user rows.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterable

AutomaticEdge = tuple[str, str]


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


def _leaf_child_ids_in_order(
    conn: sqlite3.Connection, parent_id: str | None
) -> list[str]:
    """Return ordinary leaf children of ``parent_id`` in sibling order."""
    if parent_id is None:
        return []
    return [
        child_id
        for child_id in _child_ids_in_order(conn, parent_id)
        if _is_leaf(conn, child_id)
    ]


def _automatic_dependency_id(from_id: str, to_id: str) -> str:
    """Return a deterministic id for a generated automatic chain edge."""
    return f"auto-chain-{from_id}-{to_id}"


def _dependency_exists(conn: sqlite3.Connection, from_id: str, to_id: str) -> bool:
    """Return whether any dependency row already owns ``from_id -> to_id``."""
    row = conn.execute(
        "SELECT 1 FROM dependencies WHERE from_id = ? AND to_id = ?",
        (from_id, to_id),
    ).fetchone()
    return row is not None


def _automatic_dependency_exists(
    conn: sqlite3.Connection, from_id: str, to_id: str
) -> bool:
    """Return whether ``from_id -> to_id`` is currently automatic-owned."""
    row = conn.execute(
        """
        SELECT 1
        FROM dependencies
        WHERE from_id = ? AND to_id = ? AND automatic_chain = 1
        """,
        (from_id, to_id),
    ).fetchone()
    return row is not None


def _insert_automatic_dependency(
    conn: sqlite3.Connection, from_id: str, to_id: str
) -> None:
    """Insert an automatic explicit edge unless any row already owns the pair."""
    if from_id == to_id or _dependency_exists(conn, from_id, to_id):
        return
    conn.execute(
        """
        INSERT INTO dependencies (id, from_id, to_id, kind, automatic_chain)
        VALUES (?, ?, ?, 'explicit', 1)
        """,
        (_automatic_dependency_id(from_id, to_id), from_id, to_id),
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
    """Return stored dependency targets originating from any supplied id."""
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
    graph. Effective reachability includes stored edges attached to the current
    item or any ancestor section, and a reached container includes its subtree
    because depending on a container waits for the whole container.
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
    preserve_automatic_edges: Iterable[AutomaticEdge] = (),
) -> bool:
    """Return whether moving ``item_id`` would create a dependency cycle.

    The move is evaluated against the effective graph that would exist after
    the structural change. User-owned dependency rows are preserved, inherited
    section dependencies are recomputed through the prospective parent chain,
    and automatic sibling-chain rows are recalculated from the prospective
    ordinary-leaf order. Existing automatic rows are ignored because structural
    repair will delete and recreate them.
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

    automatic_targets_after: dict[str, set[str]] = {}
    preserved_by_source = {
        from_id: to_id
        for from_id, to_id in preserve_automatic_edges
        if from_id in rows and to_id in rows
    }
    for parent_id, child_ids in children_after.items():
        if parent_id is None:
            continue
        leaf_ids = [child_id for child_id in child_ids if is_leaf_after(child_id)]
        for previous_id, dependent_id in zip(leaf_ids, leaf_ids[1:]):
            target_id = preserved_by_source.get(dependent_id, previous_id)
            targets = automatic_targets_after.setdefault(dependent_id, set())
            targets.add(target_id)

    def dependency_targets(item_ids: list[str]) -> set[str]:
        if not item_ids:
            return set()
        placeholders = ",".join("?" for _ in item_ids)
        dependency_rows = conn.execute(
            f"""
            SELECT DISTINCT to_id
            FROM dependencies
            WHERE automatic_chain = 0 AND from_id IN ({placeholders})
            """,
            tuple(item_ids),
        ).fetchall()
        return {row["to_id"] for row in dependency_rows}

    def successor_ids(candidate_id: str) -> set[str]:
        successors = descendants_after(candidate_id)
        for target_id in dependency_targets(self_and_ancestors_after(candidate_id)):
            successors.add(target_id)
            successors.update(descendants_after(target_id))
        successors.update(automatic_targets_after.get(candidate_id, set()))
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


def _automatic_edges_for_group(
    conn: sqlite3.Connection,
    parent_id: str | None,
    preserve_automatic_edges: Iterable[AutomaticEdge] = (),
) -> list[AutomaticEdge]:
    """Return the automatic chain edges wanted for one current sibling group."""
    if parent_id is None:
        return []

    leaf_ids = _leaf_child_ids_in_order(conn, parent_id)
    desired_by_source = {
        dependent_id: previous_id
        for previous_id, dependent_id in zip(leaf_ids, leaf_ids[1:])
    }
    leaf_set = set(leaf_ids)
    for from_id, to_id in preserve_automatic_edges:
        if from_id in leaf_set and to_id in leaf_set:
            desired_by_source[from_id] = to_id
    return list(desired_by_source.items())


def regenerate_group(
    conn: sqlite3.Connection,
    parent_id: str | None,
    *,
    preserve_automatic_edges: Iterable[AutomaticEdge] = (),
) -> None:
    """Recreate automatic ordinary-leaf edges for one sibling group.

    Only rows with ``automatic_chain=1`` are removed. Any existing user-owned
    row for the same pair is preserved and prevents a duplicate automatic row.
    """
    if parent_id is None:
        conn.execute(
            """
            DELETE FROM dependencies
            WHERE automatic_chain = 1
              AND from_id IN (
                SELECT id FROM items WHERE parent_id IS NULL
              )
            """
        )
        return

    conn.execute(
        """
        DELETE FROM dependencies
        WHERE automatic_chain = 1
          AND from_id IN (
            SELECT id FROM items WHERE parent_id = ?
          )
        """,
        (parent_id,),
    )
    for from_id, to_id in _automatic_edges_for_group(
        conn,
        parent_id,
        preserve_automatic_edges,
    ):
        _insert_automatic_dependency(conn, from_id, to_id)


def regenerate_groups(
    conn: sqlite3.Connection, parent_ids: Iterable[str | None]
) -> None:
    """Recreate automatic edges for several sibling groups."""
    seen: set[str | None] = set()
    for parent_id in parent_ids:
        if parent_id in seen:
            continue
        seen.add(parent_id)
        regenerate_group(conn, parent_id)


def regenerate_sibling_chain(conn: sqlite3.Connection, parent_id: str | None) -> None:
    """Deprecated alias for :func:`regenerate_group`."""
    regenerate_group(conn, parent_id)


def automatic_preserve_edge_for_lower_target(
    conn: sqlite3.Connection, from_id: str, to_id: str
) -> AutomaticEdge | None:
    """Return the target successor edge to preserve for a lower-target insert."""
    placement = same_section_lower_leaf_dependency(conn, from_id, to_id)
    if placement is None or placement["target_next_id"] is None:
        return None
    target_next_id = placement["target_next_id"]
    if _automatic_dependency_exists(conn, target_next_id, to_id):
        return (target_next_id, to_id)
    return None


def same_section_lower_leaf_dependency(
    conn: sqlite3.Connection, from_id: str, to_id: str
) -> dict[str, str | None] | None:
    """Return placement info if ``to_id`` is a lower ordinary leaf sibling."""
    rows = conn.execute(
        """
        SELECT id, parent_id
        FROM items
        WHERE id IN (?, ?)
        """,
        (from_id, to_id),
    ).fetchall()
    by_id = {row["id"]: row for row in rows}
    source = by_id.get(from_id)
    target = by_id.get(to_id)
    if (
        source is None
        or target is None
        or source["parent_id"] is None
        or source["parent_id"] != target["parent_id"]
        or not _is_leaf(conn, from_id)
        or not _is_leaf(conn, to_id)
    ):
        return None

    leaf_ids = _leaf_child_ids_in_order(conn, source["parent_id"])
    try:
        source_index = leaf_ids.index(from_id)
        target_index = leaf_ids.index(to_id)
    except ValueError:
        return None
    if target_index <= source_index:
        return None

    target_next_id = (
        leaf_ids[target_index + 1] if target_index + 1 < len(leaf_ids) else None
    )
    return {
        "parent_id": source["parent_id"],
        "target_next_id": target_next_id,
    }


def backfill_automatic_sibling_chains(conn: sqlite3.Connection) -> None:
    """One-off upgrade: persist automatic edges for existing section leaves."""
    conn.execute("DELETE FROM dependencies WHERE kind = 'implicit'")
    parent_rows = conn.execute(
        """
        SELECT DISTINCT parent_id
        FROM items
        WHERE parent_id IS NOT NULL
        ORDER BY parent_id
        """
    ).fetchall()
    for row in parent_rows:
        regenerate_group(conn, row["parent_id"])
