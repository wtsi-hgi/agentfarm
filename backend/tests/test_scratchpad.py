"""Acceptance tests for the persisted farm scratchpad."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

import config
from api.schemas import ScratchpadUpdate
from api.v1 import scratchpad as scratchpad_api
from api.v1.authz import require_identity
from db.connection import get_connection
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
    """Restore the wall-clock after tests that pin scratchpad timestamps."""
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


def _scratchpad_row(db_path: Path) -> sqlite3.Row | None:
    """Return the singleton scratchpad row from the database."""
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        return conn.execute("SELECT * FROM scratchpad WHERE id = 'primary'").fetchone()


@pytest.mark.anyio
async def test_scratchpad_defaults_and_owner_updates_are_persisted(
    fresh_db,
) -> None:
    """The owner can autosave text, height, and minimized state in one record."""
    timestamp = "2026-07-03T09:30:00.000000Z"
    from main import app

    previous_override = app.dependency_overrides.pop(require_identity, None)
    try:
        owner_headers = _session_headers("alice", "owner")
        async with _client() as client:
            initial = await client.get("/api/v1/scratchpad", headers=owner_headers)

            clock.set_clock(lambda: timestamp)
            updated = await client.patch(
                "/api/v1/scratchpad",
                json={
                    "body": "Collect from notes\nThen paste into prompt",
                    "height": 312,
                    "minimized": True,
                },
                headers=owner_headers,
            )
            reloaded = await client.get("/api/v1/scratchpad", headers=owner_headers)
    finally:
        if previous_override is not None:
            app.dependency_overrides[require_identity] = previous_override

    assert initial.status_code == 200
    assert initial.json() == {
        "body": "",
        "height": 220,
        "minimized": True,
        "updated_by": None,
        "updated_at": None,
    }

    assert updated.status_code == 200
    assert updated.json() == {
        "body": "Collect from notes\nThen paste into prompt",
        "height": 312,
        "minimized": True,
        "updated_by": "alice",
        "updated_at": timestamp,
    }
    assert reloaded.json() == updated.json()

    row = _scratchpad_row(fresh_db)
    assert row is not None
    assert row["body"] == "Collect from notes\nThen paste into prompt"
    assert row["height"] == 312
    assert row["minimized"] == 1
    assert row["updated_by"] == "alice"
    assert row["updated_at"] == timestamp


@pytest.mark.anyio
async def test_viewers_can_read_but_cannot_persist_scratchpad_changes(
    fresh_db,
) -> None:
    """Only the primary user can persist scratchpad edits."""
    del fresh_db
    from main import app

    previous_override = app.dependency_overrides.pop(require_identity, None)
    try:
        owner_headers = _session_headers("alice", "owner")
        viewer_headers = _session_headers("vue", "viewer")

        async with _client() as client:
            owner_update = await client.patch(
                "/api/v1/scratchpad",
                json={"body": "Owner draft", "height": 280, "minimized": False},
                headers=owner_headers,
            )
            viewer_read = await client.get(
                "/api/v1/scratchpad",
                headers=viewer_headers,
            )
            viewer_update = await client.patch(
                "/api/v1/scratchpad",
                json={"body": "Viewer should not save", "height": 120},
                headers=viewer_headers,
            )
            owner_read_after = await client.get(
                "/api/v1/scratchpad",
                headers=owner_headers,
            )
    finally:
        if previous_override is not None:
            app.dependency_overrides[require_identity] = previous_override

    assert owner_update.status_code == 200
    assert owner_update.json()["body"] == "Owner draft"
    assert viewer_read.status_code == 200
    assert viewer_read.json()["body"] == "Owner draft"
    assert viewer_update.status_code == 403
    assert viewer_update.json() == {"detail": "owner only"}
    assert owner_read_after.json()["body"] == "Owner draft"
    assert owner_read_after.json()["height"] == 280


@pytest.mark.anyio
async def test_scratchpad_patch_ignores_null_fields(fresh_db) -> None:
    """Null partial fields mean "leave the existing scratchpad value alone"."""
    del fresh_db

    owner_headers = _session_headers("alice", "owner")

    async with _client() as client:
        saved = await client.patch(
            "/api/v1/scratchpad",
            json={"body": "Owner draft", "height": 320, "minimized": False},
            headers=owner_headers,
        )
        ignored_nulls = await client.patch(
            "/api/v1/scratchpad",
            json={"body": None, "height": None, "minimized": None},
            headers=owner_headers,
        )

    assert saved.status_code == 200
    assert ignored_nulls.status_code == 200
    assert ignored_nulls.json() == saved.json()


@pytest.mark.anyio
async def test_scratchpad_updates_claim_write_lock_before_reading_current_state(
    fresh_db, monkeypatch
) -> None:
    """Partial scratchpad writes do not use a read-to-write transaction upgrade."""
    original_scratchpad_row = scratchpad_api._scratchpad_row
    observed_transactions: list[bool] = []

    def recording_scratchpad_row(conn: sqlite3.Connection) -> sqlite3.Row | None:
        observed_transactions.append(conn.in_transaction)
        return original_scratchpad_row(conn)

    monkeypatch.setattr(scratchpad_api, "_scratchpad_row", recording_scratchpad_row)

    with get_connection(fresh_db) as conn:
        saved = await scratchpad_api.update_scratchpad(
            ScratchpadUpdate(body="Serialized autosave"),
            object(),
            conn,
        )

    assert saved.body == "Serialized autosave"
    assert observed_transactions == [True]


@pytest.mark.anyio
async def test_scratchpad_rejects_out_of_range_heights(fresh_db) -> None:
    """The API keeps persisted scratchpad dimensions within the UI bounds."""
    del fresh_db

    async with _client() as client:
        too_small = await client.patch("/api/v1/scratchpad", json={"height": 80})
        too_large = await client.patch("/api/v1/scratchpad", json={"height": 900})

    assert too_small.status_code == 422
    assert "height" in str(too_small.json()["detail"])
    assert too_large.status_code == 422
    assert "height" in str(too_large.json()["detail"])
