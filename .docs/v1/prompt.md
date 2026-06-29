# AgentFarm v1 - Feature Description

This is the consolidated, authoritative feature description for AgentFarm v1 and
the single source of truth for the spec. It is internally consistent: there is
no "supersedes" layering to interpret. If anything here is ambiguous, stop and
ask rather than inventing behaviour.

## 1. Problem and context

The primary user is a developer orchestrating many LLM agents across many
software products at high velocity. Work and new product ideas arrive faster
than traditional tooling can keep up with.

Tools already tried and rejected: Jira / Asana (slow card creation, cross-
project visibility poor, a project-creation bottleneck for new products); a
high-level spreadsheet (categorisation churns and never gets updated); a private
markdown-checklist note app (cannot be shared with the user's manager, is an
unwieldy flat list, and cannot express dependencies, parallelism, mode-of-work,
or priority).

AgentFarm is a near-zero-friction tracker that is also live-shareable with the
user's manager on the internal network, and that in a later v2 becomes the
interface for running the agents themselves.

## 2. v1 goal

A single internal web app to capture, organise, and share software development
work across many products at the speed of editing a markdown checklist, with a
computed view that shows what to work on next.

## 3. Users, sharing, deployment

- Owner: the developer who runs the agent farm; has full read/write.
- Manager and named team members: live access; can read everything and comment.
- Internal network only; no public exposure.
- Runs as a long-lived service on a VM (required for v2; see section 15).

## 4. Architecture and stack

- Build by wholesale-copying the wtsi-hgi/llm-knowledge-base scaffold (excluding
  its skills) and building on it.
- Inherited stack: Next.js 16 (App Router) + React 19 + shadcn/ui + Tailwind CSS
  v4 (TypeScript) frontend; FastAPI + Uvicorn (Python) backend; Next.js Server
  Actions call FastAPI directly (browser never sees the backend URL); Zod-typed
  contracts validate everything crossing the boundary; Vitest (frontend) and
  pytest + httpx (backend) for tests.
- Persistence: a single-file SQLite database; the database is the source of
  truth.
- The backend is a long-lived process on the VM (not serverless/edge), because
  v2 will spawn local agent CLIs there.
- Scaffold note: the scaffold's `.gitignore` has a Python-style `lib/` rule that
  accidentally un-tracks `frontend/lib/` (backend-client, contracts, etc.),
  although they are imported everywhere. When copying the scaffold, restore and
  un-ignore those files.

## 5. Data model

### 5.1 Item tree

- Everything is an item in a single tree. Root items (parent is null) are
  "products"; any item may have arbitrarily nested children. Nesting depth is
  unbounded.
- A leaf is an item with no children. A container is an item with at least one
  child. The same item can move between the two as children are added or
  removed (see 5.4).

### 5.2 Item fields

- id: stable internal identifier (never changes).
- title: free text, freely editable.
- slug: a human-facing label derived from the current title, uniqueness-suffixed
  on collision. It re-derives whenever the title changes. Slugs are used only
  for display and for typing `>needs:slug` in the outliner; they are NOT used as
  stored references (see 6.4).
- parent and sibling order: define the item's position in the tree.
- state: lifecycle stage (see 5.3).
- mode: the kind of attention the item needs next (see 5.3).
- effort: the user's own time cost (see 5.3).
- blocked_external: a boolean flag with an optional note and an optional
  follow-up/nudge date. Distinct from being blocked by a dependency.
- authorship and last-editor: who created and who last edited the item.
- timestamps: created, last-updated, state-changed, and completed.

### 5.3 Frozen enums and defaults

- state: exactly these eight values (closed set): not-started, spec, implement,
  review, merged, released, done, abandoned. There is no enforced transition
  state-machine; state may be set freely, and single-action items simply skip
  stages that do not apply. New items default to not-started. "Complete" means
  state is done or abandoned.
- mode: exactly these five values (closed set): prompt-agent, review, merge,
  release, spec. New items default to prompt-agent.
- effort: one of quick, medium, long, with numeric weights 1, 3, 8. New items
  default to medium.

