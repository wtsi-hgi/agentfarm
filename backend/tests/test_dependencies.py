"""Acceptance tests for dependency behavior.

The corrected v1 dependency model treats the tree as structure, not sequencing:
siblings at root and inside sections are independent by default. Dependencies
are explicit edges, and an edge attached to a container section gates all leaves
nested under that section.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

import config
from db.connection import get_connection
from db.migrate import apply_migrations
from services import leverage


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    """Point the app at a fresh, empty SQLite DB under ``tmp_path``."""
    monkeypatch.setattr(config.settings, "data_dir", tmp_path)
    apply_migrations()
    return config.settings.db_path


def _client() -> AsyncClient:
    """An ``AsyncClient`` bound to the ASGI app (no network)."""
    from main import app

    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://testserver")


async def _create(client: AsyncClient, body: dict):
    return await client.post("/api/v1/items", json=body)


async def _patch(client: AsyncClient, item_id: str, body: dict):
    return await client.patch(f"/api/v1/items/{item_id}", json=body)


async def _indent(client: AsyncClient, item_id: str):
    return await client.post(f"/api/v1/items/{item_id}/indent")


async def _outdent(client: AsyncClient, item_id: str):
    return await client.post(f"/api/v1/items/{item_id}/outdent")


async def _move(client: AsyncClient, item_id: str, body: dict):
    return await client.post(f"/api/v1/items/{item_id}/move", json=body)


def _dependency_rows(db_path) -> list[dict]:
    """Return dependency rows as plain dicts."""
    with get_connection(db_path) as conn:
        rows = conn.execute(
            "SELECT id, from_id, to_id, kind FROM dependencies"
        ).fetchall()
    return [dict(row) for row in rows]


def _dependency_edges(db_path, kind: str | None = None) -> set[tuple[str, str]]:
    """Return dependency edges as ``(from_id, to_id)`` pairs."""
    with get_connection(db_path) as conn:
        if kind is None:
            rows = conn.execute("SELECT from_id, to_id FROM dependencies").fetchall()
        else:
            rows = conn.execute(
                "SELECT from_id, to_id FROM dependencies WHERE kind = ?", (kind,)
            ).fetchall()
    return {(row["from_id"], row["to_id"]) for row in rows}


def _insert_explicit_edge(db_path, from_id: str, to_id: str) -> str:
    """Insert an explicit dependency edge directly."""
    edge_id = str(uuid.uuid4())
    with get_connection(db_path) as conn:
        conn.execute(
            "INSERT INTO dependencies (id, from_id, to_id, kind) "
            "VALUES (?, ?, ?, 'explicit')",
            (edge_id, from_id, to_id),
        )
    return edge_id


def _actionable(db_path) -> set[str]:
    """Return the actionable item-id set (a supported service boundary)."""
    with get_connection(db_path) as conn:
        return set(leverage.actionable_item_ids(conn))


async def _build_outline(client: AsyncClient) -> dict[str, str]:
    """Create the outline ``A; B(B1,B2); C`` and return name -> id."""
    a = await _create(client, {"title": "A"})
    b = await _create(client, {"title": "B"})
    b1 = await _create(client, {"title": "B1", "parent_id": b.json()["id"]})
    b2 = await _create(client, {"title": "B2", "parent_id": b.json()["id"]})
    c = await _create(client, {"title": "C"})
    return {
        "A": a.json()["id"],
        "B": b.json()["id"],
        "B1": b1.json()["id"],
        "B2": b2.json()["id"],
        "C": c.json()["id"],
    }


@pytest.mark.anyio
async def test_siblings_do_not_gain_implicit_dependencies(fresh_db) -> None:
    """Sibling order at root and within a section creates no dependency rows."""
    async with _client() as client:
        await _build_outline(client)

    assert _dependency_edges(fresh_db) == set()


@pytest.mark.anyio
async def test_independent_sibling_leaves_are_actionable_together(fresh_db) -> None:
    """With no explicit edges, every open leaf is actionable at once."""
    async with _client() as client:
        ids = await _build_outline(client)

    assert _actionable(fresh_db) == {ids["A"], ids["B1"], ids["B2"], ids["C"]}


@pytest.mark.anyio
async def test_explicit_leaf_dependency_blocks_until_target_done(fresh_db) -> None:
    """A leaf-to-leaf dependency gates only the depending leaf."""
    async with _client() as client:
        ids = await _build_outline(client)

        _insert_explicit_edge(fresh_db, ids["B2"], ids["B1"])

        assert _actionable(fresh_db) == {ids["A"], ids["B1"], ids["C"]}

        done = await _patch(client, ids["B1"], {"state": "done"})
        assert done.status_code == 200

    assert _actionable(fresh_db) == {ids["A"], ids["B2"], ids["C"]}


@pytest.mark.anyio
async def test_section_dependency_is_inherited_by_descendant_leaves(fresh_db) -> None:
    """A dependency attached to a container gates all leaves under it."""
    async with _client() as client:
        ids = await _build_outline(client)

        _insert_explicit_edge(fresh_db, ids["B"], ids["A"])

        assert _actionable(fresh_db) == {ids["A"], ids["C"]}

        done = await _patch(client, ids["A"], {"state": "done"})
        assert done.status_code == 200

    assert _actionable(fresh_db) == {ids["B1"], ids["B2"], ids["C"]}


@pytest.mark.anyio
async def test_dependency_on_container_waits_for_whole_section(fresh_db) -> None:
    """A dependency target that is a container is satisfied only when complete."""
    async with _client() as client:
        ids = await _build_outline(client)

        _insert_explicit_edge(fresh_db, ids["C"], ids["B"])

        assert _actionable(fresh_db) == {ids["A"], ids["B1"], ids["B2"]}

        done_b1 = await _patch(client, ids["B1"], {"state": "done"})
        assert done_b1.status_code == 200
        assert _actionable(fresh_db) == {ids["A"], ids["B2"]}

        done_b2 = await _patch(client, ids["B2"], {"state": "done"})
        assert done_b2.status_code == 200

    assert _actionable(fresh_db) == {ids["A"], ids["C"]}


@pytest.mark.anyio
async def test_structural_edits_preserve_explicit_edge_identity(fresh_db) -> None:
    """Moving, indenting, and outdenting keep an explicit edge attached by id."""
    async with _client() as client:
        a = await _create(client, {"title": "a"})
        b = await _create(client, {"title": "b"})
        destination = await _create(client, {"title": "destination"})
        a_id = a.json()["id"]
        b_id = b.json()["id"]
        destination_id = destination.json()["id"]

        edge_id = _insert_explicit_edge(fresh_db, b_id, a_id)

        indented = await _indent(client, b_id)
        assert indented.status_code == 200
        assert indented.json()["id"] == b_id
        assert indented.json()["parent_id"] == a_id
        assert _dependency_rows(fresh_db) == [
            {"id": edge_id, "from_id": b_id, "to_id": a_id, "kind": "explicit"}
        ]

        outdented = await _outdent(client, b_id)
        assert outdented.status_code == 200
        assert outdented.json()["id"] == b_id
        assert outdented.json()["parent_id"] is None
        assert _dependency_rows(fresh_db) == [
            {"id": edge_id, "from_id": b_id, "to_id": a_id, "kind": "explicit"}
        ]

        moved = await _move(client, b_id, {"new_parent_id": destination_id})

    assert moved.status_code == 200
    assert moved.json()["id"] == b_id
    assert moved.json()["parent_id"] == destination_id
    assert _dependency_rows(fresh_db) == [
        {"id": edge_id, "from_id": b_id, "to_id": a_id, "kind": "explicit"}
    ]


@pytest.mark.anyio
async def test_create_sibling_after_existing_item_does_not_create_dependency(
    fresh_db,
) -> None:
    """Creating ``c`` after ``b`` changes sibling order without creating edges."""
    async with _client() as client:
        a = await _create(client, {"title": "a"})
        b = await _create(client, {"title": "b"})
        c = await _create(
            client,
            {
                "title": "c",
                "parent_id": b.json()["parent_id"],
                "after_id": b.json()["id"],
            },
        )

    assert c.status_code == 200
    assert c.json()["parent_id"] == b.json()["parent_id"] == a.json()["parent_id"]
    assert c.json()["sort_order"] > b.json()["sort_order"]
    assert _dependency_edges(fresh_db) == set()
