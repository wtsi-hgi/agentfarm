"""Acceptance tests for dependency behavior.

The v1 dependency model keeps tree structure separate from stored dependency
rows: explicit edges are persisted, while the default leaf-item chain inside a
section is derived live from current sibling order. Roots, sections, and
subsections stay independent siblings unless the user records explicit edges.
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


async def _post_dependency(client: AsyncClient, body: dict):
    return await client.post("/api/v1/dependencies", json=body)


async def _delete_dependency(client: AsyncClient, dependency_id: str):
    return await client.delete(f"/api/v1/dependencies/{dependency_id}")


async def _tree(client: AsyncClient):
    return await client.get("/api/v1/tree")


def _tree_item(payload: list[dict], item_id: str) -> dict:
    """Return one item from a GET ``/tree`` payload."""
    matches = [entry for entry in payload if entry["id"] == item_id]
    assert matches, f"item {item_id} missing from /tree payload"
    return matches[0]


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


def _depends_on(db_path, item_id: str, target_id: str) -> bool:
    """Return effective dependency reachability through the service boundary."""
    with get_connection(db_path) as conn:
        return leverage.depends_on(conn, item_id, target_id)


def _downstream(db_path, item_id: str) -> set[str]:
    """Return downstream leaf ids through the service boundary."""
    with get_connection(db_path) as conn:
        return leverage.downstream_item_ids(conn, item_id)


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


async def _build_cross_product_pair(client: AsyncClient) -> dict[str, str]:
    """Create ``X`` and ``Deploy DB`` leaves under separate products."""
    alpha = await _create(client, {"title": "Product Alpha"})
    beta = await _create(client, {"title": "Product Beta"})
    x = await _create(client, {"title": "X", "parent_id": alpha.json()["id"]})
    deploy_db = await _create(
        client,
        {"title": "Deploy DB", "parent_id": beta.json()["id"]},
    )
    return {
        "X": x.json()["id"],
        "deploy_db": deploy_db.json()["id"],
    }


@pytest.mark.anyio
async def test_siblings_do_not_gain_implicit_dependencies(fresh_db) -> None:
    """Sibling order is derived live and still creates no dependency rows."""
    async with _client() as client:
        await _build_outline(client)

    assert _dependency_edges(fresh_db) == set()


@pytest.mark.anyio
async def test_section_leaf_siblings_chain_by_current_sort_order(fresh_db) -> None:
    """Plain leaf items inside one section wait on their previous leaf."""
    async with _client() as client:
        section = await _create(client, {"title": "Section"})
        first = await _create(
            client, {"title": "first", "parent_id": section.json()["id"]}
        )
        second = await _create(
            client, {"title": "second", "parent_id": section.json()["id"]}
        )
        third = await _create(
            client, {"title": "third", "parent_id": section.json()["id"]}
        )
        tree = await _tree(client)

    section_id = section.json()["id"]
    first_id = first.json()["id"]
    second_id = second.json()["id"]
    third_id = third.json()["id"]

    assert _dependency_edges(fresh_db) == set()
    assert _actionable(fresh_db) == {first_id}
    assert _depends_on(fresh_db, second_id, first_id) is True
    assert _depends_on(fresh_db, third_id, second_id) is True
    assert _depends_on(fresh_db, third_id, first_id) is True
    assert _downstream(fresh_db, first_id) == {second_id, third_id}

    payload = tree.json()
    assert _tree_item(payload, section_id)["actionable"] is False
    assert _tree_item(payload, first_id)["actionable"] is True
    assert _tree_item(payload, second_id)["actionable"] is False
    assert _tree_item(payload, third_id)["actionable"] is False


@pytest.mark.anyio
async def test_section_leaf_chain_skips_subsection_siblings(fresh_db) -> None:
    """Containers do not become implicit links in a section's leaf chain."""
    async with _client() as client:
        section = await _create(client, {"title": "Section"})
        first = await _create(
            client, {"title": "first", "parent_id": section.json()["id"]}
        )
        subsection = await _create(
            client, {"title": "Subsection", "parent_id": section.json()["id"]}
        )
        nested = await _create(
            client, {"title": "nested", "parent_id": subsection.json()["id"]}
        )
        second = await _create(
            client, {"title": "second", "parent_id": section.json()["id"]}
        )

    first_id = first.json()["id"]
    subsection_id = subsection.json()["id"]
    nested_id = nested.json()["id"]
    second_id = second.json()["id"]

    assert _actionable(fresh_db) == {first_id, nested_id}
    assert _depends_on(fresh_db, second_id, first_id) is True
    assert _depends_on(fresh_db, second_id, subsection_id) is False
    assert _depends_on(fresh_db, second_id, nested_id) is False


