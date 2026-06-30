"""Acceptance tests for item prompt/response timelines."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

import config
from api.v1.authz import require_identity
from db.migrate import apply_migrations
from services import clock
from services.session_tokens import issue_session_token


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    """Point the app at a fresh, empty SQLite DB under ``tmp_path``."""
    monkeypatch.setattr(config.settings, "data_dir", tmp_path)
    apply_migrations()
    return config.settings.db_path


@pytest.fixture(autouse=True)
def _reset_clock():
    """Restore the wall-clock after tests that pin entry timestamps."""
    yield
    clock.reset_clock()


def _client() -> AsyncClient:
    """An ``AsyncClient`` bound to the ASGI app (no network)."""
    from main import app

    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://testserver")


def _session_headers(username: str, role: str) -> dict[str, str]:
    """Return a signed auth header for tests that exercise real role guards."""
    return {"x-agentfarm-session": issue_session_token(username=username, role=role)}


async def _create_item(client: AsyncClient, title: str = "Agent task"):
    return await client.post("/api/v1/items", json={"title": title})


async def _create_entry(
    client: AsyncClient,
    item_id: str,
    *,
    kind: str,
    body: str,
):
    return await client.post(
        f"/api/v1/items/{item_id}/prompt-responses",
        json={"kind": kind, "body": body},
    )


async def _list_entries(client: AsyncClient, item_id: str):
    return await client.get(f"/api/v1/items/{item_id}/prompt-responses")


async def _create_comment(client: AsyncClient, item_id: str, body: str):
    return await client.post(f"/api/v1/items/{item_id}/comments", json={"body": body})


async def _list_comments(client: AsyncClient, item_id: str):
    return await client.get(f"/api/v1/items/{item_id}/comments")


@pytest.mark.anyio
async def test_item_prompt_response_entries_are_stored_and_listed_in_order(
    fresh_db,
) -> None:
    """Each item has an ordered prompt/response history with captured timestamps."""
    del fresh_db
    prompt_time = "2026-06-30T09:00:00.000000Z"
    response_time = "2026-06-30T09:02:00.000000Z"

    async with _client() as client:
        item = await _create_item(client)
        item_id = item.json()["id"]

        clock.set_clock(lambda: response_time)
        response = await _create_entry(
            client,
            item_id,
            kind="response",
            body="## Result\n- tests passed",
        )
        clock.set_clock(lambda: prompt_time)
        prompt = await _create_entry(
            client,
            item_id,
            kind="prompt",
            body="Please run the quality gates.",
        )
        listed = await _list_entries(client, item_id)

    assert response.status_code == 200
    assert prompt.status_code == 200
    response_body = response.json()
    prompt_body = prompt.json()

    assert response_body["item_id"] == item_id
    assert response_body["kind"] == "response"
    assert response_body["body"] == "## Result\n- tests passed"
    assert response_body["created_at"] == response_time
    assert response_body["created_by"]

    assert prompt_body["item_id"] == item_id
    assert prompt_body["kind"] == "prompt"
    assert prompt_body["created_at"] == prompt_time

    assert listed.status_code == 200
    assert listed.json() == [prompt_body, response_body]


@pytest.mark.anyio
async def test_prompt_response_entries_are_separate_from_human_comments(
    fresh_db,
) -> None:
    """Prompt/response history does not appear in the human Comments endpoint."""
    del fresh_db

    async with _client() as client:
        item = await _create_item(client, "Separate discussions")
        item_id = item.json()["id"]

        comment = await _create_comment(client, item_id, "Human planning note")
        entry = await _create_entry(
            client,
            item_id,
            kind="response",
            body="$ make test\nPASS",
        )
        comments = await _list_comments(client, item_id)
        entries = await _list_entries(client, item_id)

    assert comment.status_code == 200
    assert entry.status_code == 200
    assert comments.status_code == 200
    assert entries.status_code == 200
    assert [comment["body"] for comment in comments.json()] == ["Human planning note"]
    assert [entry["body"] for entry in entries.json()] == ["$ make test\nPASS"]


@pytest.mark.anyio
async def test_only_owner_records_prompt_responses_but_viewers_can_read(
    fresh_db,
) -> None:
    """Prompt/response entries are work data; viewers may read but not create."""
    del fresh_db
    from main import app

    previous_override = app.dependency_overrides.pop(require_identity, None)
    try:
        owner_headers = _session_headers("alice", "owner")
        viewer_headers = _session_headers("vue", "viewer")
        async with _client() as client:
            item = await client.post(
                "/api/v1/items",
                json={"title": "Owner-authored timeline"},
                headers=owner_headers,
            )
            item_id = item.json()["id"]
            owner_entry = await client.post(
                f"/api/v1/items/{item_id}/prompt-responses",
                json={"kind": "prompt", "body": "Run the test suite."},
                headers=owner_headers,
            )
            viewer_entry = await client.post(
                f"/api/v1/items/{item_id}/prompt-responses",
                json={"kind": "response", "body": "Looks good."},
                headers=viewer_headers,
            )
            viewer_list = await client.get(
                f"/api/v1/items/{item_id}/prompt-responses",
                headers=viewer_headers,
            )
    finally:
        if previous_override is not None:
            app.dependency_overrides[require_identity] = previous_override

    assert item.status_code == 200
    assert owner_entry.status_code == 200
    assert owner_entry.json()["created_by"] == "alice"
    assert viewer_entry.status_code == 403
    assert viewer_entry.json() == {"detail": "owner only"}
    assert viewer_list.status_code == 200
    assert [entry["id"] for entry in viewer_list.json()] == [owner_entry.json()["id"]]


@pytest.mark.anyio
async def test_prompt_response_rejects_unknown_items_and_kinds(fresh_db) -> None:
    """The timeline contract rejects missing items and unsupported entry kinds."""
    del fresh_db

    async with _client() as client:
        missing_item = await _create_entry(
            client,
            "missing-item",
            kind="prompt",
            body="hello",
        )
        item = await _create_item(client)
        bad_kind = await _create_entry(
            client,
            item.json()["id"],
            kind="comment",
            body="wrong lane",
        )

    assert missing_item.status_code == 404
    assert missing_item.json() == {"detail": "item not found"}
    assert bad_kind.status_code == 422
    assert "kind" in str(bad_kind.json()["detail"])
