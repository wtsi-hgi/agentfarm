# AgentFarm v1 Specification

## Overview

AgentFarm is a near-zero-friction internal web app to capture, organise, and
share software development work across many products at the speed of editing a
markdown checklist, plus a computed view of what to work on next. The primary
user is a developer orchestrating many LLM agents at high velocity; a manager
and named team members get live read-and-comment access on the internal
network. The database is the source of truth; a one-way git-tracked markdown
mirror makes the tree shareable and diffable.

Everything is an item in a single unbounded tree. Root items are products; any
item may have nested children. A leaf (no children) is directly actionable; a
container (>=1 child) is structural. Sibling order is organisational only:
root items and subsection siblings are independent by default. Sequencing comes
from explicit `>needs:` edges, which may be attached to leaves or to whole
sections/containers; the dependency graph is always acyclic. An unblock-leverage
priority engine ranks actionable leaves so cheap work that unblocks large
downstream work surfaces first. The single primary surface is a keyboard
outliner with inline tokens; "work now" is a projection (collapse, colour, mode
toggles, leverage sort, time markers) of the same editable tree.

This spec covers the full stack: FastAPI + SQLite backend, Next.js Server-
Action BFF, Zod contracts, LDAP auth with owner/viewer roles, self-signed TLS,
sessions, the markdown/git mirror, storage/config, and stubbed v2 seams (runs
table + 501 spawn/stream boundary). It is built by wholesale-copying the
wtsi-hgi/llm-knowledge-base scaffold (excluding skills) and extending it.

## Architecture

### Packages and layout

Built on the copied scaffold. New and changed files only are listed; existing
scaffold files (lifespan `main.py`, `config.py` pattern, `api/__init__.py`,
`backend-client.ts`, contract test harness) are reused.

Backend (`backend/`, Python 3.11+, FastAPI + Uvicorn + Pydantic):

    backend/
      config.py                  # extend Settings (N1 env vars)
      main.py                    # extend lifespan: init DB, mirror, TLS, owner
      db/
        __init__.py
        connection.py            # SQLite connect, pragmas, session factory
        schema.sql               # DDL (see SQLite schema)
        migrate.py               # apply schema.sql idempotently at startup
      models/
        __init__.py
        enums.py                 # State, Mode, Effort enums + weights
        item.py                  # Item dataclass/row mapping
      api/
        schemas.py               # extend: Pydantic request/response models
        v1/
          items.py              # item CRUD + structure + tree read
          dependencies.py        # explicit edge add/remove
          priority.py            # actionable + leverage ordering endpoint
          comments.py            # comment CRUD
          markers.py             # time markers + since/between queries
          auth.py                # LDAP login, whoami
          runs.py                # v2 seam: runs table CRUD-lite
          spawn.py               # v2 seam: 501 spawn/stream boundary
      services/
        __init__.py
        tree.py                  # tree ops, slug derivation, reparent/move
        graph.py                 # dependency graph helpers, cycle check
        leverage.py              # unblock-leverage scoring + ordering
        mirror.py                # render markdown + git commit
        auth_ldap.py             # ldap3 direct-bind, whitelist, roles
        tls.py                   # self-signed cert generation
      tests/
        test_items.py
        test_dependencies.py
        test_priority.py
        test_comments.py
        test_markers.py
        test_auth.py
        test_mirror.py
        test_runs_spawn.py

Frontend (`frontend/`, Next.js 16 App Router + React 19 + shadcn/ui +
Tailwind v4, TypeScript):

    frontend/
      lib/
        backend-client.ts        # reuse; relax TLS for self-signed (below)
        contracts.ts             # extend: Zod schemas mirroring Pydantic
        session.ts               # httpOnly cookie read/write helpers
        outliner-parse.ts        # parse inline tokens from a row string
        leverage-state.ts        # typed action state for mutations
      app/
        actions.ts               # Server Actions -> FastAPI (all mutations)
        page.tsx                 # the unified outliner view (server shell)
        login/page.tsx           # LDAP login form
        api/health/route.ts      # reuse (external monitor only)
      middleware.ts              # enforce auth; redirect to /login
      components/
        outliner.tsx             # client: keyboard outliner + DnD
        outliner-row.tsx         # client: one identity-bound row
        view-controls.tsx        # mode toggles, leverage sort, marker filter
        product-switcher.tsx     # client: quick jump to product/any node
        comments-panel.tsx       # client: flat comments per item
      tests/
        contracts.test.ts        # extend: parse/safeParse new schemas
        outliner-parse.test.ts   # token parsing unit tests

### SQLite schema

