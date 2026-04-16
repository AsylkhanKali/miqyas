"""BIM/IFC upload, element browsing, and IFC file serving router."""

from pathlib import Path
from uuid import UUID

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.models import BIMElement, BIMModel, Project
from app.schemas import BIMElementListResponse, BIMElementResponse, BIMModelResponse

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

    # Save file to disk
    storage_dir = settings.ifc_storage_dir / str(project_id)
    storage_dir.mkdir(parents=True, exist_ok=True)
    dest = storage_dir / file.filename
    async with aiofiles.open(dest, "wb") as f:
        content = await file.read()
        await f.write(content)

    bim_model = BIMModel(
        project_id=project_id,
        filename=file.filename,
        storage_path=str(dest),
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

    file_path = Path(model.storage_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="IFC file not found on disk")

    return FileResponse(
        path=str(file_path),
        media_type="application/octet-stream",
        filename=model.filename,
        headers={"Cache-Control": "public, max-age=3600"},
    )


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
