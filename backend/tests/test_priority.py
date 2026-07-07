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


async def _ensure_dependency(client: AsyncClient, body: dict) -> None:
    """Ensure an edge exists, accepting automatic-chain duplicates."""
    created = await _post_dependency(client, body)
    if created.status_code == 200:
        return
    assert created.status_code == 409
    assert created.json() == {"detail": "dependency already exists"}


async def _patch(client: AsyncClient, item_id: str, body: dict):
    return await client.patch(f"/api/v1/items/{item_id}", json=body)


async def _move(client: AsyncClient, item_id: str, body: dict):
    return await client.post(f"/api/v1/items/{item_id}/move", json=body)


async def _priority(client: AsyncClient):
    return await client.get("/api/v1/priority")


async def _tree(client: AsyncClient):
    return await client.get("/api/v1/tree")


async def _home(client: AsyncClient):
    return await client.get("/api/v1/home")


async def _create_note(client: AsyncClient, item_id: str, body: str):
    return await client.post(f"/api/v1/items/{item_id}/notes", json={"body": body})


async def _create_prompt_response_entry(
    client: AsyncClient, item_id: str, *, kind: str, body: str
):
    return await client.post(
        f"/api/v1/items/{item_id}/prompt-responses",
        json={"kind": kind, "body": body},
    )


def _rows_by_title(rows: list[dict]) -> dict[str, dict]:
    return {row["title"]: row for row in rows}


async def _create_bucketed_leaf(
    client: AsyncClient,
    root_id: str,
    *,
    bucket_title: str,
    leaf_body: dict,
) -> dict:
    """Create a leaf under a dedicated bucket container below ``root_id``."""
    bucket = await _create(client, {"title": bucket_title, "parent_id": root_id})
    assert bucket.status_code == 200
    leaf = await _create(
        client,
        {
            **leaf_body,
            "parent_id": bucket.json()["id"],
        },
    )
    assert leaf.status_code == 200
    return leaf.json()


def _status_count_total(rollup: dict) -> int:
    """Return the sum of the six status buckets in a roll-up payload."""
    return sum(rollup["status_counts"].values())


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


