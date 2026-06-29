# Phase 1: Scaffold + config + DB foundation

Ref: [spec.md](spec.md) sections N2, N1

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

This phase is the foundation: copy the wtsi-hgi/llm-knowledge-base scaffold
(excluding skills) into the repo, then fix it up and add the database
foundation. The DB and markdown mirror live under `data_dir`. Verify the DB
initialises and the existing contract test harness still runs.

## Items

### Item 1.1: N2 - Restore frontend/lib from scaffold .gitignore bug

spec.md section: N2

The scaffold `.gitignore` Python rule `lib/` accidentally ignores
`frontend/lib/*` (backend-client, contracts, etc.) although they are imported
everywhere. Un-ignore and commit those files. Edit `.gitignore`; ensure
`frontend/lib/*` is tracked. Covers the 1 acceptance test from N2
(`git check-ignore frontend/lib/contracts.ts` reports not ignored and
`frontend/tests/contracts.test.ts` imports `@/lib/contracts` and runs).

- [ ] implemented
- [ ] reviewed

### Item 1.2: N1 - Environment configuration

spec.md section: N1

Extend `config.py` `Settings` with `data_dir` (`AGENTFARM_DATA_DIR`),
`ldap_server` (`AGENTFARM_LDAP_SERVER`), `ldap_dn_template`
(`AGENTFARM_LDAP_DN_TEMPLATE`), `owner` (`AGENTFARM_OWNER`, default OS user),
`whitelist` (`AGENTFARM_WHITELIST`, comma-separated), `tls_cert`
(`AGENTFARM_TLS_CERT`), `tls_key` (`AGENTFARM_TLS_KEY`). The SQLite file and
markdown mirror both live under `data_dir`. Covers all 3 acceptance tests from
N1 (whitelist split, data_dir placement, owner defaults to OS user).

- [ ] implemented
- [ ] reviewed

### Item 1.3: DB and enums foundation

spec.md section: Architecture (SQLite schema; Enums and weights)

Add `db/` (`connection.py` SQLite connect/pragmas/session factory,
`schema.sql` DDL for items/dependencies/comments/markers/runs, `migrate.py`
applying schema.sql idempotently at startup) and `models/enums.py` (State,
Mode, Effort enums plus `EFFORT_WEIGHT` and `MODE_WEIGHT`). Extend `main.py`
lifespan to initialise the DB under `data_dir`. Verify the DB initialises and
the existing contract test harness runs. No story-level acceptance tests; this
realises the SQLite schema and Enums/weights sections the later phases depend
on.

- [ ] implemented
- [ ] reviewed
