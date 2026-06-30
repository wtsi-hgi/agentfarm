"""Authentication API tests for LDAP direct-bind login (spec K1)."""

from __future__ import annotations

import logging

import pytest
from httpx import ASGITransport, AsyncClient

import config
from api.v1.auth import get_authenticator
from config import settings
from db.connection import get_connection
from db.migrate import apply_migrations
from main import app
from services.auth_ldap import (
    Ldap3Binder,
    LdapAuthenticator,
    LdapBindError,
    LdapBindSettings,
    LdapConfigurationError,
)
from services.session_tokens import issue_session_token


class StubBinder:
    """Test binder that records bind attempts and can be toggled to fail."""

    def __init__(self, *, succeeds: bool) -> None:
        self.succeeds = succeeds
        self.calls: list[tuple[str, str, str]] = []

    def bind(self, *, server_uri: str, bind_dn: str, password: str) -> None:
        self.calls.append((server_uri, bind_dn, password))
        if not self.succeeds:
            raise LdapBindError("stub rejected credentials")


def test_ldap3_binder_imports_declared_runtime_package(monkeypatch) -> None:
    """The production LDAP binder can import ldap3 without making a network call."""

    import ldap3

    calls: dict[str, object] = {}

    class FakeServer:
        def __init__(self, server_uri: str) -> None:
            calls["server_uri"] = server_uri

    class FakeConnection:
        bound = True

        def __init__(
            self,
            server: FakeServer,
            *,
            user: str,
            password: str,
            auto_bind: bool,
        ) -> None:
            calls["server"] = server
            calls["user"] = user
            calls["password"] = password
            calls["auto_bind"] = auto_bind

        def unbind(self) -> None:
            calls["unbound"] = True

    monkeypatch.setattr(ldap3, "Server", FakeServer)
    monkeypatch.setattr(ldap3, "Connection", FakeConnection)

    Ldap3Binder().bind(
        server_uri="ldap://directory.example",
        bind_dn="uid=alice,ou=people,dc=example,dc=com",
        password="correct horse",
    )

    server = calls.pop("server")
    assert isinstance(server, FakeServer)
    assert calls == {
        "server_uri": "ldap://directory.example",
        "user": "uid=alice,ou=people,dc=example,dc=com",
        "password": "correct horse",
        "auto_bind": True,
        "unbound": True,
    }


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    """Point the app at a fresh, empty SQLite DB for auth guard tests."""
    monkeypatch.setattr(config.settings, "data_dir", tmp_path)
    apply_migrations()
    return config.settings.db_path


@pytest.fixture(autouse=True)
def clear_auth_overrides(tmp_path, monkeypatch) -> None:
    """Keep dependency overrides isolated between tests."""

    monkeypatch.setattr(config.settings, "data_dir", tmp_path)
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


def _session_headers(username: str, role: str) -> dict[str, str]:
    return {
        "x-agentfarm-session": issue_session_token(
            username=username,
            role=role,
        )
    }


def _assert_login_identity(response, username: str, role: str) -> str:
    body = response.json()
    assert body["username"] == username
    assert body["role"] == role
    token = body.get("session_token")
    assert isinstance(token, str)
    assert token
    return token


def _item_count(db_path) -> int:
    with get_connection(db_path) as conn:
        row = conn.execute("SELECT COUNT(*) AS count FROM items").fetchone()
    return int(row["count"])


def _protected_read_paths(item_id: str, marker_id: str) -> list[str]:
    """Return protected read endpoints backed by app data."""
    return [
        "/api/v1/tree",
        "/api/v1/priority",
        f"/api/v1/items/{item_id}/comments",
        "/api/v1/markers",
        f"/api/v1/changes?since={marker_id}&field=changed",
        f"/api/v1/items/{item_id}/runs",
    ]


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
        body = response.json()
        whoami = await client.get(
            "/api/v1/auth/whoami",
            headers={"x-agentfarm-session": body.get("session_token", "")},
        )

    assert response.status_code == 200
    _assert_login_identity(response, "alice", "owner")
    assert whoami.status_code == 200
    assert whoami.json() == {"username": "alice", "role": "owner"}
    assert binder.calls == [
        (
            "ldap://directory.example",
            "uid=alice,ou=people,dc=example,dc=com",
            "correct horse",
        )
    ]


