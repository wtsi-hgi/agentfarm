# AgentFarm — Work Phases, Ball-in-court, Readiness & Views — Feature Description

This is the consolidated, authoritative feature description for reworking
AgentFarm's item **state / readiness / view** systems, and the single source of
truth for the spec. It is internally consistent; there is no "supersedes"
layering to interpret. If anything here is ambiguous, stop and ask rather than
inventing behaviour.

This is a **modification of a shipped system**, not a greenfield build. §2
records exactly how the current system behaves so the change is understood as a
refactor-and-extend of existing fields, derivations, and views. Everything in
§2 not explicitly changed by §3 onward must keep working unchanged.

## 1. Problem and context

The primary user (the **owner**) is a developer orchestrating many LLM coding
agents across many software products at high velocity. A read-only **manager**
(the owner's boss, plus optionally named viewers) watches the same tree to see
what the owner is working on and how it is progressing. Both look at the same
items but need different things from them.

Today a single `state` field is asked to encode **three unrelated questions at
once**:

1. **How far along the pipeline is this item?** (`spec` → `implement` →
   `review` → `merged` → `released`)
2. **Whose court is the ball in right now?** — can the owner act, or are we
   waiting on an agent the owner launched, or on another person?
3. **Is it closed?** (`done` / `abandoned`)

Because these three axes are squashed into one enum, meaning has been patched on
with special-case sets (`EXTERNAL_WAITING_STATES = {feedback, implement}`,
`USER_ACTION_STATES = {respond}`) and a parallel `blocked_external` boolean.
This produces concrete failures, each of which maps onto the owner's real
workflow (§13):

- **"Ready" lies during automated work.** An item whose spec is being generated
  by an agent (`state = spec`) is `actionable = true` and surfaces in **Up
  Next** as if the owner can act — but the owner is only waiting on the agent.
  Meanwhile `implement` *is* hard-coded as external-waiting, so two identical
  "an agent I launched is cranking" situations render oppositely.
- **"Waiting" means three different things.** Blocked-on-a-dependency (resolves
  itself when the prerequisite completes), waiting-on-an-agent (glance at the
  output periodically; it will self-complete), and waiting-on-a-person (chase,
  may need nudging, may give up) all collapse to one indicator and all land in
  **Follow Up** — even though only the last is genuinely "follow up with
  someone."
- **"Not started" vs "I'm mid-thought with notes" is invisible.** Both look
  like `not-started` / ready. The owner needs to know "I was in the middle of
  scoping this, I already have notes, I should continue," and the manager needs
  "started but blocked on the owner's time" vs "not begun at all."
- **`feedback` and `respond` are not phases at all.** They are ball-in-court
  values ("waiting on a person" / "the owner's turn") wearing a phase costume,
  which is why they do not sit cleanly in the pipeline sequence.
- **`blocked_external` duplicates state meaning.** An item can be `review` +
  `blocked_external = true` and nothing says whether that is "an agent is
  running" or "I'm waiting on a human."

And crucially: **the owner and the manager see the same undifferentiated
`state`**, even though the owner needs a fine-grained action queue and the
manager needs a coarse "how far along, and who is this blocked on."

## 2. What exists today (baseline being changed)

Do not change any of this except where §3 onward says so. Research the codebase
to confirm exact behaviour; the summary below is the intended baseline.

### 2.1 Item fields (relevant subset)

- `state`: lifecycle stage; closed set of 10 values (see 2.2); default
  `not-started`. There is **no enforced transition state-machine** — state may
  be set freely, and single-action items skip stages that do not apply.
- `mode`: the kind of work; closed set of 5 (`prompt-agent`, `review`, `merge`,
  `release`, `spec`); default `prompt-agent`. Drives item colour-coding in the
  outliner and a leverage weight (2× for `prompt-agent`, else 1×).
- `effort`: `quick` / `medium` / `long` with weights 1 / 3 / 8; default
  `medium`.
- `blocked_external`: boolean, with `blocked_note` (text) and
  `blocked_followup_date` (date). "Blocked on an external event/person,"
  distinct from being blocked by a dependency.
- Timestamps: `created_at`, `updated_at`, `state_changed_at`, `completed_at`.
- Per-item derived fields exposed on the tree: `needs`, `needs_edges`,
  `actionable`, `complete`, `has_notes`, `has_prompt_response_entries`.
- Related entities already present: free-text **notes**, a **prompt/response**
  entry log, **comments**, and a **state-change activity log** (records
  `from_state` → `to_state` with actor + timestamp).

### 2.2 Current `state` values and semantic sets

`not-started, spec, implement, review, feedback, respond, merged, released,
done, abandoned`. Semantics layered on top:

- `COMPLETE_STATES = {done, abandoned}` → the item counts as complete.
- `EXTERNAL_WAITING_STATES = {feedback, implement}` → not actionable, but still
  counts as open downstream work for leverage; drives the **Follow Up** view.
- `USER_ACTION_STATES = {respond}` → gets a priority boost ("the next move is
  the owner's").

### 2.3 Current derivations

- **Actionable** (leaf only; containers are never actionable): leaf ∧ not
  complete ∧ not external-waiting(state) ∧ not `blocked_external` ∧ every
  dependency target on the item or an ancestor section is complete.
- **Readiness** (frontend chip): `done` if `state = done` or `complete`;
  `ready` if actionable and not external-waiting; else `waiting`.
- **Unblock-leverage / priority**: actionable leaves ordered by
  (`respond` boost, then leverage score, then `updated_at`, then `created_at`),
  descending. Leverage score and the downstream definition are unchanged by
  this feature and must be preserved exactly (see the v1 spec §7).

### 2.4 Current views

Three outliner views: **Tree**, **Up Next**, **Follow Up**.

- **Up Next**: item is in the priority ranking ∧ actionable ∧ not done ∧ not
  external-waiting.
- **Follow Up**: not done ∧ external-waiting (`blocked_external` ∨
  `state ∈ {feedback, implement}`).

## 3. Goal

Split the overloaded `state` into **two orthogonal, independently-meaningful
axes** — **Phase** (pipeline position) and **Ball-in-court** (whose court the
work is in) — plus the existing terminal disposition. Make the readiness
indicator, the outliner views, and a new manager-facing projection all clean
**derivations** of these two axes, replacing the hand-maintained special-case
sets. Every situation in the owner's real workflow (§13) must map to exactly one
(Phase, Ball) cell and render correctly and distinctly for both audiences.

## 4. Core model: two axes plus terminal disposition

### 4.1 Phase (the pipeline-position meaning of the current `state`)

Phase answers only "what kind of work is happening / how far along is it." It is
the current `state` field with the two impostor values removed and one new value
added. The field MAY be renamed to `phase` for clarity or MAY keep the column
name `state` with its meaning narrowed — that identifier choice is at
implementation discretion, but the **concept name used throughout the product
and spec is "Phase."**

Closed set of values (default `not-started`):

- `not-started` — captured as an idea; work has not begun.
- `defining` — **NEW.** The owner is personally scoping the item: thinking,
  researching, taking notes, drafting the prompt that will be handed to the
  spec-writer agent. This is the "I have started but it lives in my head / my
  notes" phase.
- `spec` — the spec is being produced (the spec-writer skill: an interactive
  Q&A sub-part, then a long automated generate-and-check sub-part).
- `implement` — the implementation agent is producing the code.
- `review` — the PR + manual-testing loop: pushing a branch, running the
  pr-resolver agent to fix CI and reviewer comments, and the owner building and
  manually trying the feature, cycling through bugfixes.
- `merged` — merged to the develop branch (dev integration).
- `released` — released to the main branch / production.
- `done` — terminal; nothing left to do.
- `abandoned` — terminal; will not be done.

Removed relative to today: `feedback` and `respond` (they become Ball values —
see §4.2 and §10). "Complete" still means Phase ∈ {`done`, `abandoned`}.

Preserve the v1 principle: **no enforced transition machine.** Phase is freely
settable; single-action items skip phases that do not apply (e.g. a trivial item
may jump `not-started` → `done`).

### 4.2 Ball-in-court (new axis)

Ball answers "whose court is the work in right now / what are we waiting on." It
is a new, first-class, owner-settable field. Concept name: **"Ball."** Closed
set of stored values (default `you`):

- `you` — the owner's move. The owner can and should act (think, answer the
  agent's questions, test the build, trigger an agent, merge, release, act on
  received feedback, …).
- `agent` — an automated agent the owner launched is running. Nobody needs to
  act; the owner just monitors and glances at the output periodically; it will
  self-complete. Covers spec generation, implementation, pr-resolver, and
  bugfix runs.
- `person` — waiting on an external person or event (someone must answer a spec
  question, a beta user must give feedback, an external event must occur). May
  stall; may need nudging; may be given up on.

Two derived, non-stored conditions take precedence over the stored Ball when
computing status (see §5): an item blocked by an **incomplete dependency**
behaves as its own "waiting on prerequisite work" situation regardless of the
stored Ball, and a **terminal** item (done/abandoned) has no Ball.

Ball carries an optional hand-off **note** and **follow-up date** — these are
the existing `blocked_note` and `blocked_followup_date` fields, generalised from
"the external-block note" to "the note/date for the current hand-off"
(principally used when Ball = `person`; see §10). The existing `blocked_external`
boolean is **removed** and its meaning is absorbed into Ball = `person`
(see §14 Migration).

**Ball applies to leaves.** Containers are structural and never actionable
(unchanged from today); a container's stored Ball is retained-but-ignored while
it has children, exactly as `mode`/`effort` already are (v1 §5.4). A container's
status is a roll-up of its descendants (§8).

**Hand-off is the highest-frequency status change in the whole app** — the owner
flips Ball constantly (I launched the agent → `agent`; the agent finished, my
turn → `you`; I asked a person → `person`; they answered → `you`). It MUST be
near-zero-friction: settable inline in the outliner (a token, §12) and via a
one-action control on the row (ideally a single keystroke to cycle/return the
ball).

## 5. Derived status (replaces the `done` / `ready` / `waiting` readiness chip)

There is **one derived status per item**, computed from Phase, Ball,
completeness, and dependency-satisfaction. The owner UI and the manager UI
render the **same underlying status value** with different labels/grouping (§7,
§8) — this single derivation is the whole point of the rework.

Status is computed with this precedence (first match wins):

1. Phase = `done` → **Done**.
2. Phase = `abandoned` → **Dropped**.
3. Item is a container → **Rollup** (not a leaf status; show the descendant
   roll-up, §8).
4. A dependency (own or inherited from an ancestor section) is incomplete →
   **Blocked** (waiting on prerequisite work; resolves automatically when the
   prerequisite completes — nobody is expected to act on the item itself).
5. Ball = `agent` → **Monitoring** (an agent is running; glance periodically).
6. Ball = `person` → **Waiting** (on an external person/event; may need
   chasing).
7. Ball = `you` (and, by elimination, a leaf, not complete, all dependencies
   satisfied) → **Ready** (the owner can act now).

**Ready sub-label — fresh vs resume.** A **Ready** item is *fresh* when Phase =
`not-started` and it has no notes and no prompt/response entries; otherwise it
is *in progress / resume* (Phase past `not-started`, or `has_notes`, or
`has_prompt_response_entries`). The chip must make this distinction visible so
"never touched" and "mid-thought, has notes, continue" no longer look
identical. The exact affordance (e.g. a "resume" dot) is at UI discretion; the
derivation is fixed.

Note the deliberate consequence: if the owner has set Ball = `you` but a
dependency is still incomplete, **Blocked wins** — the owner cannot actually act
yet. And Ball ∈ {`agent`, `person`} is never **Ready**, which fixes the
"'ready' lies during automated work" failure.

## 6. Actionability, leverage, and priority

- **Actionable (redefined):** a leaf that is not complete, has all dependencies
  (own + inherited) satisfied, **and has Ball = `you`.** This replaces today's
  "not external-waiting(state) ∧ not `blocked_external`" clause with "Ball =
  `you`." Equivalently: **Actionable ⟺ derived status = Ready.**
- Ball ∈ {`agent`, `person`} excludes an item from actionability but **not** from
  downstream membership — an open leaf still counts as downstream work for
  leverage exactly as external-waiting items do today. This generalises the
  existing `EXTERNAL_WAITING_STATES` behaviour to "Ball ≠ `you`."
- **Delete the special-case sets.** `EXTERNAL_WAITING_STATES` and
  `USER_ACTION_STATES` are removed. The `respond` priority boost is removed as a
  special case; "the owner's move" is now the general Ball = `you` signal that
  already defines the Up Next queue, so no separate boost is needed.
- **Leverage scoring is otherwise unchanged.** The downstream definition, the
  effort/mode weights, the `score = downstream_contributions / effort(L)`
  formula, and the tie-breaks (`updated_at`, then `created_at`, then id) are
  preserved exactly. Only the actionability gate feeding the ordering changes as
  above.

## 7. Views (owner)

The single editable outliner tree remains the only surface; each view is a
projection (filter/collapse/sort) of it, and the tree stays fully editable under
any view (v1 §9.2 behaviour is preserved, including the "added this session,
currently filtered out" affordance for freshly created items). Replace the
current two work-views with **three**:

- **Up Next** — items whose derived status is **Ready** (Ball = `you`,
  actionable), leverage-ordered exactly as the priority ranking (§6). This is
  the owner's do-now queue, and it now correctly includes "answer the agent's
  spec questions," "test the latest build," "trigger pr-resolver," "merge,"
  "release," and "act on received feedback," because all are Ball = `you`.
- **Follow Up** — items whose derived status is **Waiting** (Ball = `person`),
  not complete. This is now genuinely "people/events to chase." Show the
  hand-off note and follow-up date; **surface overdue items first** (follow-up
  date in the past), then by soonest follow-up date, then by longest time
  waiting. The feedback lifecycle (§10) lives here.
- **Monitoring** — **NEW view.** Items whose derived status is **Monitoring**
  (Ball = `agent`), not complete. This is the owner's "check the output once in
  a while" queue for the long automated runs (spec generation, implementation,
  pr-resolver, bugfix). Order by **longest time since the ball became `agent`
  first** (most likely to have finished / most overdue a check).

**Blocked** items (incomplete dependency) appear in the Tree view (collapsed as
today, per v1 §9.1) but are not in any of the three action queues — they resolve
themselves when their prerequisite completes.

Add the third view to the existing Tree / Up Next / Follow Up view control
(a new toggle + icon + aria-label, following the existing pattern).

## 8. Manager (viewer) projection

The manager reads the **same derived status** as the owner, relabelled into a
coarse "how far along + who is this blocked on" framing, plus the Phase for
progress. There is no new stored data for the manager — it is a relabelling and
roll-up of §5.

Per-leaf coarse status (a direct relabelling of the derived status):

| Derived status (§5) | Manager label            |
| ------------------- | ------------------------ |
| Ready               | **On owner**             |
| Monitoring          | **In flight (agent)**    |
| Waiting             | **Waiting on others**    |
| Blocked             | **Blocked (other work)** |
| Done                | **Done**                 |
| Dropped             | **Dropped**              |

Each item also shows its **Phase** so the manager sees progress along the
pipeline (e.g. "On owner · Review" answers "the review is blocked on him"; "In
flight · Implement" answers "an agent is building it").

**Roll-ups.** For containers/products, show a compact roll-up of descendant-leaf
coarse statuses (e.g. counts or a small bar: N on owner, N in flight, N waiting
on others, N blocked, N done). This lets the manager scan a product and see
where the outstanding work sits without expanding it.

This projection must be visible to the viewer role (read-only) and is equally
available to the owner (the owner can always see what their manager sees).
Whether it is a distinct "manager view" toggle, an always-on column, or a
per-row summary is at UI discretion, but the coarse status + Phase must be
readable at a glance for every open item and rolled up per container.

## 9. Ship milestones (merged / released checkboxes)

`merged` and `released` remain **two distinct phases** (the manager cares about
dev-integration vs production release). The finer, partly-optional ship actions
are represented as a small set of per-item **milestone checkboxes**, not as
extra phases or extra items. Default set (deliberate and tunable, §15):

- `dev_updated` — the dev environment has been updated to the new build.
- `prod_updated` — the production environment has been updated.
- `docs_updated` — user documentation has been updated.
- `announced` — relevant (beta) users have been told / feedback requested.

These are optional per item (not every item needs docs or an announcement). The
owner sees which ship steps remain; the manager sees ship progress. They are
independent booleans — ticking them does not enforce an order and does not by
itself change Phase or Ball. The "release to production" act is the Phase change
`merged` → `released`; the checkboxes are the auxiliary follow-on tasks around
it.

## 10. Feedback loop

Requesting and awaiting user feedback is expressed entirely with the axes above
plus the ship checklist — no new enum:

- **Want feedback but not yet asked** → Ball = `you`, with `announced`
  unchecked; the outstanding "request feedback" step shows in Up Next as the
  owner's move.
- **Asked, awaiting feedback** → Ball = `person`, `announced` checked, with the
  hand-off note (what/who) and a `follow-up date` = when to chase or give up.
  Appears in Follow Up; overdue when the follow-up date passes.
- **Feedback received, or gave up waiting** → the owner returns Ball to `you`
  (there is something to act on) or advances Phase toward `done`. Either way the
  item leaves Follow Up.

The manager therefore always sees, from the coarse status, whether an item is
still **Waiting on others** (feedback outstanding) or has moved back **On owner**
/ **Done**. No explicit "gave up vs received" enum is required; the resolution is
just the next Ball/Phase the owner sets.

## 11. Timestamps and activity log

- Keep a timestamp for the **last Phase change** (today's `state_changed_at`,
  narrowed to Phase) to drive manager progress and history.
- Add a timestamp for the **last Ball change** (e.g. `ball_changed_at`) to drive
  the Monitoring ordering ("longest since it became `agent`") and Follow Up
  staleness.
- The activity log currently records Phase (`state`) transitions; extend it to
  also record **Ball transitions** (actor + from/to + timestamp) so the manager
  gets a truthful timeline of both progress and hand-offs. Preserve the existing
  Phase-transition history.

## 12. Outliner tokens and near-zero-friction hand-off

The outliner supports frozen inline tokens per row (`@mode`, `!effort`,
`::state`, `>needs:slug`, per v1 §8.4). Update them for the two axes:

- The Phase token continues to set Phase (the value set is the §4.1 list; keep
  the `::` sigil bound to Phase, or rename if the field is renamed — token
  values are matched case-insensitively against the closed set, and an
  unrecognised value is a parse error, exactly as today).
- Add a **Ball token** (a new sigil, e.g. `~you` / `~agent` / `~person`; exact
  sigil at implementation discretion, §15) matched case-insensitively against
  the closed Ball set, unrecognised value = parse error.
- Because hand-off is the most frequent change (§4.2), also provide a
  one-action row control (keyboard-first) to set/cycle the Ball without typing a
  full token — e.g. a single key to hand the ball to an agent, and a single key
  to take it back.

`mode` and `effort` tokens are unchanged.

## 13. Workflow → model mapping (authoritative statement of intent)

This table is the canonical mapping from the owner's real workflow to the model,
and encodes the intended behaviour for both audiences. The spec's acceptance
tests should assert these mappings.

| Owner's situation                              | Phase          | Ball    | Derived status      | Owner sees                          | Manager sees                     |
| ---------------------------------------------- | -------------- | ------- | ------------------- | ----------------------------------- | -------------------------------- |
| Idea captured, no dependency                   | not-started    | you     | Ready (fresh)       | "start this"                        | On owner · Not started           |
| Idea captured, a dependency is unfinished      | not-started    | (dep)   | Blocked             | blocked by prerequisite             | Blocked · Not started            |
| Thinking / researching / taking notes          | defining       | you     | Ready (resume)      | "continue — you have notes"         | On owner · Defining              |
| Spec Q&A: the agent is asking, my turn         | spec           | you     | Ready               | "answer the agent's questions"      | On owner · Spec                  |
| Spec Q&A: need an answer from someone else     | spec           | person  | Waiting             | "waiting on ⟨who⟩" + follow-up date | Waiting on others · Spec         |
| Spec generating (long automated run)           | spec           | agent   | Monitoring          | "agent running — check output"      | In flight · Spec                 |
| Implementing (automated run)                   | implement      | agent   | Monitoring          | "agent running — check output"      | In flight · Implement            |
| Need to build & manually test the latest       | review         | you     | Ready               | "test the latest build"             | On owner · Review                |
| Need to (re)trigger pr-resolver                | review         | you     | Ready               | "launch pr-resolver"                | On owner · Review                |
| Waiting on pr-resolver / bugfix agent          | review         | agent   | Monitoring          | "agent running — check output"      | In flight · Review               |
| Merge to dev / release / docs / announce step  | merged/released| you     | Ready               | next ship step (checklist)          | On owner · Merged/Released       |
| Asked users, awaiting feedback                 | released       | person  | Waiting             | delegate + follow-up + give-up      | Waiting on others · Released     |
| Nothing left, not waiting on anything          | done           | —       | Done                | ✓                                   | Done                             |

Notes on the review row set: per an explicit product decision, the review phase
uses a **single Ball** at any instant (whichever is the real blocker right now),
even though pr-resolver and manual testing can overlap. Do **not** model two
simultaneous review sub-tracks.

## 14. Migration from current data

One-time migration of existing rows:

- **Phase** = current `state` for every value except the two removed ones:
  - `feedback` → Phase `released`, Ball `person` (awaiting feedback is a
    post-release person-wait; acceptable one-time heuristic).
  - `respond` → Phase `released`, Ball `you` (the owner's move to act on
    feedback).
  - all other states map to the identically-named Phase.
- **Ball** for non-`feedback`/`respond` rows:
  - `implement` (was external-waiting = an agent running) → Ball `agent`.
  - `blocked_external = true` → Ball `person` (carry `blocked_note` /
    `blocked_followup_date` forward as the hand-off note/date).
  - everything else → Ball `you` (safe default; the owner re-flips as needed,
    including any `spec` items that were mid-generation).
- Remove the `blocked_external` boolean once its meaning is migrated into Ball.
- Initialise `ball_changed_at` from `state_changed_at` (or the migration time).
- Ship-milestone checkboxes default unchecked.

## 15. Deliberate defaults (tunable)

Chosen defaults, called out so acceptance tests can assert them and so they can
be tuned later without re-litigating the design:

- Ball default = `you`; Phase default = `not-started` (unchanged).
- Monitoring order = longest-since-ball-became-`agent` first; Follow Up order =
  overdue first, then soonest follow-up date, then longest waiting.
- Ship-milestone set = {`dev_updated`, `prod_updated`, `docs_updated`,
  `announced`}.
- Ball inline token sigil and the one-key hand-off binding are implementation
  choices; the closed value set (`you` / `agent` / `person`) is fixed.
- Field identifiers (`phase` vs retained `state`; `ball` vs `waiting_on`) are
  implementation choices; the concept names ("Phase," "Ball") are fixed.

## 16. Non-goals / out of scope

- **`mode` is unchanged and out of scope** beyond continuing to feed the
  leverage weight and the outliner colour-coding. Ball does not replace mode.
  (Its conceptual overlap with Phase may be revisited in a later change.)
- **No two-track review parallelism** — a single Ball per item at all times
  (§13 note).
- **No enforced Phase/Ball transition state-machine** — both remain freely
  settable (v1 §5.3 principle preserved).
- Dependency mechanics, the leverage score/formula, comments, markers, the
  markdown mirror, authentication/authorisation, and the v2 runs/spawn seams are
  all unchanged by this feature.
- No notifications, no external integrations, no time tracking.

## Notes

These clarifications resolve gaps found by researching the current codebase.
They are authoritative and take precedence over any looser reading of the
sections above.

### N.1 Legacy activity-log rows for removed Phase values

The one-time migration (§14) also rewrites historical activity-log rows (the
`item_state_changes` records that store `from_state` → `to_state`) using the
same mapping applied to item rows: any `from_state` or `to_state` equal to
`feedback` becomes `released`, and any equal to `respond` becomes `released`.
After migration, no stored activity row references the removed `feedback` /
`respond` values, so the Phase enum, the backend activity contract
(`ItemActivityOut`), and the frontend activity schema (Zod `itemActivitySchema`)
need only accept the new closed Phase set (§4.1). A previously distinct
transition (e.g. `released` → `feedback`) may collapse into a same-value
transition after rewriting; that is an accepted consequence of rewriting rather
than retaining the legacy labels.

### N.2 Recording Ball transitions in the activity log

Ball transitions (§11) are recorded in the **same** activity feed as Phase
transitions, modelled as a discriminated union rather than a second table. The
activity contract (backend `ItemActivityOut` and the frontend Zod schema) gains
a `kind` discriminator with two variants: `state-change` (Phase `from`/`to`, as
today) and a new `ball-change` (Ball `from`/`to`). The detail-panel timeline
renders both kinds. The existing "un-done" restore heuristic that scans activity
to pick the Phase to restore (`previousDoneStateFromActivity`) must consider
only `state-change` entries, so interleaved Ball events cannot corrupt Phase
restoration. Preserve the existing Phase-transition history (§11).

### N.3 Entering the hand-off note and follow-up date

The hand-off note and follow-up date (the generalised `blocked_note` /
`blocked_followup_date`, §4.2/§10) are entered through a small popover / inline
editor attached to the row's Ball control, surfaced when Ball = `person`, that
captures the note and the follow-up date together. This keeps the hand-off
near-zero-friction and co-located with the Ball change (§4.2/§12). The component
library has no date-input primitive today, so an accessible date-input primitive
must be added to support this editor.

### N.4 Audience scope of the manager projection

The manager projection (§8) is **additive** for both roles: it is an additional
surface (view/column/row-summary, exact form at UI discretion) that both the
owner and viewers can see, and viewers continue to see the existing Tree / Up
Next / Follow Up / Monitoring surfaces unchanged. It does not replace or hide
any viewer surface, and it introduces no viewer-only default. Authorization and
the viewer role are otherwise unchanged (§16).

### N.5 Hand-off note/date lifecycle when Ball leaves `person`

When the owner moves the Ball away from `person` (to `you` or to `agent`), both
the hand-off note and the follow-up date are automatically cleared. Each
`person` hand-off therefore starts with an empty note/date, Follow Up never
shows stale hand-off context, and a prior note cannot reappear on a later
hand-off. The note/date are meaningful only while Ball = `person`.

### N.6 Ball value across terminal transitions and re-open

Marking an item terminal (`done` / `abandoned`) does not mutate the stored Ball:
the pre-terminal Ball is preserved, and its transitions remain in the activity
history (a terminal item still has no *derived* Ball/status per §5 — this
concerns only the stored field). When an item is re-opened (the existing
un-done / Phase-restore behaviour), the Ball is forced to `you`. A re-opened
item is therefore unambiguously the owner's move and never silently reappears in
Monitoring or Follow Up.

### N.7 A Ball change bumps `updated_at`

A Ball change stamps `updated_at = now`, exactly like any other field edit
(today's uniform `update_item` behaviour), in addition to stamping the new
`ball_changed_at` (§11). As a result, handing the ball back to `you` floats the
item to the top among equal-leverage items in Up Next via the priority
ordering's `updated_at` tie-break (§6 ordering otherwise unchanged). This is
intended: a hand-off back to `you` is exactly when the item should surface.

### N.8 Scope of the ship-milestone fields

The four ship-milestone booleans (§9) are stored on **all** items as columns,
mirroring `mode` / `effort` / Ball: freely settable, but retained-and-ignored on
containers (a container's ship progress is the roll-up of its descendants, per
§8). They are neither root-only (unlike `repo_url` / `usage`) nor leaf-only, so
`ItemUpdate` imposes no parent/leaf validation guard on them. They default
unchecked (§14).

### N.9 A container's stored terminal Phase never overrides its roll-up

A container's derived status is always the descendant roll-up (§5 rule 3 owns
containers). A container's own stored Phase — including `done` / `abandoned`
arriving via migration or a Phase token — never drives its status or its
completeness. Container completeness stays derived solely from descendants
(preserving today's `is_complete` behaviour), so a dependency on a container is
satisfied only when all of that container's descendants are complete; the
container's own stored Phase is irrelevant to dependency-satisfaction.

To remove any possibility of confusion, the "done" checkbox is **removed from
container rows**: the UI offers no way to directly set a container's status or
completeness, reinforcing that a container's status/completeness is purely a
roll-up of its descendants. (The done checkbox remains on leaves, unchanged.)

### N.10 Migration Ball precedence for rows matching multiple signals

When a single existing row matches more than one §14 Ball signal,
`blocked_external` wins: `blocked_external = true` maps the row to Ball =
`person` and carries the existing `blocked_note` / `blocked_followup_date`
forward as the hand-off note/date — even when the row's `state` is `implement`
(which would otherwise map to `agent`) or `respond` (which would otherwise map
to `you`). Only when `blocked_external` is false is the Ball derived from state
(`implement` → `agent`, `respond` → `you`, `feedback` → `person`, everything
else → `you`, per §14). This guarantees a real block note is never silently
dropped during migration. Behaviourally this equals a fixed `person` > `agent` >
`you` precedence over the candidate signals; the override phrasing is chosen for
clarity and is scoped to the one-time migration only.

### N.11 Manager per-container roll-up: status buckets

The per-container status roll-up (§8) is a faithful aggregate, over all
descendant leaves, of the six per-leaf coarse statuses, with a distinct count
for each bucket: **On owner**, **In flight (agent)**, **Waiting on others**,
**Blocked (other work)**, **Done**, and **Dropped**. Terminal leaves are counted
(Done and Dropped are their own buckets). The §8 example's five-bucket list is
illustrative shorthand and does not exclude Dropped.

### N.12 Manager per-container ship-progress summary

In addition to the status roll-up, each container shows a compact ship-progress
summary that aggregates the four ship-milestone booleans (§9) across its
descendant leaves (for example, per-milestone completed counts, or "N/M
descendants fully shipped"). The exact visual form is at UI discretion (§8, N.4),
but some container-level ship-progress aggregate must be present so the manager
can scan a product's ship status without expanding it. The ship milestones
remain retained-and-ignored on the container's own row (N.8); this summary is
derived from the descendant leaves.

### N.13 Manager per-container derived Phase

The Phase shown for a container in the manager projection (§8) is the
**least-advanced** Phase (the earliest in the pipeline order `not-started` →
`defining` → `spec` → `implement` → `review` → `merged` → `released`) among the
container's **open** (non-terminal) descendant leaves. When a container has no
open descendant leaves it has no derived Phase — it reads as Done or Dropped from
the status roll-up (N.11). This derived Phase is a manager-projection display
value only; it does not change the container's stored Phase (still
roll-up-ignored, N.9), its completeness, or dependency-satisfaction.
