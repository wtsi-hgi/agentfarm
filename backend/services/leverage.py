"""Actionability of items (spec: Core domain rules / "Actionable leaf").

This module owns the readiness question -- "can this item be worked on right
now?" -- which the work-now projection and the ``/priority`` endpoint build on.
Unblock-leverage scoring and ordering (the rest of ``services.leverage`` per the
spec) arrive in a later phase; this file provides only actionability now, as the
clean predicate those later additions reuse.

Actionable leaf (the rule)
--------------------------
An item is actionable iff ALL of:

* it is a LEAF (has no children) -- containers are NEVER actionable;
* it is NOT complete (its own state is not ``done``/``abandoned``);
* ``blocked_external`` is false; and
* EVERY dependency target attached to the item OR any ancestor section is
  complete. A section-level dependency gates all leaves nested inside that
  section. A dependency on a container is satisfied only when the whole
  container is done, using :func:`services.tree.is_complete`.

Note (carried forward, not implemented here): ``blocked_external`` is a defining
condition of actionability but NOT of downstream membership -- a
``blocked_external`` open leaf is absent from ``/priority`` yet still contributes
to an upstream item's leverage score. That distinction belongs to the scoring
work added later; actionability simply excludes ``blocked_external`` leaves.
"""

from __future__ import annotations

import sqlite3

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


def _dependency_target_ids(conn: sqlite3.Connection, item_id: str) -> list[str]:
    """Return dependency targets for ``item_id`` and ancestor sections.

    Dependencies attached to a container/root section apply to every descendant
    leaf, so actionability checks the item's own edges plus each ancestor's
    edges.
    """
    scope_ids = _self_and_ancestor_ids(conn, item_id)
    if not scope_ids:
        return []
    placeholders = ",".join("?" for _ in scope_ids)
    rows = conn.execute(
        f"SELECT DISTINCT to_id FROM dependencies WHERE from_id IN ({placeholders})",
        tuple(scope_ids),
    ).fetchall()
    return [row["to_id"] for row in rows]


def is_actionable(conn: sqlite3.Connection, item_id: str) -> bool:
    """Return whether ``item_id`` is actionable right now (Core domain rules).

    True iff ``item_id`` is a leaf, is not itself complete, is not
    ``blocked_external``, and every dependency target on the item or its
    ancestor sections is complete under the recursive container-completeness
    rule.
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
