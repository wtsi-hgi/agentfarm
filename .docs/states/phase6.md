# Phase 6: Frontend views + manager

Ref: [spec.md](spec.md) sections H1, H2, H3, I1, L1

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

## Items

Depends on phase 5. H1 (`components/view-controls.tsx`) and L1
(test-only, against the phase-2 backend derivation and phase-5 labels)
touch disjoint files and run in parallel. H2, H3, and I1 all edit
`components/outliner.tsx` (I1 also `view-controls.tsx`), so they run
sequentially after batch 1.

### Batch 1 (parallel)

#### Item 6.1: H1 - Add the Monitoring view toggle [parallel with L1]

spec.md section: H1

Add `'monitoring'` to `OUTLINER_VIEWS` in
`frontend/components/view-controls.tsx` with a `Monitoring` label, an
aria-label, and a distinct icon, following the existing toggle pattern.
Covering all 2 acceptance tests from H1 (tests in
`tests/view-controls.test.ts`).

- [x] implemented
- [x] reviewed

#### Item 6.2: L1 - Each workflow row maps to one (Phase, Ball) -> status cell [parallel with H1]

spec.md section: L1

Encode the sec.13 workflow table as tests at the authoritative backend
`GET /tree` boundary (`services/leverage.py` status/resume, in
`tests/test_priority.py`) and at the frontend manager label
(`MANAGER_STATUS_LABELS` in `lib/state-metadata.ts`, in
`tests/state-metadata.test.ts`). Covering all 13 acceptance tests from L1;
asserts behaviour already built in phase 2 (status) and phase 5 (labels).

- [x] implemented
- [x] reviewed

For parallel batch items, use separate subagents per item.
Launch review subagents using the `nextjs-fastapi-reviewer` skill
(review all items in the batch together in a single review
pass).

### Item 6.3: H2 - View membership and ordering

spec.md section: H2

In `frontend/components/outliner.tsx`, make Up Next = `ready`, Follow Up =
`waiting` (open), Monitoring = `monitoring` (open), and keep `blocked` in
Tree only; add pure ordering helpers `compareFollowUp` and
`compareMonitoring` in `frontend/lib/state-metadata.ts` and remove the
`respond` user-action tier from
`localPriorityItems`/`compareLocalPriorityEntries`. Covering all 7
acceptance tests from H2 (tests in `tests/outliner.test.ts`,
`tests/state-metadata.test.ts`). Runs after batch 1.

- [x] implemented
- [x] reviewed

### Item 6.4: H3 - Optimistic re-projection on hand-off

spec.md section: H3

In `frontend/components/outliner.tsx`, make the optimistic status after
`patchItem({ball})` use `statusAfterBallChange` so a `you->agent` flip
leaves Up Next and joins Monitoring before the next refresh, and treat a
`ball` change as membership-affecting in `patchAffectsPriorityMembership`.
Covering all 3 acceptance tests from H3 (tests in
`tests/outliner-actions.test.ts`). Builds on 6.3.

- [x] implemented
- [x] reviewed

### Item 6.5: I1 - Manager surface with coarse status, Phase, and roll-ups

spec.md section: I1

Add a fifth `'manager'` view (`OUTLINER_VIEWS`/`OutlinerView` in
`components/view-controls.tsx`) and a manager projection component rendered
from `frontend/components/outliner.tsx`: per open leaf the
`MANAGER_STATUS_LABELS[status]` plus Phase label; per container the
`rollup.status_counts`, `rollup.ship`, and `rollup.phase`; available to
both `owner` and `viewer` without removing existing toggles. Covering all 6
acceptance tests from I1 (tests in `tests/outliner.test.ts`). Builds on
6.1, 6.3.

- [x] implemented
- [x] reviewed
