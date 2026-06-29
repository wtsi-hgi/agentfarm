"""A single, injectable source of "now" for the whole backend.

All persisted timestamps (``created_at``, ``updated_at``, ``state_changed_at``,
``completed_at``, marker/comment times) must come from :func:`now` so that a
request stamps one consistent instant and so tests can make time deterministic.

The format is ISO-8601 UTC ``YYYY-MM-DDTHH:MM:SS.ffffffZ`` (microsecond
precision, trailing ``Z``). It is chosen so that lexical string ordering equals
chronological ordering, which the leverage tie-break and marker-window queries
rely on.

The clock is overridable (:func:`set_clock` / :func:`reset_clock`) rather than
hardcoded so a later story (deterministic ordering) can pin time without
patching call sites. Production never overrides it.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

# Strftime pattern producing ``YYYY-MM-DDTHH:MM:SS.ffffff``; the ``Z`` suffix is
# appended explicitly so the value is unambiguously UTC.
_ISO_FORMAT = "%Y-%m-%dT%H:%M:%S.%f"


def _system_now() -> str:
    """Return the current UTC time in the canonical ISO-8601 ``...Z`` format."""
    return datetime.now(UTC).strftime(_ISO_FORMAT) + "Z"


# The active clock. Swappable via set_clock(); defaults to wall-clock UTC.
_clock: Callable[[], str] = _system_now


def now() -> str:
    """Return the current timestamp string from the active clock.

    Call this once per request and reuse the value for every field that must
    share an instant (e.g. on create ``created_at == updated_at ==
    state_changed_at``).
    """
    return _clock()


def set_clock(clock: Callable[[], str]) -> None:
    """Override the clock (tests only) with a callable returning ISO-8601 ``Z``."""
    global _clock
    _clock = clock


def reset_clock() -> None:
    """Restore the default wall-clock UTC clock."""
    global _clock
    _clock = _system_now
