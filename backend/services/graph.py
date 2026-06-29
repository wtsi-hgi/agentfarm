"""Implicit dependency-edge generation from tree structure.

A dependency edge ``from_id -> to_id`` means "``from_id`` depends on (needs)
``to_id``". Edges are either ``implicit`` (derived from tree shape) or
``explicit`` (hand-authored ``>needs:`` links). The two kinds share the
``dependencies`` table and are distinguished by ``kind``; explicit edges and
comments are NEVER touched by implicit regeneration.

Scope of this module today (item A1)
-------------------------------------
Only the **sibling chain** is implemented: among the children of one parent,
ordered by ``sort_order``, each child after the first depends on the previous
sibling (``child -> previous_sibling``). Regeneration for a sibling group
deletes only that group's internal implicit edges and re-derives the chain, so
it is idempotent and safe to call after any change to the group.

This is deliberately the seam for the fuller implicit engine added later
(sub-section entry edges, container completion rules, regeneration on every
structural op, and cycle-aware skipping). New rules slot into
:func:`regenerate_sibling_chain` (or sibling helpers) without changing its
callers.
"""

from __future__ import annotations

import sqlite3
import uuid


def _child_ids_in_order(conn: sqlite3.Connection, parent_id: str | None) -> list[str]:
    """Return the ids of ``parent_id``'s children ordered as siblings.

    Ordering is ``sort_order`` then ``id`` so the chain is deterministic even
    if two siblings momentarily share a ``sort_order``. ``parent_id`` of
    ``None`` selects the root (product) group.
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
    """Delete implicit edges internal to one sibling group.

    Only edges whose ``from_id`` and ``to_id`` are BOTH members of
    ``child_ids`` are removed: these are the sibling-chain edges this group
    owns. Implicit edges that merely touch the group from outside (e.g. a
    later phase's sub-section entry edge into the first child) and all explicit
    edges are left intact.
    """
    if not child_ids:
        return
    placeholders = ",".join("?" for _ in child_ids)
    conn.execute(
        f"""
        DELETE FROM dependencies
        WHERE kind = 'implicit'
          AND from_id IN ({placeholders})
          AND to_id IN ({placeholders})
        """,
        (*child_ids, *child_ids),
    )


def _insert_implicit_edge(conn: sqlite3.Connection, from_id: str, to_id: str) -> None:
    """Insert one implicit edge ``from_id -> to_id`` (ignoring duplicates).

    ``UNIQUE (from_id, to_id)`` already prevents duplicates regardless of kind;
    ``INSERT OR IGNORE`` keeps regeneration robust if an equivalent edge
    somehow exists.
    """
    conn.execute(
        """
        INSERT OR IGNORE INTO dependencies (id, from_id, to_id, kind)
        VALUES (?, ?, ?, 'implicit')
        """,
        (str(uuid.uuid4()), from_id, to_id),
    )


def regenerate_sibling_chain(conn: sqlite3.Connection, parent_id: str | None) -> None:
    """Regenerate the implicit sibling chain for one parent's children.

    Deletes the group's internal implicit edges, then re-creates
    ``child -> previous_sibling`` for each child after the first (children
    ordered by ``sort_order``). Idempotent; call after any change that affects
    the group's membership or order. Explicit edges are never altered.

    Args:
        conn: Open connection (within the caller's transaction).
        parent_id: Parent whose sibling group is regenerated (``None`` for the
            root/product group).
    """
    child_ids = _child_ids_in_order(conn, parent_id)
    _delete_group_implicit_edges(conn, child_ids)
    for previous, current in zip(child_ids, child_ids[1:]):
        _insert_implicit_edge(conn, current, previous)
