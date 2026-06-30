# Agent Farm

Agent Farm tracks work being done by many LLM agents across many software
products. It is a Next.js + FastAPI app with a single authenticated outliner,
explicit dependency edges, priority projection, comments, markers, a markdown
mirror, and v2 seams for runs/spawn.

- Frontend: Next.js App Router, React, TypeScript, Tailwind/shadcn, Server Actions
- Backend: FastAPI, SQLite, Pydantic, LDAP login, signed session tokens
- Scope: maintain a tree of agent tasks, track explicit `>needs:` dependencies,
  surface actionable work, and keep a markdown mirror of the tree

## Repository Layout

- `frontend/`: Next.js app, Vitest tests, and Playwright e2e tests
- `backend/`: FastAPI app, SQLite schema/services, and pytest suite
- `tests/`: repo-level shell tests
- `Makefile`: repo-level install, lint, format, test, e2e, and run entrypoints
- `run-dev.sh`: local launcher for both backend and frontend with health checks

## Quick Start

Prerequisites:

- Python 3.11+
- Node.js 20.9+ (Node 24 is used in CI)
- pnpm 11+

From the repo root:

```bash
make install
```

Run all lint checks:

```bash
make lint
```

Run the full test suite, including Playwright e2e:

```bash
make test
```

Apply formatting:

```bash
make format
```

Start both dev services:

```bash
make run
```

Then open the `Frontend URL` printed by `run-dev.sh`, usually
`https://localhost:3000`. Logs are written to:

```bash
tail -F logs/frontend.log logs/backend.log
```

## Make Targets

Root targets:

- `make install`: install backend and frontend dependencies
- `make lint`: backend ruff checks plus frontend ESLint/Prettier checks
- `make format`: backend ruff fix/format plus frontend Prettier
- `make format-check`: formatting checks only
- `make test`: backend pytest, frontend Vitest, shell tests, and Playwright e2e
- `make run`: start backend and frontend for real local development

Backend targets:

- `make backend-install`
- `make backend-lint`
- `make backend-format`
- `make backend-format-check`
- `make backend-test`

Frontend targets:

- `make frontend-install`
- `make frontend-lint`
- `make frontend-format`
- `make frontend-format-check`
- `make frontend-test`
- `make frontend-e2e-install`: install Playwright Chromium only when no existing
  Chrome/Chromium or matching Playwright cache is available
- `make frontend-e2e-test`

`make` loads a repo-root `.env` file when present, so local overrides can stay
out of your shell profile.

## Running Locally

`make run` is a wrapper around:

```bash
./run-dev.sh --frontend-host 0.0.0.0 --frontend-port 3000 --backend-port 8000
```

Custom ports:

```bash
make run FRONTEND_PORT=4000 BACKEND_PORT=9000
```

Custom frontend bind host:

```bash
make run FRONTEND_HOST=127.0.0.1
```

To listen on every interface, set `FRONTEND_HOST=0.0.0.0`. Keep using
`https://localhost:3000` on the same machine, or replace `localhost` with the
machine's hostname or LAN IP from another device. `0.0.0.0` is the bind address,
not the browser URL. The URL uses a local self-signed certificate; use
`AGENTFARM_TLS_CERT` and `AGENTFARM_TLS_KEY` if you need a certificate that
already chains to a trusted local CA or matches a custom hostname.

Important runtime notes:

- The frontend dev server and backend both serve HTTPS locally with a generated
  self-signed certificate.
- The frontend talks to the backend through server-side BFF calls.
- The frontend binds to `FRONTEND_HOST` (default `0.0.0.0`).
- `run-dev.sh` passes `BACKEND_URL=https://127.0.0.1:${BACKEND_PORT}` to the
  frontend process.
- Backend runtime state defaults to repo-root `data/`, which is ignored by git.
- `backend/run_uvicorn.sh` uses reload by default. Set `UVICORN_RELOAD=0` for
  one-process startup, which CI/e2e uses.

## Authentication

The app uses LDAP direct-bind login in normal development/production:

- `AGENTFARM_LDAP_SERVER`
- `AGENTFARM_LDAP_DN_TEMPLATE`
- `AGENTFARM_OWNER`
- `AGENTFARM_WHITELIST`

Successful login stores a signed `agentfarm_session` cookie. Backend protected
endpoints verify only the signed `x-agentfarm-session` token; forged username or
role headers are ignored.

For e2e tests, Playwright writes a session secret into an isolated scratch data
directory and sets a real signed session cookie in the browser context. This
keeps the tests independent from external LDAP while still exercising Next.js
middleware, Server Actions, backend auth, SQLite, and the rendered UI.

## Environment Variables

Common local settings:

- `FRONTEND_HOST` (default `0.0.0.0`)
- `FRONTEND_PORT` (default `3000`)
- `BACKEND_PORT` (default `8000`)
- `BACKEND_URL` (frontend server-side backend URL)
- `AGENTFARM_DATA_DIR` (default `data`)
- `AGENTFARM_OWNER` (defaults to the OS user)
- `AGENTFARM_WHITELIST` (comma-separated viewer usernames)
- `AGENTFARM_LDAP_SERVER`
- `AGENTFARM_LDAP_DN_TEMPLATE`
- `AGENTFARM_TLS_CERT`
- `AGENTFARM_TLS_KEY`
- `UVICORN_RELOAD` (`1` by default, set `0` for CI/e2e style startup)

Example `.env`:

```bash
FRONTEND_HOST=0.0.0.0
FRONTEND_PORT=4000
BACKEND_PORT=9000
BACKEND_URL=https://127.0.0.1:9000
AGENTFARM_DATA_DIR=data
AGENTFARM_OWNER=alice
AGENTFARM_WHITELIST=bob,carol
AGENTFARM_LDAP_SERVER=ldaps://ldap.example.com
AGENTFARM_LDAP_DN_TEMPLATE=uid={username},ou=people,dc=example,dc=com
```

## Tests And Checks

Repo-level:

```bash
make lint
make test
```

Backend only:

```bash
make backend-test
make backend-lint
```

Frontend unit tests:

```bash
make frontend-test
```

Playwright e2e:

```bash
make frontend-e2e-install
make frontend-e2e-test
```

Playwright starts FastAPI and Next.js from `frontend/playwright.config.ts` on
isolated ports (`8100` and `3100` by default) with an isolated data directory
under `.tmp/agent/playwright/`.

Browser resolution follows the same local convention as sibling repos:
`AGENTFARM_PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, Playwright/Chrome/Chromium
executable env vars, `PLAYWRIGHT_BROWSERS_PATH`, PATH, standard install
locations, then Playwright's own cache. `make test` runs the conditional browser
prep target before e2e so fresh CI images still work without re-downloading on
developer machines that already have a browser.

## CI

GitHub Actions runs two checks:

- `lint`: installs dependencies and runs `make lint`
- `test`: installs dependencies and runs `make test`

The workflow lives in `.github/workflows/ci.yml`.

## Health Endpoints

- Backend: `GET /api/v1/health`
- Frontend proxy: `GET /api/health`

`run-dev.sh` waits for both health endpoints and warms the public login page
before declaring startup ready.
