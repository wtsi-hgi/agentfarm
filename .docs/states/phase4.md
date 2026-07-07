# Phase 4: Contracts

Ref: [spec.md](spec.md) sections F1

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

## Items

Single-item phase. Gate for all frontend work; depends on phases 1-3.

### Item 4.1: F1 - Zod schemas mirror the new backend models

spec.md section: F1

In `frontend/lib/contracts.ts`: narrow `stateSchema` (drop
`feedback`/`respond`, add `defining`); add `ballSchema` and `statusSchema`;
update `itemSchema` (drop `blocked_external`, add `ball`, `ball_changed_at`,
four ship booleans); add `status`/`resume`/`rollup` to `treeItemSchema`
(with `rollupSchema`); add the `itemActivitySchema` discriminated union. In
`frontend/app/actions.ts`, update `PatchItemInput` (drop `blocked_external`,
add `ball` and the four ship booleans). Covering all 5 acceptance tests
from F1 (tests in `tests/contracts.test.ts`).

- [ ] implemented
- [ ] reviewed
