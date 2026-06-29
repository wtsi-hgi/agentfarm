# Phase 12: v2 seams

Ref: [spec.md](spec.md) sections M1, M2

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

Stubbed v2 affordances: the runs table endpoints and the spawn boundary
returning 501. Independent of the other feature phases (needs only Phases 1-2);
placed last as lowest priority. The two items are independent and run as a
single parallel batch.

## Items

### Batch 1 (parallel)

#### Item 12.1: M1 - Runs table seam [parallel with 12.2]

spec.md section: M1

Implement the runs endpoints in `api/v1/runs.py` carrying no v1 business logic:
POST `/items/{id}/runs` creates a stub run row (`status=="pending"`) and GET
`/items/{id}/runs` lists runs. Covers the 1 acceptance test from M1 (create then
list returns the pending run with `item_id==I`).

- [x] implemented
- [x] reviewed

#### Item 12.2: M2 - Spawn/stream boundary returns 501 [parallel with 12.1]

spec.md section: M2

Implement POST `/items/{id}/spawn` in `api/v1/spawn.py` returning 501 Not
Implemented over the intended SSE/WebSocket boundary, performing no work in v1.
Covers the 1 acceptance test from M2 (any item -> 501 with a not-implemented
detail).

- [x] implemented
- [x] reviewed

For parallel batch items, use separate subagents per item.
Launch review subagents using the `nextjs-fastapi-reviewer` skill
(review all items in the batch together in a single review
pass).
