# Phase & Ball: State / Readiness / Views Rework Specification

## Overview

Today one `state` enum encodes three unrelated questions: pipeline position,
whose court the work is in, and closedness. This rework splits it into two
orthogonal axes -- **Phase** (pipeline position) and **Ball** (whose court) --
plus the existing terminal disposition. The readiness chip, the outliner views,
and a new manager projection all become clean derivations of these two axes,
replacing the hand-maintained `EXTERNAL_WAITING_STATES` / `USER_ACTION_STATES`
sets and the `blocked_external` boolean.

This is a MODIFICATION of a shipped system. The baseline in prompt.md sec.2
(item CRUD, slug/sibling ordering, dependency graph, leverage scoring, tree /
priority / home endpoints, markers, notes, comments, prompt/response entries,
scratchpad, activity log, outliner tokens `@mode` `!effort` `::state`
`>needs:slug`, drag/keyboard editing) MUST keep working except where changed
below. Research confirms the concrete anchors this spec references:
`backend/models/enums.py` (`State`/`Mode`/`Effort` + weight/set helpers),
`backend/services/leverage.py` (`LeverageProjection`),
`backend/services/tree.py` (`is_complete`), `backend/api/schemas.py`,
`backend/api/v1/{items,priority,home,markers}.py`,
`backend/db/{schema.sql,migrate.py}` (`apply_schema`,
`_ensure_column`, `_run_once`), `frontend/lib/{contracts,state-metadata,
outliner-parse,outliner-mutations}.ts`, `frontend/components/{outliner,
outliner-row,view-controls,comments-panel}.tsx`, `frontend/app/actions.ts`.

Key behaviours:

- **Phase** = today's `state` with `feedback`/`respond` removed and `defining`
  added. The stored column keeps the name `state` (see Key Decisions).
- **Ball** = new owner-settable axis `you` / `agent` / `person` (default `you`).
- **One derived status** per item (`ready` / `monitoring` / `waiting` /
  `blocked` / `done` / `dropped` / `rollup`) with fixed precedence; owner and
  manager render the same value with different labels.
- **Hand-off** (flipping Ball) is the highest-frequency change: inline token,
  a one-key row control, and a note/date popover when Ball = `person`.
- One-time data migration; deliberate defaults asserted by tests.

## Architecture

### Field / identifier choices (implementation discretion, fixed here)

- Stored Phase column stays `state` (narrowed meaning); concept name "Phase".
- Stored Ball column is `ball`; concept name "Ball".
- Derived status is computed authoritatively in the backend
  `LeverageProjection` and exposed on tree/home items; the frontend mirrors the
  derivation for optimistic rendering (as `actionable`/`complete` already are).

### Backend enums (`backend/models/enums.py`)

```python
class State(StrEnum):        # "Phase"
    not_started = "not-started"
    defining = "defining"        # NEW
    spec = "spec"
    implement = "implement"
    review = "review"
    merged = "merged"
    released = "released"
    done = "done"
    abandoned = "abandoned"
    # REMOVED: feedback, respond

class Ball(StrEnum):             # NEW axis, default `you`
    you = "you"
    agent = "agent"
    person = "person"

# Pipeline order for the least-advanced roll-up (N.13); terminal excluded.
PHASE_ORDER: tuple[State, ...] = (
    State.not_started, State.defining, State.spec, State.implement,
    State.review, State.merged, State.released,
)

Status = Literal[
    "ready", "monitoring", "waiting", "blocked", "done", "dropped", "rollup",
]
```

- `is_complete(state)` unchanged (`{done, abandoned}`).
- DELETE `EXTERNAL_WAITING_STATES`, `USER_ACTION_STATES`, `is_external_waiting`,
  `user_action_priority`. `EFFORT_WEIGHT`, `MODE_WEIGHT`, `Mode`, `Effort` are
  unchanged.

### SQLite schema (`backend/db/schema.sql`)

`items`: DROP `blocked_external`; ADD `ball TEXT NOT NULL DEFAULT 'you'`,
`ball_changed_at TEXT NOT NULL DEFAULT ''`, and four milestones
`dev_updated / prod_updated / docs_updated / announced INTEGER NOT NULL
DEFAULT 0`. Keep `blocked_note`, `blocked_followup_date` (now generalised
hand-off note/date). `item_state_changes`: ADD
`kind TEXT NOT NULL DEFAULT 'state-change'`; its `from_state`/`to_state`
text columns now hold either Phase values (`kind='state-change'`) or Ball
values (`kind='ball-change'`) -- no second table (N.2).

`apply_schema` adds the new columns to existing DBs via `_ensure_column`
(idempotent) before running the one-time data migration through `_run_once`
(story E). New DBs get them from `schema.sql` directly.

### Backend response models (`backend/api/schemas.py`)

`ItemOut` (returned by create/patch/move/tree/priority/home rows): REMOVE
`blocked_external`; ADD `ball: Ball`, `ball_changed_at: str`,
`dev_updated/prod_updated/docs_updated/announced: bool`. Keep `blocked_note`,
`blocked_followup_date`. Root-only masking of `repo_url`/`usage` unchanged.

`TreeItemOut(ItemOut)`: existing `needs`, `needs_edges`, `actionable`,
`complete`, `has_notes`, `has_prompt_response_entries`, PLUS:

```python
status: Status
resume: bool                 # fresh-vs-resume predicate (sec.5)
rollup: RollupOut | None     # non-null only for containers

class RollupStatusCounts(BaseModel):     # N.11, over descendant leaves
    ready: int; monitoring: int; waiting: int
    blocked: int; done: int; dropped: int

class RollupShipProgress(BaseModel):     # N.12, over descendant leaves
    dev_updated: int; prod_updated: int; docs_updated: int; announced: int
    shipped: int         # leaves with all four milestones true
    total: int           # descendant-leaf count

class RollupOut(BaseModel):
    status_counts: RollupStatusCounts
    ship: RollupShipProgress
    phase: State | None  # least-advanced open descendant-leaf Phase, else None
```

`ItemCreate`: ADD `ball: Ball = Ball.you`. `ItemUpdate`: REMOVE
`blocked_external`; ADD `ball: Ball | None = None` and the four ship
`bool | None = None`; keep `blocked_note`, `blocked_followup_date`.

Activity contract -- discriminated union (N.2):

