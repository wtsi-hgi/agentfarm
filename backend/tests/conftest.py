"""Pytest configuration for backend tests."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


@pytest.fixture(autouse=True)
def default_owner_identity(request):
    """Default legacy endpoint tests to an owner identity until K4 sessions."""
    from api.schemas import WhoAmI
    from api.v1.authz import require_identity
    from main import app

    if request.module.__name__.endswith("test_auth"):
        yield
        return

    app.dependency_overrides[require_identity] = lambda: WhoAmI(
        username="test-owner",
        role="owner",
    )
    yield
    app.dependency_overrides.pop(require_identity, None)
