# Phase 4: Explicit dependencies

Ref: [spec.md](spec.md) sections D1, D2, C3

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

Explicit edge add-by-slug (stored by id), full cycle rejection across the
combined implicit+explicit graph, and single-implicit-edge removal for
parallelism. Depends on Phase 3 (implicit-edge engine and cycle scaffolding).
Items are sequential: D2 hardens the cycle check used by D1's add path and by
C3's regeneration behaviour.

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

### Item 4.2: D2 - Cycle rejection across combined graph

spec.md section: D2

In `services/graph.py`, reject any edge whose `to_id` can already reach
`from_id` over the combined graph, plus self-edges, with 409
`"dependency cycle rejected"` and no edge added. Covers all 4 acceptance tests
from D2 (direct cycle, transitive cycle, self-edge, explicit edge contradicting
an implicit chain).

- [ ] implemented
- [ ] reviewed

### Item 4.3: C3 - Removing one implicit edge enables parallelism

spec.md section: C3

Implement DELETE `/dependencies/{id}` in `api/v1/dependencies.py` to remove an
implicit (or explicit) edge so two siblings run in parallel, with the removal
persisting across non-structural PATCHes but being recomputed away by the next
structural change to that sibling group. Covers all 2 acceptance tests from C3
(edge removal makes both actionable and survives a title PATCH; a later
structural change regenerates the full chain so the removed edge reappears).

- [ ] implemented
- [ ] reviewed
