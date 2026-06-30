"""Actionability and unblock-leverage scoring.

This module owns the readiness question -- "can this item be worked on right
now?" -- which the work-now projection and the ``/priority`` endpoint build on.
Actionable leaf (the rule)
--------------------------
An item is actionable iff ALL of:

* it is a LEAF (has no children) -- containers are NEVER actionable;
* it is NOT complete (its own state is not ``done``/``abandoned``);
* ``blocked_external`` is false and its state is not externally waiting; and
* EVERY dependency target attached to the item, any ancestor section, or the
  live implicit section-item chain is complete. A section-level dependency
  gates all leaves nested inside that section. Plain leaf items inside the same
  non-root section also depend on the previous plain leaf by current sibling
  order. A dependency on a container is satisfied only when the whole container
  is done, using :func:`services.tree.is_complete`.

Unblock leverage
----------------
``Downstream(L)`` is every open leaf whose own dependency edges, inherited
ancestor-section dependency edges, or implicit section-item chain edges depend
on ``L`` directly or transitively. ``blocked_external`` and external-waiting
states exclude a leaf from actionability, but not from downstream membership.
"""

from __future__ import annotations

import sqlite3

from models.enums import (
    EFFORT_WEIGHT,
    MODE_WEIGHT,
    Effort,
    Mode,
    State,
    is_external_waiting,
    user_action_priority,
)
from services import tree


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


def _is_leaf(conn: sqlite3.Connection, item_id: str) -> bool:
    """Return whether ``item_id`` has no children."""
    return (
        conn.execute(
            "SELECT 1 FROM items WHERE parent_id = ? LIMIT 1", (item_id,)
        ).fetchone()
        is None
    )


def _section_leaf_sibling_ids_in_order(
    conn: sqlite3.Connection, parent_id: str
) -> list[str]:
    """Return plain leaf children of ``parent_id`` in visual sibling order."""
    rows = conn.execute(
        "SELECT id FROM items WHERE parent_id = ? ORDER BY sort_order, id",
        (parent_id,),
    ).fetchall()
    return [row["id"] for row in rows if _is_leaf(conn, row["id"])]