```python
class StateChangeActivityOut(BaseModel):
    id: str; item_id: str; kind: Literal["state-change"] = "state-change"
    actor: str; from_state: State; to_state: State; created_at: str

class BallChangeActivityOut(BaseModel):
    id: str; item_id: str; kind: Literal["ball-change"] = "ball-change"
    actor: str; from_ball: Ball; to_ball: Ball; created_at: str

ItemActivityOut = Annotated[
    StateChangeActivityOut | BallChangeActivityOut, Field(discriminator="kind")
]
```

### Frontend contracts (`frontend/lib/contracts.ts`)

`stateSchema`: `['not-started','defining','spec','implement','review','merged',
'released','done','abandoned']`. NEW `ballSchema = z.enum(['you','agent',
'person'])`, `statusSchema = z.enum([...7 values])`. `itemSchema`: drop
`blocked_external`; add `ball`, `ball_changed_at`, four ship booleans.
`treeItemSchema`: add `status`, `resume`, `rollup` (`rollupSchema.nullable()`).
`itemActivitySchema = z.discriminatedUnion('kind', [stateChange, ballChange])`.
`PatchItemInput` (`app/actions.ts`): drop `blocked_external`; add `ball`, four
ship booleans.

### `_ITEM_COLUMNS` / `_ACTIVITY_COLUMNS`

Update the column lists in `items.py`, `priority.py`, `home.py`, `markers.py`
to drop `blocked_external` and add `ball, ball_changed_at, dev_updated,
prod_updated, docs_updated, announced`; `_ACTIVITY_COLUMNS` gains `kind`.
`_row_to_item` maps ball ints/strings and the four ship ints to bools.

### Error handling

Unchanged conventions (prompt.md sec.2 baseline / v1 spec): bad enum token =>
422 naming the field; 404 unknown id; 409 dependency cycle. Ball / ship / Phase
tokens follow the same rules as `@mode`/`!effort`/`::state`.

---

## A. Model, columns, defaults (backend)

### A1: Phase enum drops impostors, adds `defining`

As the owner, I want Phase to hold only real pipeline positions, so status
derivations are clean.

**Package:** `backend/` **File:** `models/enums.py`
**Test file:** `tests/test_enums.py`

**Acceptance tests:**

1. `{m.value for m in State}` equals exactly `{not-started, defining, spec,
   implement, review, merged, released, done, abandoned}` (no `feedback`,
   no `respond`).
2. `State.defining.value == "defining"`; `State.not_started.value ==
   "not-started"`.
3. `is_complete(State.done)` and `is_complete(State.abandoned)` are True; every
   other Phase is False.
4. `PHASE_ORDER` equals the seven non-terminal Phases in pipeline order; `done`
   and `abandoned` are absent from it.
5. `EXTERNAL_WAITING_STATES`, `USER_ACTION_STATES`, `is_external_waiting`,
   `user_action_priority` no longer exist (import raises `ImportError`).

### A2: Ball enum and defaults

As the owner, I want a first-class Ball axis defaulting to `you`.

**Package:** `backend/` **File:** `models/enums.py`, `db/schema.sql`,
`api/schemas.py`, `api/v1/items.py` **Test file:** `tests/test_enums.py`,
`tests/test_items.py`

**Acceptance tests:**

1. `{m.value for m in Ball}` equals `{you, agent, person}`;
   `Ball.you.value == "you"`.
2. `POST /items` with only `{title}` returns `ball == "you"`,
   `dev_updated == prod_updated == docs_updated == announced == false`, and a
   non-empty `ball_changed_at` equal to the creation timestamp.
3. `POST /items {title, ball:"agent"}` returns `ball == "agent"`.
4. `POST /items {ball:"bogus"}` returns 422 whose detail names `ball`.
5. A freshly created item read back via `GET /tree` has no `blocked_external`
   key and includes `ball`, `ball_changed_at`, and the four ship booleans.

### A3: Ship-milestone booleans on all items

As the owner, I want four optional ship milestones on every item; as the
manager, I want them aggregated per container.

Milestones are stored on all items (leaf and container), freely settable but
retained-and-ignored on containers (N.8) -- no parent/leaf validation guard,
unlike `repo_url`/`usage`.

**Package:** `backend/` **File:** `api/schemas.py`, `api/v1/items.py`
**Test file:** `tests/test_items.py`

**Acceptance tests:**

1. `PATCH /items/{leaf} {docs_updated:true}` returns `docs_updated == true`,
   others still `false`.
2. `PATCH /items/{container} {announced:true}` succeeds (200) and returns
   `announced == true` (stored, not rejected) -- containers accept the field
   even though it is ignored for the container's own status.
3. Ticking a milestone does not change `state`, `ball`, `state_changed_at`, or
   `ball_changed_at`; it does stamp `updated_at`/`updated_by`.
4. `PATCH /items/{id} {dev_updated:"yes"}` (non-bool) returns 422.

---

## B. Derived status, actionability, leverage (backend)

### B1: Derived status precedence

As anyone, I want one status per item with fixed precedence.

Computed in `LeverageProjection` (`services/leverage.py`) per item; exposed on
tree/home rows. Precedence (first match wins), with containers owned by the
roll-up rule ahead of the terminal-Phase checks (N.9 overrides the stored
Phase of a container):

1. has children (container) -> `rollup`.
2. leaf, `state == done` -> `done`.
3. leaf, `state == abandoned` -> `dropped`.
4. leaf, not complete, any dependency target (own or inherited from an ancestor
   section) incomplete -> `blocked`.
5. leaf, `ball == agent` -> `monitoring`.
6. leaf, `ball == person` -> `waiting`.
7. leaf, `ball == you` -> `ready`.

Dependency-satisfaction reuses the existing `dependency_targets_by_id` +
`complete_by_id` (container target complete iff all descendants complete). A
missing id has no status.

**Package:** `backend/` **File:** `services/leverage.py`, `api/v1/items.py`,
`api/v1/home.py` **Test file:** `tests/test_priority.py`

**Acceptance tests:**

1. Leaf `state=not-started ball=you`, no deps -> `GET /tree` `status=="ready"`.
2. Leaf `ball=agent`, no incomplete dep -> `status=="monitoring"`.
3. Leaf `ball=person` -> `status=="waiting"`.
4. Leaf `ball=you` but depends on an incomplete leaf -> `status=="blocked"`
   (Ball loses to the dependency).
