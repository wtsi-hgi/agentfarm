"""The acting user for a mutation, resolved in exactly one place."""

from __future__ import annotations

from contextvars import ContextVar, Token

from config import settings

_current_actor: ContextVar[str | None] = ContextVar("current_actor", default=None)


def set_current_actor(username: str) -> Token[str | None]:
    """Set the current request actor and return a reset token."""
    return _current_actor.set(username)


def reset_current_actor(token: Token[str | None]) -> None:
    """Restore the actor context to its previous value."""
    _current_actor.reset(token)


def current_actor() -> str:
    """Return the username to record as the actor for a mutation."""
    return _current_actor.get() or settings.owner
