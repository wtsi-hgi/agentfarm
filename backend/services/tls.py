"""TLS certificate path preparation for local HTTPS serving."""

from __future__ import annotations

import os
import re
import socket
import ssl
import subprocess
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

GENERATED_TLS_DIRNAME = "tls"
GENERATED_CERT_FILENAME = "agentfarm-self-signed.crt"
GENERATED_KEY_FILENAME = "agentfarm-self-signed.key"
# macOS rejects TLS server certificates valid for more than 825 days; browsers
# cap publicly trusted ones at 398, so stay within that stricter limit.
MAX_VALIDITY_DAYS = 397
# Regenerate a generated certificate this many days before it expires.
RENEW_BEFORE_DAYS = 30


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
    generated under ``data_dir`` and reused on later startups while it still
    meets macOS server-certificate requirements for this host. A supplied pair
    is never checked or modified.
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
    hostnames = _machine_hostnames()
    if cert.exists() and key.exists() and _generated_cert_is_current(cert, hostnames):
        return TlsPaths(cert=cert, key=key)

    tls_dir.mkdir(parents=True, exist_ok=True)
    _generate_self_signed_cert(cert=cert, key=key, hostnames=hostnames)
    return TlsPaths(cert=cert, key=key)


def _machine_hostnames() -> list[str]:
    """Return localhost plus this machine's short and fully-qualified names."""

    names = ["localhost"]
    hostname = socket.gethostname().strip().lower()
    fqdn = socket.getfqdn().strip().lower()
    for name in (hostname.split(".")[0], hostname, fqdn):
        if name and name not in names:
            names.append(name)
    return names


def _generated_cert_is_current(cert: Path, hostnames: list[str]) -> bool:
    """Report whether a generated certificate still suits browsers on this host.

    macOS rejects TLS server certificates that are CA certificates, lack the
    serverAuth extended key usage, or are valid for too long. The certificate
    must also be valid for every current hostname and not be about to expire.
    """

    try:
        text = _openssl_x509(cert, "-text")
        dates = _openssl_x509(cert, "-startdate", "-enddate")
        expiring = (
            subprocess.run(
                [
                    "openssl",
                    "x509",
                    "-noout",
                    "-checkend",
                    str(RENEW_BEFORE_DAYS * 86400),
                    "-in",
                    str(cert),
                ],
                capture_output=True,
                text=True,
            ).returncode
            != 0
        )
    except (OSError, subprocess.CalledProcessError):
        return False

    extensions = _x509v3_extensions(text)
    validity = _validity(dates)
    if expiring or validity is None or validity > timedelta(days=MAX_VALIDITY_DAYS):
        return False
    if "CA:FALSE" not in extensions.get("Basic Constraints", ""):
        return False
    if "TLS Web Server Authentication" not in extensions.get("Extended Key Usage", ""):
        return False
    san_dns = {
        entry.strip()[len("DNS:") :].lower()
        for entry in extensions.get("Subject Alternative Name", "").split(",")
        if entry.strip().startswith("DNS:")
    }
    return set(hostnames) <= san_dns


def _openssl_x509(cert: Path, *options: str) -> str:
    return subprocess.run(
        ["openssl", "x509", "-noout", *options, "-in", str(cert)],
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def _x509v3_extensions(text: str) -> dict[str, str]:
    """Map X509v3 extension names to their values in ``openssl x509 -text``."""

    extensions: dict[str, str] = {}
    current: str | None = None
    header_indent = 0
    for line in text.splitlines():
        stripped = line.strip()
        indent = len(line) - len(line.lstrip())
        match = re.fullmatch(r"X509v3 (.+?):(?: critical)?", stripped)
        if match:
            current = match.group(1)
            header_indent = indent
            extensions[current] = ""
        elif current is not None and stripped and indent > header_indent:
            extensions[current] = f"{extensions[current]} {stripped}".strip()
        else:
            current = None
    return extensions


def _validity(dates: str) -> timedelta | None:
    """Return notAfter - notBefore from ``openssl x509 -startdate -enddate``."""

    values = dict(line.split("=", 1) for line in dates.splitlines() if "=" in line)
    try:
        not_before = ssl.cert_time_to_seconds(values["notBefore"])
        not_after = ssl.cert_time_to_seconds(values["notAfter"])
    except (KeyError, ValueError):
        return None
    return timedelta(seconds=not_after - not_before)


def _openssl_config(hostnames: list[str]) -> str:
    """Build an OpenSSL req config for a macOS-acceptable TLS server cert."""

    fqdn = next((name for name in hostnames if "." in name), "localhost")
    common_name = fqdn if len(fqdn) <= 64 else "localhost"
    alt_names = [f"DNS.{i} = {name}" for i, name in enumerate(hostnames, start=1)]
    alt_names += ["IP.1 = 127.0.0.1", "IP.2 = ::1"]
    return "\n".join(
        [
            "[req]",
            "distinguished_name = dn",
            "prompt = no",
            "x509_extensions = server_cert",
            "[dn]",
            f"CN = {common_name}",
            "[server_cert]",
            "basicConstraints = critical,CA:FALSE",
            "keyUsage = critical,digitalSignature,keyEncipherment",
            "extendedKeyUsage = serverAuth",
            "subjectKeyIdentifier = hash",
            "subjectAltName = @alt_names",
            "[alt_names]",
            *alt_names,
            "",
        ]
    )


def _generate_self_signed_cert(
    *,
    cert: Path,
    key: Path,
    hostnames: list[str] | None = None,
    days: int = MAX_VALIDITY_DAYS,
) -> None:
    """Generate a self-signed TLS server certificate using OpenSSL.

    The pair is written to temporary files beside the targets and moved into
    place only once OpenSSL succeeds, so a failure never leaves a broken pair.
    """

    if hostnames is None:
        hostnames = _machine_hostnames()
    tmp_cert = cert.with_name(f".{cert.name}.tmp")
    tmp_key = key.with_name(f".{key.name}.tmp")
    tmp_config = cert.with_name(f".{cert.name}.cnf")
    tmp_config.write_text(_openssl_config(hostnames))
    command = [
        "openssl",
        "req",
        "-x509",
        "-config",
        str(tmp_config),
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-sha256",
        "-days",
        str(days),
        "-keyout",
        str(tmp_key),
        "-out",
        str(tmp_cert),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
        os.chmod(tmp_key, 0o600)
        os.replace(tmp_key, key)
        os.replace(tmp_cert, cert)
    except FileNotFoundError as exc:
        raise TlsConfigurationError(
            "openssl is required to generate the self-signed TLS certificate"
        ) from exc
    except subprocess.CalledProcessError as exc:
        raise TlsConfigurationError(
            f"failed to generate self-signed TLS certificate: {exc.stderr.strip()}"
        ) from exc
    finally:
        for path in (tmp_config, tmp_cert, tmp_key):
            path.unlink(missing_ok=True)
