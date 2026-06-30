"""Domain enums and weights (spec: "Enums and weights").

Closed sets whose values are stored as the exact lowercase strings below. The
enums subclass ``str`` so Pydantic and ``json`` serialise members to those bare
string values (e.g. ``State.not_started`` -> ``"not-started"``).
"""

from __future__ import annotations

from enum import StrEnum


class State(StrEnum):
    """Lifecycle state of an item. Default ``not-started``."""

    not_started = "not-started"
    spec = "spec"
    implement = "implement"
    review = "review"
    feedback = "feedback"
    respond = "respond"
    merged = "merged"
    released = "released"
    done = "done"
    abandoned = "abandoned"


class Mode(StrEnum):
    """The kind of work an item represents. Default ``prompt-agent``."""

    prompt_agent = "prompt-agent"
    review = "review"
    merge = "merge"
    release = "release"
    spec = "spec"


class Effort(StrEnum):
    """Relative effort estimate for an item. Default ``medium``."""

    quick = "quick"
    medium = "medium"
    long = "long"


# Effort contribution to unblock-leverage scoring (spec: leverage).
EFFORT_WEIGHT: dict[Effort, int] = {
    Effort.quick: 1,
    Effort.medium: 3,
    Effort.long: 8,
}

# Mode contribution: prompt-agent counts double, every other mode counts once
# (spec: "MODE_WEIGHT(mode) = 2 if mode == prompt-agent else 1").
MODE_WEIGHT: dict[Mode, int] = {
    mode: (2 if mode is Mode.prompt_agent else 1) for mode in Mode
}

# States that count as "complete" (spec: '"Complete" = state in {done, abandoned}').
COMPLETE_STATES: frozenset[State] = frozenset({State.done, State.abandoned})

# States blocked on external events. They are not actionable themselves, but
# still count as open downstream work for leverage calculations.
EXTERNAL_WAITING_STATES: frozenset[State] = frozenset({State.feedback, State.implement})

# States where the next move belongs to the owner/user. These stay actionable
# and receive a priority boost over ordinary ready work.
USER_ACTION_STATES: frozenset[State] = frozenset({State.respond})


def is_complete(state: State) -> bool:
    """Return whether ``state`` counts as complete (``done`` or ``abandoned``)."""
    return state in COMPLETE_STATES


def is_external_waiting(state: State) -> bool:
    """Return whether ``state`` is waiting on an external event/person."""
    return state in EXTERNAL_WAITING_STATES


def user_action_priority(state: State) -> int:
    """Return a priority tier for states requiring owner/user action."""
    return 1 if state in USER_ACTION_STATES else 0
