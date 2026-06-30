"""Spawn/stream boundary endpoint for future v2 agent runs (spec: M2)."""

from typing import Annotated

from fastapi import APIRouter, Depends, status

from api.v1.authz import require_owner

from ..schemas import NotImplementedResponse

router = APIRouter()


@router.post(
    "/items/{item_id}/spawn",
    status_code=status.HTTP_501_NOT_IMPLEMENTED,
    response_model=NotImplementedResponse,
)
async def spawn_item(
    item_id: str,
    _owner: Annotated[object, Depends(require_owner)],
) -> NotImplementedResponse:
    """Return the v1 placeholder for the future spawn/stream boundary."""
    return NotImplementedResponse(
        detail=f"spawn for item {item_id} is not implemented in v1",
    )
