"""Authentication API tests for LDAP direct-bind login (spec K1)."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

import config
from api.v1 import auth as auth_module
from api.v1.auth import get_authenticator
from config import settings
from db.connection import get_connection
from db.migrate import apply_migrations
from main import app
from services.auth_ldap import (
    LdapAuthenticator,
    LdapBindError,
    LdapBindSettings,
    LdapConfigurationError,
)


class StubBinder:
    """Test binder that records bind attempts and can be toggled to fail."""

    def __init__(self, *, succeeds: bool) -> None:
        self.succeeds = succeeds
        self.calls: list[tuple[str, str, str]] = []

    def bind(self, *, server_uri: str, bind_dn: str, password: str) -> None:
        self.calls.append((server_uri, bind_dn, password))
        if not self.succeeds:
            raise LdapBindError("stub rejected credentials")


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    """Point the app at a fresh, empty SQLite DB for auth guard tests."""
    monkeypatch.setattr(config.settings, "data_dir", tmp_path)
    apply_migrations()
    return config.settings.db_path


@pytest.fixture(autouse=True)
def clear_auth_overrides() -> None:
    """Keep dependency overrides isolated between tests."""

    app.dependency_overrides.clear()
    auth_module._current_identity = None
    yield
    app.dependency_overrides.clear()
    auth_module._current_identity = None


def _identity_headers(username: str, role: str) -> dict[str, str]:
    return {"x-agentfarm-username": username, "x-agentfarm-role": role}


def _item_count(db_path) -> int:
    with get_connection(db_path) as conn:
        row = conn.execute("SELECT COUNT(*) AS count FROM items").fetchone()
    return int(row["count"])


@pytest.mark.anyio
async def test_login_success_returns_identity_with_username(monkeypatch) -> None:
    monkeypatch.setattr(settings, "owner", "alice")
    monkeypatch.setattr(settings, "whitelist_raw", "")
    binder = StubBinder(succeeds=True)
    authenticator = LdapAuthenticator(
        LdapBindSettings(
            server_uri="ldap://directory.example",
            dn_template="uid={username},ou=people,dc=example,dc=com",
        ),
        binder=binder,
    )
    app.dependency_overrides[get_authenticator] = lambda: authenticator

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"username": "alice", "password": "correct horse"},
        )

    assert response.status_code == 200
    assert response.json() == {"username": "alice", "role": "owner"}
    assert binder.calls == [
        (
            "ldap://directory.example",
            "uid=alice,ou=people,dc=example,dc=com",
            "correct horse",
        )
    ]


@pytest.mark.anyio
async def test_failed_bind_returns_401_authentication_failed(monkeypatch) -> None:
    monkeypatch.setattr(settings, "owner", "alice")
    monkeypatch.setattr(settings, "whitelist_raw", "")
    authenticator = LdapAuthenticator(
        LdapBindSettings(
            server_uri="ldap://directory.example",
            dn_template="uid={username},ou=people,dc=example,dc=com",
        ),
        binder=StubBinder(succeeds=False),
    )
    app.dependency_overrides[get_authenticator] = lambda: authenticator

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"username": "alice", "password": "wrong"},
        )

    assert response.status_code == 401
    assert response.json() == {"detail": "authentication failed"}


def test_missing_placeholder_validation_error_names_placeholder() -> None:
    with pytest.raises(LdapConfigurationError, match=r"\{username\} or %s"):
        LdapBindSettings(
            server_uri="ldap://directory.example",
            dn_template="uid=static,ou=people,dc=example,dc=com",
        )


@pytest.mark.anyio
async def test_missing_placeholder_aborts_startup_with_clear_error(
    tmp_path, monkeypatch
) -> None:
    import config
    from main import app, lifespan

    monkeypatch.setattr(config.settings, "data_dir", tmp_path)
    monkeypatch.setattr(
        config.settings,
        "ldap_dn_template",
        "uid=static,ou=people,dc=example,dc=com",
    )

    with pytest.raises(LdapConfigurationError, match=r"\{username\} or %s"):
        async with lifespan(app):
            pass


@pytest.mark.anyio
async def test_percent_s_template_sends_correct_bind_dn_for_bob(monkeypatch) -> None:
    monkeypatch.setattr(settings, "owner", "bob")
    monkeypatch.setattr(settings, "whitelist_raw", "")
    binder = StubBinder(succeeds=True)
    authenticator = LdapAuthenticator(
        LdapBindSettings(
            server_uri="ldap://directory.example",
            dn_template="uid=%s,ou=people,dc=example,dc=com",
        ),
        binder=binder,
    )
    app.dependency_overrides[get_authenticator] = lambda: authenticator

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"username": "bob", "password": "builder"},
        )

    assert response.status_code == 200
    assert response.json() == {"username": "bob", "role": "owner"}
    assert binder.calls == [
        (
            "ldap://directory.example",
            "uid=bob,ou=people,dc=example,dc=com",
            "builder",
        )
    ]


@pytest.mark.anyio
async def test_whoami_returns_current_identity_after_login(monkeypatch) -> None:
    monkeypatch.setattr(settings, "owner", "alice")
    monkeypatch.setattr(settings, "whitelist_raw", "")
    authenticator = LdapAuthenticator(
        LdapBindSettings(
            server_uri="ldap://directory.example",
            dn_template="uid={username},ou=people,dc=example,dc=com",
        ),
        binder=StubBinder(succeeds=True),
    )
    app.dependency_overrides[get_authenticator] = lambda: authenticator

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        await client.post(
            "/api/v1/auth/login",
            json={"username": "alice", "password": "correct horse"},
        )
        response = await client.get("/api/v1/auth/whoami")

    assert response.status_code == 200
    assert response.json() == {"username": "alice", "role": "owner"}


@pytest.mark.anyio
async def test_login_assigns_owner_role_for_configured_owner(monkeypatch) -> None:
    monkeypatch.setattr(settings, "owner", "alice")
    monkeypatch.setattr(settings, "whitelist_raw", "vue")
    authenticator = LdapAuthenticator(
        LdapBindSettings(
            server_uri="ldap://directory.example",
            dn_template="uid={username},ou=people,dc=example,dc=com",
        ),
        binder=StubBinder(succeeds=True),
    )
    app.dependency_overrides[get_authenticator] = lambda: authenticator

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"username": "alice", "password": "correct horse"},
        )

    assert response.status_code == 200
    assert response.json() == {"username": "alice", "role": "owner"}


@pytest.mark.anyio
async def test_login_assigns_viewer_role_for_whitelisted_user(monkeypatch) -> None:
    monkeypatch.setattr(settings, "owner", "alice")
    monkeypatch.setattr(settings, "whitelist_raw", "vue")
    authenticator = LdapAuthenticator(
        LdapBindSettings(
            server_uri="ldap://directory.example",
            dn_template="uid={username},ou=people,dc=example,dc=com",
        ),
        binder=StubBinder(succeeds=True),
    )
    app.dependency_overrides[get_authenticator] = lambda: authenticator

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"username": "vue", "password": "correct horse"},
        )

    assert response.status_code == 200
    assert response.json() == {"username": "vue", "role": "viewer"}


@pytest.mark.anyio
async def test_login_rejects_bound_user_who_is_not_whitelisted(monkeypatch) -> None:
    binder = StubBinder(succeeds=True)
    monkeypatch.setattr(settings, "owner", "alice")
    monkeypatch.setattr(settings, "whitelist_raw", "vue")
    authenticator = LdapAuthenticator(
        LdapBindSettings(
            server_uri="ldap://directory.example",
            dn_template="uid={username},ou=people,dc=example,dc=com",
        ),
        binder=binder,
    )
    app.dependency_overrides[get_authenticator] = lambda: authenticator

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"username": "mallory", "password": "correct horse"},
        )

    assert response.status_code == 403
    assert response.json() == {"detail": "access denied"}
    assert binder.calls == [
        (
            "ldap://directory.example",
            "uid=mallory,ou=people,dc=example,dc=com",
            "correct horse",
        )
    ]


@pytest.mark.anyio
async def test_login_allows_owner_when_absent_from_whitelist(monkeypatch) -> None:
    monkeypatch.setattr(settings, "owner", "alice")
    monkeypatch.setattr(settings, "whitelist_raw", "vue")
    authenticator = LdapAuthenticator(
        LdapBindSettings(
            server_uri="ldap://directory.example",
            dn_template="uid={username},ou=people,dc=example,dc=com",
        ),
        binder=StubBinder(succeeds=True),
    )
    app.dependency_overrides[get_authenticator] = lambda: authenticator

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"username": "alice", "password": "correct horse"},
        )

    assert response.status_code == 200
    assert response.json() == {"username": "alice", "role": "owner"}


@pytest.mark.anyio
async def test_viewer_post_item_returns_403_and_does_not_create(fresh_db) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/v1/items",
            json={"title": "Viewer cannot create"},
            headers=_identity_headers("vue", "viewer"),
        )

    assert response.status_code == 403
    assert response.json() == {"detail": "owner only"}
    assert _item_count(fresh_db) == 0


@pytest.mark.anyio
async def test_viewer_get_tree_is_allowed(fresh_db) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        created = await client.post(
            "/api/v1/items",
            json={"title": "Readable"},
            headers=_identity_headers("alice", "owner"),
        )
        response = await client.get(
            "/api/v1/tree",
            headers=_identity_headers("vue", "viewer"),
        )

    assert created.status_code == 200
    assert response.status_code == 200
    assert [item["title"] for item in response.json()] == ["Readable"]


@pytest.mark.anyio
async def test_viewer_can_post_comment(fresh_db) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        created = await client.post(
            "/api/v1/items",
            json={"title": "Commentable"},
            headers=_identity_headers("alice", "owner"),
        )
        item_id = created.json()["id"]

        response = await client.post(
            f"/api/v1/items/{item_id}/comments",
            json={"body": "I can comment"},
            headers=_identity_headers("vue", "viewer"),
        )

    assert created.status_code == 200
    assert response.status_code == 200
    assert response.json()["author"] == "vue"
    assert response.json()["body"] == "I can comment"


@pytest.mark.anyio
async def test_missing_or_invalid_identity_is_rejected_without_mutation(
    fresh_db,
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        missing = await client.post(
            "/api/v1/items",
            json={"title": "No identity"},
        )
        invalid = await client.post(
            "/api/v1/items",
            json={"title": "Bad role"},
            headers=_identity_headers("mallory", "admin"),
        )

    assert missing.status_code == 401
    assert missing.json() == {"detail": "authentication required"}
    assert invalid.status_code == 401
    assert invalid.json() == {"detail": "invalid identity"}
    assert _item_count(fresh_db) == 0
