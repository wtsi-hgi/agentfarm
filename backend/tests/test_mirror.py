"""Acceptance tests for the markdown mirror renderer and git mirror (spec: L)."""

from __future__ import annotations

import sqlite3
import subprocess
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

import config
from db.migrate import apply_migrations, apply_schema
from services.mirror import MIRROR_FILENAME, commit_tree, render_tree


@pytest.fixture
def conn() -> sqlite3.Connection:
    """Return an in-memory database with the production schema applied."""
    connection = sqlite3.connect(":memory:")
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    apply_schema(connection)
    try:
        yield connection
    finally:
        connection.close()


@pytest.fixture
def fresh_app_data(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point the FastAPI app at fresh on-disk data under ``tmp_path``."""
    monkeypatch.setattr(config.settings, "data_dir", tmp_path)
    apply_migrations()
    return tmp_path


def _client() -> AsyncClient:
    """An ``AsyncClient`` bound to the ASGI app (no network)."""
    from main import app

    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://testserver")


async def _create_item(client: AsyncClient, body: dict) -> dict:
    """Create an item over HTTP and return the response body."""
    response = await client.post("/api/v1/items", json=body)
    assert response.status_code == 200
    return response.json()


def _mirror_dir(data_dir: Path) -> Path:
    """Return the configured mirror repo path under a test data dir."""
    return data_dir / "mirror"


def _mirror_text(data_dir: Path) -> str:
    """Return the rendered mirror file text."""
    return (_mirror_dir(data_dir) / MIRROR_FILENAME).read_text(encoding="utf-8")


def _insert_item(
    conn: sqlite3.Connection,
    *,
    item_id: str,
    title: str,
    slug: str,
    parent_id: str | None = None,
    sort_order: float = 1.0,
    state: str = "not-started",
) -> None:
    timestamp = "2026-01-01T00:00:00.000000Z"
    conn.execute(
        """
        INSERT INTO items (
          id, title, slug, parent_id, sort_order, state, mode, effort,
          blocked_external, created_by, updated_by, created_at, updated_at,
          state_changed_at, completed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'prompt-agent', 'medium', 0, 'tester',
                'tester', ?, ?, ?, ?)
        """,
        (
            item_id,
            title,
            slug,
            parent_id,
            sort_order,
            state,
            timestamp,
            timestamp,
            timestamp,
            timestamp if state in {"done", "abandoned"} else None,
        ),
    )


def test_render_tree_outputs_nested_markdown_checklist(
    conn: sqlite3.Connection,
) -> None:
    """L1 test 1: tree order, two-space indent, and recursive completeness."""
    _insert_item(conn, item_id="a", title="A", slug="a", sort_order=1.0, state="done")
    _insert_item(conn, item_id="b", title="B", slug="b", sort_order=2.0)
    _insert_item(
        conn,
        item_id="b1",
        title="B1",
        slug="b1",
        parent_id="b",
        sort_order=1.0,
        state="done",
    )
    _insert_item(
        conn,
        item_id="b2",
        title="B2",
        slug="b2",
        parent_id="b",
        sort_order=2.0,
    )
    _insert_item(conn, item_id="c", title="C", slug="c", sort_order=3.0)

    assert render_tree(conn) == "\n".join(
        [
            "- [x] A",
            "- [ ] B",
            "  - [x] B1",
            "  - [ ] B2",
            "- [ ] C",
        ]
    )


def test_render_tree_shows_explicit_needs_with_current_target_slug(
    conn: sqlite3.Connection,
) -> None:
    """L1 test 2: only explicit needs are shown, resolved through live slugs."""
    _insert_item(conn, item_id="x", title="X", slug="x", sort_order=1.0)
    _insert_item(conn, item_id="y", title="Y", slug="deploy-db", sort_order=2.0)
    _insert_item(conn, item_id="z", title="Z", slug="legacy-sibling", sort_order=3.0)
    conn.execute(
        "INSERT INTO dependencies (id, from_id, to_id, kind) VALUES (?, ?, ?, ?)",
        ("edge-explicit", "x", "y", "explicit"),
    )
    conn.execute(
        "INSERT INTO dependencies (id, from_id, to_id, kind) VALUES (?, ?, ?, ?)",
        ("edge-implicit", "x", "z", "implicit"),
    )

    assert render_tree(conn).splitlines()[0] == "- [ ] X (needs: deploy-db)"


def test_render_tree_excludes_comment_bodies(conn: sqlite3.Connection) -> None:
    """L1 test 3: comments are not part of the markdown mirror output."""
    _insert_item(conn, item_id="a", title="A", slug="a")
    conn.execute(
        """
        INSERT INTO comments (id, item_id, author, body, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            "comment-1",
            "a",
            "tester",
            "this comment must stay out of the mirror",
            "2026-01-01T00:00:00.000000Z",
            "2026-01-01T00:00:00.000000Z",
        ),
    )

    rendered = render_tree(conn)

    assert rendered == "- [ ] A"
    assert "this comment must stay out of the mirror" not in rendered


