"""Autodesk Construction Cloud (ACC) integration endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import AccConfig, AccPushLog
from app.services.acc import AccClient

router = APIRouter(prefix="/projects/{project_id}/acc", tags=["acc"])


# ── Schemas ─────────────────────────────────────────────────────────────

class AccConfigUpdate(BaseModel):
    acc_hub_id: str | None = None
    acc_project_id: str | None = None
    field_mapping: dict | None = None


class AccConfigResponse(BaseModel):
    project_id: UUID
    acc_hub_id: str | None
    acc_project_id: str | None
    is_active: bool
    field_mapping: dict


class AccPushRequest(BaseModel):
    progress_item_ids: list[UUID]


# ── Auth ─────────────────────────────────────────────────────────────────

@router.get("/auth-url")
async def get_auth_url(project_id: UUID, db: AsyncSession = Depends(get_db)):
    if not __import__("app.core.config", fromlist=["get_settings"]).get_settings().acc_client_id:
        raise HTTPException(status_code=501, detail="ACC credentials not configured — set ACC_CLIENT_ID in .env")
    client = AccClient(db)
    return {"url": client.get_authorization_url(project_id)}


@router.get("/callback")
async def oauth_callback(project_id: UUID, code: str, db: AsyncSession = Depends(get_db)):
    client = AccClient(db)
    await client.exchange_code(code, project_id)
    await db.commit()
    return {"message": "ACC connected", "project_id": str(project_id)}


# ── Config ───────────────────────────────────────────────────────────────

@router.get("/config", response_model=AccConfigResponse)
async def get_config(project_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AccConfig).where(AccConfig.project_id == project_id))
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="ACC not connected for this project")
    return AccConfigResponse(
        project_id=config.project_id,
        acc_hub_id=config.acc_hub_id,
        acc_project_id=config.acc_project_id,
        is_active=config.is_active,
        field_mapping=config.field_mapping or {},
    )


@router.patch("/config")
async def update_config(project_id: UUID, body: AccConfigUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AccConfig).where(AccConfig.project_id == project_id))
    config = result.scalar_one_or_none()
    if not config:
        raise HTTPException(status_code=404, detail="ACC not connected for this project")
    if body.acc_hub_id is not None:
        config.acc_hub_id = body.acc_hub_id
    if body.acc_project_id is not None:
        config.acc_project_id = body.acc_project_id
    if body.field_mapping is not None:
        config.field_mapping = body.field_mapping
    await db.commit()
    return {"message": "Config updated"}


@router.delete("/disconnect", status_code=204)
async def disconnect(project_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AccConfig).where(AccConfig.project_id == project_id))
    config = result.scalar_one_or_none()
    if config:
        config.is_active = False
        config.access_token = None
        config.refresh_token = None
        await db.commit()


# ── Discovery ────────────────────────────────────────────────────────────

@router.get("/hubs")
async def list_hubs(project_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AccConfig).where(AccConfig.project_id == project_id))
    config = result.scalar_one_or_none()
    if not config or not config.is_active:
        raise HTTPException(status_code=400, detail="ACC not connected")
    client = AccClient(db)
    return await client.list_hubs(config)


@router.get("/projects-list")
async def list_acc_projects(project_id: UUID, hub_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AccConfig).where(AccConfig.project_id == project_id))
    config = result.scalar_one_or_none()
    if not config or not config.is_active:
        raise HTTPException(status_code=400, detail="ACC not connected")
    client = AccClient(db)
    return await client.list_projects(config, hub_id)


@router.get("/issue-types")
async def list_issue_types(project_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AccConfig).where(AccConfig.project_id == project_id))
    config = result.scalar_one_or_none()
    if not config or not config.is_active or not config.acc_project_id:
        raise HTTPException(status_code=400, detail="ACC not connected or project not selected")
    client = AccClient(db)
    return await client.list_issue_types(config)


# ── Push ─────────────────────────────────────────────────────────────────

@router.post("/push")
async def push_to_acc(project_id: UUID, body: AccPushRequest, db: AsyncSession = Depends(get_db)):
    """Push selected progress items as ACC Issues (bulk via Celery)."""
    from app.tasks.acc_tasks import bulk_acc_push_task
    task = bulk_acc_push_task.delay(str(project_id), [str(i) for i in body.progress_item_ids])
    return {"task_id": task.id, "queued": len(body.progress_item_ids)}


@router.get("/tasks/{task_id}")
async def get_push_status(project_id: UUID, task_id: str):
    from app.tasks.worker import celery_app
    result = celery_app.AsyncResult(task_id)
    return {"task_id": task_id, "status": result.status, "result": result.result if result.ready() else None}


@router.get("/push-logs")
async def get_push_logs(project_id: UUID, limit: int = 50, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AccConfig).where(AccConfig.project_id == project_id))
    config = result.scalar_one_or_none()
    if not config:
        return []
    logs_result = await db.execute(
        select(AccPushLog).where(AccPushLog.config_id == config.id)
        .order_by(AccPushLog.created_at.desc()).limit(limit)
    )
    logs = logs_result.scalars().all()
    return [
        {"id": str(log.id), "acc_issue_id": log.acc_issue_id, "success": log.success,
         "status": log.response_status, "created_at": log.created_at.isoformat()}
        for log in logs
    ]
