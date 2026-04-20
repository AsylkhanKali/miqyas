"""Procore integration API — OAuth2 flow, config, RFI/Issue push, audit logs."""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.models import ProcoreConfig, ProcorePushLog
from app.schemas import (
    ProcoreAuthUrlResponse,
    ProcoreBulkPushRequest,
    ProcoreBulkPushResponse,
    ProcoreConfigResponse,
    ProcoreConfigUpdate,
    ProcoreProjectListItem,
    ProcorePushLogResponse,
    ProcorePushRequest,
    ProcorePushResponse,
)
from app.services.procore import ProcoreClient

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(tags=["procore"])


# ── Helpers ────────────────────────────────────────────────────────────


async def _get_config(project_id: UUID, db: AsyncSession) -> ProcoreConfig:
    result = await db.execute(
        select(ProcoreConfig).where(ProcoreConfig.project_id == project_id)
    )
    config = result.scalar_one_or_none()
    if not config or not config.is_active:
        raise HTTPException(
            status_code=400,
            detail="Procore integration is not configured or inactive for this project",
        )
    return config


# ── OAuth2 Flow ────────────────────────────────────────────────────────


@router.get(
    "/projects/{project_id}/procore/auth-url",
    response_model=ProcoreAuthUrlResponse,
)
async def get_auth_url(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Generate a Procore OAuth2 authorization URL for the project."""
    if not settings.procore_client_id:
        raise HTTPException(
            status_code=501,
            detail="Procore integration is not configured on this server (missing client_id)",
        )
    client = ProcoreClient(db)
    url = client.get_authorization_url(project_id)
    return ProcoreAuthUrlResponse(auth_url=url)


@router.get("/procore/callback")
async def oauth_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """Handle Procore OAuth2 callback — exchange code for tokens and redirect."""
    # Verify & decode state
    project_id_str = ProcoreClient.verify_state(state, settings.secret_key)
    if not project_id_str:
        raise HTTPException(status_code=400, detail="Invalid or tampered state parameter")

    try:
        project_id = UUID(project_id_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid project_id in state")

    client = ProcoreClient(db)
    try:
        await client.exchange_code(code, project_id)
        await db.commit()
    except Exception as exc:
        logger.exception("OAuth code exchange failed")
        raise HTTPException(status_code=502, detail=f"Token exchange failed: {exc}")

    # Redirect to frontend integrations page
    frontend_url = settings.procore_redirect_uri.rsplit("/api", 1)[0] if "/api" in settings.procore_redirect_uri else "http://localhost:5173"
    return RedirectResponse(
        url=f"{frontend_url}/projects/{project_id}/integrations?connected=true"
    )


# ── Config Management ──────────────────────────────────────────────────


@router.get(
    "/projects/{project_id}/procore/config",
    response_model=ProcoreConfigResponse | None,
)
async def get_config(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get the Procore integration config for a project (returns null if not set up)."""
    result = await db.execute(
        select(ProcoreConfig).where(ProcoreConfig.project_id == project_id)
    )
    config = result.scalar_one_or_none()
    return config


@router.put(
    "/projects/{project_id}/procore/config",
    response_model=ProcoreConfigResponse,
)
async def update_config(
    project_id: UUID,
    body: ProcoreConfigUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update Procore config (project mapping, field mapping, active status)."""
    result = await db.execute(
        select(ProcoreConfig).where(ProcoreConfig.project_id == project_id)
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Procore config not found. Connect to Procore first.")

    if body.procore_project_id is not None:
        config.procore_project_id = body.procore_project_id
    if body.procore_company_id is not None:
        config.procore_company_id = body.procore_company_id
    if body.field_mapping is not None:
        config.field_mapping = body.field_mapping
    if body.is_active is not None:
        config.is_active = body.is_active

    await db.commit()
    await db.refresh(config)
    return config


@router.delete("/projects/{project_id}/procore/config")
async def disconnect(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Disconnect Procore — clear tokens and deactivate."""
    result = await db.execute(
        select(ProcoreConfig).where(ProcoreConfig.project_id == project_id)
    )
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="Procore config not found")

    config.access_token = None
    config.refresh_token = None
    config.token_expires_at = None
    config.is_active = False
    await db.commit()
    return {"detail": "Procore disconnected"}


# ── Procore Project Listing ────────────────────────────────────────────


@router.get(
    "/projects/{project_id}/procore/projects",
    response_model=list[ProcoreProjectListItem],
)
async def list_procore_projects(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """List Procore projects accessible by the stored token."""
    config = await _get_config(project_id, db)
    client = ProcoreClient(db)

    try:
        projects = await client.list_projects(config)
    except Exception as exc:
        logger.exception("Failed to list Procore projects")
        raise HTTPException(status_code=502, detail=f"Failed to fetch Procore projects: {exc}")

    return [
        ProcoreProjectListItem(
            id=str(p.get("id", "")),
            name=p.get("name", "Unknown"),
            company=p.get("company"),
        )
        for p in projects
    ]


@router.get(
    "/projects/{project_id}/procore/companies",
)
async def list_procore_companies(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """List Procore companies accessible by the stored token."""
    config = await _get_config(project_id, db)
    client = ProcoreClient(db)

    try:
        companies = await client.list_companies(config)
    except Exception as exc:
        logger.exception("Failed to list Procore companies")
        raise HTTPException(status_code=502, detail=f"Failed to fetch Procore companies: {exc}")

    return [{"id": str(c.get("id", "")), "name": c.get("name", "Unknown")} for c in companies]


# ── Push RFI / Issue ───────────────────────────────────────────────────


@router.post(
    "/projects/{project_id}/procore/push",
    response_model=ProcorePushResponse,
)
async def push_to_procore(
    project_id: UUID,
    body: ProcorePushRequest,
    db: AsyncSession = Depends(get_db),
):
    """Push a deviation as an RFI or Issue to Procore."""
    config = await _get_config(project_id, db)

    if not config.procore_project_id:
        raise HTTPException(
            status_code=400,
            detail="No Procore project linked. Select a Procore project in the integration settings.",
        )

    client = ProcoreClient(db)

    if body.entity_type == "rfi":
        log = await client.create_rfi(config, body.progress_item_id)
    elif body.entity_type == "issue":
        log = await client.create_issue(config, body.progress_item_id)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported entity_type: {body.entity_type}")

    await db.commit()

    return ProcorePushResponse(
        success=log.success,
        procore_entity_id=log.procore_entity_id,
        error=str(log.response_body.get("error", "")) if not log.success else None,
    )


# ── Bulk Push ─────────────────────────────────────────────────────────


@router.post(
    "/projects/{project_id}/procore/bulk-push",
    response_model=ProcoreBulkPushResponse,
)
async def bulk_push_to_procore(
    project_id: UUID,
    body: ProcoreBulkPushRequest,
    db: AsyncSession = Depends(get_db),
):
    """Enqueue a Celery task to push multiple ProgressItems to Procore.

    Accepts up to 200 items per request. Returns a task_id to poll for results.
    """
    if body.entity_type not in ("rfi", "issue"):
        raise HTTPException(status_code=400, detail="entity_type must be 'rfi' or 'issue'")

    if len(body.progress_item_ids) == 0:
        raise HTTPException(status_code=400, detail="progress_item_ids must not be empty")

    if len(body.progress_item_ids) > 200:
        raise HTTPException(status_code=400, detail="Maximum 200 items per bulk push")

    # Verify Procore is configured before queuing
    await _get_config(project_id, db)

    from app.tasks.procore_tasks import bulk_push_task

    task = bulk_push_task.delay(
        project_id=str(project_id),
        progress_item_ids=[str(i) for i in body.progress_item_ids],
        entity_type=body.entity_type,
    )

    logger.info(
        "Queued bulk Procore push: task_id=%s items=%d entity_type=%s",
        task.id, len(body.progress_item_ids), body.entity_type,
    )

    return ProcoreBulkPushResponse(
        task_id=task.id,
        queued=len(body.progress_item_ids),
        message=f"Queued {len(body.progress_item_ids)} {body.entity_type}(s) for push. Poll /procore/tasks/{task.id} for status.",
    )


@router.get("/projects/{project_id}/procore/tasks/{task_id}")
async def get_bulk_push_status(
    project_id: UUID,
    task_id: str,
):
    """Poll the status of a bulk push task."""
    from celery.result import AsyncResult

    from app.tasks.worker import celery_app

    result = AsyncResult(task_id, app=celery_app)

    response: dict = {
        "task_id": task_id,
        "state": result.state,
    }

    if result.state == "SUCCESS":
        response["result"] = result.result
    elif result.state == "FAILURE":
        response["error"] = str(result.result)
    elif result.state == "STARTED":
        response["info"] = result.info or {}

    return response


# ── Push Logs ──────────────────────────────────────────────────────────


@router.get(
    "/projects/{project_id}/procore/push-logs",
    response_model=list[ProcorePushLogResponse],
)
async def get_push_logs(
    project_id: UUID,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Get recent push audit logs for this project's Procore integration."""
    result = await db.execute(
        select(ProcoreConfig).where(ProcoreConfig.project_id == project_id)
    )
    config = result.scalar_one_or_none()
    if not config:
        return []

    result = await db.execute(
        select(ProcorePushLog)
        .where(ProcorePushLog.config_id == config.id)
        .order_by(ProcorePushLog.created_at.desc())
        .limit(limit)
    )
    return result.scalars().all()
