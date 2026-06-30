"""Acceptance tests for item comments (spec: J1)."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

import config
from db.migrate import apply_migrations
from services import clock


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    """Point the app at a fresh, empty SQLite DB under ``tmp_path``."""
    monkeypatch.setattr(config.settings, "data_dir", tmp_path)
    apply_migrations()
    return config.settings.db_path


@pytest.fixture(autouse=True)
def _reset_clock():
    """Restore the wall-clock after tests that pin comment timestamps."""
    yield
    clock.reset_clock()


def _client() -> AsyncClient:
    """An ``AsyncClient`` bound to the ASGI app (no network)."""
    from main import app

    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://testserver")


def _set_actor(monkeypatch, actor: str) -> None:
    """Set the actor used by the comments router."""
    from api.v1 import comments

    monkeypatch.setattr(comments, "current_actor", lambda: actor)


async def _create_item(client: AsyncClient, title: str = "Ship comments"):
    return await client.post("/api/v1/items", json={"title": title})


async def _create_comment(client: AsyncClient, item_id: str, body: str):
    return await client.post(f"/api/v1/items/{item_id}/comments", json={"body": body})


async def _list_comments(client: AsyncClient, item_id: str):
    return await client.get(f"/api/v1/items/{item_id}/comments")


async def _patch_comment(client: AsyncClient, comment_id: str, body: str):
    return await client.patch(f"/api/v1/comments/{comment_id}", json={"body": body})


async def _delete_comment(client: AsyncClient, comment_id: str):
    return await client.delete(f"/api/v1/comments/{comment_id}")


@pytest.mark.anyio
async def test_viewer_adds_comment_and_lists_it(fresh_db, monkeypatch) -> None:
    """J1: a viewer can add a comment and read it back in the item list."""
    del fresh_db
    timestamp = "2026-06-29T00:00:00.000000Z"
    clock.set_clock(lambda: timestamp)
    _set_actor(monkeypatch, "viewer")

    async with _client() as client:
        item = await _create_item(client)
        item_id = item.json()["id"]

        created = await _create_comment(client, item_id, "Looks good to me")
        listed = await _list_comments(client, item_id)

    assert created.status_code == 200
    created_body = created.json()
    assert created_body["item_id"] == item_id
    assert created_body["author"] == "viewer"
    assert created_body["body"] == "Looks good to me"
    assert created_body["created_at"] == timestamp
    assert created_body["updated_at"] == timestamp

    assert listed.status_code == 200
    assert listed.json() == [created_body]


@pytest.mark.anyio
async def test_owner_cannot_edit_viewer_comment(fresh_db, monkeypatch) -> None:
    """J1: even the owner cannot edit another actor's comment."""
    del fresh_db
    async with _client() as client:
        item = await _create_item(client)
        _set_actor(monkeypatch, "viewer")
        comment = await _create_comment(client, item.json()["id"], "viewer note")

        _set_actor(monkeypatch, "owner")
        rejected = await _patch_comment(client, comment.json()["id"], "owner rewrite")

    assert rejected.status_code == 403
    assert rejected.json() == {"detail": "cannot modify another user's comment"}


@pytest.mark.anyio
async def test_author_edits_own_comment_and_updated_at_advances(
    fresh_db,
    monkeypatch,
) -> None:
    """J1: the original author can edit body and receives a later updated_at."""
    del fresh_db
    t1 = "2026-06-29T00:00:00.000000Z"
    t2 = "2026-06-29T00:15:00.000000Z"
    _set_actor(monkeypatch, "viewer")

    async with _client() as client:
        item = await _create_item(client)
        clock.set_clock(lambda: t1)
        comment = await _create_comment(client, item.json()["id"], "first")

        clock.set_clock(lambda: t2)
        edited = await _patch_comment(client, comment.json()["id"], "edited")

    assert edited.status_code == 200
    body = edited.json()
    assert body["id"] == comment.json()["id"]
    assert body["author"] == "viewer"
    assert body["body"] == "edited"
    assert body["created_at"] == t1
    assert body["updated_at"] == t2
    assert body["updated_at"] > body["created_at"]


@pytest.mark.anyio
async def test_author_deletes_own_comment(fresh_db, monkeypatch) -> None:
    """J1: the original author can delete their own comment."""
    del fresh_db
    _set_actor(monkeypatch, "viewer")

    async with _client() as client:
        item = await _create_item(client)
        item_id = item.json()["id"]
        comment = await _create_comment(client, item_id, "remove me")

        deleted = await _delete_comment(client, comment.json()["id"])
        listed = await _list_comments(client, item_id)

    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True, "id": comment.json()["id"]}
    assert listed.status_code == 200
    assert listed.json() == []


@pytest.mark.anyio
async def test_list_comments_ordered_by_created_at_ascending(
    fresh_db,
    monkeypatch,
) -> None:
    """J1: an item's comments list flat, oldest first."""
    del fresh_db
    _set_actor(monkeypatch, "viewer")
    times = [
        "2026-06-29T00:00:02.000000Z",
        "2026-06-29T00:00:01.000000Z",
        "2026-06-29T00:00:03.000000Z",
    ]

    async with _client() as client:
        item = await _create_item(client)
        item_id = item.json()["id"]
        for index, timestamp in enumerate(times, start=1):
            clock.set_clock(lambda timestamp=timestamp: timestamp)
            created = await _create_comment(client, item_id, f"comment {index}")
            assert created.status_code == 200

        listed = await _list_comments(client, item_id)

    assert listed.status_code == 200
    assert [comment["body"] for comment in listed.json()] == [
        "comment 2",
        "comment 1",
        "comment 3",
    ]
    assert [comment["created_at"] for comment in listed.json()] == sorted(times)
