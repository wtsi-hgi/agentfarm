"""Pydantic models used across the API layer."""

from typing import Literal, Self

from pydantic import BaseModel, Field, StrictBool, model_validator

from models.enums import Ball, Effort, Mode, State


class MessageResponse(BaseModel):
    """Standard message response model."""

    message: str


class HealthResponse(BaseModel):
    """Health check response model."""

    status: str


class NotImplementedResponse(BaseModel):
    """Response model for intentionally unimplemented v2 seam endpoints."""

    detail: str


class LoginRequest(BaseModel):
    """Request body for ``POST /auth/login`` (spec: K1)."""

    username: str
    password: str


class WhoAmI(BaseModel):
    """Authenticated identity returned by auth endpoints (spec: K1/K2)."""

    username: str
    role: Literal["owner", "viewer"]


class FarmContext(BaseModel):
    """Public farm identity used to label which owner's UI is being viewed."""

    owner_username: str


class LoginResponse(WhoAmI):
    """Authenticated identity plus the backend-issued session token."""

    session_token: str


class ItemCreate(BaseModel):
    """Request body for ``POST /items`` (spec: A1/A2).

    Only ``title`` is required. ``parent_id``/``after_id`` place the item in the
    tree; when provided, ``after_id`` must be a sibling in the requested parent
    group. ``mode``/``effort``/``state``/``ball`` default to the documented
    values. The enum-typed fields make FastAPI reject an out-of-set token with
    HTTP 422 whose ``detail`` names the offending field.
    """

    title: str
    parent_id: str | None = None
    after_id: str | None = None
    mode: Mode = Mode.prompt_agent
    effort: Effort = Effort.medium
    state: State = State.not_started
    ball: Ball = Ball.you


class ItemUpdate(BaseModel):
    """Request body for ``PATCH /items/{id}`` (spec: A2/A3).

    Every field is optional. The distinction the endpoint relies on is *which
    fields the client actually sent*, recovered via ``model_fields_set`` /
    ``model_dump(exclude_unset=True)``: an omitted field is left unchanged,
    while an explicit ``null`` for a nullable field (``blocked_note`` /
    ``blocked_followup_date``) clears it. The ``None`` defaults below only make
    the fields optional; they are never treated as "clear" unless the field is
    in ``model_fields_set``.

    Enum-typed fields make FastAPI reject an out-of-set token with HTTP 422
    whose ``detail`` names the offending field, matching create (A1).
    """

    title: str | None = None
    state: State | None = None
    mode: Mode | None = None
    effort: Effort | None = None
    blocked_note: str | None = None
    blocked_followup_date: str | None = None
    dev_updated: StrictBool | None = None
    prod_updated: StrictBool | None = None
    docs_updated: StrictBool | None = None
    announced: StrictBool | None = None
    description: str | None = None
    repo_url: str | None = None
    usage: str | None = None


class MoveRequest(BaseModel):
    """Request body for ``POST /items/{id}/move`` (spec: G1).

    Both fields are optional and nullable. ``new_parent_id`` is the destination
    parent; ``None`` (sent explicitly or simply omitted) promotes the item to a
    root/product. Cross-product moves are allowed. ``position="first"`` places
    the moved item at the start of the destination sibling group. The default
    ``position="after"`` preserves the legacy contract: ``after_id`` positions
    the moved item immediately after that sibling, or appends it at the end of
    the group when omitted/null.
    """

    new_parent_id: str | None = None
    after_id: str | None = None
    position: Literal["first", "after"] = "after"

    @model_validator(mode="after")
    def first_position_has_no_anchor(self) -> Self:
        """Keep first-position moves unambiguous."""
        if self.position == "first" and self.after_id is not None:
            raise ValueError("after_id cannot be used with position='first'")
        return self


class MarkerCreate(BaseModel):
    """Request body for ``POST /markers`` (spec: I1)."""

    name: str
    at: str | None = None


class MarkerOut(BaseModel):
    """Response model for a named time marker (spec: I1)."""

    id: str
    name: str
    at: str
    created_at: str


class CommentCreate(BaseModel):
    """Request body for ``POST /items/{id}/comments`` (spec: J1)."""

    body: str


class CommentUpdate(BaseModel):
    """Request body for ``PATCH /comments/{id}`` (spec: J1)."""

    body: str


class NoteCreate(BaseModel):
    """Request body for recording an item note."""

    body: str


class NoteUpdate(BaseModel):
    """Request body for editing an item note."""

    body: str


class PromptResponseEntryCreate(BaseModel):
    """Request body for recording an item prompt or response timeline entry."""

    kind: Literal["prompt", "response"]
    body: str


class ScratchpadUpdate(BaseModel):
    """Request body for autosaving the singleton farm scratchpad."""

    body: str | None = None
    height: int | None = Field(default=None, ge=120, le=640)
    minimized: bool | None = None


