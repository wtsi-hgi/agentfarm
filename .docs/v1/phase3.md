# Phase 3: Tree structure + dependency inheritance

Ref: [spec.md](spec.md) sections C1, C2, C3, B1, B2, F2, F3, G1, G2, G3

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

Sibling independence by default, section dependency inheritance for
actionability, leaf/container transitions, keyboard structure ops,
identity-preserving edits, and move/merge/split. Depends on Phase 2. Item 3.1
removes the old order-derived dependency assumption; Item 3.2 adds the section
dependency semantics that later priority work relies on.

## Items

### Item 3.1: C1 - Siblings are independent by default

spec.md section: C1

Update `services/graph.py`, `services/leverage.py`, and `api/v1/items.py` so
tree structure does not generate dependency edges: root items and siblings
inside any subsection are independent by default. Covers both acceptance tests
from C1 (no dependency rows for A/B(B1,B2)/C; actionable leaves are
`{A,B1,B2,C}`).

- [x] implemented
- [x] reviewed

### Batch 1 (parallel, after Item 3.1 is reviewed)

#### Item 3.2: C2 - Section dependencies gate descendants [parallel with 3.3, 3.4, 3.5, 3.6, 3.7]

spec.md section: C2

In `services/leverage.py` / `services/tree.py`, make dependencies attached to a
container/root section apply to all descendant leaves, and make dependencies on
a container target wait for that whole container to complete. Covers all 3
acceptance tests from C2 (section edge `B->A` gates `B1/B2`; `A` done unblocks
them; `C->B` waits for both `B1` and `B2`).

- [x] implemented
- [x] reviewed

#### Item 3.3: B1 - Container retains but ignores mode/effort [parallel with 3.2, 3.4, 3.5, 3.6, 3.7]

spec.md section: B1

In `services/tree.py` / `services/leverage.py`, treat an item with >=1 child as
a container: not actionable, excluded from any `Downstream(...)` set, but its
stored mode/effort are retained and reapply when it becomes a leaf again. Covers
all 2 acceptance tests from B1 (leaf gains child -> container; child deleted ->
leaf again with retained mode/effort).

- [x] implemented
- [x] reviewed

#### Item 3.4: B2 - Container completeness is derived [parallel with 3.2, 3.3, 3.5, 3.6, 3.7]

spec.md section: B2

In `services/tree.py`, derive container completeness: a container is complete
iff all children are complete (recursively); "complete" = state in
{done, abandoned}. Covers all 3 acceptance tests from B2 (mixed
done/in-progress not complete; done+abandoned complete; nested completeness
propagates up).

- [x] implemented
- [x] reviewed

#### Item 3.5: F2 - Keyboard structure operations [parallel with 3.2, 3.3, 3.4, 3.6, 3.7]

spec.md section: F2

Implement the backend ops behind Enter/Tab/Shift-Tab in `api/v1/items.py` /
`services/tree.py`: next-sibling create, POST `/items/{id}/indent`, POST
`/items/{id}/outdent`, with dependency edges unchanged unless explicit. Covers
all 3 acceptance tests from F2 (next-sibling create without dependency; indent
makes parent a container without dependency edge; outdent may revert parent to a
leaf without dependency edge).

- [x] implemented
- [x] reviewed

#### Item 3.6: C3 / F3 - Identity-preserving structural edits [parallel with 3.2, 3.3, 3.4, 3.5, 3.7]

spec.md sections: C3, F3

In `services/tree.py` / `services/graph.py`, ensure structural edits preserve
item id, explicit edges, and comments and do not generate dependency edges for
new sibling order. Covers C3 plus the F3 acceptance test.

- [x] implemented
- [x] reviewed

#### Item 3.7: G1, G2, G3 - Move / merge / split [parallel with 3.2, 3.3, 3.4, 3.5, 3.6]

spec.md sections: G1, G2, G3

Implement POST `/items/{id}/move` `{new_parent_id?, after_id?}` in
`api/v1/items.py` with `services/tree.py` / `services/graph.py`: reparent/
reorder including promote-to-root and cross-product moves, identity preserved,
explicit edges and comments retained, no order-derived dependency edge created,
and reject move into own descendant (422). Merge (G2) and split (G3) are
asserted via the move + delete + create primitives. Covers all acceptance tests
from G1 (3), G2 (1), and G3 (1).

- [x] implemented
- [x] reviewed

For parallel batch items, use separate subagents per item.
Launch review subagents using the `nextjs-fastapi-reviewer` skill
(review all items in the batch together in a single review
pass).
