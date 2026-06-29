# Phase 11: Unified view (frontend)

Ref: [spec.md](spec.md) sections H1, H2, H3, H4, H5

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

The unified outliner view and work-now projection: GET `/tree` flags, Server
Actions, middleware, outliner + DnD components, view controls, new-item
visibility, and the product switcher. Depends on Phases 2, 3, 5, and 9 and the
contracts they define. Item 11.1 adds the backend `/tree` flags and the
`treeSchema` the components consume; the frontend stories then proceed as a
parallel batch across separate files.

## Items

### Item 11.1: H1 - Collapse not remove

spec.md section: H1

Add per-item `actionable: bool` and `complete: bool` flags to GET `/tree` in
`api/v1/items.py` (every item present, none omitted) and the work-now collapse
behaviour in `components/outliner.tsx`, with the Zod `treeSchema` parsing the
payload. Covers all 2 acceptance tests from H1 (flags for the A/B(B1,B2)/C
outline with all present; `treeSchema` parses and a payload missing
`actionable` fails safeParse).

- [ ] implemented
- [ ] reviewed

### Batch 1 (parallel, after Item 11.1 is reviewed)

#### Item 11.2: H2 - Mode colour and mode toggles [parallel with 11.3, 11.4, 11.5]

spec.md section: H2

In `components/view-controls.tsx` / `components/outliner-row.tsx`, define a
fixed mode-to-colour map (one distinct colour per Mode value) and display-only
mode toggles that filter the tree (all show when none selected). Covers all 2
acceptance tests from H2 (5 distinct colour entries, defined token per Mode;
review-only toggle shows only review items, none shows both).

- [ ] implemented
- [ ] reviewed

#### Item 11.3: H3 - Leverage sort is display-only [parallel with 11.2, 11.4, 11.5]

spec.md section: H3

Wire GET `/priority` ordering into `components/outliner.tsx` as a display-only
leverage sort that leaves stored `sort_order` and dependency edges unchanged
(`api/v1/priority.py` already exists from Phase 5). Covers the 1 acceptance test
from H3 (priority order `[A1,B1,G1]` while a later GET `/tree` keeps original
stored order).

- [ ] implemented
- [ ] reviewed

#### Item 11.4: H4 - New item stays visible until refresh [parallel with 11.2, 11.3, 11.5]

spec.md section: H4

In `components/outliner.tsx`, keep a just-created item that the active filter
would hide visible with an "added this session, currently filtered out"
affordance until the view is refreshed/re-filtered. Covers all 2 acceptance
tests from H4 (new non-actionable item stays visible with the affordance;
refresh then hides it).

- [ ] implemented
- [ ] reviewed

#### Item 11.5: H5 - Product switcher / quick jump [parallel with 11.2, 11.3, 11.4]

spec.md section: H5

Implement `components/product-switcher.tsx` (with `components/outliner.tsx`): a
display-only jump control listing every product root plus arbitrary-node
search; selecting focuses and scrolls the target into view, expanding collapsed
ancestors, mutating nothing. Covers all 3 acceptance tests from H5 (option list
is exactly the roots; selecting a product focuses/scrolls it with no storage
change; arbitrary nested target is focused with ancestors expanded).

- [ ] implemented
- [ ] reviewed

The Server Actions (`app/actions.ts`) and `middleware.ts` wiring noted in the
spec's Implementation Order for this phase support the items above (Server
Actions back every mutation invoked from these components; `middleware.ts` is
delivered in Item 9.3) and are implemented alongside the items that use them,
not as separate items.

For parallel batch items, use separate subagents per item.
Launch review subagents using the `nextjs-fastapi-reviewer` skill
(review all items in the batch together in a single review
pass).
