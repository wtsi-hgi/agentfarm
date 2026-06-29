"""Domain services: tree operations, dependency graph helpers, clock, identity.

These modules hold the behaviour shared across API stories (slug derivation,
sibling ordering, dependency checks) so the thin FastAPI routers in ``api/v1``
stay focused on request/response wiring.
"""
