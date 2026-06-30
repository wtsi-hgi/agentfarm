"""Tests for environment-backed application configuration (spec N1).

The module-level ``settings`` singleton is created at import time, so each
test constructs a fresh ``Settings()`` after setting the relevant environment
variables with ``monkeypatch``. Any ``data_dir`` uses pytest's ``tmp_path`` so
no real filesystem location outside the test sandbox is touched.
"""

from __future__ import annotations

import getpass
from pathlib import Path

from config import Settings


def test_whitelist_comma_separated_string_parsed_to_list(monkeypatch) -> None:
    """AGENTFARM_WHITELIST="vue,manager" yields ["vue", "manager"] (N1 #1)."""
    monkeypatch.setenv("AGENTFARM_WHITELIST", "vue,manager")

    settings = Settings()

    assert settings.whitelist == ["vue", "manager"]


def test_whitelist_strips_whitespace_and_drops_empties(monkeypatch) -> None:
    """Surrounding whitespace is stripped and empty entries are dropped."""
    monkeypatch.setenv("AGENTFARM_WHITELIST", " vue , manager ,")

    settings = Settings()

    assert settings.whitelist == ["vue", "manager"]


def test_whitelist_unset_defaults_to_empty_list(monkeypatch) -> None:
    """With AGENTFARM_WHITELIST unset, whitelist is an empty list."""
    monkeypatch.delenv("AGENTFARM_WHITELIST", raising=False)

    settings = Settings()

    assert settings.whitelist == []


def test_data_dir_drives_db_and_mirror_locations(monkeypatch, tmp_path) -> None:
    """data_dir is honoured and the DB file and mirror both resolve inside it.

    Spec N1 #2: the SQLite DB file path and the markdown-mirror git repo path
    are both located under the configured data dir. Initialisation itself is
    verified later (Item 1.3 / Phase 10); here we assert the configured
    locations.
    """
    monkeypatch.setenv("AGENTFARM_DATA_DIR", str(tmp_path))

    settings = Settings()

    assert settings.data_dir == tmp_path

    db_path = Path(settings.db_path)
    mirror_path = Path(settings.mirror_dir)

    # Both derived locations live strictly inside the configured data dir.
    assert db_path.resolve().is_relative_to(tmp_path.resolve())
    assert mirror_path.resolve().is_relative_to(tmp_path.resolve())
    # The two locations are distinct (DB file vs. mirror git repo directory).
    assert db_path.resolve() != mirror_path.resolve()


def test_owner_defaults_to_os_user_when_unset(monkeypatch) -> None:
    """With AGENTFARM_OWNER unset, owner is the OS user running the process (N1 #3)."""
    monkeypatch.delenv("AGENTFARM_OWNER", raising=False)

    settings = Settings()

    assert settings.owner == getpass.getuser()


def test_owner_uses_env_when_set(monkeypatch) -> None:
    """AGENTFARM_OWNER overrides the OS-user default."""
    monkeypatch.setenv("AGENTFARM_OWNER", "alice")

    settings = Settings()

    assert settings.owner == "alice"


def test_ldap_and_tls_fields_read_from_env(monkeypatch, tmp_path) -> None:
    """LDAP and TLS env vars populate their settings fields."""
    cert = tmp_path / "cert.pem"
    key = tmp_path / "key.pem"
    monkeypatch.setenv("AGENTFARM_LDAP_SERVER", "ldap://ldap.example.org")
    monkeypatch.setenv("AGENTFARM_LDAP_DN_TEMPLATE", "uid={username},ou=people,dc=ex")
    monkeypatch.setenv("AGENTFARM_TLS_CERT", str(cert))
    monkeypatch.setenv("AGENTFARM_TLS_KEY", str(key))

    settings = Settings()

    assert settings.ldap_server == "ldap://ldap.example.org"
    assert settings.ldap_dn_template == "uid={username},ou=people,dc=ex"
    assert settings.tls_cert == str(cert)
    assert settings.tls_key == str(key)


def test_ldap_fields_unwrap_shell_style_outer_quotes_from_env(monkeypatch) -> None:
    """Make-exported shell-style .env quotes are not part of LDAP config."""
    monkeypatch.setenv("AGENTFARM_LDAP_SERVER", "'ldaps://ldap.example.org'")
    monkeypatch.setenv(
        "AGENTFARM_LDAP_DN_TEMPLATE",
        "'uid=%s,ou=people,dc=example,dc=org'",
    )
    monkeypatch.setenv("AGENTFARM_OWNER", "'alice'")
    monkeypatch.setenv("AGENTFARM_WHITELIST", "'vue,manager'")

    settings = Settings()

    assert settings.ldap_server == "ldaps://ldap.example.org"
    assert settings.ldap_dn_template == "uid=%s,ou=people,dc=example,dc=org"
    assert settings.owner == "alice"
    assert settings.whitelist == ["vue", "manager"]


def test_shell_quote_unwrap_preserves_meaningful_internal_quotes(monkeypatch) -> None:
    """Only one matching pair of outer shell quotes is stripped."""
    monkeypatch.setenv("AGENTFARM_LDAP_SERVER", "ldaps://ldap.example.org")
    monkeypatch.setenv(
        "AGENTFARM_LDAP_DN_TEMPLATE",
        'uid="%s",ou=people,dc=example,dc=org',
    )

    settings = Settings()

    assert settings.ldap_dn_template == 'uid="%s",ou=people,dc=example,dc=org'


def test_ldap_and_tls_fields_default_to_none(monkeypatch) -> None:
    """Optional LDAP and TLS fields default to None when unset."""
    for var in (
        "AGENTFARM_LDAP_SERVER",
        "AGENTFARM_LDAP_DN_TEMPLATE",
        "AGENTFARM_TLS_CERT",
        "AGENTFARM_TLS_KEY",
    ):
        monkeypatch.delenv(var, raising=False)

    settings = Settings()

    assert settings.ldap_server is None
    assert settings.ldap_dn_template is None
    assert settings.tls_cert is None
    assert settings.tls_key is None
