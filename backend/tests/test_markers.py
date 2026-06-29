"""Acceptance tests for time markers and change windows (spec: I1)."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

import config
from db.migrate import apply_migrations
from services import clock


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    """Point the app at a fresh SQLite DB under ``tmp_path``."""
    monkeypatch.setattr(config.settings, "data_dir", tmp_path)
    apply_migrations()
    return config.settings.db_path


@pytest.fixture(autouse=True)
def _reset_clock():
    """Restore the wall-clock after tests that pin marker/item timestamps."""
    yield
    clock.reset_clock()


def _client() -> AsyncClient:
    """An ``AsyncClient`` bound to the ASGI app (no network)."""
    from main import app

    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://testserver")


async def _create_item(client: AsyncClient, title: str) -> dict:
    response = await client.post("/api/v1/items", json={"title": title})
    assert response.status_code == 200
    return response.json()


async def _rename_item(client: AsyncClient, item_id: str, title: str) -> dict:
    response = await client.patch(f"/api/v1/items/{item_id}", json={"title": title})
    assert response.status_code == 200
    return response.json()


async def _create_marker(
    client: AsyncClient,
    name: str,
    at: str | None = None,
) -> dict:
    body = {"name": name}
    if at is not None:
        body["at"] = at
    response = await client.post("/api/v1/markers", json=body)
    assert response.status_code == 200
    return response.json()


@pytest.mark.anyio
async def test_create_marker_defaults_at_to_now_and_lists_by_marker_time(
    fresh_db,
) -> None:
    """POST /markers stores at/created_at; GET /markers returns deterministic order."""
    async with _client() as client:
        clock.set_clock(lambda: "2026-06-29T12:00:00.000000Z")
        later = await _create_marker(client, "later")

        earlier = await _create_marker(
            client,
            "earlier",
            at="2026-06-29T08:00:00.000000Z",
        )

        response = await client.get("/api/v1/markers")

    assert response.status_code == 200
    assert later["name"] == "later"
    assert later["at"] == "2026-06-29T12:00:00.000000Z"
    assert later["created_at"] == "2026-06-29T12:00:00.000000Z"
    assert earlier["created_at"] == "2026-06-29T12:00:00.000000Z"
    assert [marker["id"] for marker in response.json()] == [
        earlier["id"],
        later["id"],
    ]


@pytest.mark.anyio
async def test_changes_since_marker_changed_field_includes_only_later_changed_item(
    fresh_db,
) -> None:
    """I1 test 1: since/changed returns items updated after the marker."""
    marker_at = "2026-06-29T00:00:00.000000Z"
    async with _client() as client:
        clock.set_clock(lambda: "2026-06-28T23:00:00.000000Z")
        y = await _create_item(client, "y")

        marker = await _create_marker(client, "M", at=marker_at)

        clock.set_clock(lambda: "2026-06-29T01:00:00.000000Z")
        x = await _create_item(client, "x")
        await _rename_item(client, x["id"], "x changed")

        response = await client.get(
            f"/api/v1/changes?since={marker['id']}&field=changed"
        )

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == [x["id"]]
    assert y["id"] not in {item["id"] for item in body}
    assert isinstance(body[0]["blocked_external"], bool)
    assert body[0]["blocked_external"] is False


@pytest.mark.anyio
async def test_changes_between_markers_created_field_uses_marker_window(
    fresh_db,
) -> None:
    """I1 test 2: between/created returns items after M1 through M2."""
    async with _client() as client:
        m1 = await _create_marker(
            client,
            "M1",
            at="2026-06-29T00:00:00.000000Z",
        )

        clock.set_clock(lambda: "2026-06-29T01:00:00.000000Z")
        z = await _create_item(client, "z")

        clock.set_clock(lambda: "2026-06-29T02:00:00.000000Z")
        at_upper_bound = await _create_item(client, "at m2")
        m2 = await _create_marker(
            client,
            "M2",
            at="2026-06-29T02:00:00.000000Z",
        )

        clock.set_clock(lambda: "2026-06-29T03:00:00.000000Z")
        after_m2 = await _create_item(client, "after m2")

        response = await client.get(
            f"/api/v1/changes?between={m1['id']},{m2['id']}&field=created"
        )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [
        z["id"],
        at_upper_bound["id"],
    ]
    assert after_m2["id"] not in {item["id"] for item in response.json()}


@pytest.mark.anyio
async def test_changes_since_last_marker_uses_caller_supplied_greatest_at_marker(
    fresh_db,
) -> None:
    """I1 test 3: supplying the greatest-at marker returns only later changes."""
    async with _client() as client:
        older = await _create_marker(
            client,
            "older",
            at="2026-06-29T00:00:00.000000Z",
        )
        last = await _create_marker(
            client,
            "last",
            at="2026-06-29T02:00:00.000000Z",
        )

        clock.set_clock(lambda: "2026-06-29T01:00:00.000000Z")
        changed_before_last = await _create_item(client, "before last")
        await _rename_item(client, changed_before_last["id"], "before last changed")

        clock.set_clock(lambda: "2026-06-29T03:00:00.000000Z")
        changed_after_last = await _create_item(client, "after last")
        await _rename_item(client, changed_after_last["id"], "after last changed")

        markers = (await client.get("/api/v1/markers")).json()
        response = await client.get(f"/api/v1/changes?since={last['id']}")

    assert markers[-1]["id"] == last["id"]
    assert older["id"] != last["id"]
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [changed_after_last["id"]]


@pytest.mark.anyio
async def test_changes_completed_field_excludes_items_without_completion_time(
    fresh_db,
) -> None:
    """The completed window ignores null completed_at values."""
    async with _client() as client:
        marker = await _create_marker(
            client,
            "before completion",
            at="2026-06-29T00:00:00.000000Z",
        )

        clock.set_clock(lambda: "2026-06-29T01:00:00.000000Z")
        incomplete = await _create_item(client, "incomplete")
        complete = await _create_item(client, "complete")
        done = await client.patch(
            f"/api/v1/items/{complete['id']}",
            json={"state": "done"},
        )
        assert done.status_code == 200

        response = await client.get(
            f"/api/v1/changes?since={marker['id']}&field=completed"
        )

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [complete["id"]]
    assert incomplete["id"] not in {item["id"] for item in response.json()}
