"""Dependency endpoints for explicit item/section edges (spec: D1/D3)."""

from __future__ import annotations

import sqlite3
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from api.v1.authz import require_owner
from db.connection import get_db
from services import graph

from ..schemas import DeletedResponse, DependencyCreate, DependencyOut

router = APIRouter()

_DEPENDENCY_COLUMNS = "id, from_id, to_id, kind"


def _row_to_dependency(row: sqlite3.Row) -> DependencyOut:
    """Build a :class:`DependencyOut` from a persisted dependency row."""
    return DependencyOut(**dict(row))


def _item_exists(conn: sqlite3.Connection, item_id: str) -> bool:
    """Return whether an item with ``item_id`` exists."""
    row = conn.execute("SELECT 1 FROM items WHERE id = ?", (item_id,)).fetchone()
    return row is not None


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
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
) -> DependencyOut:
    """Create an explicit dependency edge, resolving ``needs_slug`` once (D1)."""
    if not _item_exists(conn, payload.from_id):
        raise HTTPException(status_code=404, detail="item not found")

    to_id = _resolve_target_id(conn, payload)

    if graph.would_create_cycle(conn, payload.from_id, to_id):
        raise HTTPException(status_code=409, detail="dependency cycle rejected")

    dependency_id = str(uuid.uuid4())
    conn.execute(
        f"""
        INSERT INTO dependencies ({_DEPENDENCY_COLUMNS})
        VALUES (?, ?, ?, 'explicit')
        """,
        (dependency_id, payload.from_id, to_id),
    )

    row = conn.execute(
        f"SELECT {_DEPENDENCY_COLUMNS} FROM dependencies WHERE id = ?",
        (dependency_id,),
    ).fetchone()
    return _row_to_dependency(row)


@router.delete("/dependencies/{dependency_id}", response_model=DeletedResponse)
async def delete_dependency(
    dependency_id: str,
    _owner: Annotated[object, Depends(require_owner)],
    conn: Annotated[sqlite3.Connection, Depends(get_db)],
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