def _implicit_previous_section_leaf_id(
    conn: sqlite3.Connection, item_id: str
) -> str | None:
    """Return the previous plain leaf this section item implicitly depends on."""
    row = conn.execute(
        "SELECT parent_id FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    if row is None or row["parent_id"] is None or not _is_leaf(conn, item_id):
        return None

    sibling_ids = _section_leaf_sibling_ids_in_order(conn, row["parent_id"])
    try:
        index = sibling_ids.index(item_id)
    except ValueError:
        return None
    return sibling_ids[index - 1] if index > 0 else None


def _dependency_target_ids(conn: sqlite3.Connection, item_id: str) -> list[str]:
    """Return effective dependency targets for ``item_id``.

    Dependencies attached to a container/root section apply to every descendant
    leaf, so actionability checks the item's own edges plus each ancestor's
    edges. Plain leaf children inside one non-root section also inherit the live
    chain target: the previous plain leaf by current sibling order.
    """
    scope_ids = _self_and_ancestor_ids(conn, item_id)
    target_ids: list[str] = []
    if not scope_ids:
        return target_ids

    placeholders = ",".join("?" for _ in scope_ids)
    rows = conn.execute(
        f"SELECT DISTINCT to_id FROM dependencies WHERE from_id IN ({placeholders})",
        tuple(scope_ids),
    ).fetchall()
    target_ids.extend(row["to_id"] for row in rows)

    implicit_target_id = _implicit_previous_section_leaf_id(conn, item_id)
    if implicit_target_id is not None and implicit_target_id not in target_ids:
        target_ids.append(implicit_target_id)
    return target_ids


def is_actionable(conn: sqlite3.Connection, item_id: str) -> bool:
    """Return whether ``item_id`` is actionable right now (Core domain rules).

    True iff ``item_id`` is a leaf, is not itself complete, is not
    ``blocked_external`` or in an external-waiting state, and every dependency
    target on the item or its ancestor sections is complete under the recursive
    container-completeness rule.
    Containers are never actionable; a missing id is not actionable.

    Args:
        conn: Open connection (within the caller's transaction).
        item_id: The item whose actionability is computed.
    """
    row = conn.execute(
        "SELECT state, blocked_external FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    if row is None:
        return False

    # Containers (>=1 child) are never actionable.
    if conn.execute(
        "SELECT 1 FROM items WHERE parent_id = ? LIMIT 1", (item_id,)
    ).fetchone():
        return False

    # The item itself must be open (a complete leaf is not work to do).
    if tree.is_complete(conn, item_id):
        return False

    state = State(row["state"])
    if is_external_waiting(state):
        return False

    # An externally blocked leaf is not actionable (still counts downstream,
    # handled by the leverage scoring added later -- not here).
    if row["blocked_external"]:
        return False

    # Every direct or inherited dependency target must be complete.
    return all(
        tree.is_complete(conn, target_id)
        for target_id in _dependency_target_ids(conn, item_id)
    )


def actionable_item_ids(conn: sqlite3.Connection) -> set[str]:
    """Return the set of ids of every actionable item.

    Iterates all items and keeps those for which :func:`is_actionable` holds.
    Returned as a set because actionability is an unordered membership question
    (leverage ORDERING is added in a later phase); callers asserting membership
    compare against this set directly.

    Args:
        conn: Open connection (within the caller's transaction).
    """
    rows = conn.execute("SELECT id FROM items").fetchall()
    return {row["id"] for row in rows if is_actionable(conn, row["id"])}


def _open_leaf_ids(conn: sqlite3.Connection) -> list[str]:
    """Return ids for leaves that are not complete, including blocked leaves."""
    rows = conn.execute("SELECT id FROM items ORDER BY id").fetchall()
    return [
        row["id"]
        for row in rows
        if _is_leaf(conn, row["id"]) and not tree.is_complete(conn, row["id"])
    ]


def _contains_descendant(
    conn: sqlite3.Connection, ancestor_id: str, item_id: str
) -> bool:
    """Return whether ``item_id`` is nested below ``ancestor_id``."""
    current = conn.execute(
        "SELECT parent_id FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    visited: set[str] = set()
    while current is not None and current["parent_id"] is not None:
        parent_id = current["parent_id"]
        if parent_id == ancestor_id:
            return True
        if parent_id in visited:
            return False
        visited.add(parent_id)
        current = conn.execute(
            "SELECT parent_id FROM items WHERE id = ?", (parent_id,)
        ).fetchone()
    return False


def _dependency_path_reaches(
    conn: sqlite3.Connection,
    start_id: str,
    target_id: str,
    visited: set[str],
) -> bool:
    """Return whether dependency traversal reaches ``target_id``."""
    if start_id in visited:
        return False
    visited.add(start_id)

    if start_id == target_id:
        return True

    # Depending on a container gates every descendant leaf of that container.
    if _contains_descendant(conn, start_id, target_id):
        return True

    return any(
        _dependency_path_reaches(conn, dependency_id, target_id, visited)
        for dependency_id in _dependency_target_ids(conn, start_id)
    )


def depends_on(conn: sqlite3.Connection, item_id: str, target_id: str) -> bool:
    """Return whether ``item_id`` effectively depends on ``target_id``.

    The effective dependency set is the item's own explicit ``>needs:`` edges
    plus dependency edges inherited from all ancestor sections and any live
    implicit previous-leaf edge in its section.
    """
    return any(
        _dependency_path_reaches(conn, dependency_id, target_id, set())
        for dependency_id in _dependency_target_ids(conn, item_id)
    )


def downstream_item_ids(conn: sqlite3.Connection, item_id: str) -> set[str]:
    """Return ``Downstream(item_id)`` as a set of open leaf ids."""
    return {
        candidate_id
        for candidate_id in _open_leaf_ids(conn)
        if candidate_id != item_id and depends_on(conn, candidate_id, item_id)
    }


def _item_weight(conn: sqlite3.Connection, item_id: str) -> int:
    """Return the weighted downstream contribution for one item."""
    row = conn.execute(
        "SELECT effort, mode FROM items WHERE id = ?", (item_id,)
    ).fetchone()
    if row is None:
        return 0
    effort = Effort(row["effort"])
    mode = Mode(row["mode"])
    return EFFORT_WEIGHT[effort] * MODE_WEIGHT[mode]


def score(conn: sqlite3.Connection, item_id: str) -> float:
    """Return the unblock-leverage score for ``item_id``."""
    row = conn.execute("SELECT effort FROM items WHERE id = ?", (item_id,)).fetchone()
    if row is None:
        return 0.0
    own_effort = EFFORT_WEIGHT[Effort(row["effort"])]
    downstream_total = sum(
        _item_weight(conn, downstream_id)
        for downstream_id in downstream_item_ids(conn, item_id)
    )
    return downstream_total / own_effort


def priority_item_ids(conn: sqlite3.Connection) -> list[str]:
    """Return actionable leaves ordered by leverage score and stable tie-breaks."""

    def timestamps(item_id: str) -> tuple[str, str]:
        row = conn.execute(
            "SELECT updated_at, created_at FROM items WHERE id = ?", (item_id,)
        ).fetchone()
        if row is None:
            return ("", "")
        return (row["updated_at"], row["created_at"])

    def state_priority(item_id: str) -> int:
        row = conn.execute(
            "SELECT state FROM items WHERE id = ?", (item_id,)
        ).fetchone()
        if row is None:
            return 0
        return user_action_priority(State(row["state"]))

    ordered = sorted(actionable_item_ids(conn))
    ordered.sort(key=lambda item_id: timestamps(item_id)[1], reverse=True)
    ordered.sort(key=lambda item_id: timestamps(item_id)[0], reverse=True)
    ordered.sort(key=lambda item_id: score(conn, item_id), reverse=True)
    ordered.sort(key=state_priority, reverse=True)
    return ordered