@pytest.mark.anyio
async def test_auth_context_names_configured_farm_owner_without_session(
    monkeypatch,
) -> None:
    monkeypatch.setattr(settings, "owner", "alice")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.get("/api/v1/auth/context")

    assert response.status_code == 200
    assert response.json() == {"owner_username": "alice"}


@pytest.mark.anyio
async def test_failed_bind_returns_401_authentication_failed(
    caplog, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "owner", "alice")
    monkeypatch.setattr(settings, "whitelist_raw", "")
    authenticator = LdapAuthenticator(
        LdapBindSettings(
            server_uri="ldaps://ldap.example.org",
            dn_template="uid={username},ou=people,dc=example,dc=com",
        ),
        binder=StubBinder(succeeds=False),
    )
    app.dependency_overrides[get_authenticator] = lambda: authenticator
    caplog.set_level(logging.WARNING, logger="agentfarm.auth")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/v1/auth/login",
            json={"username": "alice", "password": "wrong"},
        )

    assert response.status_code == 401
    assert response.json() == {"detail": "authentication failed"}
    auth_logs = [
        record.getMessage()
        for record in caplog.records
        if record.name == "agentfarm.auth"
    ]
    assert any(
        "LDAP bind failed for username=alice" in message
        and "server=ldaps://ldap.example.org" in message
        and "dn_template_placeholder={username}" in message
        for message in auth_logs
    )
    assert all("wrong" not in message for message in auth_logs)


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
    _assert_login_identity(response, "bob", "owner")
    assert binder.calls == [
        (
            "ldap://directory.example",
            "uid=bob,ou=people,dc=example,dc=com",
            "builder",
        )
    ]


@pytest.mark.anyio
async def test_whoami_is_scoped_to_the_request_session_token(monkeypatch) -> None:
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
        owner_login = await client.post(
            "/api/v1/auth/login",
            json={"username": "alice", "password": "correct horse"},
        )
        viewer_login = await client.post(
            "/api/v1/auth/login",
            json={"username": "vue", "password": "correct horse"},
        )
        missing = await client.get("/api/v1/auth/whoami")
        owner = await client.get(
            "/api/v1/auth/whoami",
            headers={
                "x-agentfarm-session": owner_login.json().get("session_token", "")
            },
        )
        viewer = await client.get(
            "/api/v1/auth/whoami",
            headers={
                "x-agentfarm-session": viewer_login.json().get("session_token", "")
            },
        )
        invalid = await client.get(
            "/api/v1/auth/whoami",
            headers={"x-agentfarm-session": "not-a-valid-token"},
        )

    assert owner_login.status_code == 200
    assert viewer_login.status_code == 200
    assert missing.status_code == 401
    assert missing.json() == {"detail": "authentication required"}
    assert owner.status_code == 200
    assert owner.json() == {"username": "alice", "role": "owner"}
    assert viewer.status_code == 200
    assert viewer.json() == {"username": "vue", "role": "viewer"}
    assert invalid.status_code == 401
    assert invalid.json() == {"detail": "invalid session"}


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
    _assert_login_identity(response, "alice", "owner")


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
    _assert_login_identity(response, "vue", "viewer")


@pytest.mark.anyio
async def test_login_rejects_bound_user_who_is_not_whitelisted(
    caplog, monkeypatch
) -> None:
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
    caplog.set_level(logging.WARNING, logger="agentfarm.auth")

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
    auth_logs = [
        record.getMessage()
        for record in caplog.records
        if record.name == "agentfarm.auth"
    ]
    assert any(
        "LDAP login denied for username=mallory" in message
        and "owner_match=False" in message
        and "whitelist_count=1" in message
        for message in auth_logs
    )
    assert all("correct horse" not in message for message in auth_logs)


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
    _assert_login_identity(response, "alice", "owner")


@pytest.mark.anyio
async def test_viewer_post_item_returns_403_and_does_not_create(fresh_db) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/v1/items",
            json={"title": "Viewer cannot create"},
            headers=_session_headers("vue", "viewer"),
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
            headers=_session_headers("alice", "owner"),
        )
        response = await client.get(
            "/api/v1/tree",
            headers=_session_headers("vue", "viewer"),
        )

    assert created.status_code == 200
    assert response.status_code == 200
    assert [item["title"] for item in response.json()] == ["Readable"]


