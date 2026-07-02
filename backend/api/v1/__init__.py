"""Version 1 API routes.

Having a versioned API namespace makes it easier to evolve
endpoints over time without breaking existing clients.
"""

from fastapi import APIRouter

from . import (
    auth,
    comments,
    dependencies,
    greetings,
    health,
    items,
    markers,
    notes,
    priority,
    prompt_responses,
    runs,
    spawn,
)

api_router = APIRouter()

api_router.include_router(health.router, tags=["health"])
api_router.include_router(greetings.router, tags=["greetings"])
api_router.include_router(auth.router, tags=["auth"])
api_router.include_router(items.router, tags=["items"])
api_router.include_router(dependencies.router, tags=["dependencies"])
api_router.include_router(priority.router, tags=["priority"])
api_router.include_router(comments.router, tags=["comments"])
api_router.include_router(notes.router, tags=["notes"])
api_router.include_router(prompt_responses.router, tags=["prompt-responses"])
api_router.include_router(markers.router, tags=["markers"])
api_router.include_router(runs.router, tags=["runs"])
api_router.include_router(spawn.router, tags=["spawn"])

__all__ = ["api_router"]
