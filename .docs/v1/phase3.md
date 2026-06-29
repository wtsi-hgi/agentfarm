# Phase 3: Tree structure + implicit edges + cycle check

Ref: [spec.md](spec.md) sections C1, C2, B1, B2, F2, F3, G1, G2, G3

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

Implicit-edge generation and regeneration, cycle-rejection scaffolding
(self-edge and implicit-vs-explicit cases), leaf/container transitions,
keyboard structure ops, identity-preserving edits, and move/merge/split.
Depends on Phase 2. The implicit-edge engine (Item 3.1) is the foundation other
items in this phase rely on, so it lands first; the remaining structural
behaviours then proceed as a parallel batch.

## Items

### Item 3.1: C1 - Implicit edges from tree structure

spec.md section: C1

Implement implicit-edge generation in `services/graph.py` and wire it into
`api/v1/items.py`: sibling-chain edges, sub-section entry edge, container
completeness via next-sibling edge, all `kind='implicit'`. Also implement the
cycle-rejection scaffolding (reject self-edge and an implicit edge that would
contradict an explicit chain) used by later edge work. Covers all 5 acceptance
tests from C1 (exact edge set for the A/B(B1,B2)/C outline and the readiness
progression as items complete).

- [ ] implemented
- [ ] reviewed

### Batch 1 (parallel, after Item 3.1 is reviewed)

#### Item 3.2: C2 - Implicit edges regenerate on structural change [parallel with 3.3, 3.4, 3.5, 3.6, 3.7]

spec.md section: C2

In `services/graph.py` / `api/v1/items.py`, regenerate implicit edges for the
affected sibling groups on reorder and outdent, deleting only the group's
implicit edges before re-deriving. Covers all 2 acceptance tests from C2
(reorder `[a,b,c]`->`[a,c,b]` gives `{c->a,b->c}`; outdenting `B1` rewires
entry edges and `C->B1`).

- [ ] implemented
- [ ] reviewed

#### Item 3.3: B1 - Container retains but ignores mode/effort [parallel with 3.2, 3.4, 3.5, 3.6, 3.7]

spec.md section: B1

In `services/tree.py` / `services/leverage.py`, treat an item with >=1 child as
a container: not actionable, excluded from any `Downstream(...)` set, but its
stored mode/effort are retained and reapply when it becomes a leaf again. Covers
all 2 acceptance tests from B1 (leaf gains child -> container; child deleted ->
leaf again with retained mode/effort).

- [ ] implemented
- [ ] reviewed

#### Item 3.4: B2 - Container completeness is derived [parallel with 3.2, 3.3, 3.5, 3.6, 3.7]

spec.md section: B2

In `services/tree.py`, derive container completeness: a container is complete
iff all children are complete (recursively); "complete" = state in
{done, abandoned}. Covers all 3 acceptance tests from B2 (mixed
done/in-progress not complete; done+abandoned complete; nested completeness
propagates up).

- [ ] implemented
- [ ] reviewed

#### Item 3.5: F2 - Keyboard structure operations [parallel with 3.2, 3.3, 3.4, 3.6, 3.7]

spec.md section: F2

Implement the backend ops behind Enter/Tab/Shift-Tab in `api/v1/items.py` /
`services/tree.py`: next-sibling create, POST `/items/{id}/indent`, POST
`/items/{id}/outdent`, with implicit edges following each op. Covers all 3
acceptance tests from F2 (next-sibling create edge; indent makes parent a
container with no inner predecessor; outdent rewires and may revert parent to a
leaf).

- [ ] implemented
- [ ] reviewed

#### Item 3.6: F3 - Identity-preserving structural edits [parallel with 3.2, 3.3, 3.4, 3.5, 3.7]

spec.md section: F3

In `services/tree.py` / `services/graph.py`, ensure indent-then-outdent
preserves item id, explicit edges, and comments while regenerating affected
implicit edges. Covers the 1 acceptance test from F3.

- [ ] implemented
- [ ] reviewed

#### Item 3.7: G1, G2, G3 - Move / merge / split [parallel with 3.2, 3.3, 3.4, 3.5, 3.6]

spec.md sections: G1, G2, G3

Implement POST `/items/{id}/move` `{new_parent_id?, after_id?}` in
`api/v1/items.py` with `services/tree.py` / `services/graph.py`: reparent/
reorder including promote-to-root and cross-product moves, identity preserved,
implicit edges regenerated for both source and destination groups, explicit
edges and comments retained, reject move into own descendant (422) or cycle
(409). Merge (G2) and split (G3) are asserted via the move + delete + create
primitives. Covers all acceptance tests from G1 (3), G2 (1), and G3 (1).

- [ ] implemented
- [ ] reviewed

For parallel batch items, use separate subagents per item.
Launch review subagents using the `nextjs-fastapi-reviewer` skill
(review all items in the batch together in a single review
pass).
