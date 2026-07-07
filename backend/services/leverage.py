"""Actionability and unblock-leverage scoring.

This module owns the readiness question -- "can this item be worked on right
now?" -- which the work-now projection and the ``/priority`` endpoint build on.
Actionable leaf (the rule)
--------------------------
An item is actionable iff ALL of:

* it is a LEAF (has no children) -- containers are NEVER actionable;
* it is NOT complete (its own state is not ``done``/``abandoned``);
* its ``ball`` is ``you``; and
* EVERY stored dependency target attached to the item or any ancestor section is
  complete. A section-level dependency gates all leaves nested inside that
  section. Automatic ordinary-leaf chain dependencies are persisted as rows, so
  removing one through the UI removes it from this projection until a later
  structural repair recreates the appropriate row. A dependency on a container
  is satisfied only when the whole container is done, using
  :func:`services.tree.is_complete`.

Unblock leverage
----------------
``Downstream(L)`` is every open leaf whose own dependency edges, inherited
ancestor-section dependency edges depend on ``L`` directly or transitively.
``ball`` values other than ``you`` exclude a leaf from actionability, but not
from downstream membership.
"""

from __future__ import annotations

import sqlite3
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from models.enums import (
    EFFORT_WEIGHT,
    MODE_WEIGHT,
    Ball,
    Effort,
    Mode,
    State,
)
from models.enums import (
    is_complete as state_is_complete,
)

ItemRow = dict[str, Any]


def _append_unique(
    values: list[str], seen: set[str], candidates: Iterable[str]
) -> None:
    """Append unseen ids from ``candidates`` to ``values`` preserving order."""
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        values.append(candidate)


