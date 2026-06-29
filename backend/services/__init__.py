"""Domain services: tree operations, implicit-edge generation, clock, identity.

These modules hold the behaviour shared across API stories (slug derivation,
sibling ordering, implicit-edge regeneration) so the thin FastAPI routers in
``api/v1`` stay focused on request/response wiring.
"""
