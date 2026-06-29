"""Version 1 API routes.

Having a versioned API namespace makes it easier to evolve
endpoints over time without breaking existing clients.
"""

from fastapi import APIRouter

from . import greetings, health, items

api_router = APIRouter()

api_router.include_router(health.router, tags=["health"])
api_router.include_router(greetings.router, tags=["greetings"])
api_router.include_router(items.router, tags=["items"])

__all__ = ["api_router"]