def _insert_dependency(db_path, from_id: str, to_id: str) -> None:
    """Insert a valid explicit dependency edge with controlled ids."""
    with get_connection(db_path) as conn:
        conn.execute(
            """
            INSERT INTO dependencies (id, from_id, to_id, kind, automatic_chain)
            VALUES (?, ?, ?, 'explicit', 0)
            """,
            (f"dep-{from_id}-needs-{to_id}", from_id, to_id),
        )


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
    ball: str = "you",
    mode: str = "prompt-agent",
    effort: str = "medium",
) -> None:
    """Insert a valid actionable leaf with controlled audit timestamps."""
    with get_connection(db_path) as conn:
        conn.execute(
            """
            INSERT INTO items (
                id, title, slug, sort_order, state, ball, mode, effort,
                created_by, updated_by, created_at, updated_at, state_changed_at,
                ball_changed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item_id,
                title,
                item_id,
                1.0,
                state,
                ball,
                mode,
                effort,
                "tester",
                "tester",
                created_at,
                updated_at,
                created_at,
                created_at,
            ),
        )


def _set_ball(db_path, item_id: str, ball: str) -> None:
    """Set Ball directly for projection tests before the PATCH flow exists."""
    with get_connection(db_path) as conn:
        conn.execute(
            """
            UPDATE items
            SET ball = ?,
                ball_changed_at = '2026-01-03T00:00:00.000000Z',
                updated_at = '2026-01-03T00:00:00.000000Z'
            WHERE id = ?
            """,
            (ball, item_id),
        )


@pytest.mark.anyio
async def test_b1_leaf_without_dependencies_is_ready_on_tree_and_home(
    fresh_db,
) -> None:
    """B1 test 1: an unblocked owner leaf is ready everywhere it is exposed."""
    async with _client() as client:
        created = await _create(client, {"title": "Ready leaf"})
        tree = await _tree(client)
        home = await _home(client)

    assert created.status_code == 200
    assert tree.status_code == 200
    assert home.status_code == 200
    tree_row = _rows_by_title(tree.json())["Ready leaf"]
    home_row = _rows_by_title(home.json()["items"])["Ready leaf"]
    assert tree_row["status"] == "ready"
    assert home_row["status"] == "ready"


@pytest.mark.anyio
async def test_b1_agent_leaf_without_incomplete_dependency_is_monitoring(
    fresh_db,
) -> None:
    """B1 test 2: Ball=agent derives monitoring when dependencies are satisfied."""
    async with _client() as client:
        created = await _create(client, {"title": "Agent leaf", "ball": "agent"})
        tree = await _tree(client)

    assert created.status_code == 200
    assert tree.status_code == 200
    assert _rows_by_title(tree.json())["Agent leaf"]["status"] == "monitoring"


@pytest.mark.anyio
async def test_b1_person_leaf_is_waiting(fresh_db) -> None:
    """B1 test 3: Ball=person derives waiting."""
    async with _client() as client:
        created = await _create(client, {"title": "Person leaf", "ball": "person"})
        tree = await _tree(client)

    assert created.status_code == 200
    assert tree.status_code == 200
    assert _rows_by_title(tree.json())["Person leaf"]["status"] == "waiting"


@pytest.mark.anyio
async def test_b1_incomplete_dependency_blocks_owner_leaf(fresh_db) -> None:
    """B1 test 4: an incomplete dependency outranks Ball=you readiness."""
    async with _client() as client:
        target = await _create(client, {"title": "Incomplete target"})
        dependent = await _create(client, {"title": "Owner dependent"})
        dependency = await _post_dependency(
            client,
            {"from_id": dependent.json()["id"], "to_id": target.json()["id"]},
        )
        tree = await _tree(client)

    assert target.status_code == 200
    assert dependent.status_code == 200
    assert dependency.status_code == 200
    assert tree.status_code == 200
    assert _rows_by_title(tree.json())["Owner dependent"]["status"] == "blocked"


@pytest.mark.anyio
async def test_b1_incomplete_dependency_blocks_agent_leaf_before_monitoring(
    fresh_db,
) -> None:
    """B1 test 5: blocked outranks monitoring."""
    async with _client() as client:
        target = await _create(client, {"title": "Open prerequisite"})
        dependent = await _create(
            client,
            {"title": "Agent dependent", "ball": "agent"},
        )
        dependency = await _post_dependency(
            client,
            {"from_id": dependent.json()["id"], "to_id": target.json()["id"]},
        )
        tree = await _tree(client)

    assert target.status_code == 200
    assert dependent.status_code == 200
    assert dependency.status_code == 200
    assert tree.status_code == 200
    assert _rows_by_title(tree.json())["Agent dependent"]["status"] == "blocked"


@pytest.mark.anyio
async def test_b1_terminal_leaf_status_ignores_ball(fresh_db) -> None:
    """B1 test 6: terminal phases outrank Ball-derived open statuses."""
    async with _client() as client:
        done = await _create(
            client,
            {"title": "Done leaf", "state": "done", "ball": "agent"},
        )
        dropped = await _create(
            client,
            {"title": "Dropped leaf", "state": "abandoned", "ball": "person"},
        )
        tree = await _tree(client)

    assert done.status_code == 200
    assert dropped.status_code == 200
    assert tree.status_code == 200
    rows = _rows_by_title(tree.json())
    assert rows["Done leaf"]["status"] == "done"
    assert rows["Dropped leaf"]["status"] == "dropped"


@pytest.mark.anyio
async def test_b1_container_status_rollup_precedes_terminal_state(fresh_db) -> None:
    """B1 test 7: containers derive rollup even if their stored state is done."""
    async with _client() as client:
        container = await _create(client, {"title": "Done container", "state": "done"})
        child = await _create(
            client,
            {"title": "Container child", "parent_id": container.json()["id"]},
        )
        tree = await _tree(client)

    assert container.status_code == 200
    assert child.status_code == 200
    assert tree.status_code == 200
    assert _rows_by_title(tree.json())["Done container"]["status"] == "rollup"


@pytest.mark.anyio
async def test_b1_completed_dependency_flips_blocked_to_ball_status(
    fresh_db,
) -> None:
    """B1 test 8: completing the target releases the dependent leaf next read."""
    async with _client() as client:
        target = await _create(client, {"title": "Blocking target"})
        dependent = await _create(
            client,
            {"title": "Blocked agent", "ball": "agent"},
        )
        dependency = await _post_dependency(
            client,
            {"from_id": dependent.json()["id"], "to_id": target.json()["id"]},
        )
        blocked_tree = await _tree(client)
        completed = await _patch(client, target.json()["id"], {"state": "done"})
        released_tree = await _tree(client)

    assert target.status_code == 200
    assert dependent.status_code == 200
    assert dependency.status_code == 200
    assert blocked_tree.status_code == 200
    assert completed.status_code == 200
    assert released_tree.status_code == 200
    assert _rows_by_title(blocked_tree.json())["Blocked agent"]["status"] == "blocked"
    assert (
        _rows_by_title(released_tree.json())["Blocked agent"]["status"] == "monitoring"
    )


@pytest.mark.anyio
async def test_b2_fresh_not_started_leaf_has_resume_false_on_tree_and_home(
    fresh_db,
) -> None:
    """B2 test 1: untouched not-started work is fresh, not resume."""
    async with _client() as client:
        created = await _create(client, {"title": "Fresh ready leaf"})
        tree = await _tree(client)
        home = await _home(client)

    assert created.status_code == 200
    assert tree.status_code == 200
    assert home.status_code == 200
    tree_row = _rows_by_title(tree.json())["Fresh ready leaf"]
    home_row = _rows_by_title(home.json()["items"])["Fresh ready leaf"]
    assert tree_row["resume"] is False
    assert home_row["resume"] is False


@pytest.mark.anyio
async def test_b2_not_started_leaf_with_note_has_resume_true_on_tree_and_home(
    fresh_db,
) -> None:
    """B2 test 2: adding a note turns a fresh leaf into resume work."""
    async with _client() as client:
        created = await _create(client, {"title": "Noted ready leaf"})
        initial_tree = await _tree(client)
        note = await _create_note(client, created.json()["id"], "Keep going here.")
        resumed_tree = await _tree(client)
        resumed_home = await _home(client)

    assert created.status_code == 200
    assert initial_tree.status_code == 200
    assert note.status_code == 200
    assert resumed_tree.status_code == 200
    assert resumed_home.status_code == 200
    assert _rows_by_title(initial_tree.json())["Noted ready leaf"]["resume"] is False
    assert _rows_by_title(resumed_tree.json())["Noted ready leaf"]["resume"] is True
    assert (
        _rows_by_title(resumed_home.json()["items"])["Noted ready leaf"]["resume"]
        is True
    )


@pytest.mark.anyio
async def test_b2_defining_leaf_without_notes_has_resume_true(fresh_db) -> None:
    """B2 test 3: any phase beyond not-started is resume work."""
    async with _client() as client:
        created = await _create(
            client,
            {"title": "Mid thought leaf", "state": "defining"},
        )
        tree = await _tree(client)

    assert created.status_code == 200
    assert tree.status_code == 200
    assert _rows_by_title(tree.json())["Mid thought leaf"]["resume"] is True


@pytest.mark.anyio
async def test_b2_not_started_leaf_with_prompt_response_has_resume_true(
    fresh_db,
) -> None:
    """B2 test 4: agent timeline entries turn not-started work into resume."""
    async with _client() as client:
        created = await _create(client, {"title": "Prompted ready leaf"})
        entry = await _create_prompt_response_entry(
            client,
            created.json()["id"],
            kind="prompt",
            body="Start by checking the logs.",
        )
        tree = await _tree(client)

    assert created.status_code == 200
    assert entry.status_code == 200
    assert tree.status_code == 200
    assert _rows_by_title(tree.json())["Prompted ready leaf"]["resume"] is True


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
        await _ensure_dependency(client, dependency)
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
            await _ensure_dependency(client, dependency)

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
async def test_b3_you_ball_leaf_is_actionable_and_in_priority(fresh_db) -> None:
    """B3 test 1: owner-held ready work is actionable and ranked."""
    async with _client() as client:
        created = await _create(client, {"title": "Ready owner work"})
        tree = await _tree(client)
        response = await _priority(client)

    assert created.status_code == 200
    assert tree.status_code == 200
    assert response.status_code == 200
    item_id = created.json()["id"]
    tree_row = _rows_by_title(tree.json())["Ready owner work"]
    assert tree_row["id"] == item_id
    assert tree_row["status"] == "ready"
    assert tree_row["actionable"] is True
    assert [entry["id"] for entry in response.json()] == [item_id]
    with get_connection(fresh_db) as conn:
        assert leverage.is_actionable(conn, item_id) is True


@pytest.mark.anyio
async def test_b3_agent_ball_leaf_is_excluded_but_keeps_downstream_rank(
    fresh_db,
) -> None:
    """B3 test 2: agent-held leaves are not actionable but still downstream."""
    async with _client() as client:
        upstream = await _create(client, {"title": "Upstream", "effort": "quick"})
        peer = await _create(client, {"title": "Peer", "effort": "quick"})
        handoff = await _create(
            client,
            {
                "title": "Agent handoff",
                "effort": "long",
                "mode": "prompt-agent",
            },
        )
        ready_tree = await _tree(client)

    assert upstream.status_code == 200
    assert peer.status_code == 200
    assert handoff.status_code == 200
    assert ready_tree.status_code == 200
    handoff_id = handoff.json()["id"]
    assert _rows_by_title(ready_tree.json())["Agent handoff"]["actionable"] is True

    _set_ball(fresh_db, handoff_id, "agent")
    async with _client() as client:
        monitoring_tree = await _tree(client)
        response = await _priority(client)

    assert monitoring_tree.status_code == 200
    assert response.status_code == 200
    handoff_row = _rows_by_title(monitoring_tree.json())["Agent handoff"]
    assert handoff_row["status"] == "monitoring"
    assert handoff_row["actionable"] is False
    assert handoff_id not in {entry["id"] for entry in response.json()}
    with get_connection(fresh_db) as conn:
        assert leverage.is_actionable(conn, handoff_id) is False

    async with _client() as client:
        dependency = await _post_dependency(
            client,
            {"from_id": handoff_id, "to_id": upstream.json()["id"]},
        )
        agent_priority = await _priority(client)

    assert dependency.status_code == 200
    assert agent_priority.status_code == 200
    agent_ranked_ids = [entry["id"] for entry in agent_priority.json()]
    assert agent_ranked_ids == [upstream.json()["id"], peer.json()["id"]]
    assert _downstream(fresh_db, upstream.json()["id"]) == {handoff_id}
    assert _score(fresh_db, upstream.json()["id"]) == 16

    _set_ball(fresh_db, handoff_id, "you")
    async with _client() as client:
        owner_priority = await _priority(client)

    assert owner_priority.status_code == 200
    assert [entry["id"] for entry in owner_priority.json()] == agent_ranked_ids


@pytest.mark.anyio
async def test_b3_person_ball_leaf_is_not_actionable_or_prioritized(
    fresh_db,
) -> None:
    """B3 test 3: person-held leaves are waiting and absent from priority."""
    async with _client() as client:
        created = await _create(client, {"title": "Waiting on Sam", "ball": "person"})
        upstream = await _create(
            client,
            {"title": "Person upstream", "effort": "quick"},
        )
        downstream = await _create(
            client,
            {
                "title": "Person downstream",
                "ball": "person",
                "effort": "long",
                "mode": "prompt-agent",
            },
        )
        dependency = await _post_dependency(
            client,
            {"from_id": downstream.json()["id"], "to_id": upstream.json()["id"]},
        )
        tree = await _tree(client)
        response = await _priority(client)

    assert created.status_code == 200
    assert upstream.status_code == 200
    assert downstream.status_code == 200
    assert dependency.status_code == 200
    assert tree.status_code == 200
    assert response.status_code == 200
    item_id = created.json()["id"]
    tree_row = _rows_by_title(tree.json())["Waiting on Sam"]
    assert tree_row["status"] == "waiting"
    assert tree_row["actionable"] is False
    assert item_id not in {entry["id"] for entry in response.json()}
    with get_connection(fresh_db) as conn:
        assert leverage.is_actionable(conn, item_id) is False
    assert _downstream(fresh_db, upstream.json()["id"]) == {downstream.json()["id"]}
    assert _score(fresh_db, upstream.json()["id"]) == 16
    assert [entry["id"] for entry in response.json()] == [upstream.json()["id"]]


@pytest.mark.anyio
async def test_b3_former_respond_leaf_gets_no_priority_boost(fresh_db) -> None:
    """B3 test 4: released/owner work uses normal equal-score tie-breaks."""
    older_time = "2026-01-01T00:00:00.000000Z"
    newer_time = "2026-01-02T00:00:00.000000Z"
    _insert_priority_leaf(
        fresh_db,
        "a-former-respond",
        "Former respond work",
        older_time,
        older_time,
        state="released",
    )
    _insert_priority_leaf(
        fresh_db,
        "z-newer-ready",
        "Newer ready work",
        newer_time,
        newer_time,
    )

    async with _client() as client:
        response = await _priority(client)

    assert response.status_code == 200
    body = response.json()
    assert [entry["id"] for entry in body] == ["z-newer-ready", "a-former-respond"]
    assert [entry["rank"] for entry in body] == [1, 2]


@pytest.mark.anyio
async def test_b4_all_owner_leaves_preserve_baseline_priority_order(
    fresh_db,
) -> None:
    """B4 test 1: all-owner trees keep the pre-rework leverage ranking."""
    async with _client() as client:
        ids = await _build_e1_setup(client)
        tree = await _tree(client)
        response = await _priority(client)

    assert tree.status_code == 200
    assert response.status_code == 200
    tree_by_id = {entry["id"]: entry for entry in tree.json()}
    leaf_ids = {
        ids["A1"],
        ids["A2"],
        ids["B1"],
        ids["B2"],
        ids["B3"],
        ids["G1"],
        ids["G2"],
    }
    assert {tree_by_id[item_id]["ball"] for item_id in leaf_ids} == {"you"}
    body = response.json()
    assert [entry["id"] for entry in body] == [ids["A1"], ids["B1"], ids["G1"]]
    assert {entry["id"] for entry in body} == {ids["A1"], ids["B1"], ids["G1"]}
    assert [entry["rank"] for entry in body] == [1, 2, 3]
    assert all("score" not in entry for entry in body)


@pytest.mark.anyio
async def test_b4_agent_downstream_leaf_still_lifts_target_rank(
    fresh_db,
) -> None:
    """B4 test 2: agent-held leaves still contribute to dependency leverage."""
    older_time = "2026-01-01T00:00:00.000000Z"
    newer_time = "2026-01-02T00:00:00.000000Z"
    _insert_priority_leaf(
        fresh_db,
        "a-target",
        "Older dependency target",
        older_time,
        older_time,
        mode="review",
        effort="quick",
    )
    _insert_priority_leaf(
        fresh_db,
        "z-newer-peer",
        "Newer zero-score peer",
        newer_time,
        newer_time,
        mode="review",
        effort="quick",
    )
    _insert_priority_leaf(
        fresh_db,
        "m-agent-downstream",
        "Agent-held downstream",
        newer_time,
        newer_time,
        ball="agent",
        mode="prompt-agent",
        effort="long",
    )
    _insert_dependency(fresh_db, "m-agent-downstream", "a-target")

    async with _client() as client:
        tree = await _tree(client)
        response = await _priority(client)

    assert tree.status_code == 200
    assert response.status_code == 200
    agent_row = _rows_by_title(tree.json())["Agent-held downstream"]
    assert agent_row["status"] == "blocked"
    assert agent_row["actionable"] is False
    body = response.json()
    assert [entry["id"] for entry in body] == ["a-target", "z-newer-peer"]
    assert "m-agent-downstream" not in {entry["id"] for entry in body}
    assert _downstream(fresh_db, "a-target") == {"m-agent-downstream"}


@pytest.mark.anyio
async def test_b4_rank_reflects_mode_and_effort_weights(
    fresh_db,
) -> None:
    """B4 test 3: prompt-agent doubles, other modes are 1, effort is 1/3/8."""
    timestamp = "2026-01-01T00:00:00.000000Z"
    _insert_priority_leaf(
        fresh_db,
        "quick-base",
        "Quick base",
        timestamp,
        timestamp,
        mode="review",
        effort="quick",
    )
    _insert_priority_leaf(
        fresh_db,
        "medium-base",
        "Medium base",
        timestamp,
        timestamp,
        mode="merge",
        effort="medium",
    )
    _insert_priority_leaf(
        fresh_db,
        "long-base",
        "Long base",
        timestamp,
        timestamp,
        mode="release",
        effort="long",
    )
    _insert_priority_leaf(
        fresh_db,
        "prompt-long-downstream",
        "Prompt long downstream",
        timestamp,
        timestamp,
        mode="prompt-agent",
        effort="long",
    )
    _insert_priority_leaf(
        fresh_db,
        "review-long-downstream",
        "Review long downstream",
        timestamp,
        timestamp,
        mode="review",
        effort="long",
    )
    _insert_priority_leaf(
        fresh_db,
        "merge-medium-downstream",
        "Merge medium downstream",
        timestamp,
        timestamp,
        mode="merge",
        effort="medium",
    )
    _insert_dependency(fresh_db, "prompt-long-downstream", "quick-base")
    _insert_dependency(fresh_db, "review-long-downstream", "medium-base")
    _insert_dependency(fresh_db, "merge-medium-downstream", "long-base")

    async with _client() as client:
        response = await _priority(client)

    assert response.status_code == 200
    assert _score(fresh_db, "quick-base") == 16
    assert _score(fresh_db, "medium-base") == pytest.approx(8 / 3)
    assert _score(fresh_db, "long-base") == pytest.approx(3 / 8)
    assert [entry["id"] for entry in response.json()] == [
        "quick-base",
        "medium-base",
        "long-base",
    ]


@pytest.mark.anyio
async def test_b5_container_rollup_counts_each_leaf_status_on_tree_and_home(
    fresh_db,
) -> None:
    """B5 test 1: container status_counts aggregate all descendant leaf statuses."""
    async with _client() as client:
        root = await _create(client, {"title": "B5 status rollup"})
        root_id = root.json()["id"]
        ready = await _create_bucketed_leaf(
            client,
            root_id,
            bucket_title="Ready bucket",
            leaf_body={"title": "Ready rollup leaf"},
        )
        monitoring = await _create_bucketed_leaf(
            client,
            root_id,
            bucket_title="Monitoring bucket",
            leaf_body={"title": "Monitoring rollup leaf", "ball": "agent"},
        )
        waiting = await _create_bucketed_leaf(
            client,
            root_id,
            bucket_title="Waiting bucket",
            leaf_body={"title": "Waiting rollup leaf", "ball": "person"},
        )
        blocked = await _create_bucketed_leaf(
            client,
            root_id,
            bucket_title="Blocked bucket",
            leaf_body={"title": "Blocked rollup leaf"},
        )
        blocker = await _create(client, {"title": "External blocker"})
        dependency = await _post_dependency(
            client,
            {"from_id": blocked["id"], "to_id": blocker.json()["id"]},
        )
        done = await _create_bucketed_leaf(
            client,
            root_id,
            bucket_title="Done bucket",
            leaf_body={"title": "Done rollup leaf", "state": "done"},
        )
        dropped = await _create_bucketed_leaf(
            client,
            root_id,
            bucket_title="Dropped bucket",
            leaf_body={"title": "Dropped rollup leaf", "state": "abandoned"},
        )
        tree = await _tree(client)
        home = await _home(client)

    assert root.status_code == 200
    assert dependency.status_code == 200
    assert tree.status_code == 200
    assert home.status_code == 200
    assert {ready["id"], monitoring["id"], waiting["id"], done["id"], dropped["id"]}

    tree_row = _rows_by_title(tree.json())["B5 status rollup"]
    home_row = _rows_by_title(home.json()["items"])["B5 status rollup"]
    assert tree_row["status"] == "rollup"
    assert tree_row["rollup"]["status_counts"] == {
        "ready": 1,
        "monitoring": 1,
        "waiting": 1,
        "blocked": 1,
        "done": 1,
        "dropped": 1,
    }
    assert tree_row["rollup"]["ship"]["total"] == 6
    assert home_row["rollup"] == tree_row["rollup"]


@pytest.mark.anyio
async def test_b5_rollup_ship_counts_only_leaves_with_all_milestones(
    fresh_db,
) -> None:
    """B5 test 2: shipped counts only leaves with all four ship flags true."""
    async with _client() as client:
        root = await _create(client, {"title": "B5 ship rollup"})
        full = await _create_bucketed_leaf(
            client,
            root.json()["id"],
            bucket_title="Fully shipped bucket",
            leaf_body={"title": "Fully shipped leaf"},
        )
        partial = await _create_bucketed_leaf(
            client,
            root.json()["id"],
            bucket_title="Partially shipped bucket",
            leaf_body={"title": "Partially shipped leaf"},
        )
        full_patch = await _patch(
            client,
            full["id"],
            {
                "dev_updated": True,
                "prod_updated": True,
                "docs_updated": True,
                "announced": True,
            },
        )
        partial_patch = await _patch(
            client,
            partial["id"],
            {
                "dev_updated": True,
                "prod_updated": True,
                "docs_updated": True,
                "announced": False,
            },
        )
        tree = await _tree(client)

    assert root.status_code == 200
    assert full_patch.status_code == 200
    assert partial_patch.status_code == 200
    assert tree.status_code == 200
    ship = _rows_by_title(tree.json())["B5 ship rollup"]["rollup"]["ship"]
    assert ship == {
        "dev_updated": 2,
        "prod_updated": 2,
        "docs_updated": 2,
        "announced": 1,
        "shipped": 1,
        "total": 2,
    }


@pytest.mark.anyio
async def test_b5_rollup_phase_is_least_advanced_open_leaf_phase(
    fresh_db,
) -> None:
    """B5 test 3: rollup.phase uses least-advanced open descendant phase."""
    async with _client() as client:
        root = await _create(client, {"title": "B5 phase rollup"})
        for phase in ("review", "defining", "released"):
            await _create_bucketed_leaf(
                client,
                root.json()["id"],
                bucket_title=f"{phase} bucket",
                leaf_body={"title": f"{phase} rollup leaf", "state": phase},
            )
        tree = await _tree(client)

    assert root.status_code == 200
    assert tree.status_code == 200
    assert _rows_by_title(tree.json())["B5 phase rollup"]["rollup"]["phase"] == (
        "defining"
    )


@pytest.mark.anyio
async def test_b5_all_terminal_container_rollup_has_no_open_phase(
    fresh_db,
) -> None:
    """B5 test 4: all-terminal descendants leave rollup.phase null."""
    async with _client() as client:
        root = await _create(client, {"title": "B5 terminal rollup"})
        await _create_bucketed_leaf(
            client,
            root.json()["id"],
            bucket_title="Terminal done bucket",
            leaf_body={"title": "Terminal done leaf", "state": "done"},
        )
        await _create_bucketed_leaf(
            client,
            root.json()["id"],
            bucket_title="Terminal dropped bucket",
            leaf_body={"title": "Terminal dropped leaf", "state": "abandoned"},
        )
        tree = await _tree(client)

    assert root.status_code == 200
    assert tree.status_code == 200
    rollup = _rows_by_title(tree.json())["B5 terminal rollup"]["rollup"]
    assert rollup["phase"] is None
    assert rollup["status_counts"] == {
        "ready": 0,
        "monitoring": 0,
        "waiting": 0,
        "blocked": 0,
        "done": 1,
        "dropped": 1,
    }


@pytest.mark.anyio
async def test_b5_nested_container_rollup_counts_leaves_at_any_depth(
    fresh_db,
) -> None:
    """B5 test 5: intermediate containers aggregate all nested descendant leaves."""
    async with _client() as client:
        root = await _create(client, {"title": "B5 nested root"})
        intermediate = await _create(
            client,
            {"title": "B5 intermediate", "parent_id": root.json()["id"]},
        )
        direct = await _create(
            client,
            {
                "title": "Nested direct leaf",
                "parent_id": intermediate.json()["id"],
            },
        )
        nested = await _create(
            client,
            {
                "title": "B5 nested child container",
                "parent_id": intermediate.json()["id"],
            },
        )
        deep = await _create(
            client,
            {"title": "Nested deep leaf", "parent_id": nested.json()["id"]},
        )
        tree = await _tree(client)

    assert root.status_code == 200
    assert intermediate.status_code == 200
    assert direct.status_code == 200
    assert nested.status_code == 200
    assert deep.status_code == 200
    assert tree.status_code == 200
    rollup = _rows_by_title(tree.json())["B5 intermediate"]["rollup"]
    assert rollup["ship"]["total"] == 2
    assert _status_count_total(rollup) == 2
    assert rollup["status_counts"]["ready"] == 2


@pytest.mark.anyio
async def test_b5_leaf_rollup_is_null_on_tree_and_home(fresh_db) -> None:
    """B5 test 6: leaf rows carry rollup null everywhere TreeItemOut is exposed."""
    async with _client() as client:
        created = await _create(client, {"title": "B5 leaf with no rollup"})
        tree = await _tree(client)
        home = await _home(client)

    assert created.status_code == 200
    assert tree.status_code == 200
    assert home.status_code == 200
    assert _rows_by_title(tree.json())["B5 leaf with no rollup"]["rollup"] is None
    assert (
        _rows_by_title(home.json()["items"])["B5 leaf with no rollup"]["rollup"] is None
    )


@pytest.mark.anyio
async def test_ball_controls_actionability_regardless_of_open_phase(
    fresh_db,
) -> None:
    """Open phases are actionable only while the Ball is with the owner."""
    older_time = "2026-01-01T00:00:00.000000Z"
    newer_time = "2026-01-02T00:00:00.000000Z"
    _insert_priority_leaf(
        fresh_db,
        "a-defining",
        "Define next slice",
        older_time,
        older_time,
        state="defining",
    )
    _insert_priority_leaf(
        fresh_db,
        "b-implement",
        "Agent is implementing",
        newer_time,
        newer_time,
        state="implement",
        ball="agent",
    )
    _insert_priority_leaf(
        fresh_db,
        "c-ready",
        "Ready ordinary work",
        newer_time,
        newer_time,
    )

    async with _client() as client:
        response = await _priority(client)

    assert response.status_code == 200
    body = response.json()
    assert [entry["id"] for entry in body] == ["c-ready", "a-defining"]
    assert [entry["rank"] for entry in body] == [1, 2]
    assert [entry["state"] for entry in body] == ["not-started", "defining"]


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
        await _ensure_dependency(
            client,
            {"from_id": k2.json()["id"], "to_id": k1.json()["id"]},
        )

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
            await _ensure_dependency(client, dependency)

    assert _downstream(fresh_db, m1.json()["id"]) == {
        m2.json()["id"],
        m3.json()["id"],
    }
    assert _score(fresh_db, m1.json()["id"]) == 17
