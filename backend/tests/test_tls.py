"""TLS certificate preparation tests (spec K4)."""

from __future__ import annotations

import os
import socket
import ssl
import stat
import subprocess
from pathlib import Path

from services import tls
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


SERVER_AUTH = "TLS Web Server Authentication"


def _cert_text(cert: Path) -> str:
    return subprocess.run(
        ["openssl", "x509", "-noout", "-text", "-in", str(cert)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def _extension_block(text: str, name: str) -> str:
    """Return the header and value line of an X509v3 extension in ``text``."""

    lines = text.splitlines()
    for index, line in enumerate(lines):
        if line.strip().startswith(f"X509v3 {name}:"):
            return f"{line.strip()}\n{lines[index + 1].strip()}"
    raise AssertionError(f"extension {name!r} missing from certificate")


def _validity_days(cert: Path) -> float:
    decoded = ssl._ssl._test_decode_cert(str(cert))
    not_before = ssl.cert_time_to_seconds(decoded["notBefore"])
    not_after = ssl.cert_time_to_seconds(decoded["notAfter"])
    return (not_after - not_before) / 86400


def _san_entries(cert: Path) -> set[tuple[str, str]]:
    decoded = ssl._ssl._test_decode_cert(str(cert))
    return {(kind, value.strip().lower()) for kind, value in decoded["subjectAltName"]}


def _use_hostnames(monkeypatch, short: str, fqdn: str) -> None:
    monkeypatch.setattr(socket, "gethostname", lambda: short)
    monkeypatch.setattr(socket, "getfqdn", lambda *args: fqdn)


def _write_legacy_generated_pair(data_dir: Path) -> tuple[Path, Path]:
    """Write a pair the way earlier releases generated it (CA:TRUE, no EKU)."""

    tls_dir = data_dir / "tls"
    tls_dir.mkdir()
    cert = tls_dir / "agentfarm-self-signed.crt"
    key = tls_dir / "agentfarm-self-signed.key"
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-sha256",
            "-days",
            "3650",
            "-subj",
            "/CN=localhost",
            "-addext",
            "subjectAltName=DNS:localhost,IP:127.0.0.1",
            "-keyout",
            str(key),
            "-out",
            str(cert),
        ],
        check=True,
        capture_output=True,
    )
    return cert, key


def _generate(data_dir: Path) -> tls.TlsPaths:
    return prepare_tls_paths(
        data_dir=data_dir, configured_cert=None, configured_key=None
    )


def test_generated_cert_meets_macos_server_cert_requirements(
    tmp_path, monkeypatch
) -> None:
    """Generated certs are leaf serverAuth certs valid for every local name."""

    _use_hostnames(monkeypatch, "farm22-wrstat01", "farm22-wrstat01.example.org")

    paths = _generate(tmp_path)
    text = _cert_text(paths.cert)

    assert _extension_block(text, "Basic Constraints") == (
        "X509v3 Basic Constraints: critical\nCA:FALSE"
    )
    assert _extension_block(text, "Key Usage") == (
        "X509v3 Key Usage: critical\nDigital Signature, Key Encipherment"
    )
    assert SERVER_AUTH in _extension_block(text, "Extended Key Usage")
    assert _validity_days(paths.cert) <= 397
    sans = _san_entries(paths.cert)
    assert {
        ("DNS", "localhost"),
        ("DNS", "farm22-wrstat01"),
        ("DNS", "farm22-wrstat01.example.org"),
        ("IP Address", "127.0.0.1"),
    } <= sans
    assert {("IP Address", "::1"), ("IP Address", "0:0:0:0:0:0:0:1")} & sans
    assert len(sans) == 5
    subject = dict(
        item[0] for item in ssl._ssl._test_decode_cert(str(paths.cert))["subject"]
    )
    assert subject["commonName"] == "farm22-wrstat01.example.org"


def test_generated_cert_sans_are_deduplicated_and_cn_falls_back_to_localhost(
    tmp_path, monkeypatch
) -> None:
    """A machine that only knows itself as localhost gets no duplicate SANs."""

    _use_hostnames(monkeypatch, "localhost", "localhost")

    paths = _generate(tmp_path)

    dns = [
        v
        for k, v in ssl._ssl._test_decode_cert(str(paths.cert))["subjectAltName"]
        if k == "DNS"
    ]
    assert dns == ["localhost"]
    subject = dict(
        item[0] for item in ssl._ssl._test_decode_cert(str(paths.cert))["subject"]
    )
    assert subject["commonName"] == "localhost"