@pytest.mark.anyio
async def test_post_dependency_by_slug_stores_explicit_edge_by_target_id(
    fresh_db,
) -> None:
    """D1: ``needs_slug`` is resolved once and stored as an id edge."""
    async with _client() as client:
        ids = await _build_cross_product_pair(client)

        created = await _post_dependency(
            client,
            {"from_id": ids["X"], "needs_slug": "deploy-db"},
        )

    assert created.status_code == 200
    assert created.json()["from_id"] == ids["X"]
    assert created.json()["to_id"] == ids["deploy_db"]
    assert created.json()["kind"] == "explicit"
    assert _dependency_rows(fresh_db) == [
        {
            "id": created.json()["id"],
            "from_id": ids["X"],
            "to_id": ids["deploy_db"],
            "kind": "explicit",
        }
    ]


@pytest.mark.anyio
async def test_tree_exposes_explicit_dependency_edge_ids(fresh_db) -> None:
    """GET /tree returns enough identity to remove typed ``>needs:`` edges."""
    async with _client() as client:
        ids = await _build_cross_product_pair(client)
        created = await _post_dependency(
            client,
            {"from_id": ids["X"], "needs_slug": "deploy-db"},
        )

        tree_before_rename = await _tree(client)
        renamed = await _patch(
            client,
            ids["deploy_db"],
            {"title": "Deploy Database"},
        )
        tree_after_rename = await _tree(client)

    assert created.status_code == 200
    assert renamed.status_code == 200
    assert tree_before_rename.status_code == 200
    before_entry = _tree_item(tree_before_rename.json(), ids["X"])
    assert before_entry["needs"] == ["deploy-db"]
    assert before_entry["needs_edges"] == [
        {"id": created.json()["id"], "slug": "deploy-db"}
    ]

    assert tree_after_rename.status_code == 200
    after_entry = _tree_item(tree_after_rename.json(), ids["X"])
    assert after_entry["needs"] == ["deploy-database"]
    assert after_entry["needs_edges"] == [
        {"id": created.json()["id"], "slug": "deploy-database"}
    ]


@pytest.mark.anyio
async def test_post_dependency_accepts_target_id(fresh_db) -> None:
    """D1: callers may provide the already-resolved ``to_id``."""
    async with _client() as client:
        ids = await _build_cross_product_pair(client)

        created = await _post_dependency(
            client,
            {"from_id": ids["X"], "to_id": ids["deploy_db"]},
        )

    assert created.status_code == 200
    assert created.json()["from_id"] == ids["X"]
    assert created.json()["to_id"] == ids["deploy_db"]
    assert created.json()["kind"] == "explicit"
    assert _dependency_edges(fresh_db, kind="explicit") == {
        (ids["X"], ids["deploy_db"])
    }


@pytest.mark.anyio
async def test_post_dependency_duplicate_edge_returns_409_without_duplicate_row(
    fresh_db,
) -> None:
    """D1: duplicate explicit edges get a controlled conflict response."""
    async with _client() as client:
        ids = await _build_cross_product_pair(client)

        created = await _post_dependency(
            client,
            {"from_id": ids["X"], "to_id": ids["deploy_db"]},
        )
        rejected = await _post_dependency(
            client,
            {"from_id": ids["X"], "to_id": ids["deploy_db"]},
        )

    assert created.status_code == 200
    assert rejected.status_code == 409
    assert rejected.json() == {"detail": "dependency already exists"}
    assert _dependency_rows(fresh_db) == [
        {
            "id": created.json()["id"],
            "from_id": ids["X"],
            "to_id": ids["deploy_db"],
            "kind": "explicit",
        }
    ]


@pytest.mark.anyio
async def test_post_dependency_blocks_until_slug_target_done(fresh_db) -> None:
    """D1: an explicit edge created by slug gates actionability until done."""
    async with _client() as client:
        ids = await _build_cross_product_pair(client)

        created = await _post_dependency(
            client,
            {"from_id": ids["X"], "needs_slug": "deploy-db"},
        )
        assert created.status_code == 200
        assert _actionable(fresh_db) == {ids["deploy_db"]}

        done = await _patch(client, ids["deploy_db"], {"state": "done"})
        assert done.status_code == 200

    assert _actionable(fresh_db) == {ids["X"]}


@pytest.mark.anyio
async def test_post_dependency_unknown_slug_returns_422(fresh_db) -> None:
    """D1: an unknown ``needs_slug`` is rejected without inserting an edge."""
    async with _client() as client:
        x = await _create(client, {"title": "X"})

        rejected = await _post_dependency(
            client,
            {"from_id": x.json()["id"], "needs_slug": "missing-target"},
        )

    assert rejected.status_code == 422
    assert rejected.json() == {"detail": "unknown dependency: missing-target"}
    assert _dependency_rows(fresh_db) == []


