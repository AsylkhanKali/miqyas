"""MIQYAS — FastAPI Application Entry Point."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import api_router
from app.core.config import get_settings
from app.core.exceptions import (
    EntityNotFoundError,
    MiqyasError,
    ProcoreAPIError,
    ProcoreAuthError,
    ProcoreNotConfiguredError,
    ProcoreRateLimitError,
)
from app.core.logging import setup_logging

settings = get_settings()

# ── Structured Logging ────────────────────────────────────────────────
setup_logging(json_logs=not settings.debug, log_level="DEBUG" if settings.debug else "INFO")
logger = logging.getLogger(__name__)

# ── Sentry ────────────────────────────────────────────────────────────
if settings.sentry_dsn:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        send_default_pii=False,
    )


async def _reset_stale_bim_models() -> None:
    """
    At startup, find any BIMModel rows stuck in 'pending' or 'parsing' and
    reset them to 'failed' so the UI shows a re-parseable state instead of
    an infinite spinner.

    Why this happens:
      - The Celery worker was not running when the file was uploaded, so the
        task sat in Redis and was never consumed (status stays 'pending').
      - The worker process was OOM-killed or restarted mid-parse, leaving the
        model in 'parsing' forever (task_acks_late means the task may never
        be re-queued).

    We also try to re-queue a fresh parse task for each model so they get
    processed automatically once the worker is healthy.
    """
    import asyncio
    from sqlalchemy import select, update
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from app.models import BIMModel  # imported here to avoid circular import at module level

    try:
        engine = create_async_engine(settings.database_url)
        async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async with async_session() as session:
            result = await session.execute(
                select(BIMModel).where(BIMModel.parse_status.in_(["pending", "parsing"]))
            )
            stale = result.scalars().all()

            if not stale:
                await engine.dispose()
                return

            logger.warning(
                f"Found {len(stale)} BIM model(s) stuck in pending/parsing on startup — resetting to failed"
            )

            for model in stale:
                old_status = model.parse_status
                model.parse_status = "failed"
                model.parse_error = (
                    f"Reset on server startup — task was stuck in '{old_status}' "
                    "(worker was not running or was restarted). Click 'Parse' to retry."
                )

            await session.commit()

            # Re-queue a fresh parse for each stale model so they get processed
            # as soon as the Celery worker comes up — best-effort, ignore broker errors.
            from app.tasks.ifc_tasks import parse_ifc_task

            requeued = 0
            for model in stale:
                try:
                    parse_ifc_task.delay(str(model.id))
                    requeued += 1
                except Exception as exc:
                    # Broker not available yet — the user can hit 'Parse' manually.
                    logger.debug(f"Could not re-queue parse for {model.id}: {exc}")

            logger.info(
                f"Reset {len(stale)} stale BIM model(s) to 'failed'; re-queued {requeued} parse task(s)"
            )

        await engine.dispose()

    except Exception as exc:
        # Never let startup cleanup crash the whole app.
        logger.warning(f"Stale BIM model cleanup skipped: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure upload directories exist
    for d in [settings.upload_dir, settings.ifc_storage_dir, settings.video_storage_dir, settings.frame_storage_dir, settings.report_storage_dir]:
        d.mkdir(parents=True, exist_ok=True)

    # Reset any BIM models left stuck in pending/parsing from a previous run
    await _reset_stale_bim_models()

    yield
    # Shutdown: nothing to clean up yet


app = FastAPI(
    title=settings.project_name,
    description="AI-Powered Construction Progress Tracking Platform",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS — permissive for dev; lock down in production
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API
app.include_router(api_router, prefix=settings.api_v1_prefix)

# ── Prometheus Metrics ────────────────────────────────────────────────
from prometheus_fastapi_instrumentator import Instrumentator

Instrumentator(
    should_group_status_codes=True,
    excluded_handlers=["/docs", "/redoc", "/openapi.json", "/metrics"],
).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)


# ── Global Error Handlers ──────────────────────────────────────────────


@app.exception_handler(EntityNotFoundError)
async def entity_not_found_handler(request: Request, exc: EntityNotFoundError):
    return JSONResponse(status_code=404, content={"detail": exc.message, "type": "not_found"})


@app.exception_handler(ProcoreNotConfiguredError)
async def procore_not_configured_handler(request: Request, exc: ProcoreNotConfiguredError):
    return JSONResponse(status_code=400, content={"detail": exc.message, "type": "procore_not_configured"})


@app.exception_handler(ProcoreAuthError)
async def procore_auth_handler(request: Request, exc: ProcoreAuthError):
    return JSONResponse(status_code=401, content={"detail": exc.message, "type": "procore_auth_error"})


@app.exception_handler(ProcoreRateLimitError)
async def procore_rate_limit_handler(request: Request, exc: ProcoreRateLimitError):
    headers = {}
    if exc.retry_after:
        headers["Retry-After"] = str(exc.retry_after)
    return JSONResponse(
        status_code=429,
        content={"detail": exc.message, "type": "procore_rate_limit"},
        headers=headers,
    )


@app.exception_handler(ProcoreAPIError)
async def procore_api_handler(request: Request, exc: ProcoreAPIError):
    return JSONResponse(status_code=502, content={"detail": exc.message, "type": "procore_api_error"})


@app.exception_handler(MiqyasError)
async def miqyas_error_handler(request: Request, exc: MiqyasError):
    return JSONResponse(status_code=500, content={"detail": exc.message, "type": "application_error"})


# ── Routes ─────────────────────────────────────────────────────────────


@app.get("/")
async def root():
    return {"service": "MIQYAS", "version": "0.1.0", "docs": "/docs"}
