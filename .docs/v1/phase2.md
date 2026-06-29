# Phase 2: Items CRUD + slug

Ref: [spec.md](spec.md) sections A1, A2, A3, A4

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

Backend item create/edit/delete and slug derivation/re-derivation. Establishes
`ItemOut` and the Zod `itemSchema`. Depends on Phase 1. Items here are
sequential because A2/A3/A4 build on the create endpoint and `ItemOut` shape
established by A1.

## Items

### Item 2.1: A1 - Create item with defaults

spec.md section: A1

Implement POST `/items` in `api/v1/items.py` with `services/tree.py` and
`db/connection.py`. Server sets id (UUIDv4), derives slug, computes
`sort_order`, sets `created_by`/`updated_by`, sets timestamps, applies
defaults. Establishes `ItemCreate`/`ItemOut` Pydantic models and Zod
`itemSchema`. Creating an item does not create dependency edges. Covers all 6
acceptance tests from A1 (defaults, slug collision, slugify rules,
empty-slug fallback, bad-enum 422, child sort without dependency edge).

- [x] implemented
- [x] reviewed

### Item 2.2: A2 - Edit item fields and timestamp/slug behaviour

spec.md section: A2

Implement PATCH `/items/{id}` in `api/v1/items.py` accepting any subset of
`{title, state, mode, effort, blocked_external, blocked_note,
blocked_followup_date}`. Update `updated_at`/`updated_by`; on title change
re-derive slug; on state change set `state_changed_at` and set/clear
`completed_at` for done/abandoned. Editing must not change id, parent, order,
edges, or comments. Covers all 5 acceptance tests from A2.

- [x] implemented
- [x] reviewed

### Item 2.3: A3 - Slug re-derivation preserves id-based edges

spec.md section: A3

Implement slug re-derivation on rename in `services/tree.py` /
`api/v1/items.py` so stored edges (by id) are unchanged while displayed
`>needs:` labels update to current slugs. Covers all 3 acceptance tests from
A3 (rename keeps edge id/to_id and updates needs label; rename to colliding
slug yields `-2`; double-rename resolves throughout).

- [x] implemented
- [x] reviewed

### Item 2.4: A4 - Delete item with subtree cascade and dependency cleanup

spec.md section: A4

Implement DELETE `/items/{id}` in `api/v1/items.py` with `services/graph.py`,
removing the item and (via cascade) descendants, comments, runs, and incident
edges; keep remaining sibling order without creating a replacement dependency
edge. Covers all 2 acceptance tests from A4 (dependency cleanup/no replacement
edge; container delete cascades to children and their comments).

- [x] implemented
- [x] reviewed
