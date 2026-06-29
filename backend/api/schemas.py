"""Pydantic models used across the API layer."""

from typing import Literal, Self

from pydantic import BaseModel, model_validator

from models.enums import Effort, Mode, State


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


class ItemCreate(BaseModel):
    """Request body for ``POST /items`` (spec: A1).

    Only ``title`` is required. ``parent_id``/``after_id`` place the item in the
    tree; ``mode``/``effort``/``state`` default to the documented values. The
    enum-typed fields make FastAPI reject an out-of-set token with HTTP 422
    whose ``detail`` names the offending field.
    """

    title: str
    parent_id: str | None = None
    after_id: str | None = None
    mode: Mode = Mode.prompt_agent
    effort: Effort = Effort.medium
    state: State = State.not_started


class ItemUpdate(BaseModel):
    """Request body for ``PATCH /items/{id}`` (spec: A2).

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
    blocked_external: bool | None = None
    blocked_note: str | None = None
    blocked_followup_date: str | None = None


class MoveRequest(BaseModel):
    """Request body for ``POST /items/{id}/move`` (spec: G1).

    Both fields are optional and nullable. ``new_parent_id`` is the destination
    parent; ``None`` (sent explicitly or simply omitted) promotes the item to a
    root/product. Cross-product moves are allowed. ``after_id`` positions the
    moved item immediately after that sibling in the destination group, or
    appends it at the end of the group when omitted/null (or when the referenced
    sibling is absent from the destination).
    """

    new_parent_id: str | None = None
    after_id: str | None = None


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
    """Response model for an explicit dependency edge (spec: D1)."""

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


class RunOut(BaseModel):
    """Response model for a stub item run (spec: M1)."""

    id: str
    item_id: str
    status: Literal["pending"]
    created_at: str


class ItemOut(BaseModel):
    """Response model for a single item (spec: A1).

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
    mode: Mode
    effort: Effort
    blocked_external: bool
    blocked_note: str | None
    blocked_followup_date: str | None
    created_by: str
    updated_by: str
    created_at: str
    updated_at: str
    state_changed_at: str
    completed_at: str | None


class PriorityItemOut(ItemOut):
    """A ranked actionable leaf from GET ``/priority`` (spec: E1)."""

    rank: int


class DeletedResponse(BaseModel):
    """Response model for delete endpoints.

    Confirms the delete by echoing the removed resource id. Item deletion (A4)
    also relies on schema cascades for subtrees, comments, runs, and incident
    dependency edges; dependency deletion (D3) removes only the requested edge.
    """

    deleted: bool
    id: str


class TreeItemOut(ItemOut):
    """A single item as returned by GET ``/tree`` (spec: A3, extended by H1).

    Carries every :class:`ItemOut` field plus ``needs``: the *current* slugs of
    this item's EXPLICIT (``>needs:``) dependency targets, resolved live from
    each edge's ``to_id`` so a renamed target's label updates automatically
    (Core domain rules / A3). Implicit (tree-derived) edges are not surfaced as
    needs labels.

    ``actionable`` is the current work-now predicate from
    :func:`services.leverage.is_actionable`; ``complete`` is the recursive
    structural predicate from :func:`services.tree.is_complete` (H1). These
    are display/projection flags only: GET ``/tree`` still returns every item.
    """

    needs: list[str]
    actionable: bool
    complete: bool
