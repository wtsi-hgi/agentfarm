"""FastAPI application entry point with structured lifespan management."""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from httpx import AsyncClient

from api import api_v1_router
from config import settings
from db.migrate import apply_migrations
from services.auth_ldap import validate_dn_template
from services.sqlite_backups import start_backup_scheduler
from services.tls import prepare_tls_paths

logger = logging.getLogger("agentfarm.api")


def configure_logging() -> None:
    """Ensure loggers emit structured, leveled messages."""

    if logging.getLogger().handlers:
        # Respect host application's logging configuration (e.g., uvicorn)
        logging.getLogger().setLevel(settings.log_level.upper())
        return

    logging.basicConfig(
        level=settings.log_level.upper(),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan context manager for startup/shutdown events."""

    configure_logging()
    logger.info(
        "Starting %s", settings.app_name, extra={"version": settings.app_version}
    )

    if settings.ldap_dn_template is not None:
        validate_dn_template(settings.ldap_dn_template)

    tls_paths = prepare_tls_paths(
        data_dir=settings.data_dir,
        configured_cert=settings.tls_cert,
        configured_key=settings.tls_key,
    )
    app.state.tls_cert_path = tls_paths.cert
    app.state.tls_key_path = tls_paths.key
    logger.info("TLS ready with certificate at %s", tls_paths.cert)

    # Initialise the SQLite database under data_dir: ensure the directory
    # exists (handled by the connection helper) and apply the schema
    # idempotently. Safe to run on every startup.
    apply_migrations()
    logger.info("Database ready at %s", settings.db_path)

    app.state.http_client = AsyncClient(timeout=settings.http_client_timeout)
    app.state.sqlite_backup_task = start_backup_scheduler(
        settings.db_path,
        settings.backup_dir,
        settings.backup_interval_seconds,
        settings.backup_retention_days,
    )

    try:
        yield
    finally:
        sqlite_backup_task: asyncio.Task[None] | None = app.state.sqlite_backup_task
        if sqlite_backup_task is not None:
            sqlite_backup_task.cancel()
            with suppress(asyncio.CancelledError):
                await sqlite_backup_task

        http_client: AsyncClient = app.state.http_client
        await http_client.aclose()
        logger.info("Shutting down application")


app = FastAPI(
    title=settings.app_name,
    description=settings.app_description,
    version=settings.app_version,
    lifespan=lifespan,
)


# Mount versioned API router
app.include_router(api_v1_router, prefix="/api/v1")
