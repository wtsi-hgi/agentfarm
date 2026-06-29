"""Acceptance tests for item creation (spec: A1 - Create item with defaults).

Behaviour is exercised through the public HTTP surface (POST ``/items``) using
``httpx.AsyncClient`` + ``ASGITransport`` against the FastAPI ``app``, asserting
both status codes and JSON payloads. Persisted dependency state is read back
from the database where relevant, a supported boundary.

Database isolation: ``config.settings.data_dir`` is redirected to pytest's
``tmp_path`` and the schema applied per test, so every test runs against a
fresh SQLite file inside the test sandbox and nothing is written outside it.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

import config
from db.connection import get_connection
from db.migrate import apply_migrations
from services import clock, leverage


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    """Point the app at a fresh, empty SQLite DB under ``tmp_path``.

    Redirecting ``data_dir`` makes ``settings.db_path`` resolve inside the
    sandbox; the same path is used by ``apply_migrations()`` and the
    ``get_db()`` request dependency, so the endpoint and the test see one DB.
    """
    monkeypatch.setattr(config.settings, "data_dir", tmp_path)
    apply_migrations()
    return config.settings.db_path


@pytest.fixture(autouse=True)
def _reset_clock():
    """Always restore the wall-clock after a test that injects a fake clock.

    A2 test 3 pins :mod:`services.clock` to guarantee ``updated_at >
    created_at`` deterministically; this teardown stops that bleeding into any
    other test (and into production defaults) regardless of how the test exits.
    """
    yield
    clock.reset_clock()


def _client() -> AsyncClient:
    """An ``AsyncClient`` bound to the ASGI app (no network)."""
    transport = ASGITransport(app=_app())
    return AsyncClient(transport=transport, base_url="http://testserver")


def _app():
    # Imported lazily so the fixture's monkeypatch of settings is in effect and
    # we always use the live app object.
    from main import app

    return app


def _dependencies(db_path) -> list[dict]:
    """Return all dependency rows as plain dicts."""
    with get_connection(db_path) as conn:
        rows = conn.execute(
            "SELECT id, from_id, to_id, kind FROM dependencies"
        ).fetchall()
    return [dict(row) for row in rows]


async def _create(client: AsyncClient, body: dict):
    return await client.post("/api/v1/items", json=body)


async def _patch(client: AsyncClient, item_id: str, body: dict):
    return await client.patch(f"/api/v1/items/{item_id}", json=body)


async def _tree(client: AsyncClient):
    return await client.get("/api/v1/tree")


async def _delete(client: AsyncClient, item_id: str):
    return await client.delete(f"/api/v1/items/{item_id}")


async def _indent(client: AsyncClient, item_id: str):
    return await client.post(f"/api/v1/items/{item_id}/indent")


async def _outdent(client: AsyncClient, item_id: str):
    return await client.post(f"/api/v1/items/{item_id}/outdent")


async def _move(client: AsyncClient, item_id: str, body: dict):
    return await client.post(f"/api/v1/items/{item_id}/move", json=body)


def _item_row(db_path, item_id: str) -> dict:
    """Return one item's persisted row as a plain dict (a supported boundary)."""
    with get_connection(db_path) as conn:
        row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    return dict(row)


def _item_count(db_path) -> int:
    """Return the number of persisted items."""
    with get_connection(db_path) as conn:
        row = conn.execute("SELECT count(*) AS c FROM items").fetchone()
    return int(row["c"])


def _actionable(db_path) -> set[str]:
    """Return actionable item ids through the leverage service boundary."""
    with get_connection(db_path) as conn:
        return set(leverage.actionable_item_ids(conn))