5. Leaf `ball=agent` AND an incomplete dependency -> `status=="blocked"`
   (rule 4 precedes rule 5).
6. Leaf `state=done` -> `status=="done"`; `state=abandoned` ->
   `status=="dropped"` (regardless of `ball`).
7. A container with children returns `status=="rollup"` even when its own stored
   `state=="done"` (N.9).
8. When the blocking dependency target becomes complete, the dependent leaf's
   `status` flips from `blocked` to the Ball-derived value on the next
   `GET /tree`.

### B2: Ready fresh-vs-resume predicate

As the owner, I want "never touched" and "mid-thought, has notes" to look
different.

`resume == true` iff `state != not-started` OR `has_notes` OR
`has_prompt_response_entries`; else `false`. Exposed on every tree row; the chip
uses it only when `status == ready` (sec.5). (Fresh = `status==ready &&
!resume`.) `home.py`'s `_row_to_home_tree_item` must populate `resume` too
(required on `TreeItemOut`).

**Package:** `backend/` **File:** `services/leverage.py`, `api/v1/items.py`,
`api/v1/home.py` **Test file:** `tests/test_priority.py`

**Acceptance tests:**

1. Leaf `state=not-started`, no notes, no prompt/response -> `resume==false`.
2. Same leaf after adding a note -> `resume==true`.
3. Leaf `state=defining`, no notes -> `resume==true`.
4. Leaf with >=1 prompt/response entry, `state=not-started` -> `resume==true`.

### B3: Actionability redefined; special-case sets and respond boost removed

As the owner, I want Up-Next actionability to mean "the Ball is mine and I can
act now".

`actionable(leaf) == leaf and not complete and all deps satisfied and
ball == you`. Equivalently `actionable <=> status == "ready"`. Ball in
`{agent, person}` excludes the leaf from actionability but NOT from
`Downstream(...)` membership. The `respond` priority boost is gone.

**Package:** `backend/` **File:** `services/leverage.py`
**Test file:** `tests/test_priority.py`

**Acceptance tests:**

1. Leaf `ball=you`, deps satisfied -> present in `GET /priority` and
   `actionable==true`.
2. Same leaf switched to `ball=agent` -> absent from `/priority`,
   `actionable==false`, but still counts toward an upstream item's leverage
   (upstream item's rank/order matches the case where the leaf were `ball=you`,
   because downstream membership is unchanged).
3. Leaf `ball=person` -> `actionable==false`, absent from `/priority`.
4. Two actionable leaves with equal leverage score: order is `updated_at` desc,
   then `created_at` desc, then `id` asc -- no `respond`/user-action tier is
   applied (a leaf that used to be `respond` gets no boost).

### B4: Leverage score and ordering preserved exactly

As the owner, I want the leverage formula unchanged.

`Downstream(L)` = every open leaf (not complete, not container) that depends on
`L` directly/transitively via own or ancestor-section edges; `score(L) = sum
over D in Downstream(L) of EFFORT_WEIGHT[D.effort]*MODE_WEIGHT[D.mode] /
EFFORT_WEIGHT[L.effort]`. Numeric score never exposed. Only the actionability
gate feeding the ordering changed (B3).

**Package:** `backend/` **File:** `services/leverage.py`
**Test file:** `tests/test_priority.py`

**Acceptance tests:**

1. For a fixed tree with all leaves `ball=you`, `/priority` rank order and
   membership are identical to the pre-rework baseline for the same tree with
   no `blocked_external` and no external-waiting states.
