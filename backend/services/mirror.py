"""Markdown mirror rendering for the item tree."""

from __future__ import annotations

import sqlite3
import subprocess
from dataclasses import dataclass
from pathlib import Path

from config import settings
from services import tree

MIRROR_FILENAME = "tree.md"


@dataclass(frozen=True)
class MirrorCommitResult:
    """Outcome of rendering and committing the markdown mirror."""

    changed: bool
    commit: str | None


def render_tree(conn: sqlite3.Connection) -> str:
    """Render the current item tree as a nested markdown checklist.

    The database remains the source of truth: ordering, recursive completeness,
    and live explicit dependency labels are all delegated to the tree service
    helpers used by the API. Comments are intentionally not queried.
    """
    rows = {
        row["id"]: row
        for row in conn.execute("SELECT id, title, parent_id FROM items").fetchall()
    }
    lines: list[str] = []
    depths: dict[str, int] = {}

    for item_id in tree.items_in_tree_order(conn):
        row = rows[item_id]
        parent_id = row["parent_id"]
        depth = 0 if parent_id is None else depths[parent_id] + 1
        depths[item_id] = depth

        checkbox = "x" if tree.is_complete(conn, item_id) else " "
        suffix = _needs_suffix(tree.explicit_needs_slugs(conn, item_id))
        lines.append(f"{'  ' * depth}- [{checkbox}] {row['title']}{suffix}")

    return "\n".join(lines)


def _needs_suffix(slugs: list[str]) -> str:
    """Return the markdown needs suffix for explicit dependency slugs."""
    if not slugs:
        return ""
    return f" (needs: {', '.join(slugs)})"


def commit_tree(conn: sqlite3.Connection, mirror_dir: Path) -> MirrorCommitResult:
    """Render the current tree and commit it to the dedicated mirror repo.

    The mirror is one-way: this function only writes ``tree.md`` from the
    database state and never reads markdown back into SQLite.
    """
    repo_dir = Path(mirror_dir)
    _ensure_repo(repo_dir)

    rendered = render_tree(conn)
    rendered_bytes = rendered.encode("utf-8")
    mirror_file = repo_dir / MIRROR_FILENAME
    committed_bytes = _committed_file_bytes(repo_dir)
    if committed_bytes == rendered_bytes:
        if not mirror_file.exists() or mirror_file.read_bytes() != rendered_bytes:
            mirror_file.write_bytes(rendered_bytes)
        return MirrorCommitResult(changed=False, commit=None)

    mirror_file.write_bytes(rendered_bytes)
    _git(repo_dir, "add", MIRROR_FILENAME)
    _git(repo_dir, "commit", "-m", "Update markdown mirror")
    commit = _git(repo_dir, "rev-parse", "HEAD").stdout.strip()
    return MirrorCommitResult(changed=True, commit=commit)


def commit_current_tree(conn: sqlite3.Connection) -> MirrorCommitResult:
    """Render and commit the tree to the configured mirror repo.

    Endpoint mutators call this inside their request transaction after their DB
    changes have succeeded. If rendering or git commit fails, the exception
    propagates and the request transaction rolls back instead of silently
    diverging from the mirror.
    """
    return commit_tree(conn, settings.mirror_dir)


def _ensure_repo(repo_dir: Path) -> None:
    """Initialise and configure the mirror git repo if needed."""
    repo_dir.mkdir(parents=True, exist_ok=True)
    if not (repo_dir / ".git").is_dir():
        _git(repo_dir, "init")
    _git(repo_dir, "config", "user.name", "Agent Farm Mirror")
    _git(repo_dir, "config", "user.email", "agentfarm-mirror@example.invalid")


def _git(repo_dir: Path, *args: str) -> subprocess.CompletedProcess[str]:
    """Run git with explicit args and cwd inside the mirror repo."""
    return subprocess.run(
        ["git", *args],
        cwd=repo_dir,
        check=True,
        capture_output=True,
        text=True,
    )


def _committed_file_bytes(repo_dir: Path) -> bytes | None:
    """Return the last committed mirror file bytes, if the repo has them."""
    result = subprocess.run(
        ["git", "show", f"HEAD:{MIRROR_FILENAME}"],
        cwd=repo_dir,
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        return None
    return result.stdout
