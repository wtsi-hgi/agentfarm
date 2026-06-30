"""Tests for application log routing."""

from __future__ import annotations

import logging
from pathlib import Path
from types import SimpleNamespace

import pytest

import main
from main import lifespan, settings


@pytest.mark.anyio
async def test_startup_logs_are_emitted_on_agent_farm_logger(
    caplog, monkeypatch, tmp_path
) -> None:
    """Startup records use the Agent Farm logger namespace for routing."""

    monkeypatch.setattr(settings, "ldap_dn_template", None)
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    monkeypatch.setattr(settings, "tls_cert", None)
    monkeypatch.setattr(settings, "tls_key", None)
    monkeypatch.setattr(main, "apply_migrations", lambda: None)
    monkeypatch.setattr(
        main,
        "prepare_tls_paths",
        lambda *, data_dir, configured_cert, configured_key: SimpleNamespace(
            cert=Path(data_dir) / "cert.pem",
            key=Path(data_dir) / "key.pem",
        ),
    )

    caplog.set_level(logging.INFO)

    app = SimpleNamespace(state=SimpleNamespace())
    async with lifespan(app):
        pass

    assert any(
        record.name == "agentfarm.api"
        and record.getMessage() == f"Starting {settings.app_name}"
        for record in caplog.records
    )
