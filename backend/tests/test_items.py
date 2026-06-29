"""Acceptance tests for item creation (spec: A1 - Create item with defaults).

Behaviour is exercised through the public HTTP surface (POST ``/items``) using
``httpx.AsyncClient`` + ``ASGITransport`` against the FastAPI ``app``, asserting
both status codes and JSON payloads. Persisted edge state (the implicit sibling
chain) is read back from the database, a supported boundary, because GET
``/tree`` is not introduced until a later item.

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
from services import clock


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


def _item_row(db_path, item_id: str) -> dict:
    """Return one item's persisted row as a plain dict (a supported boundary)."""
    with get_connection(db_path) as conn:
        row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    return dict(row)


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
async def test_child_sorts_after_sibling_with_implicit_edge(fresh_db) -> None:
    """Test 6: a second child sorts after the first and gets ``c2 -> c1`` implicit."""
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

    # An implicit dependency c2 -> c1 exists (asserted via persisted DB state).
    edges = _dependencies(fresh_db)
    implicit = [e for e in edges if e["kind"] == "implicit"]
    assert any(
        e["from_id"] == c2_body["id"] and e["to_id"] == c1_body["id"] for e in implicit
    ), implicit
    # The chain is a single edge for two siblings (no spurious edges).
    assert len(implicit) == 1


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
        # A and B live in different products so the only edge between them is
        # the explicit one under test (root siblings would also gain an
        # implicit chain edge, which is not what A3 exercises).
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
        # Different products so the explicit A -> B is the only edge between them.
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


# --- A4: Delete item with subtree cascade and edge regeneration -------------


@pytest.mark.anyio
async def test_delete_middle_sibling_rechains_to_single_edge(fresh_db) -> None:
    """A4 test 1: deleting the middle of root siblings ``[a,b,c]`` re-chains the
    group to a single implicit edge ``c->a`` with nothing referencing ``b``.

    The group is built via POST ``/items`` so the implicit chain (``b->a``,
    ``c->b``) is the real, regenerated one. After DELETE ``b`` its incident
    implicit edges are cascade-removed and the remaining siblings re-derive a
    single clean chain. Asserted both via persisted edge state and GET ``/tree``.
    """
    async with _client() as client:
        a = await _create(client, {"title": "a"})
        b = await _create(client, {"title": "b"})
        c = await _create(client, {"title": "c"})
        a_id = a.json()["id"]
        b_id = b.json()["id"]
        c_id = c.json()["id"]

        # Precondition: the real implicit chain is b->a, c->b (and only those).
        implicit_before = [
            e for e in _dependencies(fresh_db) if e["kind"] == "implicit"
        ]
        assert {(e["from_id"], e["to_id"]) for e in implicit_before} == {
            (b_id, a_id),
            (c_id, b_id),
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

    # Exactly one implicit edge c->a remains; no edge references b.
    implicit = [e for e in _dependencies(fresh_db) if e["kind"] == "implicit"]
    assert len(implicit) == 1
    assert (implicit[0]["from_id"], implicit[0]["to_id"]) == (c_id, a_id)
    assert all(b_id not in (e["from_id"], e["to_id"]) for e in _dependencies(fresh_db))


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