def test_compliant_generated_pair_is_reused_unchanged(tmp_path, monkeypatch) -> None:
    """A generated pair that already meets the requirements is not rewritten."""

    _use_hostnames(monkeypatch, "farm22-wrstat01", "farm22-wrstat01.example.org")
    paths = _generate(tmp_path)
    cert_bytes = paths.cert.read_bytes()
    key_bytes = paths.key.read_bytes()

    again = _generate(tmp_path)

    assert again == paths
    assert again.cert.read_bytes() == cert_bytes
    assert again.key.read_bytes() == key_bytes


def test_legacy_ca_true_generated_pair_is_regenerated(tmp_path, monkeypatch) -> None:
    """Earlier CA:TRUE, no-EKU, 10-year generated certs heal on startup."""

    _use_hostnames(monkeypatch, "localhost", "localhost")
    cert, key = _write_legacy_generated_pair(tmp_path)
    legacy_text = _cert_text(cert)
    assert "CA:TRUE" in legacy_text
    assert SERVER_AUTH not in legacy_text
    legacy_key = key.read_bytes()

    paths = _generate(tmp_path)

    assert paths.cert == cert
    assert paths.key == key
    text = _cert_text(cert)
    assert "CA:FALSE" in text
    assert SERVER_AUTH in text
    assert _validity_days(cert) <= 397
    assert key.read_bytes() != legacy_key
    assert stat.S_IMODE(key.stat().st_mode) == 0o600
    assert sorted(p.name for p in cert.parent.iterdir()) == [
        "agentfarm-self-signed.crt",
        "agentfarm-self-signed.key",
    ]


def test_generated_pair_missing_current_hostname_is_regenerated(
    tmp_path, monkeypatch
) -> None:
    """Moving the data dir to a new host adds that host's names."""

    _use_hostnames(monkeypatch, "old-host", "old-host.example.org")
    paths = _generate(tmp_path)

    _use_hostnames(monkeypatch, "new-host", "new-host.example.org")
    _generate(tmp_path)

    sans = _san_entries(paths.cert)
    assert ("DNS", "new-host") in sans
    assert ("DNS", "new-host.example.org") in sans
    assert ("DNS", "old-host") not in sans


def test_generated_pair_expiring_soon_is_regenerated(tmp_path, monkeypatch) -> None:
    """A generated cert within 30 days of expiry is replaced."""

    _use_hostnames(monkeypatch, "localhost", "localhost")
    paths = _generate(tmp_path)
    tls._generate_self_signed_cert(cert=paths.cert, key=paths.key, days=10)
    assert _validity_days(paths.cert) <= 10

    _generate(tmp_path)

    assert _validity_days(paths.cert) > 300


def test_supplied_pair_is_never_modified(tmp_path, monkeypatch) -> None:
    """A supplied pair is used as-is, even when it would fail the checks."""

    _use_hostnames(monkeypatch, "farm22-wrstat01", "farm22-wrstat01.example.org")
    supplied_dir = tmp_path / "supplied"
    legacy_cert, legacy_key = _write_legacy_generated_pair(supplied_dir.parent)
    supplied_dir.mkdir()
    cert = supplied_dir / "host.crt"
    key = supplied_dir / "host.key"
    cert.write_bytes(legacy_cert.read_bytes())
    key.write_bytes(legacy_key.read_bytes())
    for path in (legacy_cert, legacy_key):
        path.unlink()
    legacy_cert.parent.rmdir()
    os.utime(cert, ns=(1_000_000_000_000_000_000, 1_000_000_000_000_000_000))
    os.utime(key, ns=(1_000_000_000_000_000_000, 1_000_000_000_000_000_000))
    cert.chmod(0o444)
    key.chmod(0o400)
    supplied_dir.chmod(0o555)
    before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in (cert, key)}
    data_dir = tmp_path / "data"

    try:
        paths = prepare_tls_paths(
            data_dir=data_dir, configured_cert=str(cert), configured_key=str(key)
        )
        after = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in (cert, key)}
        listing = sorted(p.name for p in supplied_dir.iterdir())
    finally:
        supplied_dir.chmod(0o755)

    assert paths == tls.TlsPaths(cert=cert, key=key)
    assert after == before
    assert listing == ["host.crt", "host.key"]
    assert not data_dir.exists()
