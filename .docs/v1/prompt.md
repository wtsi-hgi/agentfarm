# AgentFarm v1 - Feature Description

This is the requirements brief that seeds the spec-writer workflow for
AgentFarm v1. It is the evolving source of truth for requirements. Genuinely
open product decisions are listed at the end for the clarifying loop to resolve
with the user; the spec-author should not invent answers to them.

## 1. Problem and context

The primary user is a developer orchestrating many LLM agents across many
software products at high velocity. Work and new product ideas appear faster
than traditional tooling can keep up with.

Existing tools have been tried and rejected:

- Jira / Asana: creating cards is slow and awkward; understanding work across
  products in separate projects is worse; some products have no project at all
  because ideas need working on before an admin can create one.
- A high-level Google Sheets spreadsheet: categorisation constantly changes as
  products are better understood and broken down, and the user never remembers
  to update it.
- A private markdown-checklist note app (current habit): cannot be shared with
  the user's manager; it is an unwieldy flat list that must be repeatedly
  rescanned; it cannot express dependencies, "what can I do in parallel now",
  mode-of-work grouping, or priority ordering.

What is needed is a near-zero-friction tracker that is also live-shareable with
the user's manager on the internal network, and that (in v2) becomes the
interface for running the agents themselves.

## 2. v1 goal

A single internal web app to capture, organise, and share ad-hoc software
development tasks across many products at markdown-checklist entry speed, with
computed views that tell the user what to work on next.

## 3. Users, sharing, deployment

- Primary user: the developer running the agent farm (single author in v1).
- Manager: live access to the same data (sharing is a core requirement, not an
  afterthought).
- Internal network only; no public exposure; simple authentication.
- Runs as a long-lived service on a VM (required for v2 - see Architecture).

## 4. Architecture constraints

- Start from a wholesale copy of the wtsi-hgi/llm-knowledge-base repository
  (excluding its skills) as the scaffold.
- Inherited stack: Next.js 16 (App Router) + React 19 + shadcn/ui + Tailwind
  CSS v4 (TypeScript) frontend; FastAPI + Uvicorn (Python 3.11) backend;
  Next.js Server Actions call FastAPI directly; Zod-typed contracts across the
  boundary; Vitest (frontend) + pytest/httpx (backend) for tests.
- Persistence: a single-file SQLite database (simple to run and back up on a
  VM). The database is the source of truth.
- The backend must be a long-lived process on the VM (not serverless or edge),
  because v2 will spawn local CLI agents on that VM.
- Leave two seams for v2 but do NOT build v2: (a) the data model must let an
  item own many later "runs"; (b) there must be a backend service boundary for
  "spawn a local CLI process and stream its output", reusable by both
  natural-language entry and v2 agent-running.
