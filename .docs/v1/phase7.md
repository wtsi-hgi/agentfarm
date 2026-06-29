# Phase 7: Comments

Ref: [spec.md](spec.md) sections J1

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

Flat comments per item with author rules. Depends on Phase 2. Parallelisable
with Phase 8 per the spec's Implementation Order.

## Items

### Item 7.1: J1 - Owner and viewers comment; authors edit/delete own only

spec.md section: J1

Implement comment endpoints in `api/v1/comments.py`: POST
`/items/{id}/comments` (owner or viewer), PATCH `/comments/{id}` and DELETE
`/comments/{id}` (own comment only; even the owner cannot modify a viewer's
comment -> 403 `"cannot modify another user's comment"`), and GET
`/items/{id}/comments` (flat, `created_at` ascending). Establishes the
`CommentOut` model. Comments are excluded from the markdown mirror. Covers all
5 acceptance tests from J1 (viewer adds and it lists; owner cannot edit a
viewer's comment; author edits own; author deletes own; list ordered by
created_at asc).

- [ ] implemented
- [ ] reviewed