2. A `ball=agent` open leaf still appears in `Downstream(L)` of its dependency
   target (assert via the target's ordering, since score is not exposed).
3. `MODE_WEIGHT[prompt-agent]==2`, others `1`; `EFFORT_WEIGHT` = 1/3/8 -- an
   upstream item's rank reflects these weights on its downstream set.

### B5: Container roll-ups (manager data)

As the manager, I want per-container aggregates without expanding.

For each container, `rollup` aggregates over ALL descendant leaves:
`status_counts` (six buckets incl. `done`/`dropped`, N.11); `ship`
(per-milestone counts, `shipped` = leaves with all four true, `total` =
descendant-leaf count, N.12); `phase` = least-advanced `PHASE_ORDER` Phase among
OPEN (non-terminal) descendant leaves, or `None` when none are open (N.13). For
leaves, `rollup == null`. `home.py`'s `_row_to_home_tree_item` must populate
`rollup` too (required on `TreeItemOut`).

**Package:** `backend/` **File:** `services/leverage.py`, `api/v1/items.py`,
`api/v1/home.py` **Test file:** `tests/test_priority.py`

**Acceptance tests:**

1. Container with leaves {ready, monitoring, waiting, blocked, done, dropped}
   -> `rollup.status_counts` = 1 each; `rollup.ship.total == 6`.
2. `rollup.ship.shipped` counts only leaves with all four milestones true; a
   leaf with three of four does not count.
3. Open leaves at Phases {review, defining, released} -> `rollup.phase ==
   "defining"` (least advanced).
4. Container whose descendant leaves are all terminal -> `rollup.phase == null`
   and `status_counts` split across `done`/`dropped` only.
5. Nested containers: an intermediate container's `status_counts.total` counts
   leaves at any depth beneath it.
6. A leaf row has `rollup == null`.

---

## C. Item write behaviour (backend)

### C1: Ball change stamps timestamps and logs activity

As the owner, I want every Ball flip timestamped and audited.

In `update_item`, a `ball` in the payload that differs from the stored value:
sets `ball`, stamps `ball_changed_at = now` and `updated_at = now`/`updated_by`
(N.7), and inserts a `kind='ball-change'` activity row (from/to Ball). A `ball`
equal to the stored value is a no-op (no stamp, no activity). Phase-change
recording (`state_changed_at`, `completed_at`, `state-change` activity) is
unchanged.

**Package:** `backend/` **File:** `api/v1/items.py`
**Test file:** `tests/test_items.py`

**Acceptance tests:**

1. `PATCH {ball:"agent"}` on a `you` leaf -> `ball=="agent"`, `ball_changed_at`
   and `updated_at` advance, `state_changed_at` unchanged, and
   `GET /items/{id}/activity` gains one `{kind:"ball-change", from_ball:"you",
   to_ball:"agent"}` entry.
2. `PATCH {ball:"you"}` on a `you` leaf -> no new activity row,
   `ball_changed_at` unchanged.
3. `PATCH {ball:"agent"}` bumps `updated_at` so the item, once handed back to
   `you`, sorts above equal-score peers in `/priority` (N.7).
4. `PATCH {state:"spec"}` alone does not stamp `ball_changed_at` nor add a
   ball-change entry.

### C2: Hand-off note/date auto-clear when Ball leaves `person`

As the owner, I never want stale hand-off context (N.5).

When a PATCH sets `ball` to `you` or `agent`, the server clears `blocked_note`
and `blocked_followup_date` to null in the same write, regardless of whether the
payload mentioned them. Setting `ball=person` does not clear them (the payload
may set them together).

**Package:** `backend/` **File:** `api/v1/items.py`
**Test file:** `tests/test_items.py`

**Acceptance tests:**

1. Leaf with `ball=person`, `blocked_note="ask Sam"`,
   `blocked_followup_date="2026-07-10"`; `PATCH {ball:"you"}` -> `ball=="you"`,
   `blocked_note==null`, `blocked_followup_date==null`.
2. `PATCH {ball:"agent"}` from `person` likewise clears both.
3. `PATCH {ball:"person", blocked_note:"ask Sam",
   blocked_followup_date:"2026-07-10"}` stores both.
4. `PATCH {ball:"person"}` on an already-`person` leaf leaves an existing note
   intact (equal-value ball is a no-op; note untouched).

### C3: Terminal transitions preserve Ball; re-open forces Ball `you`

As the owner, closing an item must not rewrite its Ball, and re-opening it must
make it my move (N.6).

Marking `state` terminal (`done`/`abandoned`) leaves the stored `ball`
unchanged. A `state` change FROM a terminal Phase TO a non-terminal Phase, when
the payload does not itself set `ball`, forces `ball="you"`; if that differs
from the stored ball it stamps `ball_changed_at`, logs a `ball-change` entry,
and clears note/date (via C2). An explicit `ball` in the same payload wins.

**Package:** `backend/` **File:** `api/v1/items.py`
**Test file:** `tests/test_items.py`

**Acceptance tests:**

1. Leaf `ball=person`; `PATCH {state:"done"}` -> `ball` still `person`,
   `blocked_note` untouched, one `state-change` activity entry only.
2. That done leaf; `PATCH {state:"review"}` -> `ball=="you"`, a `ball-change`
   `{from_ball:"person", to_ball:"you"}` entry is added, note/date cleared.
3. Done leaf whose pre-terminal ball was `you`; `PATCH {state:"review"}` ->
   `ball=="you"` and NO ball-change entry (value unchanged).
4. `PATCH {state:"review", ball:"agent"}` on a done leaf -> `ball=="agent"`
   (explicit payload wins over the re-open default).

### C4: `ItemUpdate` field surface

As a client, I want the updated write contract.

`ItemUpdate` no longer accepts `blocked_external`; it accepts `ball`, the four
ship booleans, and (as before) `blocked_note`/`blocked_followup_date`,
`title`/`state`/`mode`/`effort`/`description`/`repo_url`/`usage`.

**Package:** `backend/` **File:** `api/schemas.py`, `api/v1/items.py`
**Test file:** `tests/test_items.py`

**Acceptance tests:**

1. `PATCH {blocked_external:true}` returns 200; the field is ignored (Pydantic
   default `extra='ignore'`) and the response contains no `blocked_external`
   key (nor does `GET /tree`).
2. `PATCH {}` (empty) is a 200 no-op leaving all fields unchanged.
3. `repo_url`/`usage` still 422 on a non-root item; ship booleans and `ball`
   do NOT 422 on non-root items (N.8).

---

## D. Activity log discriminated union (backend + restore heuristic)

### D1: Activity endpoint returns state-change and ball-change entries

As anyone, I want a truthful timeline of both Phase and Ball history.

`GET /items/{id}/activity` reads `item_state_changes` ordered by `created_at,
id` and maps each row by `kind` to `StateChangeActivityOut` (Phase from/to) or
`BallChangeActivityOut` (Ball from/to). Existing Phase history is preserved.

**Package:** `backend/` **File:** `api/v1/items.py`, `api/schemas.py`
**Test file:** `tests/test_items.py`

**Acceptance tests:**

1. A leaf patched `state not-started->spec` then `ball you->agent` returns two
   entries: `{kind:"state-change", from_state:"not-started", to_state:"spec"}`
   then `{kind:"ball-change", from_ball:"you", to_ball:"agent"}`.
2. Each entry carries `id`, `item_id`, `actor`, `created_at`.
3. Unknown item id -> 404.

---

## E. One-time data migration (backend)

### E1: Migrate rows and activity, drop `blocked_external`

As the operator, I want existing data upgraded once at startup.

A new `_run_once` migration `20260707_phase_ball_split` (registered in
`apply_schema` after the `_ensure_column` calls) runs against raw SQL (never
`State(...)`, so legacy `feedback`/`respond` strings parse safely). Those
`_ensure_column` calls first add the new `items` columns (`ball`,
`ball_changed_at`, the four ship booleans) and `item_state_changes.kind`
(default `'state-change'`) to upgraded DBs, so the discriminated-union read
cannot fail on an existing database. Steps, in order:

1. Derive Ball (only if `blocked_external` column exists) with fixed precedence
   `person > agent > you` (N.10): set `ball='agent'` where
   `blocked_external=0 AND state='implement'`; set `ball='person'` where
   `blocked_external=0 AND state='feedback'`; then set `ball='person'` where
   `blocked_external=1` (overrides). Rows that match nothing keep the column
   default `you` (covers `respond` and everything else).
2. Rewrite Phase: `UPDATE items SET state='released' WHERE state IN
   ('feedback','respond')`.
3. Rewrite activity (N.1): `UPDATE item_state_changes SET from_state='released'
   WHERE from_state IN ('feedback','respond')` and the same for `to_state`.
4. Backfill `ball_changed_at = state_changed_at` where `ball_changed_at = ''`
   (fall back to the migration timestamp when `state_changed_at` is null/empty).
5. Drop when present: `ALTER TABLE items DROP COLUMN blocked_external` (SQLite
   >= 3.35; runtime is 3.53).

Ship milestones default 0 via the column default. Idempotent: recorded in
`schema_migrations`; guarded so a fresh DB (no `blocked_external`, no rows)
completes as a no-op.

**Package:** `backend/` **File:** `db/migrate.py`, `db/schema.sql`
**Test file:** `tests/test_db.py`

**Acceptance tests:**

1. Seed a legacy `items` table (with `blocked_external`) row `state=implement,
   blocked_external=0`; after `apply_migrations` -> `state=='implement'`,
   `ball=='agent'`.
2. Legacy row `state=feedback, blocked_external=0, blocked_note='n',
   blocked_followup_date='2026-01-01'` -> `state=='released'`, `ball=='person'`,
   note/date carried forward.
3. Legacy row `state=respond, blocked_external=0` -> `state=='released'`,
   `ball=='you'`.
4. Legacy row `state=implement, blocked_external=1, blocked_note='n'` ->
   `ball=='person'` (N.10 override) and `blocked_note=='n'` retained.
5. Legacy `state=spec, blocked_external=0` -> `state=='spec'`, `ball=='you'`.
6. Legacy `item_state_changes` row `from_state=released, to_state=feedback` ->
   `to_state=='released'` (may collapse to a same-value transition; acceptable).
   No stored activity row references `feedback`/`respond` afterward.
7. After migration the `items` table has no `blocked_external` column
   (`PRAGMA table_info`), has `ball`, `ball_changed_at`, and the four ship
   columns, and every row has a non-empty `ball_changed_at`.
8. Running `apply_migrations` a second time makes no further changes and does
   not error (id already in `schema_migrations`).
9. A brand-new DB from `schema.sql` never has `blocked_external`, and the
   migration records itself without touching any row.
10. An existing DB whose `item_state_changes` predates this change gains a
    `kind` column defaulting to `'state-change'`, and every pre-existing
    activity row reads back as `kind=='state-change'`.

---

## F. Contracts sync (frontend)

### F1: Zod schemas mirror the new backend models

As a client, I want fail-fast validation of the new payloads.

**Package:** `frontend/` **File:** `lib/contracts.ts`
**Test file:** `tests/contracts.test.ts`

**Acceptance tests:**

1. `stateSchema.parse('defining')` succeeds; `stateSchema.safeParse('feedback')`
   and `.safeParse('respond')` both fail.
2. `ballSchema` accepts `you|agent|person` and rejects `bogus`.
3. `itemSchema.parse` of a backend item with `ball`, `ball_changed_at`, and four
   ship booleans succeeds; a payload still containing `blocked_external` fails
   (strict schema).
4. `treeItemSchema.parse` requires `status`, `resume`, and `rollup` (object or
   null); a container payload with a `rollup` object and a leaf payload with
   `rollup:null` both parse.
5. `itemActivitySchema` parses `{kind:'state-change', from_state, to_state,...}`
   and `{kind:'ball-change', from_ball, to_ball,...}`; a `state-change` object
   carrying `from_ball` fails, and vice versa (discriminated union).

---

## G. Frontend status derivation, labels, chip

### G1: Shared status derivation and labels

As the owner UI and manager UI, I want one status source relabelled per
audience.

**Package:** `frontend/` **File:** `lib/state-metadata.ts`
**Test file:** `tests/state-metadata.test.ts`

```typescript
export type ItemStatus = 'ready'|'monitoring'|'waiting'|'blocked'|'done'
  |'dropped'|'rollup'
export const PHASE_LABELS: Record<State, string>   // e.g. defining: 'Defining'
export const PHASE_OPTIONS: readonly {value: State; label: string}[]
export const BALL_LABELS: Record<Ball, string>     // you/agent/person
export const BALL_OPTIONS: readonly {value: Ball; label: string}[]
export const MANAGER_STATUS_LABELS: Record<
  Exclude<ItemStatus,'rollup'>, string>            // sec.8 relabelling
export function isResume(
  item: Pick<TreeItem,'state'|'has_notes'|'has_prompt_response_entries'>
): boolean
export function statusAfterBallChange(
  current: ItemStatus, ball: Ball): ItemStatus
```

`statusAfterBallChange`: returns `current` when it is
`blocked`/`done`/`dropped`/`rollup` (a Ball flip cannot change these);
otherwise `you->ready`,
`agent->monitoring`, `person->waiting`. `MANAGER_STATUS_LABELS` maps
ready->`On owner`, monitoring->`In flight (agent)`, waiting->`Waiting on
others`, blocked->`Blocked (other work)`, done->`Done`, dropped->`Dropped`.

`PHASE_LABELS`/`PHASE_OPTIONS` contain the nine Phases (no Feedback/Respond,
plus Defining). The obsolete `EXTERNAL_WAITING_STATES`, `isExternalWaitingItem`,
`itemReadiness`, `ItemReadiness` are removed; their behaviour is replaced by
`status`/`statusAfterBallChange` and the tests below (per testing-principles, no
test asserts mere removal).

**Acceptance tests:**

1. `PHASE_LABELS.defining === 'Defining'`; `PHASE_OPTIONS` has 9 entries and no
   `feedback`/`respond`.
2. `MANAGER_STATUS_LABELS.monitoring === 'In flight (agent)'` and
   `.blocked === 'Blocked (other work)'`.
3. `statusAfterBallChange('ready','agent') === 'monitoring'`;
   `statusAfterBallChange('waiting','you') === 'ready'`.
4. `statusAfterBallChange('blocked','you') === 'blocked'` (Ball cannot unblock).
5. `isResume({state:'not-started', has_notes:false,
   has_prompt_response_entries:false}) === false`; flipping any of the three to
   truthy returns `true`.

### G2: Readiness chip renders status with fresh/resume sub-label

As the owner, I want the chip to show all statuses and distinguish fresh from
resume.

The row chip renders the item's `status` label (`Ready`/`Monitoring`/`Waiting`/
`Blocked`/`Done`/`Dropped`). For `ready`, a resume affordance (e.g. a "resume"
dot / "Resume" text -- exact form at UI discretion) appears iff `item.resume`.
Row visual muting continues for terminal/monitoring/waiting items (replacing the
old external-waiting muting).