### 5.4 Leaf / container transition

- A container's stored mode and effort are RETAINED but ignored while it has
  children: containers are structural - they are not directly actionable and do
  not contribute to priority sums.
- When a container loses its last child it becomes a leaf again and its retained
  mode and effort apply once more.
- A container is complete exactly when all of its children are complete.

## 6. Dependencies and sequencing

"X needs Y" means X depends on Y: Y must be complete before X can be worked, and
X is downstream of Y. The dependency graph is always acyclic (implicit and
explicit edges combined); adding an edge that would create a cycle is rejected
with a clear error.

### 6.1 Implicit dependencies (from tree structure)

Sibling order means sequence; nesting means sub-section.

- Sibling chain: among the children of one parent, each item depends on its
  immediately preceding sibling (depends on the previous one only). A list under
  one parent is therefore a single sequential chain; parallelism comes from
  having multiple products/sub-sections, not from siblings.
- Sub-section completion: a container is complete only when all its children are
  complete, so the item following the container (the container's next sibling)
  cannot start until the whole sub-section is complete.
- Sub-section entry: the first child of a container cannot start until the
  container is reached, i.e. until the container's own predecessor is complete.

Worked example. Outline (indentation shows nesting):

    A
    B
      B1
      B2
    C

Resulting dependencies and readiness:

- A depends on nothing, so A is workable first.
- B1 (first child of B) depends on A, so B1 becomes workable once A is complete.
- B2 depends on B1.
- B is a container: complete only when B1 and B2 are complete; B is not itself
  directly workable.
- C depends on B, so C cannot start until the whole B sub-section is complete.

### 6.2 Implicit edges are real and editable

Implicit dependencies are ordinary edges in the same graph as explicit ones.
They are generated from the tree structure and regenerated for the affected
sibling groups whenever the structure changes (typing, indent/outdent, reorder,
drag-and-drop, delete). Because they are ordinary edges, the user can remove one
implicit edge to let two specific siblings run in parallel.

### 6.3 Explicit dependencies

Typed in the outliner as `>needs:slug` (repeatable for multiple dependencies),
for dependencies that the tree structure does not express (typically across
products or branches).

### 6.4 References are stored by id

Explicit dependencies are stored by target item id, not by slug. `>needs:slug`
is resolved to the target's id at entry time. When a title changes and its slug
re-derives, every place the slug is shown (other items' `>needs:` labels, the
markdown mirror) updates to the new slug, while the underlying id-based edges are
unchanged, so references always keep resolving. Churn in the mirror's `needs:`
labels on rename is accepted.

## 7. Readiness and priority (unblock-leverage)

### 7.1 Actionable

A leaf item is actionable when it is not complete, not blocked_external, and all
of its dependencies (implicit and explicit) are satisfied (each needed item is
complete). Containers are never directly actionable.

### 7.2 Unblock-leverage score

Priority ranks actionable work so that things that are quick for the user but
unblock large or long-running downstream work rise to the top (the canonical
case: "prompt an agent to start a multi-hour job" is cheap and unblocks a lot).

For an actionable leaf L:

- Downstream(L) = every item that depends on L directly or transitively (over
  the combined implicit + explicit graph) and is an open leaf (not complete; not
  a container).
- Each downstream leaf D contributes effort(D) x mode_weight(D), where
  mode_weight is 2 if D's mode is prompt-agent, else 1. (Long downstream work is
  already weighted via effort = 8, so there is no separate long multiplier.)
- score(L) = sum of downstream contributions / effort(L).

Only the resulting ordering is shown, never the numeric score. These weights are
a deliberate, tunable default chosen so acceptance tests can assert exact
orderings.

### 7.3 Tie-break and sort scope

- When two actionable items have equal scores, order them by most-recently-
  updated first, then newest-created, then id.
- The leverage ordering is a DISPLAY ordering only; it never changes stored
  sibling order or the implicit dependencies derived from it. It applies where
  items are independently actionable - primarily across products (root items)
  and among any siblings whose implicit chain edge has been removed.

