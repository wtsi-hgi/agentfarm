# Phase 1: Backend model + migration

Ref: [spec.md](spec.md) sections A1, A2, A3, E1

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

## Items

Items are sequential: A1 and A2 both edit `models/enums.py`, A2 and A3
both edit `api/schemas.py` and `api/v1/items.py` (A2 also edits
`db/schema.sql`), and E1's migration depends on the new columns (A2).

### Item 1.1: A1 - Phase enum drops impostors, adds `defining`

spec.md section: A1

Narrow `State` in `backend/models/enums.py`: remove `feedback`/`respond`,
add `defining`. Add `PHASE_ORDER` (the seven non-terminal Phases in
pipeline order) and the `Status` literal. Keep `is_complete` unchanged.
Delete `EXTERNAL_WAITING_STATES`, `USER_ACTION_STATES`,
`is_external_waiting`, and `user_action_priority`. Covering all 5
acceptance tests from A1 (tests in `tests/test_enums.py`).

- [x] implemented
- [x] reviewed

### Item 1.2: A2 - Ball enum and defaults

spec.md section: A2

Add the `Ball` StrEnum (`you`/`agent`/`person`, default `you`) in
`models/enums.py`. Add `ball`, `ball_changed_at`, and the four ship
columns to `db/schema.sql`. Wire the `ball` default and creation-time
`ball_changed_at` stamping into `POST /items` (`api/v1/items.py`), add
`ball` to `ItemCreate`, and add `ball`/`ball_changed_at`/ship fields to
`ItemOut` (`api/schemas.py`). Covering all 5 acceptance tests from A2
(tests in `tests/test_enums.py`, `tests/test_items.py`). Builds on 1.1.

- [x] implemented
- [x] reviewed

### Item 1.3: A3 - Ship-milestone booleans on all items

spec.md section: A3

Expose the four ship booleans (`dev_updated`, `prod_updated`,
`docs_updated`, `announced`) on `ItemUpdate` (`api/schemas.py`) and
allow PATCH on both leaves and containers with no parent/leaf guard
(`api/v1/items.py`); ticking a milestone must not change `state`,
`ball`, or their timestamps. Covering all 4 acceptance tests from A3
(tests in `tests/test_items.py`). Builds on 1.2.

- [x] implemented
- [x] reviewed

### Item 1.4: E1 - Migrate rows and activity, drop `blocked_external`

spec.md section: E1

Add the `20260707_phase_ball_split` `_run_once` migration in
`db/migrate.py`, registered in `apply_schema` after the `_ensure_column`
calls that add the new `items` columns and `item_state_changes.kind`.
Using raw SQL: derive `ball` with precedence `person > agent > you`,
rewrite `feedback`/`respond` Phases and matching activity rows to
`released`, backfill `ball_changed_at`, and drop `blocked_external`. Must
be idempotent (recorded in `schema_migrations`) and a no-op on a fresh DB.
Covering all 10 acceptance tests from E1 (tests in `tests/test_db.py`).
Builds on 1.2.

- [x] implemented
- [x] reviewed
