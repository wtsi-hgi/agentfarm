"""Request identity and role guards for API mutations."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from api.schemas import WhoAmI
from services.identity import reset_current_actor, set_current_actor


def _identity_from_headers(
    username: str | None,
    role: str | None,
) -> WhoAmI:
    """Parse the temporary request identity headers used before K4 sessions."""
    if not username or not role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="authentication required",
        )
    if role not in {"owner", "viewer"}:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid identity",
        )
    return WhoAmI(username=username, role=role)


async def require_identity(
    username: Annotated[str | None, Header(alias="x-agentfarm-username")] = None,
    role: Annotated[str | None, Header(alias="x-agentfarm-role")] = None,
) -> AsyncIterator[WhoAmI]:
    """Require an authenticated request identity and expose it as actor context."""
    identity = _identity_from_headers(username, role)
    token = set_current_actor(identity.username)
    try:
        yield identity
    finally:
        reset_current_actor(token)


def require_owner(
    identity: Annotated[WhoAmI, Depends(require_identity)],
) -> WhoAmI:
    """Require the owner role for protected mutations."""
    if identity.role != "owner":
        raise HTTPException(status_code=403, detail="owner only")
    return identity
