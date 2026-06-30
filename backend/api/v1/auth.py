"""Authentication endpoints for LDAP direct-bind login."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from api.schemas import LoginRequest, LoginResponse, WhoAmI
from api.v1.authz import require_identity
from config import settings
from services.auth_ldap import (
    AccessDeniedError,
    LdapAuthenticator,
    LdapBindError,
    LdapBindSettings,
    LdapConfigurationError,
    role_for_username,
)
from services.session_tokens import issue_session_token

router = APIRouter(prefix="/auth")


def get_authenticator() -> LdapAuthenticator:
    """Build the configured LDAP authenticator."""

    if not settings.ldap_server:
        raise LdapConfigurationError("AGENTFARM_LDAP_SERVER is required")
    if not settings.ldap_dn_template:
        raise LdapConfigurationError("AGENTFARM_LDAP_DN_TEMPLATE is required")
    return LdapAuthenticator(
        LdapBindSettings(
            server_uri=settings.ldap_server,
            dn_template=settings.ldap_dn_template,
        )
    )


@router.post("/login", response_model=LoginResponse)
async def login(
    request: LoginRequest,
    authenticator: LdapAuthenticator = Depends(get_authenticator),
) -> LoginResponse:
    """Authenticate a username/password by direct-binding to LDAP."""

    try:
        username = authenticator.authenticate(
            username=request.username,
            password=request.password,
        )
    except LdapBindError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="authentication failed",
        ) from exc

    try:
        role = role_for_username(
            username,
            owner=settings.owner,
            whitelist=settings.whitelist,
        )
    except AccessDeniedError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="access denied",
        ) from exc

    return LoginResponse(
        username=username,
        role=role,
        session_token=issue_session_token(username=username, role=role),
    )


@router.get("/whoami", response_model=WhoAmI)
async def whoami(
    identity: Annotated[WhoAmI, Depends(require_identity)],
) -> WhoAmI:
    """Return the identity verified from the request's session token."""

    return identity
