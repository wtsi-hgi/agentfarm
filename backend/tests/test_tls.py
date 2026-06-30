"""TLS certificate preparation tests (spec K4)."""

from __future__ import annotations

import ssl
import stat

from services.tls import prepare_tls_paths


def test_self_signed_cert_pair_generated_under_data_dir_and_parses(tmp_path) -> None:
    """Unset TLS paths generate a parseable self-signed certificate pair."""

    cert_paths = prepare_tls_paths(
        data_dir=tmp_path,
        configured_cert=None,
        configured_key=None,
    )

    assert cert_paths.cert == tmp_path / "tls" / "agentfarm-self-signed.crt"
    assert cert_paths.key == tmp_path / "tls" / "agentfarm-self-signed.key"
    assert cert_paths.cert.exists()
    assert cert_paths.key.exists()

    decoded = ssl._ssl._test_decode_cert(str(cert_paths.cert))
    assert decoded["subject"]
    assert decoded["issuer"]
    assert stat.S_IMODE(cert_paths.key.stat().st_mode) == 0o600


def test_configured_existing_cert_pair_is_reused_without_generation(tmp_path) -> None:
    """Configured TLS files are returned as-is and no generated pair is created."""

    cert = tmp_path / "configured.crt"
    key = tmp_path / "configured.key"
    cert.write_text("configured cert\n")
    key.write_text("configured key\n")

    cert_paths = prepare_tls_paths(
        data_dir=tmp_path,
        configured_cert=cert,
        configured_key=key,
    )

    assert cert_paths.cert == cert
    assert cert_paths.key == key
    assert not (tmp_path / "tls" / "agentfarm-self-signed.crt").exists()
    assert not (tmp_path / "tls" / "agentfarm-self-signed.key").exists()
