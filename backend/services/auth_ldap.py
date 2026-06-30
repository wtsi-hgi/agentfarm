"""LDAP direct-bind authentication service."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

AuthRole = Literal["owner", "viewer"]


class LdapConfigurationError(ValueError):
    """Raised when LDAP authentication settings are incomplete or invalid."""


class LdapBindError(Exception):
    """Raised when LDAP rejects credentials or cannot complete a bind."""


class AccessDeniedError(Exception):
    """Raised when a bound LDAP user is not allowed to access the app."""


class LdapBinder(Protocol):
    """Minimal interface for binding credentials against LDAP."""

    def bind(self, *, server_uri: str, bind_dn: str, password: str) -> None:
        """Bind the supplied DN and password, raising on failure."""


@dataclass(frozen=True)
class LdapBindSettings:
    """Settings required to direct-bind a user to LDAP."""

    server_uri: str
    dn_template: str

    def __post_init__(self) -> None:
        validate_dn_template(self.dn_template)


def validate_dn_template(template: str) -> None:
    """Ensure the DN template includes a supported username placeholder."""

    if "{username}" not in template and "%s" not in template:
        raise LdapConfigurationError(
            "LDAP DN template must contain username placeholder {username} or %s"
        )


def bind_dn_for_username(template: str, username: str) -> str:
    """Substitute ``username`` into a validated LDAP DN template."""

    validate_dn_template(template)
    if "{username}" in template:
        return template.replace("{username}", username)
    return template.replace("%s", username, 1)


def role_for_username(
    username: str,
    *,
    owner: str,
    whitelist: list[str],
) -> AuthRole:
    """Return the application role for an authenticated LDAP username."""

    if username == owner:
        return "owner"
    if username in whitelist:
        return "viewer"
    raise AccessDeniedError("access denied")


class Ldap3Binder:
    """LDAP binder backed by the optional ``ldap3`` package."""

    def bind(self, *, server_uri: str, bind_dn: str, password: str) -> None:
        """Bind with ldap3, importing it lazily so tests need no LDAP package."""

        try:
            from ldap3 import Connection, Server  # type: ignore[import-not-found]
            from ldap3.core.exceptions import (
                LDAPException,  # type: ignore[import-not-found]
            )
        except ModuleNotFoundError as exc:
            raise LdapConfigurationError(
                "ldap3 is required for LDAP authentication"
            ) from exc

        connection = None
        try:
            server = Server(server_uri)
            connection = Connection(
                server,
                user=bind_dn,
                password=password,
                auto_bind=True,
            )
        except LDAPException as exc:
            raise LdapBindError("LDAP bind failed") from exc
        finally:
            if connection is not None and connection.bound:
                connection.unbind()


class LdapAuthenticator:
    """Authenticate usernames by direct-binding their LDAP DN."""

    def __init__(
        self,
        bind_settings: LdapBindSettings,
        *,
        binder: LdapBinder | None = None,
    ) -> None:
        self.bind_settings = bind_settings
        self.binder = binder or Ldap3Binder()

    def authenticate(self, *, username: str, password: str) -> str:
        """Bind the user's DN and return the authenticated username."""

        bind_dn = bind_dn_for_username(self.bind_settings.dn_template, username)
        self.binder.bind(
            server_uri=self.bind_settings.server_uri,
            bind_dn=bind_dn,
            password=password,
        )
        return username