## 8. Entry: the keyboard outliner

The primary and only creation surface is a keyboard-driven outliner, like
editing a markdown checklist in a note-taking app. There is no separate one-line
quick-add bar.

### 8.1 Typing and structure

- Type anywhere: items can be inserted and typed at any point in the tree and at
  any depth, not only under product roots.
- Enter: create a new item as the next sibling of the current item; it
  implicitly depends on the previous sibling.
- Tab (indent): the current item becomes the first child of the preceding item,
  which thereby becomes a container; subsequent Enters create further items
  within it.
- Shift-Tab (outdent): move up one level, creating an item that is a sibling of
  the former parent; it implicitly depends on that parent, i.e. on the whole
  preceding sub-section completing.

### 8.2 Structured, identity-preserving editing

The outliner is structured: each row is bound to a stored item by id (it is not
a raw-text blob re-parsed from scratch). It supports creating, editing text in
place, indent/outdent, reordering, and deleting items. All structural changes
preserve item identity, so explicit `>needs:` references, dependencies, and
comments survive edits; implicit edges for the affected sibling groups are
regenerated.

### 8.3 Drag-and-drop

Items and whole sub-sections (subtrees) can be moved by drag-and-drop to a
different position, a different level (reparent), or a different product, in
addition to keyboard indent/outdent. Cross-product subtree moves are allowed.
The same identity-preservation and implicit-edge-regeneration rules apply.

### 8.4 Inline tokens per row

Each row may carry frozen inline tokens for per-item metadata, in any order:
`@mode`, `!effort`, `::state`, and `>needs:slug` (repeatable). Token values are
matched case-insensitively against the closed enum sets; an unrecognised value
is a parse error reported to the user. `#product` is NOT used in the outliner -
the section is implied by where you type.

## 9. The unified view (work-now projection plus filters)

There is a single primary view: the one editable outliner tree. "What to work on
next" is not a separate screen; it is a projection (filter, collapse, colour, and
sort) of that same tree. Filters and sorts compose.

### 9.1 Work-now projection

- Collapse, not remove: branches that are not actionable now (blocked by
  dependencies, blocked_external, completed, and the interior of chains) are
  collapsed by default. The full tree structure stays present and any collapsed
  part expands with one action so you can read or type into it.
- Mode by colour: every item is identified by its mode through obvious colour
  coding; no text badge is needed, since the tree structure gives context.
- Mode toggles (this is how mode-of-work is surfaced - not grouping): a toggle
  per mode filters the tree to show only items of the selected mode(s). With no
  mode selected, all items show, colour-coded by mode.
- Leverage sort: orders work so the highest unblock-leverage actionable items
  surface to the top (display-only, per 7.3).

### 9.2 Editable under any filter

- The tree stays fully editable under any filter: type anywhere, drag-and-drop,
  and expand collapsed parts to edit.
- A newly created item stays visible in the current filtered view even if the
  active filter would otherwise hide it (for example a brand-new item is non-
  actionable and would be hidden by work-now). It is shown with an "added this
  session, currently filtered out" affordance until the view is explicitly
  refreshed or re-filtered, at which point the filter applies normally. This
  keeps capture friction-free.
- Because there is no global capture bar, the UI must make it fast to jump to any
  product or point in the tree (for example a product switcher / quick jump).

### 9.3 Time markers and windows

- A marker is a named point in time (for example "Sprint review 2026-06-29").
- The user can filter to items created, changed, or completed since a marker, or
  between two markers. "Show only what changed since the last marker" must be one
  action.

## 10. Re-categorisation

Categorisation changes constantly as products are better understood, so these
must be cheap, and are available via both keyboard outlining and drag-and-drop:

- rename: edit an item's title.
- move: move a subtree to a new parent or position.
- promote: reparent an item to root, so it becomes a product.
- split: create one or more new root items and move subtrees under them.
- merge: reparent one item's children under another item, then remove the
  emptied item.

## 11. Comments

- Comments are a first-class entity attached to items, each authored by an
  authenticated user with a timestamp.
