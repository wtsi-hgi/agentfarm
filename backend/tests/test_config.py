"""Tests for environment-backed application configuration (spec N1).

The module-level ``settings`` singleton is created at import time, so each
test constructs a fresh ``Settings()`` after setting the relevant environment
variables with ``monkeypatch``. Any ``data_dir`` uses pytest's ``tmp_path`` so
no real filesystem location outside the test sandbox is touched.
"""

from __future__ import annotations

import getpass
from pathlib import Path

import pytest
from pydantic import ValidationError

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


def test_data_dir_drives_db_location(monkeypatch, tmp_path) -> None:
    """data_dir is honoured and the DB file resolves inside it."""
    monkeypatch.setenv("AGENTFARM_DATA_DIR", str(tmp_path))

    settings = Settings()

    assert settings.data_dir == tmp_path

    db_path = Path(settings.db_path)

    # The derived DB location lives strictly inside the configured data dir.
    assert db_path.resolve().is_relative_to(tmp_path.resolve())


def test_backup_settings_default_to_disabled_with_ten_minute_interval(
    monkeypatch,
) -> None:
    """Unset backup location disables backups while keeping default backup policy."""
    monkeypatch.delenv("AGENTFARM_BACKUP_DIR", raising=False)
    monkeypatch.delenv("AGENTFARM_BACKUP_INTERVAL_SECONDS", raising=False)
    monkeypatch.delenv("AGENTFARM_BACKUP_RETENTION_DAYS", raising=False)

    settings = Settings()

    assert settings.backup_dir is None
    assert settings.backup_interval_seconds == 600
    assert settings.backup_retention_days == 30


def test_backup_settings_read_from_env(monkeypatch, tmp_path) -> None:
    """Backup location, cadence, and retention are configurable through env vars."""
    backup_dir = tmp_path / "backups"
    monkeypatch.setenv("AGENTFARM_BACKUP_DIR", str(backup_dir))
    monkeypatch.setenv("AGENTFARM_BACKUP_INTERVAL_SECONDS", "120")
    monkeypatch.setenv("AGENTFARM_BACKUP_RETENTION_DAYS", "14")

    settings = Settings()

    assert settings.backup_dir == backup_dir
    assert settings.backup_interval_seconds == 120
    assert settings.backup_retention_days == 14


def test_zero_backup_retention_days_is_allowed_to_disable_pruning(
    monkeypatch,
) -> None:
    """Retention can be set to 0 when operators want to keep all backups."""
    monkeypatch.setenv("AGENTFARM_BACKUP_RETENTION_DAYS", "0")

    settings = Settings()

    assert settings.backup_retention_days == 0


def test_negative_backup_retention_days_is_rejected(monkeypatch) -> None:
    """Negative retention days are rejected instead of becoming surprising deletes."""
    monkeypatch.setenv("AGENTFARM_BACKUP_RETENTION_DAYS", "-1")

    with pytest.raises(ValidationError):
        Settings()


def test_blank_backup_dir_env_disables_backups(monkeypatch) -> None:
    """A blank AGENTFARM_BACKUP_DIR behaves like an unset backup location."""
    monkeypatch.setenv("AGENTFARM_BACKUP_DIR", "   ")

    settings = Settings()

    assert settings.backup_dir is None


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
