# Phase 5: Priority engine

Ref: [spec.md](spec.md) sections E1, E2, E3, E4, E5, E6

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

Unblock-leverage scoring, ordering, tie-break, the actionable-vs-downstream
distinction for `blocked_external`, and the `/priority` endpoint returning
ranks with no numeric score. Depends on Phase 3 and Phase 4 (dependency graph,
section inheritance, and actionability). Item 5.1 builds the core
scoring/ordering engine and endpoint;
the remaining stories refine specific rules and run as a parallel batch.

## Items

### Item 5.1: E1 - Leverage ordering across products

spec.md section: E1

Implement `services/leverage.py` (`Downstream(L)`, `score(L)` using
`EFFORT_WEIGHT`/`MODE_WEIGHT`, score-descending ordering) and GET `/priority`
in `api/v1/priority.py` returning actionable leaves only, each with a 1-based
`rank`, never exposing the numeric score. Covers all 2 acceptance tests from E1
(actionable set `{A1,B1,G1}`; order `[A1,B1,G1]` with ranks `1,2,3` and no
score field).

- [ ] implemented
- [ ] reviewed

### Batch 1 (parallel, after Item 5.1 is reviewed)

#### Item 5.2: E2 - prompt-agent weight isolates to 2x [parallel with 5.3, 5.4, 5.5, 5.6]

spec.md section: E2

In `services/leverage.py`, confirm `MODE_WEIGHT` doubles only prompt-agent
downstream. Covers the 1 acceptance test from E2 (`H1=16`, `I1=8`, order
`[H1,I1]`).

- [ ] implemented
- [ ] reviewed

#### Item 5.3: E3 - Division by own effort [parallel with 5.2, 5.4, 5.5, 5.6]

spec.md section: E3

In `services/leverage.py`, confirm dividing by the item's own effort ranks a
cheap item above a costly one with equal downstream. Covers the 1 acceptance
test from E3 (`A1=16/1` ranks strictly above `G1=16/8`).

- [ ] implemented
- [ ] reviewed

#### Item 5.4: E4 - Transitive downstream over open leaves only; containers excluded [parallel with 5.2, 5.3, 5.5, 5.6]

spec.md section: E4

In `services/leverage.py`, ensure `Downstream` is transitive but counts only
open leaves (excluding containers and completed leaves). Covers all 3
acceptance tests from E4 (container excluded / open child included =>
`score(J1)=6`; completed leaf excluded => `score(K1)=0`; deeper explicit chain =>
`score(M1)=17`).

- [ ] implemented
- [ ] reviewed

#### Item 5.5: E5 - Tie-break ordering [parallel with 5.2, 5.3, 5.4, 5.6]

spec.md section: E5

In `services/leverage.py`, implement the deterministic tie-break on equal
scores: `updated_at` desc, then `created_at` desc, then `id` asc (inject
clock/id generator for determinism). Covers all 3 acceptance tests from E5
(updated_at desc; created_at desc; id asc).

- [ ] implemented
- [ ] reviewed

#### Item 5.6: E6 - blocked_external excludes from actionable, not from downstream [parallel with 5.2, 5.3, 5.4, 5.5]

spec.md section: E6

In `services/leverage.py` / `api/v1/priority.py`, ensure a `blocked_external`
open leaf is absent from `/priority` (not actionable) yet still contributes to
an upstream item's downstream/score. Covers all 2 acceptance tests from E6
(`V1` blocked leaf absent; `W2` blocked but still downstream of `W1` =>
`score(W1)=16`, actionable set exactly `{W1}`).

- [ ] implemented
- [ ] reviewed

For parallel batch items, use separate subagents per item.
Launch review subagents using the `nextjs-fastapi-reviewer` skill
(review all items in the batch together in a single review
pass).