- Whitelisted non-owner users (viewers) can add comments. An author may edit or
  delete only their own comments (even the owner cannot edit another user's
  comment).
- Comments are flat (not threaded).
- Comments are NOT written to the markdown mirror.

## 12. Markdown mirror

- On every change, render the full item tree (in tree order, as a nested
  markdown checklist reflecting item state) and commit it.
- The commit goes to a dedicated git repository initialised inside the data
  directory (see 14) - not the agentfarm app repo and not a branch of it -
  isolating runtime commit churn from application history.
- The export is one-way (database to markdown); it is not re-imported in v1.
- Skip the commit if the rendered output is unchanged. Comments are excluded.

## 13. Authentication and authorization

Mirrors the approach in wtsi-hgi/wa (cmd/results.go and internal/authldap),
translated to Python/FastAPI.

### 13.1 LDAP

- Direct bind with a DN template. Configure (via env) the LDAP server address
  and a bind-DN template containing a username placeholder (`{username}` or
  `%s`). Validate at startup that the template contains the placeholder.
- To authenticate, substitute the submitted username into the template and bind
  with the submitted password; a successful bind means authenticated. Use a
  maintained Python LDAP client (for example ldap3). The username is the user's
  identity.

### 13.2 Owner and whitelist

- The owner has full create/edit/restructure rights over all items. The owner
  username defaults to the OS user that started the service and is overridable by
  env (for example AGENTFARM_OWNER). On LDAP login, the authenticated user whose
  username equals the owner username gets the owner role. (Optionally, a 0600
  owner-token file in the data dir may grant owner access to local/automation
  clients, mirroring wa; the primary web path is the username match.)
- A configured access whitelist lists the allowed LDAP usernames (the manager and
  named team members). The owner is implicitly allowed. An LDAP user who
  authenticates but is neither the owner nor whitelisted is denied access
  entirely. A whitelisted non-owner gets the viewer role: read everything and add
  comments, but no item edits.

### 13.3 Sessions and TLS

- The session is held in an httpOnly cookie set at the Next.js layer; route
  middleware enforces authentication; mutations are guarded to owner-only.
- The app serves over HTTPS. TLS cert/key paths are configurable via env; if none
  are supplied, it auto-generates a self-signed certificate on startup.
- Self-signed operation must work end to end: internal service-to-service calls
  (Server Actions to FastAPI) accept the self-signed certificate instead of
  failing verification, and deployment docs explain accepting the browser
  warning. This deliberately relaxes strict-TLS verification, which is acceptable
  for an internal-network tool.

## 14. Storage and configuration

- The SQLite database file and the markdown mirror both live in a configurable,
  gitignored data directory (for example AGENTFARM_DATA_DIR), outside the app
  source tree.
- Environment configuration includes at least: the data directory; LDAP server
  and DN template; owner override; access whitelist; and TLS cert/key paths.

## 15. v2 (deferred) and required v1 seams

- v2 (NOT built in v1): AgentFarm becomes the interface for doing the work - from
  an item, launch the appropriate agent (claude code / codex) on the VM and view
  and stream its output in the app, iterating in-system. Constraint: no API
  usage; use the user's enterprise OpenAI/Anthropic accounts via the official
  CLIs already authenticated on the VM, not raw API keys.
- v1 must leave these seams (present but unbuilt): a data-model seam where an item
  can own many later "runs" (for example a runs table plus an empty/stub
  endpoint); and a stubbed "spawn a local CLI and stream output" service boundary
  (for example returning 501) over WebSocket/SSE.
- Natural-language entry is also deferred to v2 (it depends on the same local-CLI
  mechanism). v1 ships only the keyboard outliner.

## 16. Non-goals for v1

- Running or streaming agents, and natural-language entry (all v2).
- Any human editing of items beyond the owner; non-owners may only comment.
- Threaded comments.
- Jira / Asana / Slack integrations, notifications, or a mobile app.
- Bidirectional markdown sync (the mirror is one-way).
- Time tracking or clocking.
