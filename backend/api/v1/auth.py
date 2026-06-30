"""Authentication endpoints for LDAP direct-bind login."""

from __future__ import annotations

import logging
from typing import Annotated
from urllib.parse import urlsplit, urlunsplit

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
logger = logging.getLogger("agentfarm.auth")


def _safe_ldap_server_label(server_uri: str) -> str:
    """Return an LDAP server label that never includes URI credentials."""

    parsed = urlsplit(server_uri)
    if parsed.username is None and parsed.password is None:
        return server_uri

    hostname = parsed.hostname or ""
    if parsed.port is not None:
        hostname = f"{hostname}:{parsed.port}"
    return urlunsplit((parsed.scheme, hostname, parsed.path, "", ""))


def _dn_template_placeholder(template: str) -> str:
    """Name the username placeholder style used by the configured DN template."""

    if "{username}" in template:
        return "{username}"
    if "%s" in template:
        return "%s"
    return "missing"


def get_authenticator() -> LdapAuthenticator:
    """Build the configured LDAP authenticator."""

    missing: list[str] = []
    if not settings.ldap_server:
        missing.append("AGENTFARM_LDAP_SERVER")
    if not settings.ldap_dn_template:
        missing.append("AGENTFARM_LDAP_DN_TEMPLATE")
    if missing:
        logger.error("LDAP authentication misconfigured: missing=%s", ",".join(missing))
        raise LdapConfigurationError(f"{', '.join(missing)} required")
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
        bind_settings = authenticator.bind_settings
        failure_type = type(exc.__cause__ or exc).__name__
        server_label = _safe_ldap_server_label(bind_settings.server_uri)
        placeholder = _dn_template_placeholder(bind_settings.dn_template)
        logger.warning(
            "LDAP bind failed for username=%s server=%s "
            "dn_template_placeholder=%s failure_type=%s",
            request.username,
            server_label,
            placeholder,
            failure_type,
            extra={
                "username": request.username,
                "ldap_server": server_label,
                "dn_template_placeholder": placeholder,
                "failure_type": failure_type,
            },
        )
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
        owner_match = username == settings.owner
        whitelist_count = len(settings.whitelist)
        logger.warning(
            "LDAP login denied for username=%s owner_match=%s whitelist_count=%s",
            username,
            owner_match,
            whitelist_count,
            extra={
                "username": username,
                "owner_match": owner_match,
                "whitelist_count": whitelist_count,
            },
        )
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
