# Phase 6: Outliner parsing (frontend)

Ref: [spec.md](spec.md) sections F1

## Instructions

Use the `orchestrator` skill to complete this phase, coordinating
subagents with the `nextjs-fastapi-implementor` and
`nextjs-fastapi-reviewer` skills.

Pure-frontend inline token parser. Depends only on the enum definitions from
Phase 1, so per the spec's Implementation Order it can run in parallel with
Phases 4-5.

## Items

### Item 6.1: F1 - Parse inline tokens from a row

spec.md section: F1

Implement `lib/outliner-parse.ts` `parseRow(text)` extracting, in any order and
case-insensitively, `@mode`, `!effort`, `::state`, and repeatable
`>needs:slug`, returning the remaining text as the title (`#product` is not a
token; unrecognised enum value -> parse error). Returns the `ParsedRow` /
`ParseResult` types from the spec. Covers all 6 acceptance tests from F1 (full
token row; case-insensitive match; repeated needs; bad enum error; `#` left in
title; plain title with no tokens).

- [ ] implemented
- [ ] reviewed
