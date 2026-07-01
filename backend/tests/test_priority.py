"""Acceptance tests for unblock-leverage priority ordering (spec: E1-E6)."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

import config
from db.connection import get_connection, get_db
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


async def _post_dependency(client: AsyncClient, body: dict):
    return await client.post("/api/v1/dependencies", json=body)


async def _patch(client: AsyncClient, item_id: str, body: dict):
    return await client.patch(f"/api/v1/items/{item_id}", json=body)


async def _move(client: AsyncClient, item_id: str, body: dict):
    return await client.post(f"/api/v1/items/{item_id}/move", json=body)


async def _priority(client: AsyncClient):
    return await client.get("/api/v1/priority")


async def _tree(client: AsyncClient):
    return await client.get("/api/v1/tree")


async def _count_endpoint_queries(db_path, path: str) -> tuple[int, list[str]]:
    """Return the number of SQL work statements used to serve one GET request."""
    from main import app

    statements: list[str] = []
    counted_operations = {"SELECT", "INSERT", "UPDATE", "DELETE"}

    def traced_db():
        with get_connection(db_path) as conn:
            conn.set_trace_callback(
                lambda statement: (
                    statements.append(statement)
                    if statement.lstrip().split(maxsplit=1)[0].upper()
                    in counted_operations
                    else None
                )
            )
            yield conn

    app.dependency_overrides[get_db] = traced_db
    try:
        async with _client() as client:
            response = await client.get(path)
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert response.status_code == 200
    return len(statements), statements


def _dependency_edges(db_path) -> set[tuple[str, str]]:
    """Return stored dependency edges as ``(from_id, to_id)`` pairs."""
    with get_connection(db_path) as conn:
        rows = conn.execute(
            "SELECT from_id, to_id FROM dependencies ORDER BY from_id, to_id"
        ).fetchall()
    return {(row["from_id"], row["to_id"]) for row in rows}


def _downstream(db_path, item_id: str) -> set[str]:
    """Return downstream ids through the spec-defined leverage service boundary."""
    with get_connection(db_path) as conn:
        return leverage.downstream_item_ids(conn, item_id)


def _score(db_path, item_id: str) -> float:
    """Return the unblock-leverage score through the service boundary."""
    with get_connection(db_path) as conn:
        return leverage.score(conn, item_id)


def _insert_priority_leaf(
    db_path,
    item_id: str,
    title: str,
    created_at: str,
    updated_at: str,
    state: str = "not-started",
) -> None:
    """Insert a valid actionable leaf with controlled audit timestamps."""
    with get_connection(db_path) as conn:
        conn.execute(
            """
            INSERT INTO items (
                id, title, slug, sort_order, state, created_by, updated_by,
                created_at, updated_at, state_changed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item_id,
                title,
                item_id,
                1.0,
                state,
                "tester",
                "tester",
                created_at,
                updated_at,
                created_at,
            ),
        )


async def _build_e1_setup(client: AsyncClient) -> dict[str, str]:
    """Create the E1 three-product scenario and return label -> item id."""
    alpha = await _create(client, {"title": "Alpha"})
    a1 = await _create(
        client,
        {
            "title": "A1",
            "parent_id": alpha.json()["id"],
            "effort": "quick",
            "mode": "prompt-agent",
        },
    )
    a2 = await _create(
        client,
        {
            "title": "A2",
            "parent_id": alpha.json()["id"],
            "effort": "long",
            "mode": "prompt-agent",
        },
    )

    beta = await _create(client, {"title": "Beta"})
    b1 = await _create(
        client,
        {
            "title": "B1",
            "parent_id": beta.json()["id"],
            "effort": "quick",
            "mode": "prompt-agent",
        },
    )
    b2 = await _create(
        client,
        {
            "title": "B2",
            "parent_id": beta.json()["id"],
            "effort": "medium",
            "mode": "review",
        },
    )
    b3 = await _create(
        client,
        {
            "title": "B3",
            "parent_id": beta.json()["id"],
            "effort": "medium",
            "mode": "review",
        },
    )

    gamma = await _create(client, {"title": "Gamma"})
    g1 = await _create(
        client,
        {
            "title": "G1",
            "parent_id": gamma.json()["id"],
            "effort": "long",
            "mode": "prompt-agent",
        },
    )
    g2 = await _create(
        client,
        {
            "title": "G2",
            "parent_id": gamma.json()["id"],
            "effort": "long",
            "mode": "prompt-agent",
        },
    )

    ids = {
        "Alpha": alpha.json()["id"],
        "A1": a1.json()["id"],
        "A2": a2.json()["id"],
        "Beta": beta.json()["id"],
        "B1": b1.json()["id"],
        "B2": b2.json()["id"],
        "B3": b3.json()["id"],
        "Gamma": gamma.json()["id"],
        "G1": g1.json()["id"],
        "G2": g2.json()["id"],
    }
    for dependency in (
        {"from_id": ids["A2"], "to_id": ids["A1"]},
        {"from_id": ids["B2"], "to_id": ids["B1"]},
        {"from_id": ids["B3"], "to_id": ids["B2"]},
        {"from_id": ids["G2"], "to_id": ids["G1"]},
    ):
        created = await _post_dependency(client, dependency)
        assert created.status_code == 200
    return ids


