"""Pydantic models used across the API layer."""

from pydantic import BaseModel

from models.enums import Effort, Mode, State


class MessageResponse(BaseModel):
    """Standard message response model."""

    message: str


class HealthResponse(BaseModel):
    """Health check response model."""

    status: str


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


class DeletedResponse(BaseModel):
    """Response model for ``DELETE /items/{id}`` (spec: A4).

    Confirms the delete by echoing the removed item's id. The schema's
    ``ON DELETE CASCADE`` removes the item's subtree, comments, runs, and
    incident edges as a side effect, so only the requested id is reported.
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

    Subclassing ``ItemOut`` and adding fields keeps the shape extensible: a
    later phase (H1) adds the ``actionable`` / ``complete`` booleans here
    without restructuring this model or its callers.
    """

    needs: list[str]
