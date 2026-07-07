# Phase 7: Frontend row controls + editors + panel

Ref: [spec.md](spec.md) sections J2, J3, J4, K1, K2, K3, K4

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

## Items

Depends on phases 5-6. Work splits across four files: `outliner-row.tsx`
(J2 -> J3 -> K1, sequential), `comments-panel.tsx` (K2 -> K4, sequential),
`ui/date-input.tsx` (J4, new), and `outliner.tsx` (K3). J3 also depends on
the J4 date-input primitive. The batches below align these tracks.

### Batch 1 (parallel)

#### Item 7.1: J2 - One-key hand-off control [parallel with J4, K2, K3]

spec.md section: J2

In `frontend/components/outliner-row.tsx`, add a keyboard-focusable Ball
control on leaf rows (with accessible name including the current Ball, and
no control on containers) that calls `onChangeBall`; add
`ballHandoffKey(key)` to `frontend/lib/state-metadata.ts`. Covering all 4
acceptance tests from J2 (tests in `tests/outliner.test.ts`,
`tests/state-metadata.test.ts`).

- [x] implemented
- [x] reviewed

#### Item 7.2: J4 - Accessible date-input primitive [parallel with J2, K2, K3]

spec.md section: J4

Add `frontend/components/ui/date-input.tsx`: a controlled, accessible date
field (label/aria, ISO `yyyy-mm-dd` value, empty allowed) for reuse by the
hand-off editor (J3). Covering all 3 acceptance tests from J4 (tests in
`tests/date-input.test.ts`).

- [x] implemented
- [x] reviewed

#### Item 7.3: K2 - Ship-milestone checkboxes (leaf) and rollup (container) [parallel with J2, J4, K3]

spec.md section: K2

In `frontend/components/comments-panel.tsx`, add a leaf "Ship milestones"
section with four checkboxes bound to `patchItem` (never sending
`state`/`ball`), and a read-only `rollup.ship` summary for containers.
Covering all 3 acceptance tests from K2 (tests in
`tests/outliner-comments-live.test.ts`).

- [x] implemented
- [x] reviewed

#### Item 7.4: K3 - Un-done restore heuristic ignores ball-change entries [parallel with J2, J4, K2]

spec.md section: K3

In `frontend/components/outliner.tsx`, make `previousDoneStateFromActivity`
filter to `kind==='state-change'` entries before scanning for the pre-done
Phase, and have the un-done flow PATCH only `state` (the backend forces
`ball='you'`). Covering all 3 acceptance tests from K3 (tests in
`tests/outliner-newitem-live.test.ts`).

- [x] implemented
- [x] reviewed

### Batch 2 (parallel, after batch 1 is reviewed)

#### Item 7.5: J3 - Hand-off note/date popover editor [parallel with K4]

spec.md section: J3

In `frontend/components/outliner-row.tsx` (plus an editor component), add a
popover attached to the Ball control, surfaced when `ball==='person'`, that
captures `blocked_note` and `blocked_followup_date` together and PATCHes
them; each `person` hand-off starts empty. Covering all 3 acceptance tests
from J3 (tests in `tests/outliner.test.ts`). Builds on 7.1 (Ball control)
and 7.2 (date-input primitive).

- [x] implemented
- [x] reviewed

#### Item 7.6: K4 - Detail-panel timeline renders both activity kinds [parallel with J3]

spec.md section: K4

In `frontend/components/comments-panel.tsx`, render `state-change` entries
as `PHASE_LABELS[from] -> PHASE_LABELS[to]` and `ball-change` entries as
`BALL_LABELS[from] -> BALL_LABELS[to]`, each with actor and timestamp, in
the returned order. Covering all 3 acceptance tests from K4 (tests in
`tests/outliner-comments-live.test.ts`). Builds on 7.3 (same file).

- [x] implemented
- [x] reviewed

For parallel batch items, use separate subagents per item.
Launch review subagents using the `nextjs-fastapi-reviewer` skill
(review all items in the batch together in a single review
pass).

### Item 7.7: K1 - Done checkbox removed from containers; leaves keep it

spec.md section: K1

In `frontend/components/outliner-row.tsx`, gate the done checkbox (and the
already-hidden Phase select) to leaves so a container renders neither,
while leaves keep both and un-checking a done leaf restores a prior Phase
(K3). Covering all 3 acceptance tests from K1 (tests in
`tests/outliner.test.ts`). Same file as 7.1/7.5; implement after batch 2 is
reviewed.

- [x] implemented
- [x] reviewed