@pytest.mark.anyio
async def test_priority_returns_only_actionable_e1_leaves(fresh_db) -> None:
    """E1 test 1: only the first leaf in each product is actionable."""
    async with _client() as client:
        ids = await _build_e1_setup(client)
        response = await _priority(client)

    assert response.status_code == 200
    body = response.json()
    assert {entry["id"] for entry in body} == {ids["A1"], ids["B1"], ids["G1"]}


@pytest.mark.anyio
async def test_priority_orders_e1_by_leverage_rank_without_score(fresh_db) -> None:
    """E1 test 2: leverage order is A1, B1, G1 with ranks and no score."""
    async with _client() as client:
        ids = await _build_e1_setup(client)
        response = await _priority(client)

    assert response.status_code == 200
    assert _downstream(fresh_db, ids["A1"]) == {ids["A2"]}
    assert _downstream(fresh_db, ids["B1"]) == {ids["B2"], ids["B3"]}
    assert _downstream(fresh_db, ids["G1"]) == {ids["G2"]}
    assert _score(fresh_db, ids["A1"]) == 16
    assert _score(fresh_db, ids["B1"]) == 6
    assert _score(fresh_db, ids["G1"]) == 2
    body = response.json()
    assert [entry["id"] for entry in body] == [ids["A1"], ids["B1"], ids["G1"]]
    assert [entry["rank"] for entry in body] == [1, 2, 3]
    assert [entry["title"] for entry in body] == ["A1", "B1", "G1"]
    assert all("score" not in entry for entry in body)


@pytest.mark.anyio
async def test_priority_order_does_not_mutate_tree_order_or_edges_h3(
    fresh_db,
) -> None:
    """H3: leverage priority is display-only; stored tree and edges stay put."""
    async with _client() as client:
        ids = await _build_e1_setup(client)
        before_edges = _dependency_edges(fresh_db)

        priority = await _priority(client)
        tree = await _tree(client)

    assert priority.status_code == 200
    assert [entry["id"] for entry in priority.json()] == [
        ids["A1"],
        ids["B1"],
        ids["G1"],
    ]

    assert tree.status_code == 200
    payload = tree.json()

    def child_titles(parent_id: str) -> list[str]:
        children = [entry for entry in payload if entry["parent_id"] == parent_id]
        return [entry["title"] for entry in children]

    assert child_titles(ids["Alpha"]) == ["A1", "A2"]
    assert child_titles(ids["Beta"]) == ["B1", "B2", "B3"]
    assert child_titles(ids["Gamma"]) == ["G1", "G2"]
    assert _dependency_edges(fresh_db) == before_edges


@pytest.mark.anyio
async def test_priority_uses_section_leaf_chain_and_reorder_updates_it(
    fresh_db,
) -> None:
    """Plain section items are prioritized in current visual chain order."""
    async with _client() as client:
        section = await _create(client, {"title": "Section"})
        first = await _create(
            client,
            {
                "title": "first",
                "parent_id": section.json()["id"],
                "effort": "quick",
            },
        )
        second = await _create(
            client,
            {
                "title": "second",
                "parent_id": section.json()["id"],
                "effort": "medium",
            },
        )
        third = await _create(
            client,
            {
                "title": "third",
                "parent_id": section.json()["id"],
                "effort": "long",
                "mode": "prompt-agent",
            },
        )

        initial_priority = await _priority(client)
        first_id = first.json()["id"]
        second_id = second.json()["id"]
        third_id = third.json()["id"]
        initial_downstream = _downstream(fresh_db, first_id)
        initial_score = _score(fresh_db, first_id)
        moved = await _move(
            client,
            third_id,
            {"new_parent_id": section.json()["id"], "position": "first"},
        )
        reordered_priority = await _priority(client)
        reordered_downstream = _downstream(fresh_db, third_id)
        reordered_score = _score(fresh_db, third_id)

    assert initial_priority.status_code == 200
    assert [entry["id"] for entry in initial_priority.json()] == [first_id]
    assert initial_downstream == {second_id, third_id}
    assert initial_score == 22

    assert moved.status_code == 200
    assert reordered_priority.status_code == 200
    assert [entry["id"] for entry in reordered_priority.json()] == [third_id]
    assert reordered_downstream == {first_id, second_id}
    assert reordered_score == 1.0