**Package:** `frontend/` **File:** `components/outliner-row.tsx`
**Test file:** `tests/outliner.test.ts`

**Acceptance tests:**

1. A `status='ready', resume=false` leaf shows a "Ready" chip with no resume
   affordance.
2. A `status='ready', resume=true` leaf shows the resume affordance alongside
   "Ready".
3. A `status='monitoring'` leaf shows "Monitoring"; `status='waiting'` shows
   "Waiting"; `status='blocked'` shows "Blocked".
4. A `status='dropped'` leaf shows "Dropped"; `status='done'` shows "Done".

---

## H. Owner views

### H1: Add the Monitoring view toggle

As the owner, I want a third work view.

`OUTLINER_VIEWS` gains `'monitoring'` (giving `['tree','up-next','follow-up',
'monitoring']`, before I1 adds a fifth `'manager'`) with a label `Monitoring`,
an aria-label, and a distinct icon, following the existing `view-controls`
pattern.

**Package:** `frontend/` **File:** `components/view-controls.tsx`
**Test file:** `tests/view-controls.test.ts`

**Acceptance tests:**

1. A toggle with accessible name "Show monitoring work" (or equivalent) and
   visible label "Monitoring" is present in the view control.
2. Clicking it calls `onViewChange('monitoring')`; `aria-pressed` reflects the
   active view.