@pytest.mark.anyio
async def test_post_dependency_rejects_direct_cycle(fresh_db) -> None:
    """D2: adding the reverse of an existing edge is rejected."""
    async with _client() as client:
        a = await _create(client, {"title": "A"})
        b = await _create(client, {"title": "B"})
        a_id = a.json()["id"]
        b_id = b.json()["id"]

        created = await _post_dependency(client, {"from_id": a_id, "to_id": b_id})
        rejected = await _post_dependency(client, {"from_id": b_id, "to_id": a_id})

    assert created.status_code == 200
    assert rejected.status_code == 409
    assert rejected.json() == {"detail": "dependency cycle rejected"}
    assert _dependency_edges(fresh_db, kind="explicit") == {(a_id, b_id)}


@pytest.mark.anyio
async def test_post_dependency_rejects_transitive_cycle(fresh_db) -> None:
    """D2: reachability across a chain prevents closing a longer cycle."""
    async with _client() as client:
        a = await _create(client, {"title": "A"})
        b = await _create(client, {"title": "B"})
        c = await _create(client, {"title": "C"})
        a_id = a.json()["id"]
        b_id = b.json()["id"]
        c_id = c.json()["id"]

        first = await _post_dependency(client, {"from_id": a_id, "to_id": b_id})
        second = await _post_dependency(client, {"from_id": b_id, "to_id": c_id})
        rejected = await _post_dependency(client, {"from_id": c_id, "to_id": a_id})

    assert first.status_code == 200
    assert second.status_code == 200
    assert rejected.status_code == 409
    assert rejected.json() == {"detail": "dependency cycle rejected"}
    assert _dependency_edges(fresh_db, kind="explicit") == {
        (a_id, b_id),
        (b_id, c_id),
    }


@pytest.mark.anyio
async def test_post_dependency_rejects_self_edge(fresh_db) -> None:
    """D2: an item cannot depend on itself."""
    async with _client() as client:
        a = await _create(client, {"title": "A"})
        a_id = a.json()["id"]

        rejected = await _post_dependency(client, {"from_id": a_id, "to_id": a_id})

    assert rejected.status_code == 409
    assert rejected.json() == {"detail": "dependency cycle rejected"}
    assert _dependency_rows(fresh_db) == []


@pytest.mark.anyio
async def test_post_dependency_rejects_opposite_section_edge(fresh_db) -> None:
    """D2: section-origin edges participate in the same cycle check."""
    async with _client() as client:
        ids = await _build_outline(client)

        created = await _post_dependency(
            client,
            {"from_id": ids["B"], "to_id": ids["A"]},
        )
        rejected = await _post_dependency(
            client,
            {"from_id": ids["A"], "to_id": ids["B"]},
        )

    assert created.status_code == 200
    assert rejected.status_code == 409
    assert rejected.json() == {"detail": "dependency cycle rejected"}
    assert _dependency_edges(fresh_db, kind="explicit") == {(ids["B"], ids["A"])}


@pytest.mark.anyio
async def test_post_dependency_rejects_inherited_section_cycle(fresh_db) -> None:
    """D2: descendants inherit their section's explicit dependencies."""
    async with _client() as client:
        ids = await _build_outline(client)

        created = await _post_dependency(
            client,
            {"from_id": ids["B"], "to_id": ids["A"]},
        )
        rejected = await _post_dependency(
            client,
            {"from_id": ids["A"], "to_id": ids["B1"]},
        )

    assert created.status_code == 200
    assert rejected.status_code == 409
    assert rejected.json() == {"detail": "dependency cycle rejected"}
    assert _dependency_edges(fresh_db, kind="explicit") == {(ids["B"], ids["A"])}


@pytest.mark.anyio
async def test_post_dependency_rejects_cycle_through_container_target(
    fresh_db,
) -> None:
    """D2: depending on a container reaches its descendant leaves."""
    async with _client() as client:
        ids = await _build_outline(client)

        created = await _post_dependency(
            client,
            {"from_id": ids["A"], "to_id": ids["B"]},
        )
        rejected = await _post_dependency(
            client,
            {"from_id": ids["B1"], "to_id": ids["A"]},
        )

    assert created.status_code == 200
    assert rejected.status_code == 409
    assert rejected.json() == {"detail": "dependency cycle rejected"}
    assert _dependency_edges(fresh_db, kind="explicit") == {(ids["A"], ids["B"])}


@pytest.mark.anyio
async def test_post_dependency_rejects_cycle_through_section_leaf_chain(
    fresh_db,
) -> None:
    """D2: explicit edges cannot point back through a section's implicit chain."""
    async with _client() as client:
        section = await _create(client, {"title": "Section"})
        first = await _create(
            client, {"title": "first", "parent_id": section.json()["id"]}
        )
        second = await _create(
            client, {"title": "second", "parent_id": section.json()["id"]}
        )

        rejected = await _post_dependency(
            client,
            {"from_id": first.json()["id"], "to_id": second.json()["id"]},
        )

    assert rejected.status_code == 409
    assert rejected.json() == {"detail": "dependency cycle rejected"}
    assert _dependency_edges(fresh_db) == set()


