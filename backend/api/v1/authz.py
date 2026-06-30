"""Request identity and role guards for API mutations."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from api.schemas import WhoAmI
from services.identity import reset_current_actor, set_current_actor
from services.session_tokens import verify_session_token


def _identity_from_session_token(session_token: str | None) -> WhoAmI:
    """Verify a backend-issued session token and return its identity claims."""
    if not session_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="authentication required",
        )
    claims = verify_session_token(session_token)
    if claims is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid session",
        )
    return WhoAmI(username=claims.username, role=claims.role)


async def require_identity(
    session_token: Annotated[str | None, Header(alias="x-agentfarm-session")] = None,
) -> AsyncIterator[WhoAmI]:
    """Require an authenticated request identity and expose it as actor context."""
    identity = _identity_from_session_token(session_token)
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