def _comments(db_path, item_id: str) -> list[dict]:
    """Return an item's comment rows as plain dicts, oldest first."""
    with get_connection(db_path) as conn:
        rows = conn.execute(
            "SELECT id, item_id, author, body, created_at, updated_at "
            "FROM comments WHERE item_id = ? ORDER BY created_at",
            (item_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def _insert_comment(db_path, item_id: str, body: str, at: str) -> str:
    """Insert a comment row directly (the comments endpoint does not exist yet).

    Returns the new comment id so the test can assert it is untouched by a
    later item edit.
    """
    comment_id = str(uuid.uuid4())
    with get_connection(db_path) as conn:
        conn.execute(
            "INSERT INTO comments (id, item_id, author, body, created_at, "
            "updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (comment_id, item_id, "tester", body, at, at),
        )
    return comment_id


def _insert_explicit_edge(db_path, from_id: str, to_id: str) -> str:
    """Insert an explicit dependency edge directly (no edge endpoint yet).

    Returns the new edge id so the test can assert the same edge (id + to_id)
    survives an item rename.
    """
    edge_id = str(uuid.uuid4())
    with get_connection(db_path) as conn:
        conn.execute(
            "INSERT INTO dependencies (id, from_id, to_id, kind) "
            "VALUES (?, ?, ?, 'explicit')",
            (edge_id, from_id, to_id),
        )
    return edge_id


@pytest.mark.anyio
async def test_create_with_defaults(fresh_db) -> None:
    """Test 1: empty DB, minimal body -> 200 with all documented defaults."""
    async with _client() as client:
        response = await _create(client, {"title": "Ship login"})

    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "Ship login"
    assert body["slug"] == "ship-login"
    assert body["id"]  # non-empty id
    assert body["parent_id"] is None
    assert body["state"] == "not-started"
    assert body["mode"] == "prompt-agent"
    assert body["effort"] == "medium"
    assert body["blocked_external"] is False
    assert body["blocked_note"] is None
    assert body["blocked_followup_date"] is None
    assert body["completed_at"] is None
    # All four creation timestamps are the same instant.
    assert body["created_at"] == body["updated_at"] == body["state_changed_at"]


@pytest.mark.anyio
async def test_slug_collision_appends_integer(fresh_db) -> None:
    """Test 2: a colliding slug yields ``ship-login-2`` (first owner keeps bare)."""
    async with _client() as client:
        first = await _create(client, {"title": "Ship login"})
        second = await _create(client, {"title": "Ship login!"})

    assert first.json()["slug"] == "ship-login"
    assert second.status_code == 200
    assert second.json()["slug"] == "ship-login-2"


@pytest.mark.anyio
async def test_slugify_collapses_non_alnum_runs(fresh_db) -> None:
    """Test 3: punctuation/space runs collapse to single hyphens, trimmed."""
    async with _client() as client:
        response = await _create(client, {"title": "  C++  &  Rust  "})

    assert response.status_code == 200
    assert response.json()["slug"] == "c-rust"


@pytest.mark.anyio
async def test_slugify_empty_result_falls_back_to_item(fresh_db) -> None:
    """Test 4: a title with no alphanumerics slugifies to ``item``."""
    async with _client() as client:
        response = await _create(client, {"title": "***"})

    assert response.status_code == 200
    assert response.json()["slug"] == "item"


@pytest.mark.anyio
async def test_bad_enum_returns_422_naming_field(fresh_db) -> None:
    """Test 5: an out-of-set ``mode`` is a 422 whose detail names the field."""
    async with _client() as client:
        response = await _create(client, {"title": "x", "mode": "bogus"})

    assert response.status_code == 422
    body = response.json()
    assert "detail" in body
    assert "mode" in str(body["detail"])


@pytest.mark.anyio
async def test_child_sorts_after_sibling_without_dependency(fresh_db) -> None:
    """Test 6: a second child sorts after the first without creating a dependency."""
    async with _client() as client:
        parent = await _create(client, {"title": "Parent"})
        parent_id = parent.json()["id"]
        c1 = await _create(client, {"title": "c1", "parent_id": parent_id})
        c2 = await _create(client, {"title": "c2", "parent_id": parent_id})

    c1_body = c1.json()
    c2_body = c2.json()
    assert c2.status_code == 200
    assert c2_body["parent_id"] == parent_id
    # c2 sorts strictly after c1 among the siblings.
    assert c2_body["sort_order"] > c1_body["sort_order"]

    # Sibling order is organisational only; no dependency is derived.
    assert _dependencies(fresh_db) == []


@pytest.mark.anyio
async def test_create_unknown_parent_id_returns_404_without_insert(fresh_db) -> None:
    """POST /items rejects an unknown parent before writing anything."""
    async with _client() as client:
        response = await _create(
            client,
            {"title": "Orphan", "parent_id": str(uuid.uuid4())},
        )

    assert response.status_code == 404
    assert response.json() == {"detail": "item not found"}
    assert _item_count(fresh_db) == 0


@pytest.mark.anyio
async def test_create_unknown_after_id_returns_404_without_insert(fresh_db) -> None:
    """POST /items rejects an unknown sibling anchor before writing the item."""
    async with _client() as client:
        existing = await _create(client, {"title": "Existing"})
        response = await _create(
            client,
            {"title": "Unanchored", "after_id": str(uuid.uuid4())},
        )

    assert existing.status_code == 200
    assert response.status_code == 404
    assert response.json() == {"detail": "item not found"}
    assert _item_count(fresh_db) == 1


# --- A2: Edit item fields and timestamp/slug behaviour ----------------------


@pytest.mark.anyio
async def test_patch_state_to_done_sets_completed_and_state_changed(fresh_db) -> None:
    """A2 test 1: not-started -> done sets completed_at and state_changed_at."""
    async with _client() as client:
        created = await _create(client, {"title": "Ship login"})
        item_id = created.json()["id"]
        before = created.json()

        response = await _patch(client, item_id, {"state": "done"})

    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "done"
    assert body["completed_at"] is not None
    # The state-change moment advanced from the (creation) baseline.
    assert body["state_changed_at"] != before["state_changed_at"]
    # Persisted row agrees with the response.
    row = _item_row(fresh_db, item_id)
    assert row["state"] == "done"
    assert row["completed_at"] is not None


@pytest.mark.anyio
async def test_patch_state_off_done_clears_completed(fresh_db) -> None:
    """A2 test 2: done (completed_at set) -> implement clears completed_at.

    The ``done`` precondition is reached by first PATCHing to ``done`` (which
    sets ``completed_at`` per A2 test 1), then the behaviour under test is the
    transition back to a non-complete state clearing it.
    """
    async with _client() as client:
        created = await _create(client, {"title": "Ship login"})
        item_id = created.json()["id"]
        done = await _patch(client, item_id, {"state": "done"})
        # Precondition: the item is now done with completed_at set.
        assert done.json()["completed_at"] is not None

        response = await _patch(client, item_id, {"state": "implement"})

    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "implement"
    assert body["completed_at"] is None
    assert _item_row(fresh_db, item_id)["completed_at"] is None


@pytest.mark.anyio
async def test_patch_title_preserves_id_edges_comments_and_bumps_updated(
    fresh_db,
) -> None:
    """A2 test 3: renaming keeps id/edges/comments and yields updated_at > created_at.

    The injectable clock pins creation at ``t1`` and the PATCH at ``t2`` (>
    ``t1``) so ``updated_at > created_at`` is guaranteed regardless of machine
    speed; the autouse ``_reset_clock`` fixture restores the wall-clock after.
    """
    t1 = "2026-06-29T00:00:00.000000Z"
    t2 = "2026-06-29T01:00:00.000000Z"

    clock.set_clock(lambda: t1)
    async with _client() as client:
        # Two items so the rename target ``i`` can have an explicit edge to ``z``.
        created_i = await _create(client, {"title": "Item I"})
        created_z = await _create(client, {"title": "Item Z"})
        item_id = created_i.json()["id"]
        z_id = created_z.json()["id"]
        created_at = created_i.json()["created_at"]

        # Comment + explicit edge attached to I directly (endpoints not built yet).
        comment_id = _insert_comment(fresh_db, item_id, "a note", t1)
        edge_id = _insert_explicit_edge(fresh_db, item_id, z_id)

        clock.set_clock(lambda: t2)
        response = await _patch(client, item_id, {"title": "New"})

    assert response.status_code == 200
    body = response.json()
    # Identity preserved; slug re-derived from the new title.
    assert body["id"] == item_id
    assert body["title"] == "New"
    assert body["slug"] == "new"
    # updated_at advanced strictly past created_at (which is unchanged).
    assert body["created_at"] == created_at == t1
    assert body["updated_at"] == t2
    assert body["updated_at"] > body["created_at"]

    # The comment is unchanged (same id, body, timestamps).
    comments = _comments(fresh_db, item_id)
    assert len(comments) == 1
    assert comments[0]["id"] == comment_id
    assert comments[0]["body"] == "a note"
    assert comments[0]["created_at"] == comments[0]["updated_at"] == t1

    # The explicit edge is unchanged (same edge id and to_id).
    edges = _dependencies(fresh_db)
    explicit = [e for e in edges if e["kind"] == "explicit"]
    assert len(explicit) == 1
    assert explicit[0]["id"] == edge_id
    assert explicit[0]["from_id"] == item_id
    assert explicit[0]["to_id"] == z_id


@pytest.mark.anyio
async def test_patch_effort_only_leaves_mode_and_state_unchanged(fresh_db) -> None:
    """A2 test 4: PATCH effort=long changes only effort; mode/state unchanged."""
    async with _client() as client:
        created = await _create(client, {"title": "Ship login"})
        item_id = created.json()["id"]
        before = created.json()

        response = await _patch(client, item_id, {"effort": "long"})

    assert response.status_code == 200
    body = response.json()
    assert body["effort"] == "long"
    # Untouched fields keep their prior (default) values.
    assert body["mode"] == before["mode"] == "prompt-agent"
    assert body["state"] == before["state"] == "not-started"


@pytest.mark.anyio
async def test_patch_blocked_fields_persist_together(fresh_db) -> None:
    """A2 test 5: blocked_external + note + followup_date all persist."""
    async with _client() as client:
        created = await _create(client, {"title": "Ship login"})
        item_id = created.json()["id"]

        response = await _patch(
            client,
            item_id,
            {
                "blocked_external": True,
                "blocked_note": "awaiting infra",
                "blocked_followup_date": "2026-07-10",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["blocked_external"] is True
    assert body["blocked_note"] == "awaiting infra"
    assert body["blocked_followup_date"] == "2026-07-10"
    # Persisted values agree (blocked_external stored as integer 1).
    row = _item_row(fresh_db, item_id)
    assert row["blocked_external"] == 1
    assert row["blocked_note"] == "awaiting infra"
    assert row["blocked_followup_date"] == "2026-07-10"


@pytest.mark.anyio
async def test_patch_unknown_id_returns_404(fresh_db) -> None:
    """An unknown item id yields 404 with the documented detail."""
    async with _client() as client:
        response = await _patch(client, str(uuid.uuid4()), {"title": "New"})

    assert response.status_code == 404
    assert response.json()["detail"] == "item not found"


@pytest.mark.anyio
async def test_patch_bad_enum_returns_422_naming_field(fresh_db) -> None:
    """A bad enum token on edit is a 422 whose detail names the field."""
    async with _client() as client:
        created = await _create(client, {"title": "Ship login"})
        item_id = created.json()["id"]

        response = await _patch(client, item_id, {"state": "bogus"})

    assert response.status_code == 422
    assert "state" in str(response.json()["detail"])


# --- A3: Slug re-derivation preserves id-based edges ------------------------


def _tree_item(payload: list[dict], item_id: str) -> dict:
    """Return the GET ``/tree`` entry for ``item_id`` (a supported boundary)."""
    matches = [entry for entry in payload if entry["id"] == item_id]
    assert matches, f"item {item_id} missing from /tree payload"
    return matches[0]


@pytest.mark.anyio
async def test_rename_keeps_edge_and_updates_needs_label(fresh_db) -> None:
    """A3 test 1: rename of an edge target keeps the edge (id + to_id) and the
    displayed ``>needs:`` label re-derives to the target's new slug.

    The explicit edge ``A -> B`` is stored by ``to_id`` (B's id), so when B's
    title (and thus slug) changes, the stored edge is byte-for-byte unchanged
    while A's needs label, resolved live from ``to_id`` to B's current slug,
    becomes ``build-the-api-gateway``.
    """
    async with _client() as client:
        # A and B live in different products; the only edge between them is the
        # explicit one under test.
        prod_b = await _create(client, {"title": "Product B"})
        prod_a = await _create(client, {"title": "Product A"})
        b = await _create(
            client, {"title": "Build API", "parent_id": prod_b.json()["id"]}
        )
        a = await _create(
            client, {"title": "Consume API", "parent_id": prod_a.json()["id"]}
        )
        b_id = b.json()["id"]
        a_id = a.json()["id"]
        # Sanity: B owns the bare slug it will rename away from.
        assert b.json()["slug"] == "build-api"

        edge_id = _insert_explicit_edge(fresh_db, a_id, b_id)

        renamed = await _patch(client, b_id, {"title": "Build the API gateway"})

        tree = await _tree(client)

    assert renamed.status_code == 200
    assert renamed.json()["slug"] == "build-the-api-gateway"

    # The stored explicit edge is unchanged: same edge id and same to_id (B's id).
    edges = _dependencies(fresh_db)
    explicit = [e for e in edges if e["kind"] == "explicit"]
    assert len(explicit) == 1
    assert explicit[0]["id"] == edge_id
    assert explicit[0]["from_id"] == a_id
    assert explicit[0]["to_id"] == b_id

    # GET /tree shows A's needs label as B's *current* slug.
    assert tree.status_code == 200
    payload = tree.json()
    assert _tree_item(payload, a_id)["needs"] == ["build-the-api-gateway"]


@pytest.mark.anyio
async def test_rename_into_colliding_slug_yields_suffix(fresh_db) -> None:
    """A3 test 2: renaming Y to a title that slugifies to an in-use slug yields
    ``task-2`` while the prior owner ``X`` keeps the bare ``task``."""
    async with _client() as client:
        x = await _create(client, {"title": "task"})
        y = await _create(client, {"title": "Other"})
        x_id = x.json()["id"]
        y_id = y.json()["id"]
        assert x.json()["slug"] == "task"

        renamed = await _patch(client, y_id, {"title": "Task!"})

    assert renamed.status_code == 200
    assert renamed.json()["slug"] == "task-2"
    # X is untouched and keeps the bare slug it owned first.
    assert _item_row(fresh_db, x_id)["slug"] == "task"


@pytest.mark.anyio
async def test_double_rename_resolves_needs_label_throughout(fresh_db) -> None:
    """A3 test 3: B renamed twice (-> Foo, -> Bar); the edge A -> B resolves
    throughout (same edge id/to_id) and A's final needs label is ``bar``."""
    async with _client() as client:
        # Different products; the explicit A -> B is the only edge between them.
        prod_b = await _create(client, {"title": "Product B"})
        prod_a = await _create(client, {"title": "Product A"})
        b = await _create(
            client, {"title": "Build API", "parent_id": prod_b.json()["id"]}
        )
        a = await _create(
            client, {"title": "Consume API", "parent_id": prod_a.json()["id"]}
        )
        b_id = b.json()["id"]
        a_id = a.json()["id"]

        edge_id = _insert_explicit_edge(fresh_db, a_id, b_id)

        first = await _patch(client, b_id, {"title": "Foo"})
        tree_after_foo = await _tree(client)
        second = await _patch(client, b_id, {"title": "Bar"})
        tree_after_bar = await _tree(client)

    assert first.status_code == 200
    assert first.json()["slug"] == "foo"
    assert second.status_code == 200
    assert second.json()["slug"] == "bar"

    # The same edge (id + to_id) persists across both renames.
    edges = _dependencies(fresh_db)
    explicit = [e for e in edges if e["kind"] == "explicit"]
    assert len(explicit) == 1
    assert explicit[0]["id"] == edge_id
    assert explicit[0]["to_id"] == b_id

    # The displayed needs label tracks B's current slug at each point.
    assert _tree_item(tree_after_foo.json(), a_id)["needs"] == ["foo"]
    assert _tree_item(tree_after_bar.json(), a_id)["needs"] == ["bar"]


# --- H1: Collapse not remove -------------------------------------------------


@pytest.mark.anyio
async def test_tree_marks_actionable_and_complete_without_omitting_items(
    fresh_db,
) -> None:
    """H1: GET /tree returns every item plus work-now flags.

    The phase text's A/B(B1,B2)/C acceptance line predates the corrected
    sibling-independent model. Under the core rules, A, B1, B2, and C are
    independent open leaves and therefore actionable; B is only structural
    because it has children.
    """
    async with _client() as client:
        a = await _create(client, {"title": "A"})
        b = await _create(client, {"title": "B"})
        b1 = await _create(client, {"title": "B1", "parent_id": b.json()["id"]})
        b2 = await _create(client, {"title": "B2", "parent_id": b.json()["id"]})
        c = await _create(client, {"title": "C"})

        response = await _tree(client)

    assert response.status_code == 200
    payload = response.json()
    ids = {
        "A": a.json()["id"],
        "B": b.json()["id"],
        "B1": b1.json()["id"],
        "B2": b2.json()["id"],
        "C": c.json()["id"],
    }
    assert {entry["id"] for entry in payload} == set(ids.values())

    assert _tree_item(payload, ids["A"])["actionable"] is True
    assert _tree_item(payload, ids["B"])["actionable"] is False
    assert _tree_item(payload, ids["B1"])["actionable"] is True
    assert _tree_item(payload, ids["B2"])["actionable"] is True
    assert _tree_item(payload, ids["C"])["actionable"] is True

    for item_id in ids.values():
        item = _tree_item(payload, item_id)
        assert item["complete"] is False
        assert item["needs"] == []


# --- A4: Delete item with subtree cascade and dependency cleanup ------------


@pytest.mark.anyio
async def test_delete_middle_sibling_preserves_order_without_dependency(
    fresh_db,
) -> None:
    """A4 test 1: deleting the middle of ``[a,b,c]`` leaves ``[a,c]``.

    Any dependency rows incident to ``b`` are cascade-removed, but no replacement
    edge is derived between the remaining siblings.
    """
    async with _client() as client:
        a = await _create(client, {"title": "a"})
        b = await _create(client, {"title": "b"})
        c = await _create(client, {"title": "c"})
        a_id = a.json()["id"]
        b_id = b.json()["id"]
        c_id = c.json()["id"]

        _insert_explicit_edge(fresh_db, c_id, b_id)
        assert {(e["from_id"], e["to_id"]) for e in _dependencies(fresh_db)} == {
            (c_id, b_id)
        }

        response = await _delete(client, b_id)

        tree = await _tree(client)

    assert response.status_code == 200

    # b is gone; a and c remain.
    ids_on_tree = {entry["id"] for entry in tree.json()}
    assert ids_on_tree == {a_id, c_id}
    with get_connection(fresh_db) as conn:
        remaining = {row["id"] for row in conn.execute("SELECT id FROM items")}
    assert remaining == {a_id, c_id}

    payload = sorted(tree.json(), key=lambda entry: entry["sort_order"])
    assert [entry["id"] for entry in payload] == [a_id, c_id]

    assert _dependencies(fresh_db) == []


@pytest.mark.anyio
async def test_delete_container_cascades_to_children_and_comments(fresh_db) -> None:
    """A4 test 2: deleting container ``P`` removes ``P``, its children, and a
    child's comment via the schema's ``ON DELETE CASCADE``.

    The comment is inserted directly (the comments endpoint is Phase 7). After
    DELETE ``P`` every row -- the container, both children, and the comment --
    is absent, proving the cascade fired on the request connection.
    """
    async with _client() as client:
        parent = await _create(client, {"title": "P"})
        parent_id = parent.json()["id"]
        c1 = await _create(client, {"title": "c1", "parent_id": parent_id})
        c2 = await _create(client, {"title": "c2", "parent_id": parent_id})
        c1_id = c1.json()["id"]
        c2_id = c2.json()["id"]

        # A comment on c1, inserted directly (endpoint not built yet).
        comment_id = _insert_comment(
            fresh_db, c1_id, "looks good", "2026-06-29T00:00:00.000000Z"
        )
        # Precondition: the comment is present before the delete.
        assert [c["id"] for c in _comments(fresh_db, c1_id)] == [comment_id]

        response = await _delete(client, parent_id)

    assert response.status_code == 200

    # P, c1, c2, and c1's comment are all gone (rows absent).
    with get_connection(fresh_db) as conn:
        remaining_items = {row["id"] for row in conn.execute("SELECT id FROM items")}
        comment_count = conn.execute(
            "SELECT count(*) AS c FROM comments WHERE id = ?", (comment_id,)
        ).fetchone()["c"]
    assert parent_id not in remaining_items
    assert c1_id not in remaining_items
    assert c2_id not in remaining_items
    assert remaining_items == set()
    assert comment_count == 0
    assert _comments(fresh_db, c1_id) == []


# --- B1: Container retains but ignores mode/effort --------------------------


@pytest.mark.anyio
async def test_container_retains_mode_effort_but_is_not_actionable(
    fresh_db,
) -> None:
    """B1 tests 1-2: a parent with children is structural, then leaf again.

    Downstream scoring is intentionally not implemented in this phase, so this
    proves the currently available behavior: a child makes ``L`` a container
    for actionability while leaving its stored work tokens untouched; deleting
    the last child makes ``L`` an actionable leaf again with those retained
    values.
    """
    async with _client() as client:
        leaf = await _create(
            client, {"title": "L", "mode": "prompt-agent", "effort": "long"}
        )
        leaf_id = leaf.json()["id"]

        child = await _create(client, {"title": "c", "parent_id": leaf_id})
        child_id = child.json()["id"]
        tree_with_child = await _tree(client)

        assert child.status_code == 200
        assert _tree_item(tree_with_child.json(), child_id)["parent_id"] == leaf_id
        assert leaf_id not in _actionable(fresh_db)
        assert child_id in _actionable(fresh_db)
        assert _item_row(fresh_db, leaf_id)["mode"] == "prompt-agent"
        assert _item_row(fresh_db, leaf_id)["effort"] == "long"

        deleted = await _delete(client, child_id)
        tree_without_child = await _tree(client)

    assert deleted.status_code == 200
    assert _tree_item(tree_without_child.json(), leaf_id)["parent_id"] is None
    assert leaf_id in _actionable(fresh_db)
    assert _item_row(fresh_db, leaf_id)["mode"] == "prompt-agent"
    assert _item_row(fresh_db, leaf_id)["effort"] == "long"


# --- B2: Container completeness is derived ----------------------------------


@pytest.mark.anyio
async def test_container_with_mixed_done_and_in_progress_children_is_incomplete(
    fresh_db,
) -> None:
    """B2 test 1: a dependency on ``P`` waits while any child remains open."""
    async with _client() as client:
        parent = await _create(client, {"title": "P"})
        parent_id = parent.json()["id"]
        await _create(client, {"title": "c1", "parent_id": parent_id, "state": "done"})
        c2 = await _create(
            client,
            {"title": "c2", "parent_id": parent_id, "state": "implement"},
        )
        dependent = await _create(client, {"title": "D"})
        dependent_id = dependent.json()["id"]

        _insert_explicit_edge(fresh_db, dependent_id, parent_id)

    actionable = _actionable(fresh_db)
    assert dependent_id not in actionable
    assert c2.json()["id"] in actionable
    assert parent_id not in actionable


@pytest.mark.anyio
async def test_container_with_done_and_abandoned_children_is_complete(
    fresh_db,
) -> None:
    """B2 test 2: ``done`` and ``abandoned`` leaves both satisfy a container."""
    async with _client() as client:
        parent = await _create(client, {"title": "P"})
        parent_id = parent.json()["id"]
        c1 = await _create(
            client, {"title": "c1", "parent_id": parent_id, "state": "done"}
        )
        c2 = await _create(
            client, {"title": "c2", "parent_id": parent_id, "state": "abandoned"}
        )
        dependent = await _create(client, {"title": "D"})
        dependent_id = dependent.json()["id"]

        _insert_explicit_edge(fresh_db, dependent_id, parent_id)

    actionable = _actionable(fresh_db)
    assert dependent_id in actionable
    assert c1.json()["id"] not in actionable
    assert c2.json()["id"] not in actionable
    assert parent_id not in actionable


@pytest.mark.anyio
async def test_nested_container_completeness_propagates_to_ancestors(
    fresh_db,
) -> None:
    """B2 test 3: nested completion satisfies dependencies on ``Q`` and ``P``."""
    async with _client() as client:
        parent = await _create(client, {"title": "P"})
        parent_id = parent.json()["id"]
        child_container = await _create(client, {"title": "Q", "parent_id": parent_id})
        child_container_id = child_container.json()["id"]
        await _create(
            client,
            {"title": "leaf", "parent_id": child_container_id, "state": "done"},
        )
        parent_dependent = await _create(client, {"title": "depends on P"})
        child_dependent = await _create(client, {"title": "depends on Q"})
        parent_dependent_id = parent_dependent.json()["id"]
        child_dependent_id = child_dependent.json()["id"]

        _insert_explicit_edge(fresh_db, parent_dependent_id, parent_id)
        _insert_explicit_edge(fresh_db, child_dependent_id, child_container_id)

    assert _actionable(fresh_db) == {parent_dependent_id, child_dependent_id}


# --- F2: Keyboard structure operations (Enter / Tab / Shift-Tab) ------------


def _implicit_edges(db_path) -> set[tuple[str, str]]:
    """Return all legacy implicit edges as ``(from_id, to_id)`` tuples."""
    return {
        (e["from_id"], e["to_id"])
        for e in _dependencies(db_path)
        if e["kind"] == "implicit"
    }


@pytest.mark.anyio
async def test_enter_next_sibling_create_preserves_independence(fresh_db) -> None:
    """F2 test 1 (Enter): a next-sibling create is POST ``/items`` with the
    current item's ``parent_id`` and ``after_id``; the new sibling sorts after
    the current item without gaining a dependency edge.
    """
    async with _client() as client:
        a = await _create(client, {"title": "a"})
        a_body = a.json()

        b = await _create(
            client,
            {"title": "b", "parent_id": a_body["parent_id"], "after_id": a_body["id"]},
        )

    assert b.status_code == 200
    b_body = b.json()
    a_id = a_body["id"]
    b_id = b_body["id"]
    # b is a sibling of a (same parent) sorting strictly after it.
    assert b_body["parent_id"] == a_body["parent_id"]
    assert b_body["sort_order"] > a_body["sort_order"]
    # Sibling order is independent by default.
    assert (b_id, a_id) not in _implicit_edges(fresh_db)
    assert _dependencies(fresh_db) == []


@pytest.mark.anyio
async def test_indent_makes_preceding_sibling_a_container(fresh_db) -> None:
    """F2 test 2 (Tab): indenting ``b`` (top-level ``[a,b]``) makes it the first
    child of ``a``; ``a`` becomes a container and ``b`` has no dependency edge
    just because it is nested.
    """
    async with _client() as client:
        a = await _create(client, {"title": "a"})
        b = await _create(client, {"title": "b"})
        a_id = a.json()["id"]
        b_id = b.json()["id"]

        # Precondition: root siblings are independent.
        assert _dependencies(fresh_db) == []

        response = await _indent(client, b_id)

        tree = await _tree(client)

    assert response.status_code == 200
    # b is now a's first (and only) child.
    assert response.json()["id"] == b_id
    assert response.json()["parent_id"] == a_id
    assert _item_row(fresh_db, b_id)["parent_id"] == a_id

    # a is now a container: GET /tree lists b as a's child, and a is no longer a
    # root sibling of b.
    payload = tree.json()
    assert {entry["id"] for entry in payload} == {a_id, b_id}
    assert _tree_item(payload, a_id)["parent_id"] is None
    assert _tree_item(payload, b_id)["parent_id"] == a_id

    # Nesting does not create dependency edges.
    assert _dependencies(fresh_db) == []


@pytest.mark.anyio
async def test_outdent_moves_up_one_level_and_depends_on_former_parent(
    fresh_db,
) -> None:
    """F2 test 3 (Shift-Tab): outdenting child ``b`` of container ``a`` makes
    ``b`` a sibling of ``a`` (``a``'s parent), positioned immediately after
    ``a``; if ``a`` now has no children it is a leaf again.
    """
    async with _client() as client:
        a = await _create(client, {"title": "a"})
        a_id = a.json()["id"]
        b = await _create(client, {"title": "b", "parent_id": a_id})
        b_id = b.json()["id"]
        # Precondition: b is a's only child (a is a container).
        assert _item_row(fresh_db, b_id)["parent_id"] == a_id

        response = await _outdent(client, b_id)

        tree = await _tree(client)

    assert response.status_code == 200
    b_body = response.json()
    assert b_body["id"] == b_id
    # b is now a sibling of a at root (a's former parent was None).
    assert b_body["parent_id"] == a.json()["parent_id"]
    assert b_body["parent_id"] is None
    assert _item_row(fresh_db, b_id)["parent_id"] is None
    # b sorts strictly after a.
    assert b_body["sort_order"] > a.json()["sort_order"]

    # Outdenting changes structure only; dependencies remain empty.
    assert _dependencies(fresh_db) == []

    # a now has no children, so it is a leaf again: GET /tree lists both at root,
    # neither nested under the other.
    payload = tree.json()
    assert {entry["id"] for entry in payload} == {a_id, b_id}
    assert _tree_item(payload, a_id)["parent_id"] is None
    assert _tree_item(payload, b_id)["parent_id"] is None


@pytest.mark.anyio
async def test_indent_first_item_is_rejected(fresh_db) -> None:
    """Indenting an item with no preceding sibling is invalid (422)."""
    async with _client() as client:
        a = await _create(client, {"title": "a"})
        a_id = a.json()["id"]

        response = await _indent(client, a_id)

    assert response.status_code == 422
    assert "indent" in str(response.json()["detail"])
    # The item is unmoved (still a root item).
    assert _item_row(fresh_db, a_id)["parent_id"] is None


@pytest.mark.anyio
async def test_outdent_root_item_is_rejected(fresh_db) -> None:
    """Outdenting an item already at root (no parent) is invalid (422)."""
    async with _client() as client:
        a = await _create(client, {"title": "a"})
        a_id = a.json()["id"]

        response = await _outdent(client, a_id)

    assert response.status_code == 422
    assert "outdent" in str(response.json()["detail"])
    assert _item_row(fresh_db, a_id)["parent_id"] is None


@pytest.mark.anyio
async def test_indent_unknown_id_returns_404(fresh_db) -> None:
    """Indenting an unknown item id is a 404."""
    async with _client() as client:
        response = await _indent(client, str(uuid.uuid4()))

    assert response.status_code == 404
    assert response.json()["detail"] == "item not found"


@pytest.mark.anyio
async def test_outdent_unknown_id_returns_404(fresh_db) -> None:
    """Outdenting an unknown item id is a 404."""
    async with _client() as client:
        response = await _outdent(client, str(uuid.uuid4()))

    assert response.status_code == 404
    assert response.json()["detail"] == "item not found"


# --- F3: Identity-preserving structural edits -------------------------------


@pytest.mark.anyio
async def test_indent_then_outdent_preserves_id_edge_and_comment(
    fresh_db,
) -> None:
    """F3: indent then outdent keeps the same item, explicit edge, and comment."""
    timestamp = "2026-06-29T00:00:00.000000Z"

    async with _client() as client:
        a = await _create(client, {"title": "a"})
        b = await _create(client, {"title": "b"})
        z = await _create(client, {"title": "z"})
        a_id = a.json()["id"]
        b_id = b.json()["id"]
        z_id = z.json()["id"]

        edge_id = _insert_explicit_edge(fresh_db, b_id, z_id)
        comment_id = _insert_comment(fresh_db, b_id, "keep me", timestamp)

        indented = await _indent(client, b_id)
        outdented = await _outdent(client, b_id)

    assert indented.status_code == 200
    assert indented.json()["id"] == b_id
    assert indented.json()["parent_id"] == a_id

    assert outdented.status_code == 200
    assert outdented.json()["id"] == b_id
    assert outdented.json()["parent_id"] is None

    edges = _dependencies(fresh_db)
    explicit = [edge for edge in edges if edge["kind"] == "explicit"]
    assert explicit == [
        {"id": edge_id, "from_id": b_id, "to_id": z_id, "kind": "explicit"}
    ]

    assert _comments(fresh_db, b_id) == [
        {
            "id": comment_id,
            "item_id": b_id,
            "author": "tester",
            "body": "keep me",
            "created_at": timestamp,
            "updated_at": timestamp,
        }
    ]


# --- G1: Move subtree across products ---------------------------------------


@pytest.mark.anyio
async def test_move_across_products_reparents_without_order_dependency(
    fresh_db,
) -> None:
    """G1 test 1: moving ``x`` from product ``P1`` to product ``P2`` after ``y``
    reparents ``x`` and sorts it after ``y`` without deriving ``x -> y``.

    Built entirely via the create + move primitives. Asserted via both the move
    response and GET ``/tree`` plus persisted dependency state.
    """
    async with _client() as client:
        p1 = await _create(client, {"title": "P1"})
        p2 = await _create(client, {"title": "P2"})
        p1_id = p1.json()["id"]
        p2_id = p2.json()["id"]
        x = await _create(client, {"title": "x", "parent_id": p1_id})
        y = await _create(client, {"title": "y", "parent_id": p2_id})
        x_id = x.json()["id"]
        y_id = y.json()["id"]

        response = await _move(client, x_id, {"new_parent_id": p2_id, "after_id": y_id})

        tree = await _tree(client)

    assert response.status_code == 200
    body = response.json()
    # Identity preserved and reparented under P2.
    assert body["id"] == x_id
    assert body["parent_id"] == p2_id
    assert _item_row(fresh_db, x_id)["parent_id"] == p2_id

    # x sorts strictly after y within P2.
    x_order = _item_row(fresh_db, x_id)["sort_order"]
    y_order = _item_row(fresh_db, y_id)["sort_order"]
    assert x_order > y_order

    # Placement is not a dependency.
    implicit = _implicit_edges(fresh_db)
    assert (x_id, y_id) not in implicit
    assert {edge for edge in implicit if x_id in edge} == set()

    # GET /tree confirms the new structure: x is under P2, P1 has no children.
    payload = tree.json()
    assert _tree_item(payload, x_id)["parent_id"] == p2_id
    p1_children = [e["id"] for e in payload if e["parent_id"] == p1_id]
    assert p1_children == []
    p2_children = [e["id"] for e in payload if e["parent_id"] == p2_id]
    assert set(p2_children) == {x_id, y_id}


@pytest.mark.anyio
async def test_move_promote_to_root_keeps_explicit_edge(fresh_db) -> None:
    """G1 test 2: promoting ``x`` to a product (``new_parent_id`` null) makes it a
    root item while its explicit edge ``x -> z`` survives unchanged (same edge id
    and ``to_id``).

    The explicit edge is inserted directly (the dependencies endpoint is a later
    phase). Promotion only changes ``x``'s ``parent_id``/``sort_order``; explicit
    edges are untouched.
    """
    async with _client() as client:
        # x starts as a child of a container so promotion is a real reparent.
        parent = await _create(client, {"title": "Parent"})
        parent_id = parent.json()["id"]
        x = await _create(client, {"title": "x", "parent_id": parent_id})
        z = await _create(client, {"title": "z"})
        x_id = x.json()["id"]
        z_id = z.json()["id"]
        assert _item_row(fresh_db, x_id)["parent_id"] == parent_id

        edge_id = _insert_explicit_edge(fresh_db, x_id, z_id)

        response = await _move(client, x_id, {"new_parent_id": None})

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == x_id
    # x is now a product (root item).
    assert body["parent_id"] is None
    assert _item_row(fresh_db, x_id)["parent_id"] is None

    # The explicit edge x -> z is byte-for-byte unchanged (same id and to_id).
    edges = _dependencies(fresh_db)
    explicit = [e for e in edges if e["kind"] == "explicit"]
    assert len(explicit) == 1
    assert explicit[0]["id"] == edge_id
    assert explicit[0]["from_id"] == x_id
    assert explicit[0]["to_id"] == z_id


@pytest.mark.anyio
async def test_move_into_own_descendant_is_rejected(fresh_db) -> None:
    """G1 test 3: moving container ``C`` into its own descendant ``d`` is a 422
    and nothing moves.

    Building ``C > ... > d`` and asking to reparent ``C`` under ``d`` would
    corrupt the tree (a cycle in the parent relation), so it is rejected before
    any mutation; the tree is left exactly as it was.
    """
    async with _client() as client:
        c = await _create(client, {"title": "C"})
        c_id = c.json()["id"]
        mid = await _create(client, {"title": "mid", "parent_id": c_id})
        mid_id = mid.json()["id"]
        d = await _create(client, {"title": "d", "parent_id": mid_id})
        d_id = d.json()["id"]

        before = {iid: _item_row(fresh_db, iid) for iid in (c_id, mid_id, d_id)}

        response = await _move(client, c_id, {"new_parent_id": d_id})

    assert response.status_code == 422
    assert response.json()["detail"] == "cannot move into own descendant"

    # Nothing moved: every item keeps its prior parent and sort_order.
    for iid in (c_id, mid_id, d_id):
        row = _item_row(fresh_db, iid)
        assert row["parent_id"] == before[iid]["parent_id"]
        assert row["sort_order"] == before[iid]["sort_order"]


@pytest.mark.anyio
async def test_move_into_self_is_rejected(fresh_db) -> None:
    """Guard: moving an item into itself is a 422 (self is its own descendant)."""
    async with _client() as client:
        c = await _create(client, {"title": "C"})
        c_id = c.json()["id"]
        child = await _create(client, {"title": "child", "parent_id": c_id})
        child_id = child.json()["id"]

        response = await _move(client, c_id, {"new_parent_id": c_id})

    assert response.status_code == 422
    assert response.json()["detail"] == "cannot move into own descendant"
    # Unchanged: C is still a root, child is still under C.
    assert _item_row(fresh_db, c_id)["parent_id"] is None
    assert _item_row(fresh_db, child_id)["parent_id"] == c_id


@pytest.mark.anyio
async def test_move_unknown_item_returns_404(fresh_db) -> None:
    """Guard: moving an unknown item id is a 404."""
    async with _client() as client:
        response = await _move(client, str(uuid.uuid4()), {"new_parent_id": None})

    assert response.status_code == 404
    assert response.json()["detail"] == "item not found"


@pytest.mark.anyio
async def test_move_unknown_new_parent_returns_404(fresh_db) -> None:
    """Guard: a ``new_parent_id`` that references no item is a 404, nothing moves."""
    async with _client() as client:
        x = await _create(client, {"title": "x"})
        x_id = x.json()["id"]

        response = await _move(client, x_id, {"new_parent_id": str(uuid.uuid4())})

    assert response.status_code == 404
    assert response.json()["detail"] == "item not found"
    # x is unmoved (still a root).
    assert _item_row(fresh_db, x_id)["parent_id"] is None


@pytest.mark.anyio
async def test_move_after_reverse_dependency_is_allowed(fresh_db) -> None:
    """Moving after an item does not add the reverse edge or create a cycle.

    Setup: products ``P`` (child ``a``) and ``Q`` (child ``b``) with an explicit
    edge ``a -> b`` (a needs b). Moving ``b`` under ``P`` after ``a`` is allowed
    because order does not create ``b -> a``.
    """
    async with _client() as client:
        p = await _create(client, {"title": "P"})
        q = await _create(client, {"title": "Q"})
        p_id = p.json()["id"]
        q_id = q.json()["id"]
        a = await _create(client, {"title": "a", "parent_id": p_id})
        b = await _create(client, {"title": "b", "parent_id": q_id})
        a_id = a.json()["id"]
        b_id = b.json()["id"]

        # Explicit edge a -> b inserted directly (a depends on b).
        _insert_explicit_edge(fresh_db, a_id, b_id)

        response = await _move(client, b_id, {"new_parent_id": p_id, "after_id": a_id})

    assert response.status_code == 200

    # Applied: b is now under P, the explicit edge a -> b remains, and no
    # implicit b -> a was added.
    assert _item_row(fresh_db, b_id)["parent_id"] == p_id
    edges = _dependencies(fresh_db)
    assert [(e["from_id"], e["to_id"], e["kind"]) for e in edges] == [
        (a_id, b_id, "explicit")
    ]
    assert (b_id, a_id) not in _implicit_edges(fresh_db)


# --- G2: Merge (reparent children, remove emptied item) ---------------------


@pytest.mark.anyio
async def test_merge_via_move_children_then_delete_source(fresh_db) -> None:
    """G2 test 1: merging ``src`` into ``dst`` by moving ``src``'s children under
    ``dst`` (after ``d1``) and deleting the emptied ``src`` yields ``dst`` with
    children ``[d1, s1, s2]`` and no ``src``.

    Exercised purely through the move + delete primitives (no merge endpoint).
    """
    async with _client() as client:
        src = await _create(client, {"title": "src"})
        dst = await _create(client, {"title": "dst"})
        src_id = src.json()["id"]
        dst_id = dst.json()["id"]
        s1 = await _create(client, {"title": "s1", "parent_id": src_id})
        s2 = await _create(client, {"title": "s2", "parent_id": src_id})
        d1 = await _create(client, {"title": "d1", "parent_id": dst_id})
        s1_id = s1.json()["id"]
        s2_id = s2.json()["id"]
        d1_id = d1.json()["id"]

        # Move s1 after d1, then s2 after the just-moved s1.
        move1 = await _move(client, s1_id, {"new_parent_id": dst_id, "after_id": d1_id})
        move2 = await _move(client, s2_id, {"new_parent_id": dst_id, "after_id": s1_id})
        deleted = await _delete(client, src_id)

        tree = await _tree(client)

    assert move1.status_code == 200
    assert move2.status_code == 200
    assert deleted.status_code == 200

    # src no longer exists.
    with get_connection(fresh_db) as conn:
        src_count = conn.execute(
            "SELECT count(*) AS c FROM items WHERE id = ?", (src_id,)
        ).fetchone()["c"]
    assert src_count == 0

    # dst has children [d1, s1, s2] in stored order.
    payload = tree.json()
    dst_children = [
        e["id"]
        for e in sorted(
            (e for e in payload if e["parent_id"] == dst_id),
            key=lambda e: e["sort_order"],
        )
    ]
    assert dst_children == [d1_id, s1_id, s2_id]

    # The stored order is not a dependency chain.
    assert _implicit_edges(fresh_db) == set()


# --- G3: Split (new root items, move subtrees under them) -------------------


@pytest.mark.anyio
async def test_split_create_root_then_move_subtree(fresh_db) -> None:
    """G3 test 1: split ``s1`` out of container ``src`` into a brand-new product
    ``R`` via the create + move primitives (no split endpoint).

    After creating root ``R`` (``parent_id==null``) and moving ``s1`` under it:
    ``R`` is a product, ``R`` has exactly child ``[s1]``, ``s1.parent_id==R``,
    and neither ``s1`` nor ``s2`` gains a dependency edge from the split.
    """
    async with _client() as client:
        src = await _create(client, {"title": "src"})
        src_id = src.json()["id"]
        s1 = await _create(client, {"title": "s1", "parent_id": src_id})
        s2 = await _create(client, {"title": "s2", "parent_id": src_id})
        s1_id = s1.json()["id"]
        s2_id = s2.json()["id"]

        # Precondition: siblings under src are independent.
        assert _implicit_edges(fresh_db) == set()

        # Create a new product root R, then move s1 under it.
        r = await _create(client, {"title": "R", "parent_id": None})
        r_id = r.json()["id"]
        moved = await _move(client, s1_id, {"new_parent_id": r_id})

        tree = await _tree(client)

    assert r.json()["parent_id"] is None
    assert moved.status_code == 200

    # R is a product with exactly child [s1]; s1's parent is R.
    payload = tree.json()
    assert _tree_item(payload, r_id)["parent_id"] is None
    r_children = [e["id"] for e in payload if e["parent_id"] == r_id]
    assert r_children == [s1_id]
    assert _item_row(fresh_db, s1_id)["parent_id"] == r_id

    implicit = _implicit_edges(fresh_db)
    assert {edge for edge in implicit if edge[0] == s1_id} == set()
    assert (s2_id, s1_id) not in implicit
    assert all(frm != s2_id for (frm, to) in implicit)
