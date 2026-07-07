# Phase 5: Frontend derivation + chip + tokens

Ref: [spec.md](spec.md) sections G1, G2, J1

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

## Items

Depends on phase 4. G1 (`lib/state-metadata.ts`) and J1
(`lib/outliner-parse.ts` / `lib/outliner-mutations.ts`) touch disjoint
files and run in parallel; G2 edits `components/outliner-row.tsx` and
consumes G1's labels/`isResume`, so it follows batch 1.

### Batch 1 (parallel)

#### Item 5.1: G1 - Shared status derivation and labels [parallel with J1]

spec.md section: G1

In `frontend/lib/state-metadata.ts`: add the `ItemStatus` type,
`PHASE_LABELS`/`PHASE_OPTIONS` (nine Phases), `BALL_LABELS`/`BALL_OPTIONS`,
`MANAGER_STATUS_LABELS`, `isResume`, and `statusAfterBallChange`; remove
the obsolete `EXTERNAL_WAITING_STATES`, `isExternalWaitingItem`,
`itemReadiness`, `ItemReadiness`. Covering all 5 acceptance tests from G1
(tests in `tests/state-metadata.test.ts`).

- [ ] implemented
- [ ] reviewed

#### Item 5.2: J1 - Ball inline token [parallel with G1]

spec.md section: J1

Add the `~you`/`~agent`/`~person` Ball token (case-insensitive, validated
against `ballSchema`) to `parseRow` in `frontend/lib/outliner-parse.ts`,
adding `ball?: Ball` to `ParsedRow`; have `submitRowText` in
`frontend/lib/outliner-mutations.ts` add `ball` to the PATCH when parsed
and changed. Existing `@mode`/`!effort`/`::state`/`>needs:` behaviour
unchanged. Covering all 5 acceptance tests from J1 (tests in
`tests/outliner-parse.test.ts`, `tests/outliner-actions.test.ts`).

- [ ] implemented
- [ ] reviewed

For parallel batch items, use separate subagents per item.
Launch review subagents using the `nextjs-fastapi-reviewer` skill
(review all items in the batch together in a single review
pass).

### Item 5.3: G2 - Readiness chip renders status with fresh/resume sub-label

spec.md section: G2

In `frontend/components/outliner-row.tsx`, render the item's `status` label
(Ready/Monitoring/Waiting/Blocked/Done/Dropped) in the row chip, with a
resume affordance shown only when `status == ready && item.resume`, and
keep visual muting for terminal/monitoring/waiting rows. Covering all 4
acceptance tests from G2 (tests in `tests/outliner.test.ts`). Builds on
G1 (5.1); implement after batch 1 is reviewed.

- [ ] implemented
- [ ] reviewed
