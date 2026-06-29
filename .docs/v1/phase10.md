# Phase 10: Markdown mirror

Ref: [spec.md](spec.md) sections L1, L2

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

Render the tree as a nested markdown checklist and commit it to a dedicated git
repo, skipping unchanged renders. Depends on Phase 3 for the tree/edges and
ordering. Items are sequential: L2's commit logic consumes L1's renderer.

## Items

### Item 10.1: L1 - Render tree as nested checklist

spec.md section: L1

Implement `services/mirror.py` `render_tree(items)` producing a nested markdown
checklist in tree order: two spaces of indent per depth, `- [x]`/`- [ ]` per
completeness, explicit `>needs:` shown as a `(needs: slug, ...)` suffix using
current slugs, comments excluded. Covers all 3 acceptance tests from L1 (exact
nested output for the A/B(B1,B2)/C outline; needs suffix; no comment text).

- [ ] implemented
- [ ] reviewed

### Item 10.2: L2 - Commit to dedicated git repo, skip unchanged

spec.md section: L2

In `services/mirror.py`, on every mutating change render the tree and commit to
a git repo initialised inside the data dir (not the app repo), skipping the
commit when output is byte-identical to the last commit; one-way (no re-import).
Covers all 4 acceptance tests from L2 (first commit created under data dir;
no-op render skips commit; title edit creates a new commit with updated content;
slug-change render churns the committed `needs:` label).

- [ ] implemented
- [ ] reviewed
