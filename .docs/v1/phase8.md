# Phase 8: Markers and windows

Ref: [spec.md](spec.md) sections I1

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

Named time markers and the change-window query. Depends on Phase 2.
Parallelisable with Phase 7 per the spec's Implementation Order.

## Items

### Item 8.1: I1 - Create markers and filter by window

spec.md section: I1

Implement marker endpoints in `api/v1/markers.py`: POST `/markers`
`{name, at?}` (at defaults to now), GET `/markers`, and GET `/changes` with
query params `since=<marker_id>` or `between=<id1>,<id2>` and
`field=created|changed|completed` (default `changed`), returning items whose
chosen timestamp falls in the window. Establishes the `MarkerOut` model. Covers
all 3 acceptance tests from I1 (since/changed includes only later-changed item;
between/created window; "since the last marker" resolves to the greatest `at`).

- [x] implemented
- [x] reviewed
