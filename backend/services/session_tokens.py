"""Signed session-token helpers for backend authorization."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from config import settings

Role = Literal["owner", "viewer"]

_SESSION_SECRET_FILENAME = "session.secret"


@dataclass(frozen=True)
class SessionClaims:
    """Verified identity claims from a backend-issued session token."""

    username: str
    role: Role


def _secret_path() -> Path:
    """Return the path storing the HMAC secret for the current data dir."""
    return Path(settings.data_dir) / _SESSION_SECRET_FILENAME


def _load_or_create_secret() -> str:
    """Load the HMAC secret, creating it under ``settings.data_dir`` if needed."""
    path = _secret_path()
    try:
        secret = path.read_text(encoding="utf-8").strip()
        if secret:
            return secret
    except FileNotFoundError:
        pass

    path.parent.mkdir(parents=True, exist_ok=True)
    secret = secrets.token_urlsafe(32)
    path.write_text(f"{secret}\n", encoding="utf-8")
    path.chmod(0o600)
    return secret


def _base64url_encode(value: bytes) -> str:
    """Encode bytes using unpadded URL-safe base64."""
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _base64url_decode(value: str) -> bytes:
    """Decode unpadded URL-safe base64."""
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}")


def _signature(payload_segment: str, secret: str) -> str:
    """Return the signature segment for a payload segment."""
    digest = hmac.new(
        secret.encode("utf-8"),
        payload_segment.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return _base64url_encode(digest)


def issue_session_token(*, username: str, role: str) -> str:
    """Issue a signed token containing the minimal v1 identity claims."""
    if not username:
        raise ValueError("username is required")
    if role not in {"owner", "viewer"}:
        raise ValueError("role must be owner or viewer")

    payload = json.dumps(
        {"role": role, "username": username},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    payload_segment = _base64url_encode(payload)
    signature_segment = _signature(payload_segment, _load_or_create_secret())
    return f"{payload_segment}.{signature_segment}"


def verify_session_token(token: str) -> SessionClaims | None:
    """Return verified claims for ``token``, or ``None`` when invalid."""
    try:
        payload_segment, signature_segment = token.split(".", maxsplit=1)
    except ValueError:
        return None
    if not payload_segment or not signature_segment:
        return None

    expected_signature = _signature(payload_segment, _load_or_create_secret())
    if not hmac.compare_digest(signature_segment, expected_signature):
        return None

    try:
        payload = json.loads(_base64url_decode(payload_segment))
    except (binascii.Error, json.JSONDecodeError, UnicodeDecodeError):
        return None

    if not isinstance(payload, dict):
        return None
    username = payload.get("username")
    role = payload.get("role")
    if not isinstance(username, str) or not username:
        return None
    if role not in {"owner", "viewer"}:
        return None
    return SessionClaims(username=username, role=role)
