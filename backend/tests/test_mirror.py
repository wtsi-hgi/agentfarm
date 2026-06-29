"""Acceptance tests for the markdown mirror renderer and git mirror (spec: L)."""

from __future__ import annotations

import sqlite3
import subprocess
from pathlib import Path

import pytest

from db.migrate import apply_schema
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


def _git(repo: Path, *args: str) -> str:
    """Run git in the mirror repo and return stripped stdout."""
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