class DependencyCreate(BaseModel):
    """Request body for ``POST /dependencies`` (spec: D1).

    ``from_id`` is the depending item or section. Callers may provide either a
    resolved ``to_id`` or a typed ``needs_slug``; the endpoint resolves slugs at
    creation time and always stores the edge by id.
    """

    from_id: str
    to_id: str | None = None
    needs_slug: str | None = None

    @model_validator(mode="after")
    def target_is_unambiguous(self) -> Self:
        """Require exactly one supported target reference form."""
        has_to_id = self.to_id is not None
        has_needs_slug = self.needs_slug is not None
        if has_to_id == has_needs_slug:
            raise ValueError("provide exactly one of to_id or needs_slug")
        return self


class DependencyOut(BaseModel):
    """Response model for a dependency edge visible in the Details UI."""

    id: str
    from_id: str
    to_id: str
    kind: Literal["explicit"]


class CommentOut(BaseModel):
    """Response model for a flat item comment (spec: J1)."""

    id: str
    item_id: str
    author: str
    body: str
    created_at: str
    updated_at: str


class NoteOut(BaseModel):
    """Response model for a dated item note."""

    id: str
    item_id: str
    created_by: str
    body: str
    created_at: str
    updated_at: str


class PromptResponseEntryOut(BaseModel):
    """Response model for an item prompt/response timeline entry."""

    id: str
    item_id: str
    kind: Literal["prompt", "response"]
    created_by: str
    body: str
    created_at: str


class ScratchpadOut(BaseModel):
    """Response model for the singleton scratchpad."""

    body: str
    height: int
    minimized: bool
    updated_by: str | None
    updated_at: str | None


class ItemActivityOut(BaseModel):
    """Response model for timestamped item activity in the detail panel."""

    id: str
    item_id: str
    kind: Literal["state-change"]
    actor: str
    from_state: State
    to_state: State
    created_at: str


class RunOut(BaseModel):
    """Response model for a stub item run (spec: M1)."""

    id: str
    item_id: str
    status: Literal["pending"]
    created_at: str


class ItemOut(BaseModel):
    """Response model for a single item (spec: A1/A2).

    Mirrors the persisted ``items`` row. Enum fields serialise to their exact
    lowercase string values; timestamps are ISO-8601 UTC strings; nullable
    columns are ``None`` when unset.
    """

    id: str
    title: str
    slug: str
    parent_id: str | None
    sort_order: float
    state: State
    ball: Ball = Ball.you
    mode: Mode
    effort: Effort
    blocked_note: str | None
    blocked_followup_date: str | None
    dev_updated: bool = False
    prod_updated: bool = False
    docs_updated: bool = False
    announced: bool = False
    description: str
    repo_url: str | None
    usage: str
    created_by: str
    updated_by: str
    created_at: str
    updated_at: str
    state_changed_at: str
    ball_changed_at: str = ""
    completed_at: str | None


class PriorityItemOut(ItemOut):
    """A ranked actionable leaf from GET ``/priority`` (spec: E1)."""

    rank: int


class HomePriorityItemOut(BaseModel):
    """Compact priority rank carried by the initial home payload."""

    id: str
    rank: int


class DeletedResponse(BaseModel):
    """Response model for delete endpoints.

    Confirms the delete by echoing the removed resource id. Item deletion (A4)
    also relies on schema cascades for subtrees, comments, runs, and incident
    dependency edges; dependency deletion (D3) removes only the requested edge.
    """

    deleted: bool
    id: str


class TreeDependencyEdgeOut(BaseModel):
    """Dependency identity exposed with a tree row's typed ``>needs:`` label."""

    id: str
    slug: str
    automatic_chain: bool = False


class TreeItemOut(ItemOut):
    """A single item as returned by GET ``/tree`` (spec: A3, extended by H1).

    Carries every :class:`ItemOut` field plus ``needs``: the *current* slugs of
    this item's visible ``>needs:`` dependency targets, resolved live from each
    edge's ``to_id`` so a renamed target's label updates automatically (Core
    domain rules / A3). Automatic ordinary-leaf chain rows are included because
    they are persisted as removable explicit dependencies. ``needs_edges``
    carries the matching dependency edge ids so clients that parse row text can
    reconcile removals through the supported delete endpoint without guessing.

    ``actionable`` is the current work-now predicate from
    :func:`services.leverage.is_actionable`; ``complete`` is the recursive
    structural predicate from :func:`services.tree.is_complete` (H1). These
    are display/projection flags only: GET ``/tree`` still returns every item.
    ``has_notes`` and ``has_prompt_response_entries`` tell the outliner whether
    a row already has dated notes or agent timeline records to open.
    """

    needs: list[str]
    needs_edges: list[TreeDependencyEdgeOut]
    actionable: bool
    complete: bool
    has_notes: bool
    has_prompt_response_entries: bool


class HomePayloadOut(BaseModel):
    """Authenticated payload for the initial home page render."""

    owner_username: str
    session: WhoAmI
    items: list[TreeItemOut]
    priority_items: list[HomePriorityItemOut]
    markers: list[MarkerOut]
    scratchpad: ScratchpadOut
