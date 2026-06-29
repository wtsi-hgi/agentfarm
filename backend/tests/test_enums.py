"""Tests for the domain enums and weights (spec: Enums and weights).

These assert the closed sets and their exact serialised string values, plus
the effort/mode weighting and the "complete" predicate that later phases
(priority, leverage, tree completion) depend on.
"""

from __future__ import annotations

from models.enums import (
    EFFORT_WEIGHT,
    MODE_WEIGHT,
    Effort,
    Mode,
    State,
    is_complete,
)


def test_state_values_exact() -> None:
    """State has exactly the spec's members and lowercase string values."""
    assert {member.value for member in State} == {
        "not-started",
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


def test_enums_are_str_valued() -> None:
    """Members are plain strings so Pydantic/JSON serialise to the exact value."""
    assert State.spec == "spec"
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
