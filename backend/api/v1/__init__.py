"""Version 1 API routes.

Having a versioned API namespace makes it easier to evolve
endpoints over time without breaking existing clients.
"""

from fastapi import APIRouter

from . import comments, dependencies, greetings, health, items, markers, priority

api_router = APIRouter()

api_router.include_router(health.router, tags=["health"])
api_router.include_router(greetings.router, tags=["greetings"])
api_router.include_router(items.router, tags=["items"])
api_router.include_router(dependencies.router, tags=["dependencies"])
api_router.include_router(priority.router, tags=["priority"])
api_router.include_router(comments.router, tags=["comments"])
api_router.include_router(markers.router, tags=["markers"])

__all__ = ["api_router"]