### H2: View membership and ordering

As the owner, I want each view to show exactly the right items in the right
order.

Membership is by derived status: Up Next = `ready`; Follow Up = `waiting` (not
complete); Monitoring = `monitoring` (not complete). `blocked` items appear only
in Tree (collapsed as today) and in no action queue. Ordering:

- Up Next: leverage rank (existing `/priority` order via
  `effectivePriorityItems` / `localPriorityItems`), with the `respond`
  user-action tier removed from
  `localPriorityItems`/`compareLocalPriorityEntries`.
- Follow Up: overdue first (`blocked_followup_date` < today, local date), then
  ascending `blocked_followup_date` (null dates last), then ascending
  `ball_changed_at` (longest waiting first).
- Monitoring: ascending `ball_changed_at` (longest since it became `agent`
  first).

Pure ordering helpers in `lib/state-metadata.ts` (or `lib/outliner-views.ts`):

```typescript
export function compareFollowUp(a: TreeItem, b: TreeItem, today: string): number
export function compareMonitoring(a: TreeItem, b: TreeItem): number
```

**Package:** `frontend/` **File:** `components/outliner.tsx`,
`lib/state-metadata.ts` **Test file:** `tests/outliner.test.ts`,
`tests/state-metadata.test.ts`

**Acceptance tests:**

1. In `up-next`, a `ready` leaf is visible and a
   `waiting`/`monitoring`/`blocked` leaf is not.
2. In `follow-up`, `waiting` leaves are visible; `ready`/`monitoring`/`blocked`
   are not.
3. In `monitoring`, `monitoring` leaves are visible; others are not.
4. `compareFollowUp`: an item with past `blocked_followup_date` sorts before one
   with a future date; two future dates sort by soonest; two null dates sort by
   older `ball_changed_at` first.
5. `compareMonitoring`: the item with the older `ball_changed_at` sorts first.
6. A leaf that was `respond` (now `state=released, ball=you`) receives no
   Up-Next ordering boost over an equal-leverage peer.
7. A `blocked` leaf appears in Tree view and in none of the three work views.

### H3: Optimistic re-projection on hand-off

As the owner, flipping the Ball moves the item between views immediately.

After `patchItem({ball})`, the merged item's optimistic status uses
`statusAfterBallChange`, so a `you->agent` flip drops the leaf from Up Next and
adds it to Monitoring before the next tree refresh (mirrors today's optimistic
work-flag recompute). `patchAffectsPriorityMembership` treats a `ball` change as
membership-affecting.

**Package:** `frontend/` **File:** `components/outliner.tsx`
**Test file:** `tests/outliner-actions.test.ts`

**Acceptance tests:**

1. In Up Next, setting a visible `ready` leaf to `ball=agent` removes it from Up
   Next without a full reload.
2. Switching to Monitoring then shows that leaf.
3. Handing the Ball back to `you` returns it to Up Next.

---

## I. Manager projection

### I1: Manager surface with coarse status, Phase, and roll-ups

As the manager (and the owner), I want a read-only "how far + who is it blocked
on" projection (N.4 additive; exact surface at discretion -- implemented here
as a fifth view toggle: a `'manager'` member added to `OUTLINER_VIEWS` /
`OutlinerView`).

Per open leaf: the coarse `MANAGER_STATUS_LABELS[status]` plus the Phase label
(e.g. "On owner - Review"). Per container: the six-bucket `rollup.status_counts`
(compact counts/bar), the `rollup.ship` summary, and the derived
`rollup.phase` label (or nothing when null). Terminal leaves show Done/Dropped.
Available to both `owner` and `viewer`; the existing Tree / Up Next / Follow
Up / Monitoring surfaces remain unchanged for viewers.

**Package:** `frontend/` **File:** `components/outliner.tsx` (+ a manager
projection component), `components/view-controls.tsx`
**Test file:** `tests/outliner.test.ts`

**Acceptance tests:**

1. A `status='ready', state='review'` leaf renders "On owner" and "Review".
2. A `status='monitoring', state='implement'` leaf renders "In flight (agent)"
   and "Implement".
3. A `status='waiting', state='released'` leaf renders "Waiting on others" and
   "Released".
4. A container with `rollup.status_counts {ready:2, monitoring:1, waiting:0,
   blocked:1, done:3, dropped:0}` renders those six counts (Dropped present as a
   bucket) and its `rollup.phase` label.
5. The container ship summary reflects `rollup.ship` (e.g. `shipped`/`total`).
6. The projection renders for a `viewer` identity and does not remove the other
   view toggles.

---

## J. Ball token, one-key hand-off, hand-off editor

### J1: Ball inline token

As the owner, I want to set the Ball by typing a token.

Add a Ball token to `parseRow` using the `~` sigil (`~you`/`~agent`/`~person`),
matched case-insensitively against `ballSchema`; an unrecognised value is a
parse error, like `::state`. `ParsedRow` gains `ball?: Ball`. `submitRowText`
adds `ball` to the PATCH when parsed and changed. `@mode`, `!effort`, `::state`,
`>needs:` unchanged; `::` continues to set Phase.

**Package:** `frontend/` **File:** `lib/outliner-parse.ts`,
`lib/outliner-mutations.ts` **Test file:** `tests/outliner-parse.test.ts`,
`tests/outliner-actions.test.ts`

**Acceptance tests:**