@pytest.mark.anyio
async def test_delete_dependency_restores_section_leaf_actionability(
    fresh_db,
) -> None:
    """D3: deleting an explicit edge leaves only the section's own leaf chain."""
    async with _client() as client:
        ids = await _build_outline(client)
        created = await _post_dependency(
            client,
            {"from_id": ids["B"], "to_id": ids["A"]},
        )
        edge_id = created.json()["id"]

        assert created.status_code == 200
        assert _actionable(fresh_db) == {ids["A"], ids["C"]}

        deleted = await _delete_dependency(client, edge_id)

    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True, "id": edge_id}
    assert _dependency_rows(fresh_db) == []
    assert _actionable(fresh_db) == {ids["A"], ids["B1"], ids["C"]}


@pytest.mark.anyio
async def test_delete_dependency_reconciles_tree_needs(
    fresh_db,
) -> None:
    """D3: deleting one explicit edge updates tree identities and labels."""
    async with _client() as client:
        dependent = await _create(client, {"title": "Dependent"})
        first = await _create(client, {"title": "Target One"})
        second = await _create(client, {"title": "Target Two"})
        dependent_id = dependent.json()["id"]

        first_edge = await _post_dependency(
            client,
            {"from_id": dependent_id, "to_id": first.json()["id"]},
        )
        second_edge = await _post_dependency(
            client,
            {"from_id": dependent_id, "to_id": second.json()["id"]},
        )
        deleted = await _delete_dependency(client, first_edge.json()["id"])
        tree_after_delete = await _tree(client)

    assert first_edge.status_code == 200
    assert second_edge.status_code == 200
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True, "id": first_edge.json()["id"]}
    assert tree_after_delete.status_code == 200

    entry = _tree_item(tree_after_delete.json(), dependent_id)
    assert entry["needs"] == ["target-two"]
    assert entry["needs_edges"] == [
        {"id": second_edge.json()["id"], "slug": "target-two"}
    ]


@pytest.mark.anyio
async def test_deleted_dependency_does_not_reappear_after_later_edits(
    fresh_db,
) -> None:
    """D3: unrelated item mutations do not recreate a deleted explicit edge."""
    async with _client() as client:
        ids = await _build_outline(client)
        created = await _post_dependency(
            client,
            {"from_id": ids["B2"], "to_id": ids["A"]},
        )
        edge_id = created.json()["id"]
        deleted = await _delete_dependency(client, edge_id)

        assert created.status_code == 200
        assert deleted.status_code == 200
        assert _dependency_rows(fresh_db) == []

        patched = await _patch(client, ids["A"], {"title": "A renamed"})
        moved = await _move(client, ids["B2"], {"new_parent_id": None})

    assert patched.status_code == 200
    assert moved.status_code == 200
    assert _dependency_rows(fresh_db) == []


@pytest.mark.anyio
async def test_delete_dependency_unknown_id_returns_404(fresh_db) -> None:
    """D3: deleting a missing edge follows the API's not-found policy."""
    async with _client() as client:
        response = await _delete_dependency(client, str(uuid.uuid4()))

    assert response.status_code == 404
    assert response.json() == {"detail": "dependency not found"}


@pytest.mark.anyio
async def test_root_sibling_leaves_are_actionable_together(fresh_db) -> None:
    """Root siblings are independent unless explicit edges link them."""
    async with _client() as client:
        a = await _create(client, {"title": "A"})
        b = await _create(client, {"title": "B"})
        c = await _create(client, {"title": "C"})

    assert _actionable(fresh_db) == {a.json()["id"], b.json()["id"], c.json()["id"]}


@pytest.mark.anyio
async def test_outline_leaf_children_chain_but_root_siblings_stay_independent(
    fresh_db,
) -> None:
    """Only the first open plain item in a section is actionable by default."""
    async with _client() as client:
        ids = await _build_outline(client)

    assert _actionable(fresh_db) == {ids["A"], ids["B1"], ids["C"]}


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

    assert _actionable(fresh_db) == {ids["B1"], ids["C"]}


@pytest.mark.anyio
async def test_dependency_on_container_waits_for_whole_section(fresh_db) -> None:
    """A dependency target that is a container is satisfied only when complete."""
    async with _client() as client:
        ids = await _build_outline(client)

        _insert_explicit_edge(fresh_db, ids["C"], ids["B"])

        assert _actionable(fresh_db) == {ids["A"], ids["B1"]}

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