@pytest.mark.anyio
async def test_protected_reads_reject_missing_or_invalid_session_and_allow_viewer(
    fresh_db,
) -> None:
    """Protected data reads require a signed session; viewers may still read."""
    del fresh_db
    owner_headers = _session_headers("alice", "owner")
    viewer_headers = _session_headers("vue", "viewer")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        created = await client.post(
            "/api/v1/items",
            json={"title": "Readable"},
            headers=owner_headers,
        )
        assert created.status_code == 200
        item_id = created.json()["id"]
        comment = await client.post(
            f"/api/v1/items/{item_id}/comments",
            json={"body": "visible note"},
            headers=owner_headers,
        )
        marker = await client.post(
            "/api/v1/markers",
            json={"name": "Before readable", "at": "2000-01-01T00:00:00.000000Z"},
            headers=owner_headers,
        )
        run = await client.post(
            f"/api/v1/items/{item_id}/runs",
            headers=owner_headers,
        )

        assert comment.status_code == 200
        assert marker.status_code == 200
        assert run.status_code == 200

        paths = _protected_read_paths(item_id, marker.json()["id"])
        for path in paths:
            missing = await client.get(path)
            invalid = await client.get(
                path,
                headers={"x-agentfarm-session": "not-a-valid-token"},
            )
            viewer = await client.get(path, headers=viewer_headers)

            assert missing.status_code == 401, path
            assert missing.json() == {"detail": "authentication required"}
            assert invalid.status_code == 401, path
            assert invalid.json() == {"detail": "invalid session"}
            assert viewer.status_code == 200, path


@pytest.mark.anyio
async def test_public_reads_remain_public_without_session(fresh_db) -> None:
    """Health and greeting endpoints are intentionally public."""
    del fresh_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        health = await client.get("/api/v1/health")
        greeting = await client.get("/api/v1/hello", params={"name": "Ada"})

    assert health.status_code == 200
    assert health.json() == {"status": "healthy"}
    assert greeting.status_code == 200
    assert greeting.json() == {"message": "Hello, Ada from FastAPI!"}


@pytest.mark.anyio
async def test_viewer_can_post_comment(fresh_db) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        created = await client.post(
            "/api/v1/items",
            json={"title": "Commentable"},
            headers=_session_headers("alice", "owner"),
        )
        item_id = created.json()["id"]

        response = await client.post(
            f"/api/v1/items/{item_id}/comments",
            json={"body": "I can comment"},
            headers=_session_headers("vue", "viewer"),
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
            headers={
                "x-agentfarm-session": "not-a-valid-token",
                "x-agentfarm-username": "mallory",
                "x-agentfarm-role": "owner",
            },
        )

    assert missing.status_code == 401
    assert missing.json() == {"detail": "authentication required"}
    assert invalid.status_code == 401
    assert invalid.json() == {"detail": "invalid session"}
    assert _item_count(fresh_db) == 0


@pytest.mark.anyio
async def test_forged_identity_headers_do_not_escalate_viewer_token(
    fresh_db,
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/v1/items",
            json={"title": "Forged owner"},
            headers={
                **_session_headers("vue", "viewer"),
                "x-agentfarm-username": "alice",
                "x-agentfarm-role": "owner",
            },
        )

    assert response.status_code == 403
    assert response.json() == {"detail": "owner only"}
    assert _item_count(fresh_db) == 0


@pytest.mark.anyio
async def test_forged_identity_headers_without_session_are_rejected(
    fresh_db,
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        response = await client.post(
            "/api/v1/items",
            json={"title": "Forged cookie"},
            headers={
                "x-agentfarm-username": "alice",
                "x-agentfarm-role": "owner",
                "cookie": (
                    "agentfarm_session=%7B%22username%22%3A%22alice%22%2C"
                    "%22role%22%3A%22owner%22%7D"
                ),
            },
        )

    assert response.status_code == 401
    assert response.json() == {"detail": "authentication required"}
    assert _item_count(fresh_db) == 0
