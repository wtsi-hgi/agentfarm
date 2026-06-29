# Phase 4: Explicit dependencies

Ref: [spec.md](spec.md) sections D1, D2, D3

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

Explicit edge add-by-slug (stored by id), full cycle rejection across the
dependency graph, and explicit-edge removal for restoring parallelism. Depends
on Phase 3 (tree structure and section dependency semantics). Items are
sequential: D2 hardens the cycle check used by D1's add path.

## Items

### Item 4.1: D1 - Add explicit edge by slug, stored by id

spec.md section: D1

Implement POST `/dependencies` in `api/v1/dependencies.py` with
`services/graph.py`: `{from_id, needs_slug}` resolves the slug to a target id
at entry time and stores `kind='explicit'`; `{from_id, to_id}` also accepted;
unknown slug -> 422 `"unknown dependency: <slug>"`. Covers all 3 acceptance
tests from D1 (cross-tree edge stored by id; actionability flips when target
completes; unknown-slug 422).

- [ ] implemented
- [ ] reviewed

### Item 4.2: D2 - Cycle rejection across dependency graph

spec.md section: D2

In `services/graph.py`, reject any edge whose `to_id` can already reach
`from_id` over the dependency graph, plus self-edges, with 409
`"dependency cycle rejected"` and no edge added. Covers all 4 acceptance tests
from D2 (direct cycle, transitive cycle, self-edge, opposite section edge).

- [ ] implemented
- [ ] reviewed

### Item 4.3: D3 - Delete explicit dependency edge

spec.md section: D3

Implement DELETE `/dependencies/{id}` in `api/v1/dependencies.py` to remove an
explicit edge so items or sections become independent again. Covers acceptance
tests that removal makes the depending leaves actionable once no other blocking
dependencies remain, survives unrelated PATCHes/structural edits, and does not
reappear automatically.

- [ ] implemented
- [ ] reviewed