1. `parseRow('Fix bug ~agent')` -> `{title:'Fix bug', ball:'agent'}`.
2. `parseRow('~PERSON note')` matches case-insensitively -> `ball:'person'`.
3. `parseRow('x ~bogus')` -> `{ok:false, error:/ball/i}`.
4. `parseRow('Ship it ::review ~you @merge')` sets `state:'review'`,
   `ball:'you'`, `mode:'merge'`.
5. `submitRowText` on an item currently `ball=you` with text `'... ~agent'`
   issues `patchItem(id,{ball:'agent'})`; text with `'~you'` (unchanged) issues
   no ball patch.

### J2: One-key hand-off control

As the owner, I want single-key hand-off from the focused row.

Each leaf row shows a keyboard-focusable Ball control displaying the current
Ball (token/sigil). With it focused, one key hands the Ball to `agent`, another
takes it back to `you` (exact bindings at UI discretion; a third for `person` is
allowed). The keys do not type into the title Input.

```typescript
export function ballHandoffKey(key: string): Ball | null  // a->agent, y->you
```

**Package:** `frontend/` **File:** `components/outliner-row.tsx`,
`lib/state-metadata.ts` **Test file:** `tests/outliner.test.ts`,
`tests/state-metadata.test.ts`

**Acceptance tests:**

1. `ballHandoffKey` maps the "to agent" key to `'agent'`, the "to you" key to
   `'you'`, and any other key to `null`.
2. Pressing the "to agent" key on a focused `you` leaf's Ball control calls
   `onChangeBall(item,'agent')`; pressing "to you" on an `agent` leaf calls
   `onChangeBall(item,'you')`.
3. The Ball control exposes an accessible name including the current Ball.
4. A container row shows no Ball control (Ball is ignored on containers).

### J3: Hand-off note/date popover editor

As the owner, I want to capture who/what and a follow-up date when I hand the
Ball to a person (N.3).

A popover/inline editor attached to the Ball control, surfaced when
`ball==='person'`, captures `blocked_note` (text) and `blocked_followup_date`
(date) together and PATCHes them. Because the backend clears both when Ball
leaves `person` (C2), each `person` hand-off starts empty and no prior note
reappears.

**Package:** `frontend/` **File:** `components/outliner-row.tsx` (+ editor
component) **Test file:** `tests/outliner.test.ts`

**Acceptance tests:**

1. Setting a leaf to `ball=person` reveals the note/date editor; setting it to
   `you`/`agent` hides it.
2. Entering note "ask Sam" and date "2026-07-10" and saving issues
   `patchItem(id,{blocked_note:'ask Sam',
   blocked_followup_date:'2026-07-10'})`.
3. A leaf whose backend note/date were cleared (after leaving `person`) shows an
   empty editor on the next `person` hand-off.

### J4: Accessible date-input primitive

As a developer, I want a reusable date input (none exists today, N.3).

`components/ui/date-input.tsx`: a controlled, accessible date field (label /
aria, ISO `yyyy-mm-dd` value, empty allowed) used by the hand-off editor and
available for reuse.

**Package:** `frontend/` **File:** `components/ui/date-input.tsx`
**Test file:** `tests/date-input.test.ts`

**Acceptance tests:**

1. Renders with an accessible name from its label/aria and reflects its `value`.
2. Changing the value calls `onChange` with an ISO `yyyy-mm-dd` string.
3. Clearing the field calls `onChange` with `''` (empty).

---

## K. Container behaviour, ship UI, restore, timeline

### K1: Done checkbox removed from containers; leaves keep it

As the owner, I want no way to directly close a container (N.9); its
status/completeness is purely a descendant roll-up.

The done checkbox renders only on leaves (already gated by `parent_id !== null`;
now also gated to leaves -- a container never shows it). The Phase `<select>`
already hides on containers; keep it hidden. Container completeness stays
derived from descendants (unchanged `is_complete`).

**Package:** `frontend/` **File:** `components/outliner-row.tsx`
**Test file:** `tests/outliner.test.ts`

**Acceptance tests:**

1. A container row renders no "Mark item done" checkbox and no Phase select.
2. A leaf row still renders the done checkbox and Phase select.
3. Checking a leaf's done checkbox issues `patchItem(id,{state:'done'})`;
   unchecking a done leaf restores a prior Phase (K3).

### K2: Ship-milestone checkboxes (leaf) and rollup (container)

As the owner, I want to tick ship steps per leaf; as the manager, see progress.

Leaf detail panel gains a "Ship milestones" section: four checkboxes bound to
`patchItem` (`dev_updated`/`prod_updated`/`docs_updated`/`announced`). A
container's detail shows the read-only `rollup.ship` summary. Ticking is
independent and never changes Phase or Ball.

**Package:** `frontend/` **File:** `components/comments-panel.tsx`
**Test file:** `tests/outliner-comments-live.test.ts`

**Acceptance tests:**

1. A leaf detail shows four milestone checkboxes reflecting the item's booleans.
2. Ticking `docs_updated` issues `patchItem(id,{docs_updated:true})` and does
   not send `state` or `ball`.
3. A container detail shows a ship-progress summary (from `rollup.ship`) and no
   editable milestone checkboxes.

### K3: Un-done restore heuristic ignores ball-change entries

As the owner, un-checking done restores the correct Phase; interleaved Ball
events must not corrupt it (N.2).

`previousDoneStateFromActivity` filters to `kind==='state-change'` entries
before scanning for the pre-done Phase. The un-done flow PATCHes only `state`
to the restored Phase; the backend forces `ball='you'` (C3), so the re-opened
item is unambiguously the owner's move.

**Package:** `frontend/` **File:** `components/outliner.tsx`
**Test file:** `tests/outliner-newitem-live.test.ts`

**Acceptance tests:**

1. Activity `[{kind:'state-change',from:'spec',to:'done'}]` restores `spec` when
   the done checkbox is unchecked.
2. Activity `[{state-change spec->done}, {ball-change you->agent}]` still
   restores `spec` (ball entries skipped), not a ball value.
3. With no restorable state-change history, restore falls back to `not-started`.

### K4: Detail-panel timeline renders both activity kinds

As anyone, I want to read Phase and Ball history in the detail panel.

The activity section renders `state-change` entries as a Phase transition
(`PHASE_LABELS[from] -> PHASE_LABELS[to]`) and `ball-change` entries as a Ball
transition (`BALL_LABELS[from] -> BALL_LABELS[to]`), each with actor and
timestamp, ordered as returned.

