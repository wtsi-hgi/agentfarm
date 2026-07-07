# Phase 2: Backend derivations

Ref: [spec.md](spec.md) sections B1, B2, B3, B4, B5

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

## Items

Items are sequential: all edit `services/leverage.py` (the
`LeverageProjection`), with 2.1/2.2/2.5 also wiring `TreeItemOut` in
`api/v1/items.py` and `api/v1/home.py`, so they cannot run in parallel.
Depends on phase 1.

### Item 2.1: B1 - Derived status precedence

spec.md section: B1

Compute the seven-value `status` per item in `LeverageProjection`
(`services/leverage.py`) with the fixed precedence (container rollup ->
done -> dropped -> blocked -> monitoring -> waiting -> ready), reusing
`dependency_targets_by_id` and `complete_by_id`. Expose `status` on tree
and home rows (`api/v1/items.py`, `api/v1/home.py`). Covering all 8
acceptance tests from B1 (tests in `tests/test_priority.py`).

- [ ] implemented
- [ ] reviewed

### Item 2.2: B2 - Ready fresh-vs-resume predicate

spec.md section: B2

Compute `resume` (true iff `state != not-started` OR `has_notes` OR
`has_prompt_response_entries`) in `LeverageProjection` and expose it on
every tree row; ensure `home.py`'s `_row_to_home_tree_item` populates it
too. Covering all 4 acceptance tests from B2 (tests in
`tests/test_priority.py`). Builds on 2.1.

- [ ] implemented
- [ ] reviewed

### Item 2.3: B3 - Actionability redefined; special-case sets and respond boost removed

spec.md section: B3

Redefine `actionable` in `services/leverage.py` so `actionable(leaf) ==
leaf and not complete and deps satisfied and ball == you` (equivalently
`actionable <=> status == "ready"`); `agent`/`person` leaves are excluded
from actionability but still count in `Downstream(...)`. Remove the
`respond` priority boost. Covering all 4 acceptance tests from B3 (tests in
`tests/test_priority.py`). Builds on 2.1.

- [ ] implemented
- [ ] reviewed

### Item 2.4: B4 - Leverage score and ordering preserved exactly

spec.md section: B4

Keep the `Downstream(L)` / `score(L)` leverage formula and tie-break
ordering unchanged in `services/leverage.py`; only the actionability gate
(B3) feeding the ordering changes. Covering all 3 acceptance tests from B4
(tests in `tests/test_priority.py`). Builds on 2.3.

- [ ] implemented
- [ ] reviewed

### Item 2.5: B5 - Container roll-ups (manager data)

spec.md section: B5

Compute `rollup` (`RollupOut` with `status_counts`, `ship`, and
least-advanced `phase`) over all descendant leaves for each container in
`LeverageProjection`; leaves get `rollup == null`. Expose on tree and home
rows (`api/v1/items.py`, `api/v1/home.py`), ensuring
`_row_to_home_tree_item` populates it. Covering all 6 acceptance tests from
B5 (tests in `tests/test_priority.py`). Builds on 2.1.

- [ ] implemented
- [ ] reviewed