@pytest.mark.anyio
async def test_tree_and_priority_query_counts_stay_bounded_for_large_chain(
    fresh_db,
) -> None:
    """Large outlines are projected set-at-once instead of via per-item walks."""
    async with _client() as client:
        section = await _create(client, {"title": "Performance section"})
        section_id = section.json()["id"]
        for index in range(40):
            created = await _create(
                client,
                {
                    "title": f"Chain item {index + 1:02d}",
                    "parent_id": section_id,
                },
            )
            assert created.status_code == 200

    tree_query_count, tree_statements = await _count_endpoint_queries(
        fresh_db, "/api/v1/tree"
    )
    priority_query_count, priority_statements = await _count_endpoint_queries(
        fresh_db, "/api/v1/priority"
    )

    assert tree_query_count <= 5, tree_statements
    assert priority_query_count <= 5, priority_statements


@pytest.mark.anyio
async def test_done_section_chain_leaf_is_excluded_and_next_leaf_is_prioritized(
    fresh_db,
) -> None:
    """Done leaves do not outrank open section-chain work."""
    async with _client() as client:
        section = await _create(client, {"title": "Section"})
        first = await _create(
            client,
            {
                "title": "first",
                "parent_id": section.json()["id"],
                "effort": "quick",
            },
        )
        second = await _create(
            client,
            {
                "title": "second",
                "parent_id": section.json()["id"],
                "effort": "quick",
            },
        )
        third = await _create(
            client,
            {
                "title": "third",
                "parent_id": section.json()["id"],
                "effort": "medium",
            },
        )

        first_id = first.json()["id"]
        second_id = second.json()["id"]
        third_id = third.json()["id"]
        done = await _patch(client, first_id, {"state": "done"})
        response = await _priority(client)

    assert done.status_code == 200
    assert response.status_code == 200
    assert [entry["id"] for entry in response.json()] == [second_id]
    assert first_id not in {entry["id"] for entry in response.json()}
    assert _downstream(fresh_db, second_id) == {third_id}


@pytest.mark.anyio
async def test_priority_divides_equal_downstream_by_own_effort(fresh_db) -> None:
    """E3: A cheap item outranks a costly one with equal downstream leverage."""
    async with _client() as client:
        ids = await _build_e1_setup(client)
        response = await _priority(client)

    assert response.status_code == 200
    assert _score(fresh_db, ids["A1"]) == 16
    assert _score(fresh_db, ids["G1"]) == 2

    body = response.json()
    ranks = {entry["id"]: entry["rank"] for entry in body}
    assert ranks[ids["A1"]] < ranks[ids["G1"]]


@pytest.mark.anyio
async def test_priority_weights_only_prompt_agent_downstream_double_e2(
    fresh_db,
) -> None:
    """E2: prompt-agent downstream contributes double; review stays single."""
    async with _client() as client:
        h = await _create(client, {"title": "H"})
        h1 = await _create(
            client,
            {"title": "H1", "parent_id": h.json()["id"], "effort": "quick"},
        )
        h2 = await _create(
            client,
            {
                "title": "H2",
                "parent_id": h.json()["id"],
                "effort": "long",
                "mode": "prompt-agent",
            },
        )

        i = await _create(client, {"title": "I"})
        i1 = await _create(
            client,
            {"title": "I1", "parent_id": i.json()["id"], "effort": "quick"},
        )
        i2 = await _create(
            client,
            {
                "title": "I2",
                "parent_id": i.json()["id"],
                "effort": "long",
                "mode": "review",
            },
        )

        ids = {
            "H1": h1.json()["id"],
            "H2": h2.json()["id"],
            "I1": i1.json()["id"],
            "I2": i2.json()["id"],
        }
        for dependency in (
            {"from_id": ids["H2"], "to_id": ids["H1"]},
            {"from_id": ids["I2"], "to_id": ids["I1"]},
        ):
            created = await _post_dependency(client, dependency)
            assert created.status_code == 200

        response = await _priority(client)

    assert response.status_code == 200
    assert _score(fresh_db, ids["H1"]) == 16
    assert _score(fresh_db, ids["I1"]) == 8
    body = response.json()
    assert [entry["id"] for entry in body] == [ids["H1"], ids["I1"]]
    assert [entry["title"] for entry in body] == ["H1", "I1"]


