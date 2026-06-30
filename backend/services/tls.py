"""TLS certificate path preparation for local HTTPS serving."""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

GENERATED_TLS_DIRNAME = "tls"
GENERATED_CERT_FILENAME = "agentfarm-self-signed.crt"
GENERATED_KEY_FILENAME = "agentfarm-self-signed.key"


@dataclass(frozen=True)
class TlsPaths:
    """Resolved certificate and private-key paths for HTTPS serving."""

    cert: Path
    key: Path


class TlsConfigurationError(RuntimeError):
    """Raised when TLS settings cannot be prepared."""


def prepare_tls_paths(
    *,
    data_dir: Path,
    configured_cert: str | Path | None,
    configured_key: str | Path | None,
) -> TlsPaths:
    """Resolve configured TLS paths or generate a self-signed pair.

    ``AGENTFARM_TLS_CERT`` and ``AGENTFARM_TLS_KEY`` are an all-or-nothing
    pair. When both are absent, a local development self-signed certificate is
    generated under ``data_dir`` and reused on later startups.
    """

    if configured_cert is not None or configured_key is not None:
        if configured_cert is None or configured_key is None:
            raise TlsConfigurationError(
                "AGENTFARM_TLS_CERT and AGENTFARM_TLS_KEY must be set together"
            )
        cert = Path(configured_cert)
        key = Path(configured_key)
        if not cert.exists():
            raise TlsConfigurationError(f"TLS certificate not found: {cert}")
        if not key.exists():
            raise TlsConfigurationError(f"TLS key not found: {key}")
        return TlsPaths(cert=cert, key=key)

    tls_dir = data_dir / GENERATED_TLS_DIRNAME
    cert = tls_dir / GENERATED_CERT_FILENAME
    key = tls_dir / GENERATED_KEY_FILENAME
    if cert.exists() and key.exists():
        return TlsPaths(cert=cert, key=key)

    tls_dir.mkdir(parents=True, exist_ok=True)
    _generate_self_signed_cert(cert=cert, key=key)
    return TlsPaths(cert=cert, key=key)


def _generate_self_signed_cert(*, cert: Path, key: Path) -> None:
    """Generate a localhost self-signed certificate using OpenSSL."""

    command = [
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
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except FileNotFoundError as exc:
        raise TlsConfigurationError(
            "openssl is required to generate the self-signed TLS certificate"
        ) from exc
    except subprocess.CalledProcessError as exc:
        raise TlsConfigurationError(
            f"failed to generate self-signed TLS certificate: {exc.stderr.strip()}"
        ) from exc

    os.chmod(key, 0o600)
