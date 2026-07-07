# Phase 3: Backend writes + activity

Ref: [spec.md](spec.md) sections C1, C2, C3, C4, D1

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

## Items

Items are sequential: all edit `update_item` / the activity endpoint in
`api/v1/items.py` (with C4/D1 also touching `api/schemas.py`), so they
cannot run in parallel. Depends on phase 1.

### Item 3.1: C1 - Ball change stamps timestamps and logs activity

spec.md section: C1

In `update_item` (`api/v1/items.py`), a changed `ball` sets `ball`, stamps
`ball_changed_at`/`updated_at`/`updated_by`, and inserts a
`kind='ball-change'` activity row (from/to Ball); an equal-value `ball` is
a no-op. Phase-change recording stays unchanged. Covering all 4 acceptance
tests from C1 (tests in `tests/test_items.py`).

- [x] implemented
- [x] reviewed

### Item 3.2: C2 - Hand-off note/date auto-clear when Ball leaves `person`

spec.md section: C2

In `update_item`, a PATCH that sets `ball` to `you` or `agent` clears
`blocked_note` and `blocked_followup_date` to null in the same write,
regardless of the payload; setting `ball=person` does not clear them.
Covering all 4 acceptance tests from C2 (tests in `tests/test_items.py`).
Builds on 3.1.

- [x] implemented
- [x] reviewed

### Item 3.3: C3 - Terminal transitions preserve Ball; re-open forces Ball `you`

spec.md section: C3

In `update_item`, a terminal `state` change leaves `ball` unchanged; a
change FROM terminal TO non-terminal with no explicit `ball` forces
`ball="you"` (stamping/logging/clearing via C1/C2 when it differs). An
explicit `ball` in the same payload wins. Covering all 4 acceptance tests
from C3 (tests in `tests/test_items.py`). Builds on 3.1, 3.2.

- [x] implemented
- [x] reviewed

### Item 3.4: C4 - `ItemUpdate` field surface

spec.md section: C4

Update `ItemUpdate` (`api/schemas.py`) to drop `blocked_external` and
accept `ball`, the four ship booleans, and (as before)
`blocked_note`/`blocked_followup_date` plus the existing fields; confirm
`repo_url`/`usage` still 422 on non-root while `ball`/ship do not.
Covering all 3 acceptance tests from C4 (tests in `tests/test_items.py`).
Builds on 3.1.

- [x] implemented
- [x] reviewed

### Item 3.5: D1 - Activity endpoint returns state-change and ball-change entries

spec.md section: D1

Make `GET /items/{id}/activity` (`api/v1/items.py`) read
`item_state_changes` ordered by `created_at, id` and map each row by
`kind` into the `ItemActivityOut` discriminated union
(`StateChangeActivityOut` / `BallChangeActivityOut`) defined in
`api/schemas.py`; unknown id -> 404. Covering all 3 acceptance tests from
D1 (tests in `tests/test_items.py`). Builds on 3.1.

- [x] implemented
- [x] reviewed