@pytest.mark.anyio
async def test_priority_tie_break_prefers_latest_updated_at_e5(fresh_db) -> None:
    """E5: an item edited later outranks an equal-score item."""
    old_time = "2026-01-01T00:00:00.000000Z"
    latest_time = "2026-01-02T00:00:00.000000Z"
    _insert_priority_leaf(fresh_db, "z-m1", "M1 edited", old_time, latest_time)
    _insert_priority_leaf(fresh_db, "a-n1", "N1", old_time, old_time)

    async with _client() as client:
        response = await _priority(client)

    assert response.status_code == 200
    body = response.json()
    assert [entry["title"] for entry in body] == ["M1 edited", "N1"]
    assert [entry["rank"] for entry in body] == [1, 2]


@pytest.mark.anyio
async def test_priority_tie_break_prefers_newer_created_at_e5(fresh_db) -> None:
    """E5: newer creation time wins when score and updated_at are tied."""
    older_time = "2026-01-01T00:00:00.000000Z"
    newer_time = "2026-01-02T00:00:00.000000Z"
    _insert_priority_leaf(fresh_db, "a-p1", "P1", older_time, older_time)
    _insert_priority_leaf(fresh_db, "z-q1", "Q1", newer_time, newer_time)

    async with _client() as client:
        response = await _priority(client)

    assert response.status_code == 200
    body = response.json()
    assert [entry["title"] for entry in body] == ["Q1", "P1"]
    assert [entry["rank"] for entry in body] == [1, 2]


@pytest.mark.anyio
async def test_priority_tie_break_prefers_lexically_smaller_id_e5(fresh_db) -> None:
    """E5: id ascending is the final deterministic tie-break."""
    same_time = "2026-01-01T00:00:00.000000Z"
    _insert_priority_leaf(fresh_db, "a-r1", "R1 small id", same_time, same_time)
    _insert_priority_leaf(fresh_db, "z-r1", "R1 large id", same_time, same_time)

    async with _client() as client:
        response = await _priority(client)

    assert response.status_code == 200
    body = response.json()
    assert [entry["id"] for entry in body] == ["a-r1", "z-r1"]
    assert [entry["rank"] for entry in body] == [1, 2]


@pytest.mark.anyio
async def test_priority_excludes_blocked_external_root_leaf_e6(fresh_db) -> None:
    """E6 test 1: an externally blocked open root leaf is not actionable."""
    async with _client() as client:
        v1 = await _create(client, {"title": "V1"})
        assert v1.status_code == 200
        blocked = await client.patch(
            f"/api/v1/items/{v1.json()['id']}",
            json={"blocked_external": True},
        )
        assert blocked.status_code == 200

        response = await _priority(client)

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.anyio
async def test_priority_counts_blocked_external_leaf_downstream_e6(fresh_db) -> None:
    """E6 test 2: blocked downstream leaves still contribute to upstream score."""
    async with _client() as client:
        w1 = await _create(client, {"title": "W1", "effort": "quick"})
        assert w1.status_code == 200
        w2 = await _create(
            client,
            {
                "title": "W2",
                "effort": "long",
                "mode": "prompt-agent",
            },
        )
        assert w2.status_code == 200

        blocked = await client.patch(
            f"/api/v1/items/{w2.json()['id']}",
            json={"blocked_external": True},
        )
        assert blocked.status_code == 200
        dependency = await _post_dependency(
            client, {"from_id": w2.json()["id"], "to_id": w1.json()["id"]}
        )
        assert dependency.status_code == 200

        v1 = await _create(client, {"title": "V1"})
        assert v1.status_code == 200
        blocked_v1 = await client.patch(
            f"/api/v1/items/{v1.json()['id']}",
            json={"blocked_external": True},
        )
        assert blocked_v1.status_code == 200

        response = await _priority(client)

    assert response.status_code == 200
    assert _downstream(fresh_db, w1.json()["id"]) == {w2.json()["id"]}
    assert _score(fresh_db, w1.json()["id"]) == 16

    body = response.json()
    assert {entry["id"] for entry in body} == {w1.json()["id"]}
    assert [entry["title"] for entry in body] == ["W1"]


