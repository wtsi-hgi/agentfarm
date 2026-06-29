"""Acceptance tests for v2 seam endpoints (spec: M1/M2)."""

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
    """Restore the wall-clock after tests that pin run timestamps."""
    yield
    clock.reset_clock()


def _client() -> AsyncClient:
    """An ``AsyncClient`` bound to the ASGI app (no network)."""
    from main import app

    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://testserver")


async def _create_item(client: AsyncClient, title: str = "Run owner"):
    return await client.post("/api/v1/items", json={"title": title})


async def _create_run(client: AsyncClient, item_id: str):
    return await client.post(f"/api/v1/items/{item_id}/runs")


async def _list_runs(client: AsyncClient, item_id: str):
    return await client.get(f"/api/v1/items/{item_id}/runs")


async def _spawn_item(client: AsyncClient, item_id: str):
    return await client.post(f"/api/v1/items/{item_id}/spawn")


@pytest.mark.anyio
async def test_create_run_then_list_returns_pending_run(fresh_db) -> None:
    """M1: creating a run stores a pending row owned by the item."""
    del fresh_db
    timestamp = "2026-06-29T00:00:00.000000Z"
    clock.set_clock(lambda: timestamp)

    async with _client() as client:
        item = await _create_item(client)
        item_id = item.json()["id"]

        created = await _create_run(client, item_id)
        listed = await _list_runs(client, item_id)

    assert created.status_code == 200
    created_body = created.json()
    assert created_body["item_id"] == item_id
    assert created_body["status"] == "pending"
    assert created_body["created_at"] == timestamp

    assert listed.status_code == 200
    assert listed.json() == [created_body]


@pytest.mark.anyio
async def test_spawn_boundary_returns_not_implemented(fresh_db) -> None:
    """M2: POST /items/{id}/spawn exists but performs no v1 work."""
    del fresh_db

    async with _client() as client:
        item = await _create_item(client, "Spawn seam")
        response = await _spawn_item(client, item.json()["id"])

    assert response.status_code == 501
    assert "not implemented" in response.json()["detail"].lower()
