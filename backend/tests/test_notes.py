"""Acceptance tests for item notes."""

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
    """Restore the wall-clock after tests that pin note timestamps."""
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


async def _create_item(client: AsyncClient, title: str = "Document notes"):
    return await client.post("/api/v1/items", json={"title": title})


async def _create_note(client: AsyncClient, item_id: str, body: str):
    return await client.post(f"/api/v1/items/{item_id}/notes", json={"body": body})


async def _list_notes(client: AsyncClient, item_id: str):
    return await client.get(f"/api/v1/items/{item_id}/notes")


async def _patch_note(client: AsyncClient, note_id: str, body: str):
    return await client.patch(f"/api/v1/notes/{note_id}", json={"body": body})


@pytest.mark.anyio
async def test_item_notes_are_stored_listed_and_edited(fresh_db) -> None:
    """An item has dated markdown notes that remain editable after creation."""
    del fresh_db
    first_time = "2026-07-02T09:00:00.000000Z"
    second_time = "2026-07-02T09:05:00.000000Z"
    edit_time = "2026-07-02T09:10:00.000000Z"

    async with _client() as client:
        item = await _create_item(client)
        item_id = item.json()["id"]

        clock.set_clock(lambda: second_time)
        second = await _create_note(client, item_id, "## Later\n- keep this")
        clock.set_clock(lambda: first_time)
        first = await _create_note(client, item_id, "# First\nInitial note")

        clock.set_clock(lambda: edit_time)
        edited = await _patch_note(
            client, first.json()["id"], "## First edited\nUpdated"
        )
        listed = await _list_notes(client, item_id)

    assert second.status_code == 200
    assert first.status_code == 200
    second_body = second.json()
    first_body = first.json()

    assert second_body["item_id"] == item_id
    assert second_body["body"] == "## Later\n- keep this"
    assert second_body["created_by"]
    assert second_body["created_at"] == second_time
    assert second_body["updated_at"] == second_time

    assert first_body["created_at"] == first_time
    assert first_body["updated_at"] == first_time

    assert edited.status_code == 200
    edited_body = edited.json()
    assert edited_body["id"] == first_body["id"]
    assert edited_body["item_id"] == item_id
    assert edited_body["body"] == "## First edited\nUpdated"
    assert edited_body["created_at"] == first_time
    assert edited_body["updated_at"] == edit_time

    assert listed.status_code == 200
    assert listed.json() == [edited_body, second_body]


@pytest.mark.anyio
async def test_notes_are_separate_from_comments_and_prompt_responses(
    fresh_db,
) -> None:
    """Item notes do not leak into human comments or agent prompt/response logs."""
    del fresh_db

    async with _client() as client:
        item = await _create_item(client, "Separate note lanes")
        item_id = item.json()["id"]

        comment = await client.post(
            f"/api/v1/items/{item_id}/comments", json={"body": "Human comment"}
        )
        entry = await client.post(
            f"/api/v1/items/{item_id}/prompt-responses",
            json={"kind": "response", "body": "Agent response"},
        )
        note = await _create_note(client, item_id, "Private project note")
        comments = await client.get(f"/api/v1/items/{item_id}/comments")
        entries = await client.get(f"/api/v1/items/{item_id}/prompt-responses")
        notes = await _list_notes(client, item_id)

    assert comment.status_code == 200
    assert entry.status_code == 200
    assert note.status_code == 200
    assert [comment["body"] for comment in comments.json()] == ["Human comment"]
    assert [entry["body"] for entry in entries.json()] == ["Agent response"]
    assert [note["body"] for note in notes.json()] == ["Private project note"]


@pytest.mark.anyio
async def test_only_owner_creates_and_edits_notes_but_viewers_can_read(
    fresh_db,
) -> None:
    """Notes are owner-authored work records; viewers may read but not mutate."""
    del fresh_db
    from main import app

    previous_override = app.dependency_overrides.pop(require_identity, None)
    try:
        owner_headers = _session_headers("alice", "owner")
        viewer_headers = _session_headers("vue", "viewer")
        async with _client() as client:
            item = await client.post(
                "/api/v1/items",
                json={"title": "Owner-authored notes"},
                headers=owner_headers,
            )
            item_id = item.json()["id"]
            owner_note = await client.post(
                f"/api/v1/items/{item_id}/notes",
                json={"body": "Owner note"},
                headers=owner_headers,
            )
            viewer_create = await client.post(
                f"/api/v1/items/{item_id}/notes",
                json={"body": "Viewer note"},
                headers=viewer_headers,
            )
            viewer_edit = await client.patch(
                f"/api/v1/notes/{owner_note.json()['id']}",
                json={"body": "Viewer rewrite"},
                headers=viewer_headers,
            )
            viewer_list = await client.get(
                f"/api/v1/items/{item_id}/notes",
                headers=viewer_headers,
            )
    finally:
        if previous_override is not None:
            app.dependency_overrides[require_identity] = previous_override

    assert item.status_code == 200
    assert owner_note.status_code == 200
    assert owner_note.json()["created_by"] == "alice"
    assert viewer_create.status_code == 403
    assert viewer_create.json() == {"detail": "owner only"}
    assert viewer_edit.status_code == 403
    assert viewer_edit.json() == {"detail": "owner only"}
    assert viewer_list.status_code == 200
    assert [note["id"] for note in viewer_list.json()] == [owner_note.json()["id"]]


@pytest.mark.anyio
async def test_notes_reject_unknown_items_and_notes(fresh_db) -> None:
    """The notes contract rejects missing item and note identifiers."""
    del fresh_db

    async with _client() as client:
        missing_item_create = await _create_note(client, "missing-item", "hello")
        missing_item_list = await _list_notes(client, "missing-item")
        missing_note_patch = await _patch_note(client, "missing-note", "edited")

    assert missing_item_create.status_code == 404
    assert missing_item_create.json() == {"detail": "item not found"}
    assert missing_item_list.status_code == 404
    assert missing_item_list.json() == {"detail": "item not found"}
    assert missing_note_patch.status_code == 404
    assert missing_note_patch.json() == {"detail": "note not found"}
