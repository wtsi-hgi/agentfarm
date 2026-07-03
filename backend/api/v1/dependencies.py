"""Dependency endpoints for explicit item/section edges (spec: D1/D3)."""

from __future__ import annotations

import sqlite3
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from api.v1.authz import require_owner
from db.connection import get_write_db
from services import graph, tree

from ..schemas import DeletedResponse, DependencyCreate, DependencyOut

router = APIRouter()

_DEPENDENCY_COLUMNS = "id, from_id, to_id, kind"
_DEPENDENCY_ALREADY_EXISTS = "dependency already exists"


def _row_to_dependency(row: sqlite3.Row) -> DependencyOut:
    """Build a :class:`DependencyOut` from a persisted dependency row."""
    return DependencyOut(**dict(row))


def _item_exists(conn: sqlite3.Connection, item_id: str) -> bool:
    """Return whether an item with ``item_id`` exists."""
    row = conn.execute("SELECT 1 FROM items WHERE id = ?", (item_id,)).fetchone()
    return row is not None


def _dependency_exists(conn: sqlite3.Connection, from_id: str, to_id: str) -> bool:
    """Return whether the dependency edge already exists."""
    row = conn.execute(
        "SELECT 1 FROM dependencies WHERE from_id = ? AND to_id = ?",
        (from_id, to_id),
    ).fetchone()
    return row is not None


def _is_duplicate_dependency_error(exc: sqlite3.IntegrityError) -> bool:
    """Return whether SQLite rejected a duplicate dependency edge."""
    return (
        getattr(exc, "sqlite_errorcode", None) == sqlite3.SQLITE_CONSTRAINT_UNIQUE
        and "dependencies.from_id" in str(exc)
        and "dependencies.to_id" in str(exc)
    )


def _resolve_target_id(conn: sqlite3.Connection, payload: DependencyCreate) -> str:
    """Resolve the target id from ``to_id`` or ``needs_slug``."""
    if payload.to_id is not None:
        if not _item_exists(conn, payload.to_id):
            raise HTTPException(status_code=404, detail="item not found")
        return payload.to_id

    row = conn.execute(
        "SELECT id FROM items WHERE slug = ?", (payload.needs_slug,)
    ).fetchone()
    if row is None:
        raise HTTPException(
            status_code=422,
            detail=f"unknown dependency: {payload.needs_slug}",
        )
    return row["id"]


@router.post("/dependencies", response_model=DependencyOut)
async def create_dependency(
    payload: DependencyCreate,
    _owner: Annotated[object, Depends(require_owner)],
    conn: Annotated[sqlite3.Connection, Depends(get_write_db, scope="function")],
) -> DependencyOut:
    """Create an explicit dependency edge, resolving ``needs_slug`` once (D1)."""
    if not _item_exists(conn, payload.from_id):
        raise HTTPException(status_code=404, detail="item not found")

    to_id = _resolve_target_id(conn, payload)

    if _dependency_exists(conn, payload.from_id, to_id):
        raise HTTPException(status_code=409, detail=_DEPENDENCY_ALREADY_EXISTS)

    lower_leaf_placement = graph.same_section_lower_leaf_dependency(
        conn,
        payload.from_id,
        to_id,
    )
    if lower_leaf_placement is not None:
        preserve_edge = graph.automatic_preserve_edge_for_lower_target(
            conn,
            payload.from_id,
            to_id,
        )
        preserve_edges = () if preserve_edge is None else (preserve_edge,)
        if graph.move_would_create_cycle(
            conn,
            payload.from_id,
            lower_leaf_placement["parent_id"],
            after_id=to_id,
            preserve_automatic_edges=preserve_edges,
        ):
            raise HTTPException(status_code=409, detail="dependency cycle rejected")

        tree.reparent_item(
            conn,
            payload.from_id,
            lower_leaf_placement["parent_id"],
            after_id=to_id,
            preserve_automatic_edges=preserve_edges,
        )
        row = conn.execute(
            f"""
            SELECT {_DEPENDENCY_COLUMNS}
            FROM dependencies
            WHERE from_id = ? AND to_id = ?
            """,
            (payload.from_id, to_id),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=409, detail="dependency cycle rejected")
        return _row_to_dependency(row)

    if graph.would_create_cycle(conn, payload.from_id, to_id):
        raise HTTPException(status_code=409, detail="dependency cycle rejected")

    dependency_id = str(uuid.uuid4())
    try:
        conn.execute(
            f"""
            INSERT INTO dependencies ({_DEPENDENCY_COLUMNS}, automatic_chain)
            VALUES (?, ?, ?, 'explicit', 0)
            """,
            (dependency_id, payload.from_id, to_id),
        )
    except sqlite3.IntegrityError as exc:
        if _is_duplicate_dependency_error(exc):
            raise HTTPException(
                status_code=409,
                detail=_DEPENDENCY_ALREADY_EXISTS,
            ) from exc
        raise

    row = conn.execute(
        f"SELECT {_DEPENDENCY_COLUMNS} FROM dependencies WHERE id = ?",
        (dependency_id,),
    ).fetchone()
    return _row_to_dependency(row)


@router.delete("/dependencies/{dependency_id}", response_model=DeletedResponse)
async def delete_dependency(
    dependency_id: str,
    _owner: Annotated[object, Depends(require_owner)],
    conn: Annotated[sqlite3.Connection, Depends(get_write_db, scope="function")],
) -> DeletedResponse:
    """Delete an explicit dependency edge by id (D3)."""
    existing = conn.execute(
        "SELECT 1 FROM dependencies WHERE id = ? AND kind = 'explicit'",
        (dependency_id,),
    ).fetchone()
    if existing is None:
        raise HTTPException(status_code=404, detail="dependency not found")

    conn.execute(
        "DELETE FROM dependencies WHERE id = ? AND kind = 'explicit'",
        (dependency_id,),
    )
    return DeletedResponse(deleted=True, id=dependency_id)
