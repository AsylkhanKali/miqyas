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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure upload directories exist
    for d in [settings.upload_dir, settings.ifc_storage_dir, settings.video_storage_dir, settings.frame_storage_dir, settings.report_storage_dir]:
        d.mkdir(parents=True, exist_ok=True)
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