@dataclass(frozen=True)
class LeverageProjection:
    """Set-at-once dependency, completeness, actionability and priority view."""

    item_rows: dict[str, ItemRow]
    children_by_parent: dict[str | None, list[str]]
    dependency_targets_by_id: dict[str, list[str]]
    descendants_by_id: dict[str, set[str]]
    complete_by_id: dict[str, bool]
    actionable_by_id: dict[str, bool]
    depends_on_by_id: dict[str, set[str]]
    downstream_by_id: dict[str, set[str]]
    score_by_id: dict[str, float]

    @classmethod
    def from_connection(cls, conn: sqlite3.Connection) -> LeverageProjection:
        """Load the two graph tables once and derive the work projection."""
        item_rows = {
            row["id"]: dict(row)
            for row in conn.execute("SELECT * FROM items").fetchall()
        }
        children_by_parent = cls._children_by_parent(item_rows)
        stored_targets = cls._stored_dependency_targets(conn)
        complete_by_id = cls._complete_by_id(item_rows, children_by_parent)
        if stored_targets:
            descendants_by_id = cls._descendants_by_id(item_rows, children_by_parent)
            dependency_targets_by_id = cls._dependency_targets_by_id(
                item_rows,
                children_by_parent,
                stored_targets,
            )
            depends_on_by_id = cls._depends_on_by_id(
                item_rows,
                dependency_targets_by_id,
                descendants_by_id,
            )
            downstream_by_id = cls._downstream_by_id(
                item_rows,
                children_by_parent,
                depends_on_by_id,
                complete_by_id,
            )
            score_by_id = cls._score_by_id(item_rows, downstream_by_id)
        else:
            descendants_by_id = {item_id: set() for item_id in item_rows}
            dependency_targets_by_id = {item_id: [] for item_id in item_rows}
            depends_on_by_id = {item_id: set() for item_id in item_rows}
            downstream_by_id = {item_id: set() for item_id in item_rows}
            score_by_id = {item_id: 0.0 for item_id in item_rows}
        actionable_by_id = cls._actionable_by_id(
            item_rows,
            children_by_parent,
            dependency_targets_by_id,
            complete_by_id,
        )
        return cls(
            item_rows=item_rows,
            children_by_parent=children_by_parent,
            dependency_targets_by_id=dependency_targets_by_id,
            descendants_by_id=descendants_by_id,
            complete_by_id=complete_by_id,
            actionable_by_id=actionable_by_id,
            depends_on_by_id=depends_on_by_id,
            downstream_by_id=downstream_by_id,
            score_by_id=score_by_id,
        )

    @staticmethod
    def _children_by_parent(
        item_rows: dict[str, ItemRow],
    ) -> dict[str | None, list[str]]:
        children: dict[str | None, list[str]] = defaultdict(list)
        for item_id, row in item_rows.items():
            children[row["parent_id"]].append(item_id)

        for child_ids in children.values():
            child_ids.sort(
                key=lambda child_id: (
                    item_rows[child_id]["sort_order"],
                    child_id,
                )
            )
        return dict(children)

    @staticmethod
    def _stored_dependency_targets(
        conn: sqlite3.Connection,
    ) -> dict[str, list[str]]:
        targets_by_source: dict[str, list[str]] = defaultdict(list)
        rows = conn.execute(
            "SELECT from_id, to_id FROM dependencies ORDER BY from_id, to_id"
        ).fetchall()
        for row in rows:
            targets_by_source[row["from_id"]].append(row["to_id"])
        return dict(targets_by_source)

    @classmethod
    def _descendants_by_id(
        cls,
        item_rows: dict[str, ItemRow],
        children_by_parent: dict[str | None, list[str]],
    ) -> dict[str, set[str]]:
        memo: dict[str, set[str]] = {}

        def descendants(item_id: str, visiting: set[str]) -> set[str]:
            if item_id in memo:
                return memo[item_id]
            if item_id in visiting:
                return set()

            visiting.add(item_id)
            collected: set[str] = set()
            for child_id in children_by_parent.get(item_id, []):
                collected.add(child_id)
                collected.update(descendants(child_id, visiting))
            visiting.remove(item_id)
            memo[item_id] = collected
            return collected

        return {item_id: descendants(item_id, set()) for item_id in item_rows}

    @classmethod
    def _complete_by_id(
        cls,
        item_rows: dict[str, ItemRow],
        children_by_parent: dict[str | None, list[str]],
    ) -> dict[str, bool]:
        memo: dict[str, bool] = {}

        def complete(item_id: str, visiting: set[str]) -> bool:
            if item_id in memo:
                return memo[item_id]
            if item_id in visiting:
                memo[item_id] = False
                return False

            visiting.add(item_id)
            children = children_by_parent.get(item_id, [])
            if children:
                value = all(complete(child_id, visiting) for child_id in children)
            else:
                value = state_is_complete(State(item_rows[item_id]["state"]))
            visiting.remove(item_id)
            memo[item_id] = value
            return value

        return {item_id: complete(item_id, set()) for item_id in item_rows}

    @staticmethod
    def _self_and_ancestor_ids(
        item_rows: dict[str, ItemRow], item_id: str
    ) -> list[str]:
        ids: list[str] = []
        current: str | None = item_id
        visited: set[str] = set()
        while current is not None and current not in visited and current in item_rows:
            visited.add(current)
            ids.append(current)
            current = item_rows[current]["parent_id"]
        return ids

    @classmethod
    def _dependency_targets_by_id(
        cls,
        item_rows: dict[str, ItemRow],
        children_by_parent: dict[str | None, list[str]],
        stored_targets: dict[str, list[str]],
    ) -> dict[str, list[str]]:
        dependency_targets: dict[str, list[str]] = {}
        for item_id in item_rows:
            targets: list[str] = []
            seen: set[str] = set()
            for scope_id in cls._self_and_ancestor_ids(item_rows, item_id):
                _append_unique(targets, seen, stored_targets.get(scope_id, []))
            dependency_targets[item_id] = targets

        return dependency_targets

    @staticmethod
    def _actionable_by_id(
        item_rows: dict[str, ItemRow],
        children_by_parent: dict[str | None, list[str]],
        dependency_targets_by_id: dict[str, list[str]],
        complete_by_id: dict[str, bool],
    ) -> dict[str, bool]:
        actionable: dict[str, bool] = {}
        for item_id, row in item_rows.items():
            actionable[item_id] = (
                not children_by_parent.get(item_id)
                and not complete_by_id.get(item_id, False)
                and Ball(row["ball"]) == Ball.you
                and all(
                    complete_by_id.get(target_id, False)
                    for target_id in dependency_targets_by_id[item_id]
                )
            )
        return actionable

    @classmethod
    def _depends_on_by_id(
        cls,
        item_rows: dict[str, ItemRow],
        dependency_targets_by_id: dict[str, list[str]],
        descendants_by_id: dict[str, set[str]],
    ) -> dict[str, set[str]]:
        successors_by_id = {
            item_id: (
                set(dependency_targets_by_id[item_id])
                | descendants_by_id.get(item_id, set())
            )
            for item_id in item_rows
        }
        reachable_memo: dict[str, set[str]] = {}

        def reachable_from(start_id: str, visiting: set[str]) -> set[str]:
            if start_id in reachable_memo:
                return reachable_memo[start_id]
            if start_id in visiting:
                return {start_id}

            visiting.add(start_id)
            reachable = {start_id}
            for successor_id in successors_by_id.get(start_id, set()):
                if successor_id in item_rows:
                    reachable.update(reachable_from(successor_id, visiting))
                else:
                    reachable.add(successor_id)
            visiting.remove(start_id)
            reachable_memo[start_id] = reachable
            return reachable

        depends_on: dict[str, set[str]] = {}
        for item_id in item_rows:
            targets: set[str] = set()
            for dependency_id in dependency_targets_by_id[item_id]:
                targets.update(reachable_from(dependency_id, set()))
            depends_on[item_id] = targets
        return depends_on

    @staticmethod
    def _downstream_by_id(
        item_rows: dict[str, ItemRow],
        children_by_parent: dict[str | None, list[str]],
        depends_on_by_id: dict[str, set[str]],
        complete_by_id: dict[str, bool],
    ) -> dict[str, set[str]]:
        open_leaf_ids = [
            item_id
            for item_id in item_rows
            if not children_by_parent.get(item_id)
            and not complete_by_id.get(item_id, False)
        ]
        downstream: dict[str, set[str]] = {item_id: set() for item_id in item_rows}
        for candidate_id in open_leaf_ids:
            for target_id in depends_on_by_id[candidate_id]:
                if target_id != candidate_id:
                    downstream.setdefault(target_id, set()).add(candidate_id)
        return downstream

    @staticmethod
    def _item_weight(item_rows: dict[str, ItemRow], item_id: str) -> int:
        row = item_rows.get(item_id)
        if row is None:
            return 0
        effort = Effort(row["effort"])
        mode = Mode(row["mode"])
        return EFFORT_WEIGHT[effort] * MODE_WEIGHT[mode]

    @classmethod
    def _score_by_id(
        cls,
        item_rows: dict[str, ItemRow],
        downstream_by_id: dict[str, set[str]],
    ) -> dict[str, float]:
        scores: dict[str, float] = {}
        for item_id, row in item_rows.items():
            own_effort = EFFORT_WEIGHT[Effort(row["effort"])]
            downstream_total = sum(
                cls._item_weight(item_rows, downstream_id)
                for downstream_id in downstream_by_id.get(item_id, set())
            )
            scores[item_id] = downstream_total / own_effort
        return scores

    def tree_order_ids(self) -> list[str]:
        """Return every item id in root-preorder tree order."""
        ordered: list[str] = []
        visited: set[str] = set()

        def visit(parent_id: str | None) -> None:
            for child_id in self.children_by_parent.get(parent_id, []):
                if child_id in visited:
                    continue
                visited.add(child_id)
                ordered.append(child_id)
                visit(child_id)

        visit(None)
        return ordered

    def priority_item_ids(self) -> list[str]:
        """Return actionable leaves ordered by leverage score and tie-breaks."""
        ordered = sorted(
            item_id
            for item_id, actionable in self.actionable_by_id.items()
            if actionable
        )
        ordered.sort(
            key=lambda item_id: (
                self.score_by_id.get(item_id, 0.0),
                self.item_rows[item_id]["updated_at"],
                self.item_rows[item_id]["created_at"],
            ),
            reverse=True,
        )
        return ordered

    def is_actionable(self, item_id: str) -> bool:
        """Return whether ``item_id`` is actionable in this projection."""
        return self.actionable_by_id.get(item_id, False)

    def is_complete(self, item_id: str) -> bool:
        """Return whether ``item_id`` is complete in this projection."""
        return self.complete_by_id.get(item_id, False)

    def downstream_item_ids(self, item_id: str) -> set[str]:
        """Return ``Downstream(item_id)`` in this projection."""
        return set(self.downstream_by_id.get(item_id, set()))

    def depends_on(self, item_id: str, target_id: str) -> bool:
        """Return whether ``item_id`` depends on ``target_id`` in this projection."""
        return target_id in self.depends_on_by_id.get(item_id, set())

    def score(self, item_id: str) -> float:
        """Return the unblock-leverage score in this projection."""
        return self.score_by_id.get(item_id, 0.0)