def test_commit_tree_initialises_repo_with_rendered_markdown(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    """L2 test 1: a fresh data dir gets an isolated repo with one commit."""
    mirror_dir = tmp_path / "data" / "mirror"
    _insert_item(conn, item_id="a", title="A", slug="a")

    result = commit_tree(conn, mirror_dir)

    assert result.changed is True
    assert result.commit is not None
    assert (mirror_dir / ".git").is_dir()
    assert (mirror_dir / MIRROR_FILENAME).read_text(encoding="utf-8") == "- [ ] A"
    assert _git(mirror_dir, "rev-list", "--count", "HEAD") == "1"
    assert _git(mirror_dir, "show", f"HEAD:{MIRROR_FILENAME}") == "- [ ] A"


def test_commit_tree_skips_byte_identical_render(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    """L2 test 2: identical output does not create another commit."""
    mirror_dir = tmp_path / "data" / "mirror"
    _insert_item(conn, item_id="a", title="A", slug="a")
    commit_tree(conn, mirror_dir)

    result = commit_tree(conn, mirror_dir)

    assert result.changed is False
    assert result.commit is None
    assert _git(mirror_dir, "rev-list", "--count", "HEAD") == "1"


def test_commit_tree_commits_title_edit(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    """L2 test 3: rendered title changes create a new commit."""
    mirror_dir = tmp_path / "data" / "mirror"
    _insert_item(conn, item_id="a", title="A", slug="a")
    commit_tree(conn, mirror_dir)

    conn.execute(
        "UPDATE items SET title = ?, slug = ? WHERE id = ?",
        ("Alpha", "alpha", "a"),
    )
    result = commit_tree(conn, mirror_dir)

    assert result.changed is True
    assert _git(mirror_dir, "rev-list", "--count", "HEAD") == "2"
    assert (mirror_dir / MIRROR_FILENAME).read_text(encoding="utf-8") == "- [ ] Alpha"
    assert _git(mirror_dir, "show", f"HEAD:{MIRROR_FILENAME}") == "- [ ] Alpha"


def test_commit_tree_commits_needs_slug_churn_after_rename(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    """L2 test 4: needs labels track renamed target slugs in the mirror."""
    mirror_dir = tmp_path / "data" / "mirror"
    _insert_item(conn, item_id="x", title="X", slug="x", sort_order=1.0)
    _insert_item(conn, item_id="y", title="Y", slug="deploy-db", sort_order=2.0)
    conn.execute(
        "INSERT INTO dependencies (id, from_id, to_id, kind) VALUES (?, ?, ?, ?)",
        ("edge-explicit", "x", "y", "explicit"),
    )
    commit_tree(conn, mirror_dir)

    conn.execute(
        "UPDATE items SET title = ?, slug = ? WHERE id = ?",
        ("Deploy Database", "deploy-database", "y"),
    )
    result = commit_tree(conn, mirror_dir)

    assert result.changed is True
    assert _git(mirror_dir, "rev-list", "--count", "HEAD") == "2"
    rendered = (mirror_dir / MIRROR_FILENAME).read_text(encoding="utf-8")
    assert rendered.splitlines()[0] == "- [ ] X (needs: deploy-database)"
    assert _git(mirror_dir, "show", f"HEAD:{MIRROR_FILENAME}") == rendered


@pytest.mark.anyio
async def test_item_mutations_commit_markdown_mirror_via_http(
    fresh_app_data: Path,
) -> None:
    """Item create/update endpoints render and commit the configured mirror."""
    mirror_dir = _mirror_dir(fresh_app_data)

    async with _client() as client:
        item = await _create_item(client, {"title": "Alpha"})

        assert (mirror_dir / ".git").is_dir()
        assert _mirror_text(fresh_app_data) == "- [ ] Alpha"
        assert _git(mirror_dir, "rev-list", "--count", "HEAD") == "1"

        renamed = await client.patch(
            f"/api/v1/items/{item['id']}",
            json={"title": "Beta"},
        )
        assert renamed.status_code == 200

        assert _mirror_text(fresh_app_data) == "- [ ] Beta"
        assert _git(mirror_dir, "rev-list", "--count", "HEAD") == "2"

        unchanged_render = await client.patch(
            f"/api/v1/items/{item['id']}",
            json={"effort": "long"},
        )

    assert unchanged_render.status_code == 200
    assert _mirror_text(fresh_app_data) == "- [ ] Beta"
    assert _git(mirror_dir, "rev-list", "--count", "HEAD") == "2"


@pytest.mark.anyio
async def test_dependency_mutations_update_markdown_mirror_via_http(
    fresh_app_data: Path,
) -> None:
    """Dependency create/delete endpoints update live needs labels in the mirror."""
    mirror_dir = _mirror_dir(fresh_app_data)

    async with _client() as client:
        dependent = await _create_item(client, {"title": "Dependent"})
        target = await _create_item(client, {"title": "Target"})
        before_dependency = _git(mirror_dir, "rev-list", "--count", "HEAD")

        created = await client.post(
            "/api/v1/dependencies",
            json={"from_id": dependent["id"], "to_id": target["id"]},
        )
        assert created.status_code == 200

        assert _mirror_text(fresh_app_data).splitlines()[0] == (
            "- [ ] Dependent (needs: target)"
        )
        assert int(_git(mirror_dir, "rev-list", "--count", "HEAD")) == (
            int(before_dependency) + 1
        )

        deleted = await client.delete(f"/api/v1/dependencies/{created.json()['id']}")

    assert deleted.status_code == 200
    assert _mirror_text(fresh_app_data).splitlines()[0] == "- [ ] Dependent"


@pytest.mark.anyio
async def test_marker_mutation_initialises_markdown_mirror_via_http(
    fresh_app_data: Path,
) -> None:
    """Marker creation also runs the configured mirror hook."""
    mirror_dir = _mirror_dir(fresh_app_data)

    async with _client() as client:
        created = await client.post("/api/v1/markers", json={"name": "Checkpoint"})

    assert created.status_code == 200
    assert (mirror_dir / ".git").is_dir()
    assert _mirror_text(fresh_app_data) == ""
    assert _git(mirror_dir, "rev-list", "--count", "HEAD") == "1"


@pytest.mark.anyio
async def test_comment_mutations_do_not_commit_markdown_mirror(
    fresh_app_data: Path,
) -> None:
    """Comment creates/updates/deletes stay out of the markdown mirror."""
    mirror_dir = _mirror_dir(fresh_app_data)

    async with _client() as client:
        item = await _create_item(client, {"title": "Discuss"})
        committed = _git(mirror_dir, "rev-list", "--count", "HEAD")

        created = await client.post(
            f"/api/v1/items/{item['id']}/comments",
            json={"body": "Looks good"},
        )
        assert created.status_code == 200

        edited = await client.patch(
            f"/api/v1/comments/{created.json()['id']}",
            json={"body": "Still looks good"},
        )
        assert edited.status_code == 200

        deleted = await client.delete(f"/api/v1/comments/{created.json()['id']}")

    assert deleted.status_code == 200
    assert _git(mirror_dir, "rev-list", "--count", "HEAD") == committed
    assert _mirror_text(fresh_app_data) == "- [ ] Discuss"


def _git(repo: Path, *args: str) -> str:
    """Run git in the mirror repo and return stripped stdout."""
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
