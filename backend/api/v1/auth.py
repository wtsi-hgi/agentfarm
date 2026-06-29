"""Authentication endpoints for LDAP direct-bind login."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from api.schemas import LoginRequest, WhoAmI
from config import settings
from services.auth_ldap import (
    AccessDeniedError,
    LdapAuthenticator,
    LdapBindError,
    LdapBindSettings,
    LdapConfigurationError,
    role_for_username,
)

router = APIRouter(prefix="/auth")

_current_identity: WhoAmI | None = None


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


@router.post("/login", response_model=WhoAmI)
async def login(
    request: LoginRequest,
    authenticator: LdapAuthenticator = Depends(get_authenticator),
) -> WhoAmI:
    """Authenticate a username/password by direct-binding to LDAP."""

    global _current_identity  # noqa: PLW0603

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

    _current_identity = WhoAmI(username=username, role=role)
    return _current_identity


@router.get("/whoami", response_model=WhoAmI)
async def whoami() -> WhoAmI:
    """Return the current placeholder identity until sessions are added."""

    if _current_identity is not None:
        return _current_identity
    return WhoAmI(username=settings.owner, role="owner")
