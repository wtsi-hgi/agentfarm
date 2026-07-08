"""Tests for the domain enums and weights (spec: Enums and weights).

These assert the closed sets and their exact serialised string values, plus
the effort/mode weighting and the "complete" predicate that later phases
(priority, leverage, tree completion) depend on.
"""

from __future__ import annotations

from typing import get_args

import pytest

from models.enums import (
    EFFORT_WEIGHT,
    MODE_WEIGHT,
    PHASE_ORDER,
    Ball,
    Effort,
    Mode,
    State,
    Status,
    is_complete,
)


@pytest.fixture(autouse=True)
def default_owner_identity() -> None:
    """Enum tests do not need the app-level identity override fixture."""


def test_state_values_exact() -> None:
    """State has exactly the spec's members and lowercase string values."""
    assert {member.value for member in State} == {
        "not-started",
        "defining",
        "spec",
        "implement",
        "review",
        "merged",
        "released",
        "done",
        "abandoned",
    }
    # The hyphenated member is exposed under a python-safe name.
    assert State.not_started.value == "not-started"
    assert State.defining.value == "defining"


def test_mode_values_exact() -> None:
    """Mode has exactly the spec's members and lowercase string values."""
    assert {member.value for member in Mode} == {
        "prompt-agent",
        "review",
        "merge",
        "release",
        "spec",
    }
    assert Mode.prompt_agent.value == "prompt-agent"


def test_effort_values_exact() -> None:
    """Effort has exactly the spec's members and lowercase string values."""
    assert {member.value for member in Effort} == {"quick", "medium", "long"}


def test_ball_values_exact() -> None:
    """Ball has exactly the spec's members and defaults to the owner."""
    assert {member.value for member in Ball} == {"you", "agent", "person"}
    assert Ball.you.value == "you"


def test_enums_are_str_valued() -> None:
    """Members are plain strings so Pydantic/JSON serialise to the exact value."""
    assert State.spec == "spec"
    assert Ball.agent == "agent"
    assert Mode.review == "review"
    assert Effort.long == "long"
    # str subclassing also means json.dumps emits the bare string.
    import json

    assert json.dumps(Effort.quick) == '"quick"'


def test_effort_weight_values() -> None:
    """EFFORT_WEIGHT maps quick/medium/long to 1/3/8 keyed by Effort."""
    assert EFFORT_WEIGHT[Effort.quick] == 1
    assert EFFORT_WEIGHT[Effort.medium] == 3
    assert EFFORT_WEIGHT[Effort.long] == 8
    # Every effort has a weight.
    assert set(EFFORT_WEIGHT) == set(Effort)


def test_mode_weight_prompt_agent_is_two_else_one() -> None:
    """MODE_WEIGHT is 2 for prompt-agent and 1 for every other mode."""
    assert MODE_WEIGHT[Mode.prompt_agent] == 2
    for mode in Mode:
        if mode is Mode.prompt_agent:
            continue
        assert MODE_WEIGHT[mode] == 1
    # Covers all five modes.
    assert set(MODE_WEIGHT) == set(Mode)


def test_is_complete_only_done_and_abandoned() -> None:
    """ "Complete" is exactly the {done, abandoned} states."""
    assert is_complete(State.done) is True
    assert is_complete(State.abandoned) is True
    for state in State:
        if state in (State.done, State.abandoned):
            continue
        assert is_complete(state) is False


def test_phase_order_is_non_terminal_pipeline_order() -> None:
    """PHASE_ORDER lists the seven non-terminal phases in pipeline order."""
    assert PHASE_ORDER == (
        State.not_started,
        State.defining,
        State.spec,
        State.implement,
        State.review,
        State.merged,
        State.released,
    )
    assert State.done not in PHASE_ORDER
    assert State.abandoned not in PHASE_ORDER


def test_status_literal_values_exact() -> None:
    """Status exposes the derived item statuses separately from State."""
    assert set(get_args(Status)) == {
        "ready",
        "monitoring",
        "waiting",
        "blocked",
        "done",
        "dropped",
        "rollup",
    }


@pytest.mark.parametrize(
    "name",
    [
        "EXTERNAL_WAITING_STATES",
        "USER_ACTION_STATES",
        "is_external_waiting",
        "user_action_priority",
    ],
)
def test_removed_waiting_exports_no_longer_import(name: str) -> None:
    """Waiting/user-action state helpers are no longer part of the enum API."""
    with pytest.raises(ImportError, match=name):
        exec(f"from models.enums import {name}", {})