Source of truth. `db/schema.sql`, applied idempotently at startup. All ids are
text UUIDv4. Timestamps are ISO-8601 UTC strings (`YYYY-MM-DDTHH:MM:SS.ffffffZ`)
so lexical sort equals chronological sort. Booleans are integers 0/1.

    CREATE TABLE IF NOT EXISTS items (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      slug            TEXT NOT NULL UNIQUE,
      parent_id       TEXT REFERENCES items(id) ON DELETE CASCADE,
      sort_order      REAL NOT NULL,          -- order among siblings
      state           TEXT NOT NULL DEFAULT 'not-started',
      mode            TEXT NOT NULL DEFAULT 'prompt-agent',
      effort          TEXT NOT NULL DEFAULT 'medium',
      blocked_external      INTEGER NOT NULL DEFAULT 0,
      blocked_note          TEXT,
      blocked_followup_date TEXT,             -- ISO date or NULL
      created_by      TEXT NOT NULL,
      updated_by      TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      state_changed_at TEXT NOT NULL,
      completed_at    TEXT                    -- set when state done/abandoned
    );

    CREATE TABLE IF NOT EXISTS dependencies (
      id          TEXT PRIMARY KEY,
      from_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      to_id       TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,              -- 'explicit' in v1
      UNIQUE (from_id, to_id)
    );  -- edge means: from_id depends on (needs) to_id

    CREATE TABLE IF NOT EXISTS comments (
      id          TEXT PRIMARY KEY,
      item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      author      TEXT NOT NULL,
      body        TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS markers (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      at          TEXT NOT NULL,              -- the named point in time
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (         -- v2 seam, unused in v1 logic
      id          TEXT PRIMARY KEY,
      item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  TEXT NOT NULL
    );

`UNIQUE (from_id, to_id)` prevents duplicate edges regardless of kind. A
self-edge (from_id == to_id) is rejected by the cycle check, not the schema.

### Enums and weights (`models/enums.py`)

Closed sets; values stored as the exact lowercase strings below.

    State  = not-started | spec | implement | review | merged | released
             | done | abandoned        # default not-started
    Mode   = prompt-agent | review | merge | release | spec  # default
             prompt-agent
    Effort = quick | medium | long       # default medium

    EFFORT_WEIGHT = {quick: 1, medium: 3, long: 8}
    MODE_WEIGHT(mode) = 2 if mode == prompt-agent else 1

"Complete" = state in {done, abandoned}. A container is complete iff all its
children are complete (recursively).

### Core domain rules (shared by stories)

Slug derivation (`services/tree.py`):

- Slugify title: lowercase; trim; replace each run of non-`[a-z0-9]` with `-`;
  strip leading/trailing `-`. Empty result becomes `item`.
- Uniqueness: if the candidate collides with another item's slug, append
  `-2`, `-3`, ... (first free integer >= 2). The item keeping a bare slug is
  the one that owned it first; a re-deriving item yields to existing slugs.
- Re-derive on every title change. Slugs are display/typing only; never stored
  as a reference (edges store ids).

Dependencies (`services/graph.py`, `services/leverage.py`):

- Sibling order is organisational only. Creating, moving, indenting, outdenting,
  reordering, or deleting items never creates dependency edges between siblings.
- Dependencies are explicit `>needs:` edges stored in `dependencies` with
  `kind='explicit'`. Edges store ids, not slugs.
- An edge may originate from a leaf or from a container/root section. A
  dependency attached to a container applies to every descendant leaf of that
  container.
- A dependency target may itself be a container. Such a dependency is satisfied
  only when that whole container is complete recursively.
- Structural edits preserve explicit dependency edges and comments because they
  are stored by item id.

Cycle rejection: before inserting any edge, check that `to_id` cannot already
reach `from_id` over the dependency graph. If it can, or `from_id == to_id`,
reject with HTTP 409 and body `{"detail": "dependency cycle rejected"}`.

Actionable leaf: leaf (no children) AND not complete AND `blocked_external`
false AND every dependency target on that leaf or on any ancestor section is
complete. Containers are never actionable.

Unblock-leverage (`services/leverage.py`):

- `Downstream(L)` = every open leaf (not complete AND not a container) whose
  own dependencies or ancestor-section dependencies depend on L directly or
  transitively. Note `blocked_external` does NOT exclude a leaf from any
  `Downstream(...)` set: a `blocked_external` leaf is itself NOT actionable
  (absent from `/priority`) yet STILL counts as a downstream open leaf
  contributing to an upstream item's score. Actionability (excludes
  `blocked_external`) and downstream membership (keys only on not-complete and
  not-container) are deliberately distinct.
- `score(L) = (sum over D in Downstream(L) of EFFORT_WEIGHT[D.effort] *
  MODE_WEIGHT(D.mode)) / EFFORT_WEIGHT[L.effort]`.
- Ordering: score descending. Tie-break: `updated_at` desc, then `created_at`
  desc, then `id` ascending. Numeric score is never exposed in any response;
  only ordering (a `rank` integer and/or array order) is returned.

### API surface (FastAPI, under `/api/v1`)

All endpoints declare `response_model` and return Pydantic models. Mutations
require owner role (enforced at Next.js middleware + re-checked server-side).

    POST   /items                 create item (parent_id?, after_id?, fields)
    PATCH  /items/{id}            edit title/state/mode/effort/blocked_*
    DELETE /items/{id}            delete item (subtree cascade)
    POST   /items/{id}/move       reparent/reorder (new_parent_id?, after_id?)
    POST   /items/{id}/indent     make first child of preceding sibling
    POST   /items/{id}/outdent    move up one level
    GET    /tree                  full tree (items + edges) in tree order
    POST   /dependencies          add explicit edge {from_id,to_id|needs_slug}
    DELETE /dependencies/{id}     remove explicit edge
    GET    /priority              actionable leaves in leverage order
    POST   /items/{id}/comments   add comment (owner or viewer)
    PATCH  /comments/{id}         edit own comment
    DELETE /comments/{id}         delete own comment
    GET    /items/{id}/comments   list comments (flat, created_at asc)
    POST   /markers               create marker {name, at?}
    GET    /markers               list markers
    GET    /changes               items since/between markers (query params)
    POST   /auth/login            LDAP bind; returns identity + role
    GET    /auth/whoami           current identity + role
    POST   /items/{id}/runs       v2 seam: create stub run row
    GET    /items/{id}/runs       v2 seam: list runs
    POST   /items/{id}/spawn      v2 seam: returns 501

### Error handling

- Validation / bad enum token: 422 with `{"detail": "<message>"}`.
- Cycle: 409 `{"detail": "dependency cycle rejected"}`.
- Unknown `>needs:` slug: 422 `{"detail": "unknown dependency: <slug>"}`.
- Auth failure (bad bind): 401 `{"detail": "authentication failed"}`.
- Not whitelisted and not owner: 403 `{"detail": "access denied"}`.
- Viewer attempting an item mutation: 403 `{"detail": "owner only"}`.
- Editing/deleting another user's comment: 403
  `{"detail": "cannot modify another user's comment"}`.
- Not found: 404 `{"detail": "<entity> not found"}`.
- Frontend: every FastAPI response validated by Zod via `backendJson()`;
  contract mismatch raises `BackendRequestError`. Server Actions catch and
  return typed state `{status:'error', error}`.

### TLS and self-signed handling

- Backend serves HTTPS; `AGENTFARM_TLS_CERT`/`AGENTFARM_TLS_KEY` give paths.
  If unset, `services/tls.py` generates a self-signed cert+key at startup
  under the data dir and uses them.
- `backend-client.ts` (`backendJson`) creates the fetch agent so internal
  Server-Action -> FastAPI calls accept the self-signed cert (verification
  relaxed for the internal backend origin only). Deployment docs note the
  browser warning must be accepted.

---

## A. Data model and items

### A1: Create item with defaults

As the owner, I want to create an item, so that work is captured instantly.

POST `/items` body `{title, parent_id?, after_id?, mode?, effort?, state?}`.
Server sets id (UUIDv4), derives slug, computes `sort_order` (after `after_id`
or appended at end of the sibling group), sets `created_by`/`updated_by` to the
authenticated owner, and all four timestamps to now. Defaults apply when fields
omitted. Creating an item does not create dependency edges.

**Package:** `backend/`
**File:** `api/v1/items.py`, `services/tree.py`, `db/connection.py`
**Test file:** `tests/test_items.py`

    class ItemCreate(BaseModel):
        title: str
        parent_id: str | None = None
        after_id: str | None = None
        mode: Mode = Mode.prompt_agent
        effort: Effort = Effort.medium
        state: State = State.not_started
    class ItemOut(BaseModel):
        id: str; title: str; slug: str; parent_id: str | None
        sort_order: float; state: State; mode: Mode; effort: Effort
        blocked_external: bool; blocked_note: str | None
        blocked_followup_date: str | None
        created_by: str; updated_by: str
        created_at: str; updated_at: str; state_changed_at: str
        completed_at: str | None

**Acceptance tests:**

1. Given an empty DB, when POST `/items` with `{"title":"Ship login"}`, then
   200 and body has `state=="not-started"`, `mode=="prompt-agent"`,
   `effort=="medium"`, `blocked_external==false`, `parent_id==null`,
   `slug=="ship-login"`, non-empty `id`, and `created_at==updated_at==
   state_changed_at`, `completed_at==null`.
2. Given an item with slug `ship-login`, when POST `/items`
   `{"title":"Ship login!"}`, then the new item's `slug=="ship-login-2"`.
3. Given title `"  C++  &  Rust  "`, when created, then `slug=="c-rust"`.
4. Given title `"***"`, when created, then `slug=="item"`.
5. Given POST `/items` with `{"title":"x","mode":"bogus"}`, then 422 with
   `detail` containing `mode`.
6. Given parent `P` with children `[c1]`, when POST `/items`
   `{"title":"c2","parent_id":"P"}`, then `c2.parent_id=="P"` and `c2` sorts
   after `c1`, and no dependency edge is created.

### A2: Edit item fields and timestamp/slug behaviour

As the owner, I want to edit any item field, so that categorisation stays cheap.

PATCH `/items/{id}` with any subset of `{title, state, mode, effort,
blocked_external, blocked_note, blocked_followup_date}`. On any change set
`updated_at=now`, `updated_by=owner`. On title change, re-derive slug (A3). On
state change set `state_changed_at=now`; if new state in {done,abandoned} set
`completed_at=now`, else clear `completed_at`. Editing does not change id,
parent, order, edges, or comments.

**Package:** `backend/`
**File:** `api/v1/items.py`
**Test file:** `tests/test_items.py`

**Acceptance tests:**

1. Given item with `state=not-started`, when PATCH `{"state":"done"}`, then
   `state=="done"`, `completed_at` non-null, and `state_changed_at` updated.
2. Given item with `state=done` (completed_at set), when PATCH
   `{"state":"implement"}`, then `completed_at==null`.
3. Given item id `I` with comments and edges, when PATCH `{"title":"New"}`,
   then `I.id` unchanged, comments unchanged, edges unchanged, and
   `updated_at > created_at`.
4. Given PATCH `{"effort":"long"}`, then `effort=="long"` and `mode`,`state`
   unchanged.
5. Given PATCH `{"blocked_external":true,"blocked_note":"awaiting infra",
   "blocked_followup_date":"2026-07-10"}`, then all three persist.

### A3: Slug re-derivation preserves id-based edges

As the owner, I want renames to keep dependencies resolving, so that
restructuring is safe.

When a title changes, its slug re-derives and any displayed `>needs:` labels
referencing it update, while stored edges (by id) are unchanged.

**Package:** `backend/`
**File:** `services/tree.py`, `api/v1/items.py`
**Test file:** `tests/test_items.py`

**Acceptance tests:**

1. Given item `B` slug `build-api` and item `A` with explicit edge `A -> B`,
   when PATCH `B` `{"title":"Build the API gateway"}`, then `B.slug==
   "build-the-api-gateway"`, the edge `A -> B` still exists with the same edge
   id and `to_id==B.id`, and GET `/tree` shows A's needs label as
   `build-the-api-gateway`.
2. Given items `X` slug `task` and `Y`, when `Y` is renamed to a title that
   slugifies to `task`, then `Y.slug=="task-2"` and `X.slug=="task"` is
   unchanged.
3. Given `B` renamed twice (`->"Foo"`, then `->"Bar"`), edge `A -> B` resolves
   throughout and the final displayed needs label is `bar`.

### A4: Delete item with subtree cascade and dependency cleanup

As the owner, I want to delete an item or subtree, so that obsolete work is
removed.

DELETE `/items/{id}` removes the item and (via cascade) its descendants,
comments, runs, and incident edges. Remaining siblings keep their relative
order; no replacement dependency edge is created.

**Package:** `backend/`
**File:** `api/v1/items.py`, `services/graph.py`
**Test file:** `tests/test_items.py`

**Acceptance tests:**

1. Given siblings `[a,b,c]` under root and an explicit edge that references
   `b`, when DELETE `b`, then `a` and `c` remain in order, `b` is gone, and no
   edge references `b`; no replacement edge `c->a` is created.
2. Given container `P` with children `[c1,c2]` and comments on `c1`, when
   DELETE `P`, then `P`, `c1`, `c2`, and `c1`'s comments are all gone.

---

## B. Leaf/container transitions

### B1: Container retains but ignores mode/effort

As the owner, I want adding a child to make an item structural, so that
containers do not pollute priority.

A leaf becomes a container when it gains a first child; its stored mode and
effort are retained in the row but ignored while it has children. It becomes a
leaf again (retained mode/effort apply) when it loses its last child.

**Package:** `backend/`
**File:** `services/tree.py`, `services/leverage.py`
**Test file:** `tests/test_items.py`, `tests/test_priority.py`

**Acceptance tests:**

1. Given leaf `L` (`effort=long`, `mode=prompt-agent`) with no children, when
   a child `c` is created under `L`, then `L` is reported as a container, is
   not actionable, and is excluded from any `Downstream(...)` set, while
   `L.mode`/`L.effort` remain `prompt-agent`/`long` in the row.
2. Given the state from test 1, when `c` is deleted, then `L` is a leaf again,
   is actionable (deps permitting), and contributes with `effort=long`,
   `mode=prompt-agent`.

### B2: Container completeness is derived

As the owner, I want a container to be complete only when its children are, so
that downstream sequencing is correct.

**Package:** `backend/`
**File:** `services/tree.py`
**Test file:** `tests/test_items.py`

**Acceptance tests:**

1. Given container `P` with children `c1` (done) and `c2` (implement), then `P`
   is not complete.
2. Given `P` with `c1` (done) and `c2` (abandoned), then `P` is complete.
3. Given nested container `P` > `Q` > `leaf` where `leaf` is done, then both
   `Q` and `P` are complete.

---

## C. Dependency semantics and section inheritance

### C1: Siblings are independent by default

As the owner, I want sibling products and subsections to run independently by
default, so that the outline expresses structure without over-sequencing work.

Build the outline below and assert no edges are generated from order alone.

    A
    B
      B1
      B2
    C

**Package:** `backend/`
**File:** `services/graph.py`, `services/leverage.py`, `api/v1/items.py`
**Test file:** `tests/test_dependencies.py`

**Acceptance tests:**

1. Given the outline above (A,B,C top-level in order; B1,B2 children of B in
   order; nothing complete), then the dependency table is empty.
2. Given that outline, when actionability is computed, then exactly
   `{A,B1,B2,C}` is actionable; `B` is a container and is not actionable.

### C2: Explicit section dependencies gate descendant leaves

As the owner, I want to declare that one section depends on another, so that I
can sequence only the sections that genuinely require sequencing.

**Package:** `backend/`
**File:** `services/leverage.py`, `services/tree.py`
**Test file:** `tests/test_dependencies.py`

**Acceptance tests:**

1. Given the C1 outline and explicit edge `B->A`, then descendant leaves `B1`
   and `B2` inherit that section dependency; exactly `{A,C}` is actionable.
2. Given `A` is set to done, then `{B1,B2,C}` are actionable.
3. Given explicit edge `C->B`, then `C` is blocked until the whole `B` section
   is complete; completing only `B1` does not unblock `C`, but completing both
   `B1` and `B2` does.

### C3: Structural edits preserve explicit dependencies

As the owner, I want dependencies to stay attached to item ids while I
restructure, so that recategorisation does not lose sequencing.

**Package:** `backend/`
**File:** `services/tree.py`, `api/v1/items.py`
**Test file:** `tests/test_dependencies.py`

**Acceptance tests:**

1. Given item `b` with explicit edge `b->a`, when `b` is moved, indented, or
   outdented, then the same edge id still points from `b` to `a`.
2. Given siblings `[a,b]` with no explicit edge, when a structural change to
   that sibling group occurs (create sibling `c` after `b`), then no dependency
   edge is generated.

---

## D. Explicit dependencies and cycle rejection

### D1: Add explicit edge by slug, stored by id

As the owner, I want `>needs:slug` cross-tree dependencies, so that I can
express links the tree cannot.

POST `/dependencies` `{from_id, needs_slug}` resolves `needs_slug` to a target
id at entry time and stores `kind='explicit'`. Alternatively `{from_id,to_id}`.

**Package:** `backend/`
**File:** `api/v1/dependencies.py`, `services/graph.py`
**Test file:** `tests/test_dependencies.py`

**Acceptance tests:**

1. Given items `X` and `Y` (slug `deploy-db`) in different products, when POST
   `/dependencies` `{"from_id":"X","needs_slug":"deploy-db"}`, then an edge
   `X->Y` of kind `explicit` exists with `to_id==Y.id`.
2. Given the edge from test 1 and `Y` not complete, then `X` is not actionable;
   when `Y` is set to done, `X` becomes actionable (deps permitting).
3. Given POST `/dependencies` with `needs_slug` matching no item, then 422 with
   `detail=="unknown dependency: <slug>"`.

### D2: Cycle rejection across dependency graph

As the owner, I want cycles rejected, so that the graph stays acyclic.

**Package:** `backend/`
**File:** `services/graph.py`
**Test file:** `tests/test_dependencies.py`

**Acceptance tests:**

1. Given explicit edge `A->B`, when POST `/dependencies`
   `{"from_id":"B","to_id":"A"}`, then 409 with
   `detail=="dependency cycle rejected"` and no edge is added.
2. Given chain `A->B->C` (explicit), when POST `{"from_id":"C","to_id":"A"}`,
   then 409 (transitive cycle) and no edge added.
3. Given POST `{"from_id":"A","to_id":"A"}`, then 409 (self-edge).
4. Given section edge `B->A`, when POST `/dependencies` `{"from_id":"A",
   "to_id":"B"}`, then 409 and the explicit edge is not added.

### D3: Delete explicit edge restores independence

As the owner, I want to remove a dependency edge, so that items or sections can
run independently again.

DELETE `/dependencies/{id}` removes the explicit edge with that id. Removing an
edge never creates a replacement edge from sibling order.

**Package:** `backend/`
**File:** `api/v1/dependencies.py`
**Test file:** `tests/test_dependencies.py`

**Acceptance tests:**

1. Given explicit edge `B->A` and `A` incomplete, then `B` (or descendants of
   section `B`) is not actionable; when DELETE that edge, `B`'s eligible leaves
   become actionable if no other dependency blocks them.
2. Given the edge from test 1 is deleted, when an unrelated PATCH or structural
   edit occurs, then the edge does not reappear.

---

## E. Unblock-leverage priority

All scores below use `EFFORT_WEIGHT={quick:1,medium:3,long:8}` and
`MODE_WEIGHT=2 for prompt-agent else 1`. GET `/priority` returns actionable
leaves only, ordered by score desc then the tie-break, each with a `rank`
integer (1-based); the numeric score is never present in the response.

### E1: Leverage ordering across products

As the owner, I want quick items that unblock big work first, so that I prompt
long agent jobs early.

Setup (three independent product roots; first child of each is actionable):

    Alpha:  A1(quick,prompt-agent) -> A2(long,prompt-agent)   [A2 needs A1]
    Beta:   B1(quick,prompt-agent) -> B2(medium,review)
                                    -> B3(medium,review)       [B2 needs B1; B3 needs B2]
    Gamma:  G1(long,prompt-agent)  -> G2(long,prompt-agent)    [G2 needs G1]

**Package:** `backend/`
**File:** `services/leverage.py`, `api/v1/priority.py`
**Test file:** `tests/test_priority.py`

**Acceptance tests:**

1. Given the setup, the actionable set is exactly `{A1, B1, G1}` (A2,B2,B3,G2
   blocked; no containers).
2. Scores: `A1` Downstream `{A2}` => `8*2/1 = 16`; `B1` Downstream `{B2,B3}`
   => `(3*1 + 3*1)/1 = 6`; `G1` Downstream `{G2}` => `8*2/8 = 2`. GET
   `/priority` returns order `[A1, B1, G1]` with ranks `1,2,3` and no numeric
   score field.

### E2: prompt-agent weight isolates to 2x

As the owner, I want prompt-agent downstream weighted double, so that agent
kick-offs win ties on effort.

Setup:

    H:  H1(quick) -> H2(long,prompt-agent)   [H2 needs H1]
    I:  I1(quick) -> I2(long,review)         [I2 needs I1]

**Package:** `backend/`
**File:** `services/leverage.py`
**Test file:** `tests/test_priority.py`

**Acceptance tests:**

1. Scores: `H1 = 8*2/1 = 16`; `I1 = 8*1/1 = 8`. Order is `[H1, I1]`.

### E3: Division by own effort

As the owner, I want my own effort to divide the score, so that a costly item
ranks below a cheap one with equal downstream.

Reuse E1: `A1` and `G1` both have downstream contribution `16`, but
`A1=16/1=16` and `G1=16/8=2`.

**Package:** `backend/`
**File:** `services/leverage.py`
**Test file:** `tests/test_priority.py`

**Acceptance tests:**

1. Given A1 and G1 with identical downstream contribution `16`, GET `/priority`
   ranks `A1` strictly above `G1`.

### E4: Transitive downstream over open leaves only; containers excluded

As the owner, I want downstream counted transitively but only over open leaves,
so that containers and finished work do not inflate priority.

Setup:

    J1(quick) ; J2(container) with child J2a(medium,prompt-agent)
    edges: J2 needs J1 (section dependency inherited by J2a)
    K1(quick) -> K2(long,prompt-agent, state=done)   [K2 needs K1]

**Package:** `backend/`
**File:** `services/leverage.py`
**Test file:** `tests/test_priority.py`

**Acceptance tests:**

1. `Downstream(J1)` excludes container `J2` and includes open leaf `J2a`;
   `score(J1) = 3*2/1 = 6`.
2. `Downstream(K1)` excludes the completed leaf `K2`; `score(K1) = 0/1 = 0`.
3. Given explicit edges `M2->M1` and `M3->M2` with all leaves open,
   `Downstream(M1) = {M2, M3}` and `score(M1) = (1*1 + 8*2)/1 = 17`
   (M2 mode review => weight 1).

### E5: Tie-break ordering

As the owner, I want deterministic ordering on equal scores, so that the list
is stable.

Setup: four single-leaf products (no children, no downstream, all score 0):
`M1` created at t1; `N1` created at t2 (>t1); `P1` created at t3; `Q1` created
at t4 (>t3). `M1` has its title edited at t5 (latest of all). `P1` and `Q1` are
never edited (their `updated_at` equals their `created_at`).

**Package:** `backend/`
**File:** `services/leverage.py`
**Test file:** `tests/test_priority.py`

**Acceptance tests:**

1. Between `M1` and `N1` (equal score 0): `M1.updated_at`(t5) > `N1.updated_at`
   (t2), so `M1` ranks above `N1` (updated_at desc wins).
2. Between `P1` and `Q1` (equal score, equal-to-created updated_at): newest
   `created_at` first, so `Q1`(t4) ranks above `P1`(t3).
3. Given two items with identical score, `updated_at`, and `created_at`
   (constructed by inserting both with the same timestamps), the one with the
   lexically smaller `id` ranks first.

### E6: blocked_external excludes from actionable, not from downstream

As the owner, I want a `blocked_external` leaf hidden from `/priority` yet still
counted as downstream work, so that an external block does not falsely lower the
priority of the item that would unblock it.

`blocked_external` is a defining condition of actionability but NOT of
downstream membership (see Core domain rules): a `blocked_external` open leaf is
absent from `/priority` yet still contributes to an upstream item's leverage
score.

Setup (two independent products):

    W:  W1(quick,prompt-agent) -> W2(long,prompt-agent)   [W2 needs W1]
        W2.blocked_external = true
    V:  V1(medium,prompt-agent)                           [root leaf, no deps]
        V1.blocked_external = true

**Package:** `backend/`
**File:** `services/leverage.py`, `api/v1/priority.py`
**Test file:** `tests/test_priority.py`

**Acceptance tests:**

1. Given `V1` is a leaf with no dependencies (all deps satisfied) but
   `blocked_external==true`, then `V1` is NOT actionable and is absent from GET
   `/priority`.
2. Given `W2.blocked_external==true`, then `W2` is not actionable, yet
   `Downstream(W1) == {W2}` (W2 is not complete and not a container), so
   `score(W1) = 8*2/1 = 16`; GET `/priority` includes `W1` and excludes both
   `W2` and `V1`. The whole actionable set is exactly `{W1}`.

---

## F. Keyboard outliner and inline tokens

### F1: Parse inline tokens from a row

As the owner, I want to type metadata inline, so that capture is one keystroke
flow.

`lib/outliner-parse.ts` `parseRow(text)` extracts, in any order and case-
insensitively: `@mode`, `!effort`, `::state`, `>needs:slug` (repeatable). The
remaining text (tokens stripped, whitespace collapsed) is the title.
`#product` is not a token. Unrecognised enum value => parse error.

**Package:** `frontend/`
**File:** `lib/outliner-parse.ts`
**Test file:** `tests/outliner-parse.test.ts`

    type ParsedRow = {
      title: string
      mode?: Mode; effort?: Effort; state?: State
      needs: string[]            // slugs, in order seen
    }
    type ParseResult =
      | { ok: true; row: ParsedRow }
      | { ok: false; error: string }

**Acceptance tests:**

1. `parseRow("Ship login @review !quick ::implement >needs:deploy-db")` yields
   `ok:true` with `title=="Ship login"`, `mode=="review"`, `effort=="quick"`,
   `state=="implement"`, `needs==["deploy-db"]`.
2. `parseRow("!LONG @Prompt-Agent build it")` yields `effort=="long"`,
   `mode=="prompt-agent"`, `title=="build it"` (case-insensitive match).
3. `parseRow("X >needs:a >needs:b")` yields `needs==["a","b"]`.
4. `parseRow("X @bogus")` yields `ok:false` with `error` mentioning `bogus`.
5. `parseRow("Refactor #payments module")` yields `title=="Refactor #payments
   module"` (the `#` token is left in the title) and `needs==[]`.
6. `parseRow("   plain title   ")` yields `title=="plain title"`, no tokens.

### F2: Keyboard structure operations

As the owner, I want Enter/Tab/Shift-Tab to build the tree, so that outlining
feels like a markdown editor.

Outliner row actions map to backend ops: Enter -> create next sibling
(independent by default); Tab -> indent (become first child of preceding
sibling, which becomes a container); Shift-Tab -> outdent (become sibling of
former parent, independent by default). Each row is identity-bound by item id.

**Package:** `backend/` (behaviour asserted at API)
**File:** `api/v1/items.py`, `services/tree.py`
**Test file:** `tests/test_items.py`

**Acceptance tests:**

1. Given item `a` at top level, when POST `/items/{a}` next-sibling create
   `b` (Enter), then `b.parent_id==a.parent_id`, `b` sorts after `a`, and edge
   `b->a` does not exist unless explicitly added.
2. Given top-level `[a,b]`, when POST `/items/{b}/indent` (Tab), then
   `b.parent_id==a`, `a` is now a container, and no dependency edge is created.
3. Given `a` container with child `b`, when POST `/items/{b}/outdent`
   (Shift-Tab), then `b.parent_id==a.parent_id` (a's parent), `b` sorts after
   `a`, and no dependency edge is created; if `a` now has no children `a` is a
   leaf again.

### F3: Identity-preserving structural edits

As the owner, I want edges and comments to survive restructuring, so that
re-categorisation is lossless.

**Package:** `backend/`
**File:** `services/tree.py`, `services/graph.py`
**Test file:** `tests/test_items.py`

**Acceptance tests:**

1. Given item `b` with an explicit edge `b->z` and one comment, when `b` is
   indented then outdented, then `b.id` is unchanged, the explicit edge `b->z`
   and the comment both still exist.

---

## G. Re-categorisation and drag-and-drop

### G1: Move subtree across products

As the owner, I want to move a subtree to another product, so that structure
follows understanding.

POST `/items/{id}/move` `{new_parent_id?, after_id?}`. `new_parent_id=null`
promotes to root (product). Cross-product moves allowed. Identity preserved;
explicit edges and comments retained. Move rejected if `new_parent_id` is a
descendant of the moved item (422
`{"detail":"cannot move into own descendant"}`).

**Package:** `backend/`
**File:** `api/v1/items.py`, `services/tree.py`, `services/graph.py`
**Test file:** `tests/test_items.py`

**Acceptance tests:**

1. Given product `P1` with child `x` and product `P2` with child `y`, when
   POST `/items/{x}/move` `{"new_parent_id":"P2","after_id":"y"}`, then
   `x.parent_id==P2`, `x` sorts after `y`, and no dependency edge `x->y` is
   created.
2. Given `x` with explicit edge `x->z`, when `x` is promoted (`new_parent_id`
   null), then `x.parent_id==null` (a product) and edge `x->z` still exists.
3. Given container `C` with descendant `d`, when POST `/items/{C}/move`
   `{"new_parent_id":"d"}`, then 422 `detail=="cannot move into own
   descendant"`.

### G2: Merge (reparent children, remove emptied item)

As the owner, I want to merge one item into another, so that duplicates
collapse.

Performed as moves of children + delete of the emptied source. Asserted via the
move + delete primitives.

**Package:** `backend/`
**File:** `api/v1/items.py`
**Test file:** `tests/test_items.py`

**Acceptance tests:**

1. Given `src` with children `[s1,s2]` and `dst` with child `[d1]`, when `s1`
   and `s2` are moved under `dst` (after `d1`) and `src` is deleted, then `dst`
   has children `[d1,s1,s2]` in order, no dependency chain is created, and
   `src` no longer exists.

### G3: Split (new root items, move subtrees under them)

As the owner, I want to split work into new products, so that a growing item
becomes its own product as understanding improves.

Performed as one or more root-item creations (POST `/items` with
`parent_id=null`) plus moves of subtrees under each new root. Asserted via the
create + move primitives.

**Package:** `backend/`
**File:** `api/v1/items.py`
**Test file:** `tests/test_items.py`

**Acceptance tests:**

1. Given container `src` with independent children `[s1,s2]`,
   when a new root `R` is created (`parent_id==null`) and `s1` is moved under
   `R`, then `R.parent_id==null` (a product), `R` has children `[s1]`,
   `s1.parent_id==R`, and neither `s1` nor `s2` gains a dependency edge from
   the split.

---

## H. Unified view and work-now projection

The projection is computed by the server (tree + actionability + leverage
order) and rendered by the client; collapse/colour/toggle/sort/marker state is
display-only and never mutates stored order or edges.

### H1: Collapse not remove

As the owner, I want non-actionable branches collapsed (not removed), so that I
can still read and type into them.

GET `/tree` returns every item plus per-item flags `actionable: bool` and
`complete: bool`. The work-now projection collapses items that are not
actionable now (blocked by deps, blocked_external, or complete) while keeping
the full structure present and expandable.

**Package:** `backend/` + `frontend/`
**File:** `api/v1/items.py` (flags); `components/outliner.tsx`
**Test file:** `tests/test_items.py`; `tests/contracts.test.ts`

**Acceptance tests:**

1. Given outline `A; B(B1,B2); C` with nothing complete, GET `/tree` marks
   `A.actionable==true` and `B.actionable==B1.actionable==B2.actionable==
   C.actionable==false`, and `complete==false` for all; every item is present
   in the payload (none omitted).
2. The Zod `treeSchema` parses the GET `/tree` payload including `actionable`
   and `complete` booleans; a payload missing `actionable` fails `safeParse`.

### H2: Mode colour and mode toggles

As the owner, I want each item coloured by mode and toggleable by mode, so that
mode-of-work is visible without badges.

Each mode maps to a fixed colour token. Mode toggles filter the tree to the
selected mode(s); with no mode selected all items show. Filtering is display-
only.

**Package:** `frontend/`
**File:** `components/view-controls.tsx`, `components/outliner-row.tsx`
**Test file:** `tests/contracts.test.ts` (colour map), Playwright optional

A fixed colour map exists, one distinct colour per mode value:
`{prompt-agent, review, merge, release, spec}`.

**Acceptance tests:**

1. The mode-to-colour map has exactly 5 entries, one per Mode value, all
   distinct; looking up any Mode value returns a defined colour token.
2. Given items of modes `prompt-agent` and `review`, when only the `review`
   toggle is active, then only `review` items are shown; when no toggle is
   active, both are shown.

### H3: Leverage sort is display-only

As the owner, I want leverage sort to reorder the display only, so that stored
order is preserved.

When leverage sort is on, actionable items are shown in GET `/priority` order;
stored `sort_order` and dependency edges are unchanged.

**Package:** `backend/` + `frontend/`
**File:** `api/v1/priority.py`; `components/outliner.tsx`
**Test file:** `tests/test_priority.py`

**Acceptance tests:**

1. Given the E1 setup, GET `/priority` order is `[A1,B1,G1]`, and a subsequent
   GET `/tree` still lists each product's children in their original stored
   `sort_order` (display sort did not mutate storage).

### H4: New item stays visible until refresh

As the owner, I want a just-created item to stay visible even if filtered out,
so that capture never hides my work.

A newly created item that the active filter would hide (e.g. it is non-
actionable under work-now) remains shown with an "added this session, currently
filtered out" affordance until the view is explicitly refreshed or re-filtered,
after which the filter applies normally.

**Package:** `frontend/`
**File:** `components/outliner.tsx`
**Test file:** Vitest component test (`tests/outliner-newitem.test.ts`)

**Acceptance tests:**

1. Given work-now filter active (hides non-actionable items), when a new non-
   actionable item is created in-session, then it remains visible with the
   "added this session, currently filtered out" affordance.
2. Given that item is visible via the affordance, when the view is refreshed
   (re-filtered), then the item is hidden by the work-now filter (no longer
   exempt).

### H5: Product switcher / quick jump

As the owner, I want to jump fast to any product or point in the tree, so that
capture stays friction-free without a global quick-add bar.

`components/product-switcher.tsx` renders a jump control listing every product
root (every item with `parent_id==null`, by title) and an arbitrary-node search
across all items. Selecting a product focuses and scrolls its subtree into view;
selecting an arbitrary item focuses and scrolls to that node, expanding any
collapsed ancestors so the target is visible. The control mutates nothing
(display-only navigation).

**Package:** `frontend/`
**File:** `components/product-switcher.tsx`, `components/outliner.tsx`
**Test file:** Vitest component test (`tests/product-switcher.test.ts`)

**Acceptance tests:**

1. Given products `Alpha`, `Beta`, `Gamma` (root items), when the switcher
   opens, then its option list contains exactly `Alpha`, `Beta`, `Gamma` (one
   entry per root, none missing).
2. Given the switcher open, when product `Beta` is selected, then `Beta`'s
   subtree is focused and scrolled into view (the focused node id equals
   `Beta`'s id) and stored order/edges are unchanged.
3. Given a collapsed item `B2` nested under product `Beta`, when `B2` is chosen
   as an arbitrary jump target, then `B2` is focused and scrolled into view and
   its collapsed ancestors are expanded so `B2` is visible.

---

## I. Time markers and windows

### I1: Create markers and filter by window

As the owner, I want named time markers, so that I can show what changed since a
point.

POST `/markers` `{name, at?}` (at defaults to now). GET `/changes` query params:
`since=<marker_id>` or `between=<id1>,<id2>` and `field=created|changed|
completed` (default `changed`). Returns items whose chosen timestamp
(`created_at` / `updated_at` / `completed_at`) is in the window. "Since the last
marker" is one call with the most recent marker id.

**Package:** `backend/`
**File:** `api/v1/markers.py`
**Test file:** `tests/test_markers.py`

    class MarkerOut(BaseModel):
        id: str; name: str; at: str; created_at: str

**Acceptance tests:**

1. Given marker `M` at `2026-06-29T00:00:00.000000Z`, and item `x` updated
   after `M` and item `y` updated before `M`, when GET
   `/changes?since=<M>&field=changed`, then the result contains `x` and not
   `y`.
2. Given markers `M1`(earlier) and `M2`(later), and item `z` created between
   them, when GET `/changes?between=<M1>,<M2>&field=created`, then `z` is
   included; an item created after `M2` is excluded.
3. Given two markers, "since the last marker" resolves to the marker with the
   greatest `at`; GET `/changes?since=<that id>` returns only items changed
   after it.

---

## J. Comments

### J1: Owner and viewers comment; authors edit/delete own only

As a viewer, I want to comment on items, so that I can give the owner feedback.

Comments are flat, attached to an item, authored by the authenticated user with
timestamps. Owner and viewers may add. A user may edit/delete only their own
comment; even the owner cannot modify a viewer's comment. Comments are excluded
from the markdown mirror.

**Package:** `backend/`
**File:** `api/v1/comments.py`
**Test file:** `tests/test_comments.py`

    class CommentOut(BaseModel):
        id: str; item_id: str; author: str; body: str
        created_at: str; updated_at: str

**Acceptance tests:**

1. Given an authenticated viewer `vue`, when POST `/items/{id}/comments`
   `{"body":"looks good"}`, then 200 and `author=="vue"`, and GET
   `/items/{id}/comments` includes it.
2. Given a comment authored by `vue`, when user `alice` (owner) PATCH that
   comment, then 403 `detail=="cannot modify another user's comment"`.
3. Given a comment authored by `vue`, when `vue` PATCH `{"body":"updated"}`,
   then `body=="updated"` and `updated_at > created_at`.
4. Given a comment authored by `vue`, when `vue` DELETE it, then 200 and it is
   absent from the list.
5. GET `/items/{id}/comments` returns comments ordered by `created_at`
   ascending.

---

## K. Authentication and authorisation

### K1: LDAP direct-bind login

As any user, I want to log in with my LDAP credentials, so that access is
controlled.

`services/auth_ldap.py` substitutes the submitted username into the env DN
template (`{username}` or `%s`) and binds with the submitted password (ldap3); a
successful bind authenticates. The DN template is validated at startup to
contain the placeholder; a template without it aborts startup with a clear
error.

**Package:** `backend/`
**File:** `services/auth_ldap.py`, `api/v1/auth.py`, `config.py`
**Test file:** `tests/test_auth.py`

LDAP bind is abstracted behind a small injectable interface so tests stub the
bind result without a live server.

    class LoginRequest(BaseModel):
        username: str; password: str
    class WhoAmI(BaseModel):
        username: str; role: str   # 'owner' | 'viewer'

**Acceptance tests:**

1. Given DN template `uid={username},ou=people,dc=ex` and a stub binder that
   succeeds for `(uid=alice,ou=people,dc=ex, "pw")`, when POST `/auth/login`
   `{"username":"alice","password":"pw"}`, then 200 and `username=="alice"`.
2. Given a stub binder that fails, when POST `/auth/login` with any creds, then
   401 `detail=="authentication failed"`.
3. Given a DN template with no placeholder, when the app starts (settings
   validation runs), then startup raises a configuration error naming the
   missing placeholder.
4. Given DN template `%s,ou=people` and username `bob`, then the bind DN sent
   to the binder is `bob,ou=people`.

### K2: Owner and whitelist roles

As the deployer, I want owner and whitelist roles, so that only the right
people get write/read.

Owner username defaults to the OS user that started the service, overridable by
`AGENTFARM_OWNER`. On login: if username == owner -> owner role; else if in
whitelist -> viewer; else -> 403 access denied. Owner is implicitly allowed even
if absent from the whitelist.

**Package:** `backend/`
**File:** `services/auth_ldap.py`, `api/v1/auth.py`, `config.py`
**Test file:** `tests/test_auth.py`

**Acceptance tests:**

1. Given `AGENTFARM_OWNER=alice` and whitelist `["vue"]`, when `alice`
   authenticates, then role is `owner`.
2. Given the same config, when `vue` authenticates, then role is `viewer`.
3. Given the same config, when `mallory` authenticates (bind succeeds) but is
   neither owner nor whitelisted, then 403 `detail=="access denied"`.
4. Given owner `alice` not present in the whitelist, `alice` is still allowed
   (owner implicitly allowed) with role `owner`.

### K3: Owner-only mutations; viewer read+comment

As the owner, I want only me to edit items, so that the tree stays
authoritative.

All item/dependency/marker/structure mutations require owner role; viewers get
403 `owner only`. Viewers may GET everything and POST comments. Next.js
`middleware.ts` enforces an authenticated session and gates mutation routes;
the backend re-checks role server-side.

**Package:** `backend/` + `frontend/`
**File:** `api/v1/items.py` (guard), `frontend/middleware.ts`
**Test file:** `tests/test_auth.py`

**Acceptance tests:**

1. Given a viewer session, when POST `/items` (any item mutation), then 403
   `detail=="owner only"` and no item is created.
2. Given a viewer session, when GET `/tree`, then 200 with the full tree.
3. Given a viewer session, when POST `/items/{id}/comments`, then 200.
4. Given no/invalid session, when a request hits a guarded backend mutation,
   then it is rejected (401/403) and never mutates state.

### K4: Sessions and self-signed TLS

As the deployer, I want HTTPS with sessions over an internal network, so that
the tool is usable without a public CA.

Session is an httpOnly cookie set at the Next.js layer after login. The backend
serves HTTPS using configured cert/key, or a self-signed pair generated at
startup under the data dir when none is configured. Server-Action -> FastAPI
calls accept the self-signed cert.

**Package:** `backend/` + `frontend/`
**File:** `services/tls.py`, `frontend/lib/session.ts`,
`frontend/lib/backend-client.ts`, `main.py`
**Test file:** `tests/test_auth.py` (cert gen);
`frontend/tests/backend-client.test.ts` (TLS agent)

**Acceptance tests:**

1. Given no `AGENTFARM_TLS_CERT`/`AGENTFARM_TLS_KEY`, when TLS setup runs at
   startup, then a self-signed cert and key are created under the data dir and
   the cert parses as a valid X.509 certificate.
2. Given `AGENTFARM_TLS_CERT`/`AGENTFARM_TLS_KEY` set to existing files, when
   TLS setup runs, then those files are used and no new cert is generated.
3. The session cookie set by the login Server Action is `httpOnly` (asserted on
   the set-cookie attributes).
4. Given the internal backend origin is `https://...` (self-signed), when
   `backend-client.ts` constructs the fetch agent/dispatcher used by
   `backendJson` for that origin, then the agent has TLS verification relaxed
   (`rejectUnauthorized: false`), so an internal Server-Action -> FastAPI call
   to the self-signed backend does NOT fail certificate verification. Asserted
   on the constructed agent's options (same style as test 3), not via a live
   connection.

---

## L. Markdown mirror

### L1: Render tree as nested checklist

As the owner, I want a markdown mirror of the tree, so that it is shareable and
diffable.

`services/mirror.py` `render_tree(items)` produces a nested markdown checklist
in tree order: two spaces of indent per depth level; each item a checklist line
`- [x] <title>` if complete else `- [ ] <title>`; explicit `>needs:` shown as a
`(needs: slug, ...)` suffix using current slugs. Comments are excluded.

**Package:** `backend/`
**File:** `services/mirror.py`
**Test file:** `tests/test_mirror.py`

**Acceptance tests:**

1. Given outline `A; B(B1,B2); C` with `A` done and `B1` done, when rendered,
   then the output is exactly:

       - [x] A
       - [ ] B
         - [x] B1
         - [ ] B2
       - [ ] C

2. Given `X` with an explicit edge to `Y` (slug `deploy-db`), the line for `X`
   ends with `(needs: deploy-db)`.
3. Given a comment on `A`, the rendered output contains no comment text.

### L2: Commit to dedicated git repo, skip unchanged

As the owner, I want every change committed to an isolated git repo, so that
runtime churn does not touch app history.

On every mutating change, render the tree and commit to a git repo initialised
inside the data dir (not the app repo). If the rendered output is byte-identical
to the last commit, skip the commit. One-way (no re-import in v1).

**Package:** `backend/`
**File:** `services/mirror.py`
**Test file:** `tests/test_mirror.py`

**Acceptance tests:**

1. Given a fresh data dir, when an item is created and the mirror runs, then a
   git repo exists under the data dir with one commit containing the rendered
   markdown.
2. Given the mirror just committed, when a no-op change re-renders identical
   output, then no new commit is created (commit count unchanged).
3. Given a title edit that changes the rendered output, when the mirror runs,
   then a new commit is created and the file content reflects the new title.
4. Given a rename that changes a slug used in another item's `needs:` label,
   the new commit's content shows the updated `needs:` slug (mirror churn
   accepted).

---

## M. v2 seams (stubbed)

### M1: Runs table seam

As a future maintainer, I want an item to own runs, so that v2 can attach agent
runs.

Minimal runs table and endpoints exist but carry no v1 business logic: create a
stub run row for an item and list runs.

**Package:** `backend/`
**File:** `api/v1/runs.py`
**Test file:** `tests/test_runs_spawn.py`

**Acceptance tests:**

1. Given an item `I`, when POST `/items/{I}/runs`, then 200 and a run row with
   `item_id==I`, `status=="pending"` exists; GET `/items/{I}/runs` returns it.

### M2: Spawn/stream boundary returns 501

As a future maintainer, I want the spawn boundary present but unimplemented, so
that v2 can fill it in.

POST `/items/{id}/spawn` returns 501 Not Implemented. The route exists over the
intended SSE/WebSocket boundary but performs no work in v1.

**Package:** `backend/`
**File:** `api/v1/spawn.py`
**Test file:** `tests/test_runs_spawn.py`

**Acceptance tests:**

1. Given any item, when POST `/items/{id}/spawn`, then 501 with a `detail`
   indicating not implemented.

---

## N. Configuration and scaffold fix-up

### N1: Environment configuration

As the deployer, I want all settings via env, so that deployment is
configurable.

Extend `config.py` `Settings` with: `data_dir` (`AGENTFARM_DATA_DIR`),
`ldap_server` (`AGENTFARM_LDAP_SERVER`), `ldap_dn_template`
(`AGENTFARM_LDAP_DN_TEMPLATE`), `owner` (`AGENTFARM_OWNER`, default OS user),
`whitelist` (`AGENTFARM_WHITELIST`, comma-separated), `tls_cert`
(`AGENTFARM_TLS_CERT`), `tls_key` (`AGENTFARM_TLS_KEY`). The SQLite file and
markdown mirror both live under `data_dir`.

**Package:** `backend/`
**File:** `config.py`
**Test file:** `tests/test_auth.py` / `tests/test_mirror.py`

**Acceptance tests:**

1. Given `AGENTFARM_WHITELIST="vue,manager"`, when settings load, then
   `whitelist == ["vue","manager"]`.
2. Given `AGENTFARM_DATA_DIR=/some/dir`, when the DB and mirror initialise,
   then both are created under `/some/dir` (DB file path and git repo path are
   both inside it).
3. Given `AGENTFARM_OWNER` unset, when settings load, then `owner` equals the
   OS user that started the process.

### N2: Restore frontend/lib from scaffold .gitignore bug

As the implementor, I want `frontend/lib/*` tracked, so that imports resolve.

The scaffold `.gitignore` Python rule `lib/` accidentally ignores
`frontend/lib/` (backend-client, contracts, etc.) although they are imported
everywhere. The copied repo must un-ignore and commit those files.

**Package:** repo root
**File:** `.gitignore`, `frontend/lib/*`
**Test file:** `tests/contracts.test.ts` (imports from `@/lib/contracts`)

**Acceptance tests:**

1. Given the copied repo, `git check-ignore frontend/lib/contracts.ts` reports
   the file is NOT ignored (exit non-zero / no output), and
   `frontend/tests/contracts.test.ts` imports `@/lib/contracts` and runs.

---

## Implementation Order

Phases build on tested foundations. Within a phase, backend and frontend items
without cross-dependencies may proceed in parallel; phases are otherwise
sequential.

1. **Scaffold + config + DB foundation.** Copy scaffold (excluding skills); fix
   `.gitignore` (N2); extend `config.py` (N1); add `db/` (connection, schema,
   migrate) and `models/enums.py`. Verify DB initialises under `data_dir` and
   contract harness runs. (Sequential; foundation.)

2. **Items CRUD + slug.** A1, A2, A3, A4 backend item create/edit/delete and
   slug derivation/re-derivation. Establishes `ItemOut` + Zod `itemSchema`.
   (Depends on 1.)

3. **Tree structure + dependency inheritance.** Sibling independence (C1),
   section dependency inheritance (C2), structural preservation of explicit
   edges (C3), leaf/container transitions (B1, B2), keyboard ops (F2),
   identity-preserving edits (F3), move/merge/split (G1, G2, G3). (Depends on
   2.)

4. **Explicit dependencies.** D1 add-by-slug stored-by-id; D2 full cycle
   rejection across the dependency graph; dependency deletion for restoring
   parallelism. (Depends on 3.)

5. **Priority engine.** E1-E6 unblock-leverage scoring, ordering, tie-break,
   blocked_external actionability vs downstream (E6), `/priority` endpoint with
   ranks and no score. (Depends on 3 and 4 for the dependency graph and
   actionability.)

6. **Outliner parsing (frontend).** F1 `parseRow` token parser. Can run in
   parallel with 4-5 (pure frontend, depends only on enum definitions from 1).

7. **Comments.** J1 add/edit/delete/list with author rules. (Depends on 2.)

8. **Markers and windows.** I1 marker create + `/changes` queries. (Depends on
   2; parallelisable with 7.)

9. **Auth + sessions + TLS.** K1-K4 LDAP direct-bind, roles, owner-only
   guards, session cookie, self-signed TLS. (Depends on 1; guards wrap the
   endpoints from 2-8, so land after they exist.)

10. **Markdown mirror.** L1 render, L2 git commit + skip-unchanged. (Depends on
    3 for tree and dependency ordering.)

11. **Unified view (frontend).** GET `/tree` flags (H1), Server Actions,
    `middleware.ts`, outliner + DnD components, view controls (mode colour H2,
    leverage sort H3, markers), new-item-stays-visible (H4), product switcher /
    quick jump (H5). (Depends on 2,3,5,9 and the contracts they define;
    parallelise sub-items across files.)

12. **v2 seams.** M1 runs table endpoints, M2 spawn 501. (Independent; can land
    any time after 1-2; placed last as lowest priority.)

---

## Appendix: Key Decisions

**Implementation/review skills.** Implement each story with the
`nextjs-fastapi-implementor` skill (strict TDD: failing test first, minimal
code, refactor, lint) and verify with `nextjs-fastapi-reviewer` (every
acceptance test has a real behavioural test; BFF, contracts, and backend
conventions hold). Both reference `nextjs-fastapi-conventions`,
`testing-principles`, and `agent-conduct`.

**Database as source of truth; ids stable, slugs derived.** Ids are immutable
UUIDs; all references (edges, comments, runs) are by id. Slugs are display-only
and re-derived on rename, so renames never break references (A3). This is the
single most load-bearing decision for the dependency model.

**One explicit dependency graph.** Dependency edges live in `dependencies` and
are stored by item id. Actionability, cycle checks, and leverage all operate on
that graph plus section inheritance: dependencies attached to a container/root
section gate every descendant leaf. Sibling order never creates edges; explicit
edge addition/removal is how the user sequences or restores parallelism.

**Leverage weights are fixed, tunable defaults.**
`EFFORT_WEIGHT {1,3,8}` and `MODE_WEIGHT 2 for prompt-agent` are chosen so
acceptance tests assert exact orderings. Downstream counts only open leaves
transitively (containers and completed work excluded) and divides by the item's
own effort, realising "cheap work that unblocks big work first". Only ordering
(ranks) is exposed; the numeric score is internal, so the API contract does not
leak the formula.

**Display vs storage separation.** Leverage sort, collapse, colour, mode
toggles, and marker filters are display-only projections of one editable tree;
they never mutate `sort_order` or dependency edges (H3). A new item is exempt
from the active filter until refresh (H4) to keep capture frictionless.

**Auth modelled on wtsi-hgi/wa.** LDAP direct-bind with a DN template
(placeholder validated at startup), owner-by-username (OS-user default,
env-overridable), whitelist for viewers, owner-implicitly-allowed, deny
otherwise. Mutations are owner-only and guarded both at the Next.js middleware
and re-checked server-side. The LDAP binder is injected so tests run without a
live server.

**Self-signed TLS for an internal tool.** HTTPS always; configured cert/key or
a startup-generated self-signed pair under the data dir. Server-Action ->
FastAPI calls accept the self-signed cert; this deliberate relaxation is
acceptable for an internal-network deployment and documented for the browser
warning.

**Markdown mirror isolation.** The mirror commits to a dedicated git repo
inside the (gitignored) data dir, never the app repo, and skips identical
renders, so runtime churn stays out of application history. One-way only;
comments excluded.

**Testing strategy.** Backend: pytest + httpx `AsyncClient`/`ASGITransport`
asserting status codes AND JSON payloads; deterministic timestamps/ids injected
where ordering or tie-breaks are asserted (E5) so tests are reproducible. The
LDAP binder, clock, and id generator are injectable for determinism. Frontend:
Vitest for `parseRow` and Zod contract tests (`parse`/`safeParse` for every new
schema); component tests for H2/H4 behaviour, with Playwright reserved for any
genuinely perceptual mode-colour assertion per conventions. Tests assert
user-visible behaviour (API contracts, rendered markdown, persisted state, edge
sets, orderings), never implementation details.

**Error policy.** Closed-enum tokens, unknown slugs, and malformed input ->
422; cycles -> 409; auth failures -> 401; authorisation failures -> 403;
missing entities -> 404. Every FastAPI response is Zod-validated on the
frontend; a contract break raises `BackendRequestError`, and Server Actions
return typed error state rather than throwing to the user.

**v2 seams without v2 behaviour.** A `runs` table with create/list endpoints and
a `spawn` route returning 501 over the intended SSE/WebSocket boundary are the
only v2 affordances; no agent execution, streaming, or natural-language entry is
built in v1.
