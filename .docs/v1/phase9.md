# Phase 9: Auth + sessions + TLS

Ref: [spec.md](spec.md) sections K1, K2, K3, K4

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

LDAP direct-bind login, owner/whitelist roles, owner-only mutation guards,
session cookie, and self-signed TLS. Depends on Phase 1; the guards wrap the
endpoints built in Phases 2-8, so this lands after they exist. Items are
sequential: login (K1) underpins roles (K2), which underpin the mutation guards
(K3); sessions/TLS (K4) builds on the same auth layer.

## Items

### Item 9.1: K1 - LDAP direct-bind login

spec.md section: K1

Implement `services/auth_ldap.py` (substitute username into the env DN template
`{username}` or `%s`, bind with ldap3 behind a small injectable binder
interface; validate the template contains the placeholder at startup) and POST
`/auth/login` plus GET `/auth/whoami` in `api/v1/auth.py`, extending
`config.py`. Establishes `LoginRequest` / `WhoAmI`. Covers all 4 acceptance
tests from K1 (successful stub bind; failed bind -> 401; missing-placeholder
startup error; correct bind DN from `%s` template).

- [x] implemented
- [x] reviewed

### Item 9.2: K2 - Owner and whitelist roles

spec.md section: K2

In `services/auth_ldap.py` / `api/v1/auth.py` / `config.py`, assign roles on
login: owner if username == owner (OS-user default, `AGENTFARM_OWNER`
override), else viewer if whitelisted, else 403 access denied; owner is
implicitly allowed even if absent from the whitelist. Covers all 4 acceptance
tests from K2 (owner role; viewer role; non-whitelisted 403; owner allowed
despite absence from whitelist).

- [x] implemented
- [x] reviewed

### Item 9.3: K3 - Owner-only mutations; viewer read+comment

spec.md section: K3

Add owner-only guards to all item/dependency/marker/structure mutations
(`api/v1/items.py` and the other mutation routers) returning 403 `"owner only"`
for viewers, while viewers may GET everything and POST comments; add
`frontend/middleware.ts` to enforce an authenticated session and gate mutation
routes, with the backend re-checking role server-side. Covers all 4 acceptance
tests from K3 (viewer mutation 403 and no create; viewer GET 200; viewer
comment 200; no/invalid session rejected without mutation).

- [x] implemented
- [x] reviewed

### Item 9.4: K4 - Sessions and self-signed TLS

spec.md section: K4

Implement `services/tls.py` (use configured `AGENTFARM_TLS_CERT`/
`AGENTFARM_TLS_KEY`, else generate a self-signed pair under the data dir at
startup; wire into `main.py`), the httpOnly session cookie in the login Server
Action via `frontend/lib/session.ts`, and relax TLS verification for the
internal backend origin in `frontend/lib/backend-client.ts`. Covers all 4
acceptance tests from K4 (self-signed cert generated and parses; configured
files reused; session cookie is httpOnly; fetch agent has
`rejectUnauthorized: false` for the self-signed origin).

- [x] implemented
- [x] reviewed
