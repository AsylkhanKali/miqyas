"""BIM/IFC upload, element browsing, and IFC file serving router."""

import tempfile
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, RedirectResponse
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.models import BIMElement, BIMModel, Project
from app.schemas import BIMElementListResponse, BIMElementResponse, BIMModelResponse
from app.services.storage import get_storage

router = APIRouter(prefix="/projects/{project_id}/bim", tags=["bim"])
settings = get_settings()


@router.post("/upload", response_model=BIMModelResponse, status_code=status.HTTP_201_CREATED)
async def upload_ifc(
    project_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not file.filename or not file.filename.lower().endswith(".ifc"):
        raise HTTPException(status_code=400, detail="Only .ifc files are accepted")

    # Write to a local temp file first, then push to the configured storage backend.
    # storage_path stores the STORAGE KEY (not a local path) so it works for both
    # local and S3/R2 backends across redeploys.
    content = await file.read()
    storage_key = f"ifc/{project_id}/{file.filename}"

    with tempfile.NamedTemporaryFile(delete=False, suffix=".ifc") as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        storage = get_storage()
        await storage.upload(tmp_path, storage_key)
    finally:
        tmp_path.unlink(missing_ok=True)

    bim_model = BIMModel(
        project_id=project_id,
        filename=file.filename,
        storage_path=storage_key,   # storage key, resolved at read-time
        file_size_bytes=len(content),
        parse_status="pending",
    )
    db.add(bim_model)
    await db.flush()
    await db.refresh(bim_model)
    await db.commit()

    from app.tasks.ifc_tasks import parse_ifc_task
    parse_ifc_task.delay(str(bim_model.id))

    return bim_model


@router.get("/models", response_model=list[BIMModelResponse])
async def list_bim_models(project_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(BIMModel).where(BIMModel.project_id == project_id).order_by(BIMModel.created_at.desc())
    )
    return result.scalars().all()


@router.get("/models/{model_id}/elements", response_model=BIMElementListResponse)
async def list_elements(
    project_id: UUID,
    model_id: UUID,
    skip: int = 0,
    limit: int = 100,
    category: str | None = None,
    level: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(BIMElement).where(BIMElement.bim_model_id == model_id)
    count_query = select(func.count(BIMElement.id)).where(BIMElement.bim_model_id == model_id)

    if category:
        query = query.where(BIMElement.category == category)
        count_query = count_query.where(BIMElement.category == category)
    if level:
        query = query.where(BIMElement.level == level)
        count_query = count_query.where(BIMElement.level == level)

    total = (await db.execute(count_query)).scalar_one()
    results = (await db.execute(query.offset(skip).limit(limit))).scalars().all()
    return BIMElementListResponse(items=results, total=total)


@router.get("/elements/{element_id}", response_model=BIMElementResponse)
async def get_element(project_id: UUID, element_id: UUID, db: AsyncSession = Depends(get_db)):
    element = await db.get(BIMElement, element_id)
    if not element:
        raise HTTPException(status_code=404, detail="Element not found")
    return element


@router.get("/models/{model_id}/file")
async def download_ifc_file(
    project_id: UUID,
    model_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Serve the original IFC file for client-side mesh loading (web-ifc)."""
    model = await db.get(BIMModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="BIM model not found")
    if model.project_id != project_id:
        raise HTTPException(status_code=404, detail="BIM model not found in this project")

    storage = get_storage()

    if not await storage.exists(model.storage_path):
        raise HTTPException(
            status_code=404,
            detail=(
                "IFC file not found in storage. "
                "If you are on local storage this means the file was lost after a server restart. "
                "Please re-upload the file or switch to S3/R2 storage for persistence."
            ),
        )

    # S3/R2 → redirect to a short-lived presigned URL so the download goes
    # directly from the object store to the browser (no double-streaming).
    if not storage.is_local():
        url = await storage.presigned_url(model.storage_path, expires_in=3600)
        return RedirectResponse(url=url)

    # Local storage → stream the file through FastAPI as before.
    local_path = await storage.get_local_path(model.storage_path)
    return FileResponse(
        path=str(local_path),
        media_type="application/octet-stream",
        filename=model.filename,
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.post("/models/{model_id}/reparse", status_code=status.HTTP_202_ACCEPTED)
async def reparse_bim_model(
    project_id: UUID,
    model_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Re-run the IFC parser on an existing model.

    Use this after:
      - parser improvements (e.g. geometry/pset bug fixes) are deployed, to
        back-fill previously-parsed models
      - `parse_status` is stuck on `failed` or `parsing`

    Existing `BIMElement` rows are deleted first so the new parse starts clean.
    The IFC file must still exist on disk at `model.storage_path`.
    """
    model = await db.get(BIMModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="BIM model not found")
    if model.project_id != project_id:
        raise HTTPException(status_code=404, detail="BIM model not found in this project")

    storage = get_storage()
    if not await storage.exists(model.storage_path):
        raise HTTPException(
            status_code=409,
            detail=(
                "IFC file no longer exists in storage — cannot re-parse. "
                "Re-upload the file."
            ),
        )

    # Wipe existing elements and reset status
    await db.execute(delete(BIMElement).where(BIMElement.bim_model_id == model_id))
    model.element_count = 0
    model.parse_status = "pending"
    model.parse_error = None
    await db.commit()

    from app.tasks.ifc_tasks import parse_ifc_task
    task = parse_ifc_task.delay(str(model_id))

    return {
        "model_id": str(model_id),
        "task_id": task.id,
        "status": "queued",
        "message": "Re-parse scheduled. Poll /models/{id}/info for parse_status.",
    }


@router.post("/models/{model_id}/force-reset", status_code=status.HTTP_200_OK)
async def force_reset_bim_model(
    project_id: UUID,
    model_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Force a stuck model back to 'failed' status.

    Use when parse_status is stuck at 'pending' or 'parsing' and no Celery
    worker is processing it (e.g. worker crashed / OOM killed).  The user
    can then hit Re-parse once the worker is healthy again.
    """
    model = await db.get(BIMModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="BIM model not found")
    if model.project_id != project_id:
        raise HTTPException(status_code=404, detail="BIM model not found in this project")

    if model.parse_status not in ("pending", "parsing"):
        raise HTTPException(
            status_code=409,
            detail=f"Model is already in terminal state: {model.parse_status!r}. "
                   "Only pending/parsing models can be force-reset.",
        )

    model.parse_status = "failed"
    model.parse_error = "Manually reset — task appeared stuck (worker may have been restarting)"
    await db.commit()

    return {"model_id": str(model_id), "parse_status": "failed"}


@router.get("/models/{model_id}/info")
async def get_model_info(
    project_id: UUID,
    model_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get model metadata including file size (used by frontend to decide bbox vs mesh mode)."""
    model = await db.get(BIMModel, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="BIM model not found")

    return {
        "id": str(model.id),
        "filename": model.filename,
        "file_size_bytes": model.file_size_bytes,
        "file_size_mb": round((model.file_size_bytes or 0) / (1024 * 1024), 1),
        "element_count": model.element_count,
        "parse_status": model.parse_status,
        "ifc_schema_version": model.ifc_schema_version,
    }