def build_projection(conn: sqlite3.Connection) -> LeverageProjection:
    """Return a set-at-once work projection for the current transaction."""
    return LeverageProjection.from_connection(conn)


def is_actionable(conn: sqlite3.Connection, item_id: str) -> bool:
    """Return whether ``item_id`` is actionable right now (Core domain rules).

    True iff ``item_id`` is a leaf, is not itself complete, has ``ball == you``,
    and every dependency
    target on the item or its ancestor sections is complete under the recursive
    container-completeness rule.
    Containers are never actionable; a missing id is not actionable.

    Args:
        conn: Open connection (within the caller's transaction).
        item_id: The item whose actionability is computed.
    """
    return build_projection(conn).is_actionable(item_id)


def actionable_item_ids(conn: sqlite3.Connection) -> set[str]:
    """Return the set of ids of every actionable item.

    Iterates all items and keeps those for which :func:`is_actionable` holds.
    Returned as a set because actionability is an unordered membership question
    (leverage ORDERING is added in a later phase); callers asserting membership
    compare against this set directly.

    Args:
        conn: Open connection (within the caller's transaction).
    """
    projection = build_projection(conn)
    return {
        item_id
        for item_id, actionable in projection.actionable_by_id.items()
        if actionable
    }


def depends_on(conn: sqlite3.Connection, item_id: str, target_id: str) -> bool:
    """Return whether ``item_id`` effectively depends on ``target_id``.

    The effective dependency set is the item's own stored ``>needs:`` edges plus
    dependency edges inherited from all ancestor sections.
    """
    return build_projection(conn).depends_on(item_id, target_id)


def downstream_item_ids(conn: sqlite3.Connection, item_id: str) -> set[str]:
    """Return ``Downstream(item_id)`` as a set of open leaf ids."""
    return build_projection(conn).downstream_item_ids(item_id)


def score(conn: sqlite3.Connection, item_id: str) -> float:
    """Return the unblock-leverage score for ``item_id``."""
    return build_projection(conn).score(item_id)


def priority_item_ids(conn: sqlite3.Connection) -> list[str]:
    """Return actionable leaves ordered by leverage score and stable tie-breaks."""

    return build_projection(conn).priority_item_ids()