@pytest.mark.anyio
async def test_feedback_and_implement_wait_externally_while_respond_is_prioritized(
    fresh_db,
) -> None:
    """Feedback and Implement are not actionable; Respond surfaces ahead of work."""
    older_time = "2026-01-01T00:00:00.000000Z"
    newer_time = "2026-01-02T00:00:00.000000Z"
    _insert_priority_leaf(
        fresh_db,
        "a-respond",
        "Respond to feedback",
        older_time,
        older_time,
        state="respond",
    )
    _insert_priority_leaf(
        fresh_db,
        "b-feedback",
        "Await requested feedback",
        newer_time,
        newer_time,
        state="feedback",
    )
    _insert_priority_leaf(
        fresh_db,
        "c-implement",
        "Agent is implementing",
        newer_time,
        newer_time,
        state="implement",
    )
    _insert_priority_leaf(
        fresh_db,
        "d-ready",
        "Ready ordinary work",
        newer_time,
        newer_time,
    )

    async with _client() as client:
        response = await _priority(client)

    assert response.status_code == 200
    body = response.json()
    assert [entry["id"] for entry in body] == ["a-respond", "d-ready"]
    assert [entry["rank"] for entry in body] == [1, 2]
    assert [entry["state"] for entry in body] == ["respond", "not-started"]


@pytest.mark.anyio
async def test_downstream_inherits_container_dependency_but_excludes_container_e4(
    fresh_db,
) -> None:
    """E4: a container dependency flows to its open leaf children only."""
    async with _client() as client:
        j = await _create(client, {"title": "J"})
        j1 = await _create(
            client,
            {
                "title": "J1",
                "parent_id": j.json()["id"],
                "effort": "quick",
            },
        )
        j2 = await _create(client, {"title": "J2", "parent_id": j.json()["id"]})
        j2a = await _create(client, {"title": "J2a", "parent_id": j2.json()["id"]})
        created = await _post_dependency(
            client,
            {"from_id": j2.json()["id"], "to_id": j1.json()["id"]},
        )

    assert created.status_code == 200
    assert _downstream(fresh_db, j1.json()["id"]) == {j2a.json()["id"]}
    assert j2.json()["id"] not in _downstream(fresh_db, j1.json()["id"])
    assert _score(fresh_db, j1.json()["id"]) == 6


@pytest.mark.anyio
async def test_downstream_excludes_completed_leaf_e4(fresh_db) -> None:
    """E4: completed leaves do not contribute to downstream or score."""
    async with _client() as client:
        k = await _create(client, {"title": "K"})
        k1 = await _create(
            client,
            {
                "title": "K1",
                "parent_id": k.json()["id"],
                "effort": "quick",
            },
        )
        k2 = await _create(
            client,
            {
                "title": "K2",
                "parent_id": k.json()["id"],
                "state": "done",
            },
        )
        created = await _post_dependency(
            client,
            {"from_id": k2.json()["id"], "to_id": k1.json()["id"]},
        )

    assert created.status_code == 200
    assert _downstream(fresh_db, k1.json()["id"]) == set()
    assert _score(fresh_db, k1.json()["id"]) == 0


@pytest.mark.anyio
async def test_downstream_follows_transitive_leaf_chain_e4(fresh_db) -> None:
    """E4: explicit downstream chains are transitive across open leaves."""
    async with _client() as client:
        m = await _create(client, {"title": "M"})
        m1 = await _create(
            client,
            {
                "title": "M1",
                "parent_id": m.json()["id"],
                "effort": "quick",
            },
        )
        m2 = await _create(
            client,
            {
                "title": "M2",
                "parent_id": m.json()["id"],
                "effort": "quick",
                "mode": "review",
            },
        )
        m3 = await _create(
            client,
            {
                "title": "M3",
                "parent_id": m.json()["id"],
                "effort": "long",
                "mode": "prompt-agent",
            },
        )
        for dependency in (
            {"from_id": m2.json()["id"], "to_id": m1.json()["id"]},
            {"from_id": m3.json()["id"], "to_id": m2.json()["id"]},
        ):
            created = await _post_dependency(client, dependency)
            assert created.status_code == 200

    assert _downstream(fresh_db, m1.json()["id"]) == {
        m2.json()["id"],
        m3.json()["id"],
    }
    assert _score(fresh_db, m1.json()["id"]) == 17