**Package:** `frontend/` **File:** `components/comments-panel.tsx`
**Test file:** `tests/outliner-comments-live.test.ts`

**Acceptance tests:**

1. A `state-change` entry renders "Spec -> Done" (labelled), actor, timestamp.
2. A `ball-change` entry renders "You -> Agent" (labelled), actor, timestamp.
3. Mixed entries render in the returned order.

---

## L. Workflow -> model mapping (sec.13, authoritative)

### L1: Each workflow row maps to one (Phase, Ball) -> status cell

As the product owner, I want the canonical workflow table encoded as tests, at
the backend `GET /tree` boundary (authoritative status), with the frontend
manager label asserted per G1.

**Package:** `backend/` + `frontend/` **File:** `services/leverage.py`,
`lib/state-metadata.ts` **Test file:** `tests/test_priority.py`,
`tests/state-metadata.test.ts`

**Acceptance tests** (each: build the leaf, read `status`/`resume`, and check
`MANAGER_STATUS_LABELS[status]`):

1. Idea, no dep: `state=not-started, ball=you` -> `status=ready`,
   `resume=false`; manager "On owner".
2. Idea, unfinished dep: `state=not-started` + incomplete dependency ->
   `status=blocked`; manager "Blocked (other work)".
3. Thinking/notes: `state=defining, ball=you` -> `status=ready`, `resume=true`;
   manager "On owner".
4. Spec Q&A, my turn: `state=spec, ball=you` -> `status=ready`; "On owner".
5. Spec Q&A, external answer needed: `state=spec, ball=person` ->
   `status=waiting`; "Waiting on others".
6. Spec generating: `state=spec, ball=agent` -> `status=monitoring`; "In flight
   (agent)".
7. Implementing: `state=implement, ball=agent` -> `status=monitoring`; "In
   flight (agent)".
8. Build & manually test: `state=review, ball=you` -> `status=ready`; "On
   owner".
9. Re-trigger pr-resolver: `state=review, ball=you` -> `status=ready`; "On
   owner".
10. Waiting on pr-resolver/bugfix: `state=review, ball=agent` ->
    `status=monitoring`; "In flight (agent)".
11. Ship step (merge/release/docs/announce): `state=merged, ball=you` ->
    `status=ready`; "On owner".
12. Asked users, awaiting feedback: `state=released, ball=person` ->
    `status=waiting`; "Waiting on others".
13. Nothing left: `state=done` -> `status=done`; manager "Done" (Ball has no
    effect on derived status).

---

## Implementation Order

1. **Backend model + migration (A, E).** Enums, schema columns, `_ensure_column`
   wiring, the `20260707_phase_ball_split` `_run_once` migration. Foundation for
   everything; tests in `test_enums.py`, `test_db.py`.
2. **Backend derivations (B).** Status precedence, `resume`, redefined
   actionability, preserved leverage, container roll-ups in
   `LeverageProjection`; expose on `TreeItemOut`/home. Tests in
   `test_priority.py`. Builds on 1.
3. **Backend writes + activity (C, D).** Ball PATCH side-effects, auto-clear,
   terminal/re-open rules, ship PATCH, discriminated-union activity + endpoint.
   Tests in `test_items.py`. Builds on 1.
4. **Contracts (F).** Zod schemas + `PatchItemInput`. Gate for frontend work.
   Builds on 1-3.
5. **Frontend derivation + chip + tokens (G, J1).** `state-metadata.ts`,
   readiness chip, `~ball` parsing. Builds on 4.
6. **Frontend views + manager (H, I, L-frontend).** Monitoring toggle,
   status-based membership + ordering, optimistic re-projection, manager
   surface. Builds on 5.
7. **Frontend row controls + editors + panel (J2-J4, K).** One-key hand-off,
   hand-off popover, date-input primitive, container done-checkbox removal, ship
   UI, restore-heuristic filter, timeline. Builds on 5-6.

Phases 2 and 3 are parallel after 1; phases 6 and 7 are parallel after 5.

## Appendix: Key Decisions

- **Stored column stays `state`; new column `ball`.** Minimises churn to the
  activity table (`from_state`/`to_state`), the `::` token, `state_changed_at`,
  and every `_ITEM_COLUMNS` list, while the product/spec concept names are
  "Phase" and "Ball" (prompt.md sec.4.1/15 allow this).
- **Status computed in the backend projection, mirrored in the frontend for
  optimism.** Blocked depends on dependency-satisfaction, which only the backend
  computes; exposing one `status` field keeps a single source of truth and makes
  acceptance tests concrete at the HTTP boundary, matching the existing
  `actionable`/`complete` pattern. `actionable <=> status=='ready'` retained for
  back-compat.
- **Activity reuses `item_state_changes` + a `kind` discriminator (no second
  table, N.2).** Ball rows store their from/to values in the existing text
  columns; the API maps by `kind` into a Pydantic/Zod discriminated union. The
  N.1 rewrite targets only the `feedback`/`respond` strings, so ball rows are
  untouched.
- **`blocked_external` is dropped via `ALTER TABLE ... DROP COLUMN`** (SQLite
  3.53 supports it) inside the one-time migration, after deriving Ball, guarded
  by column existence so fresh DBs are unaffected.
- **Re-open forces `ball='you'` server-side** (C3) rather than relying on the
  client, so any path out of a terminal Phase is unambiguously the owner's move.
- **Discretion choices stated, not turned into user-facing requirements:** `~`
  Ball sigil; one-key bindings (`a`/`y`, optional `p`); the resume affordance
  form; the manager surface as a distinct view toggle; ship-milestone placement
  in the detail panel; the roll-up visual (counts/bar). The fixed value sets
  (`you`/`agent`/`person`; the seven-value status; the four milestones) and the
  derivations are the requirements.

**Testing strategy.** Backend: `pytest` + `httpx.AsyncClient`/`ASGITransport`
against `app`, asserting status codes and JSON payloads; migration tests seed a
legacy table then assert post-`apply_migrations` state (a supported boundary).
Frontend: Vitest contract tests (`.parse`/`.safeParse`), pure-function unit
tests for derivation/ordering, and component tests for chip/views/controls.
Follow **testing-principles** (behaviour at supported boundaries; no assertions
on mere removal of old artifacts) and the **nextjs-fastapi-implementor** /
**nextjs-fastapi-reviewer** skills.
