"""The acting user for a mutation, resolved in exactly one place.

Item ``created_by`` / ``updated_by`` (and later comment authorship) record "the
authenticated owner". Real session-based authentication is not built until a
later phase; until then the actor is the configured owner
(``settings.owner``).

Resolving it through :func:`current_actor` (rather than reading
``settings.owner`` at every call site) means the later auth phase can swap this
single function for one that reads the request's session identity without
touching the item/edge logic.
"""

from __future__ import annotations

from config import settings


def current_actor() -> str:
    """Return the username to record as the actor for a mutation.

    For now this is the configured owner. A later phase replaces the body with
    the authenticated session identity; callers and stored data are unaffected.
    """
    return settings.owner