- One-way export: on every change, render the whole model to a human-readable
  markdown checklist file committed to git, giving a diffable history, a
  familiar artefact, and a safety net (mirrors the user's current habit).

## 5. Core model

- A single tree of items. Root items are "products"; any item may have
  arbitrarily nested child items (tasks, subtasks, and deeper). The user's real
  data is deeply hierarchical, so nesting depth is unbounded.
- Re-categorisation must be cheap and is a first-class need: rename an item,
  move a subtree to a new parent, promote an item to a product, split one
  product into several, and merge items. This directly addresses the
  "categorisation constantly changing" pain.
- Lifecycle state per item, covering at least: not-started, spec, implement,
  review, merged, released, plus done and abandoned. Not every item traverses
  every stage; some items are single actions (for example "merge a PR" or
  "release").
- Next-action mode per item: the kind of attention the item needs next, from a
  small fixed set:
  - prompt-agent: prompt an agent to feed it more work
  - review: manually review agent output and file bug feedback
  - merge: merge a PR
  - release: release software to users
  - spec: spec a new product or feature
  Modes drive the "work now" lanes.
- Dependencies: a cross-cutting directed acyclic graph over items (item X
  "needs" item Y). Adding and removing a dependency must be trivial. Used to
  compute readiness and priority.
- Blocked-external flag: the item is waiting on an outside factor (for example
  user feedback) with an optional note and an optional follow-up/nudge date.
  This is distinct from being blocked by an internal dependency.
- Effort: a coarse estimate of how much of the user's own time the item needs
  (for example quick / medium / long). Used for priority.
- Timestamps retained for every item: created, last-updated, state-changed, and
  completed - needed for time filtering.

## 6. Readiness and priority (the heart of the tool)

- An item is "actionable now" when it is not done or abandoned, is not
  blocked-external, and all of its dependencies are satisfied.
- Priority is "unblock-leverage": actionable items are ranked so that work which
  is quick for the user but unblocks large or long-running downstream work rises
  to the top. The canonical example is "prompt an agent to start a multi-hour
  implementation": cheap for the user, unblocks hours of agent work, so it
  should sit at the top of the list.
- The score should rise as the item's own effort falls (quicker is higher) and
  rise with the amount, effort, or duration of the work it unblocks (count and
  effort of dependent items, especially prompt-agent or long-running ones).
  prompt-agent items are inherently quick-for-the-user and high-leverage, so
  they should naturally dominate the ordering.

## 7. Entry (zero-friction is the top requirement)

- v1 core, the guaranteed fast path: a single global quick-add bar with a terse,
  keyboard-first, one-line grammar available everywhere. Proposed starting
  grammar (to refine during specing):

  `#product @mode !effort >needs:other-item ::state free text title`

  for example `#wr @prompt-agent !quick >needs:wr-release jobrun docs update`.
  Tokens are optional and order-free; bare text creates an item under a default
  or last-used product.
- Quick edits from any view (change state, change mode, mark done, add a
  dependency) must each be one or two keystrokes.
- Natural-language entry (desirable): the user types plain English (for example
  "done the bakker merge; start jobrun docs; that one is blocked on the wr
  release") and an LLM applies the changes to the model. Because of the no-API
  constraint (see v2), this must shell out to an already-authenticated local
  claude/codex CLI - the same mechanism v2 uses - rather than a hosted API.

## 8. Views

- Home, "Work now, in parallel": all actionable items grouped into mode lanes
  (prompt-agent / review / merge / release / spec), each lane ordered by
  unblock-leverage. This is the default screen and answers "what can I do right
  now, and what is most worth doing first".
- Tree / per-product view: the full hierarchy, collapsible, showing each item's
  state, mode, and blocked/dependency badges; used for browsing and for bulk
  re-categorisation.
- Dependency view: see what blocks and is blocked by an item, and visualise the
  dependency chains enough to understand them.
- Time filter with saved markers:
  - Saved markers are named points in time (for example "Sprint review
    2026-06-29").
  - The user can filter to items created, changed, or completed since a marker,
    or between two markers. "Show only what changed since the last sprint
    review" must be a single click.

## 9. Markdown mirror

On every change, export the full model to a single human-readable markdown
checklist file and commit it to git. This is one-way (database to markdown),
giving a diffable history, a familiar artefact, and a safety net. It is not
re-imported in v1.

## 10. v2 (deferred - do NOT build, but keep the seam)

- AgentFarm becomes the interface for doing the work: from an item, the user
  launches the appropriate agent (claude code / codex) on the VM and views and
  streams its output inside the app, iterating (prompt, watch, feed back)
  in-system.
- Constraint: no API usage. It must use the user's enterprise OpenAI and
  Anthropic accounts via the official CLIs already authenticated on the VM
  (mirroring and streaming their input/output), not raw API keys.
- v1 obligations toward this: a persistent backend on the VM; a data seam where
  an item can own many runs; and a stubbed-but-unbuilt service boundary for
  "spawn a local CLI and stream its output" (WebSocket or SSE).

## 11. Non-goals for v1

- Running or streaming agents (this is v2).
- Multiple human authors, assignees, or comment threads (unless manager-edit is
  chosen - see open decisions).
- Jira / Asana / Slack integrations, notifications, or a mobile app.
- Bidirectional markdown synchronisation (export is one-way).
- Time tracking or clocking.

## 12. Open decisions for the clarifying loop

1. Manager access: read-only, or also edit and comment? (Affects auth and
   whether a multi-user model is needed in v1.)
2. Authentication on the internal network: reuse the llm-knowledge-base
   pattern, a shared login, or institutional SSO?
3. Natural-language entry in v1 (via a thin one-shot local-CLI call) versus
   deferring it to the v2 LLM layer. The one-line grammar is the guaranteed v1
   fast path; v1 must not be blocked on NL entry.
4. Exact lifecycle state set; whether single-action items (merge, release) use a
   reduced lifecycle; whether mode is an explicit field or derived from state;
   whether "blocked/waiting" is a mode or a separate flag.
5. The unblock-leverage formula and its inputs (effort scale, how downstream
   weight is computed); whether to surface the numeric score or only the
   ordering.
6. One-line quick-add grammar specifics (token set, delimiters, defaults).
7. Whether products are simply root items of the tree or a distinct entity, and
   exactly how promote / split / merge behave.
8. SQLite location and backup; whether the markdown mirror is committed to the
   agentfarm repo itself or to a separate data directory or branch.
