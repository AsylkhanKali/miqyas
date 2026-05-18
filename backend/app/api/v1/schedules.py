"""Schedule (P6 XER/XML) upload and activity browsing router."""

from uuid import UUID

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.models import Activity, Project, Schedule
from app.schemas import ActivityListResponse, ScheduleResponse

router = APIRouter(prefix="/projects/{project_id}/schedules", tags=["schedules"])
settings = get_settings()

ALLOWED_EXTENSIONS = {".xer", ".xml"}


@router.post("/upload", response_model=ScheduleResponse, status_code=status.HTTP_201_CREATED)
async def upload_schedule(
    project_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename required")

    ext = "." + file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Only {ALLOWED_EXTENSIONS} files accepted")

    storage_dir = settings.upload_dir / "schedules" / str(project_id)
    storage_dir.mkdir(parents=True, exist_ok=True)
    dest = storage_dir / file.filename
    async with aiofiles.open(dest, "wb") as f:
        content = await file.read()
        await f.write(content)

    schedule = Schedule(
        project_id=project_id,
        filename=file.filename,
        storage_path=str(dest),
        source_format=ext.lstrip("."),
        parse_status="pending",
    )
    db.add(schedule)
    await db.flush()
    await db.refresh(schedule)
    await db.commit()

    from app.tasks.p6_tasks import parse_schedule_task
    parse_schedule_task.delay(str(schedule.id))

    return schedule


@router.get("/", response_model=list[ScheduleResponse])
async def list_schedules(project_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Schedule).where(Schedule.project_id == project_id).order_by(Schedule.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{schedule_id}", response_model=ScheduleResponse)
async def get_schedule(project_id: UUID, schedule_id: UUID, db: AsyncSession = Depends(get_db)):
    schedule = await db.get(Schedule, schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return schedule


@router.get("/{schedule_id}/activities", response_model=ActivityListResponse)
async def list_activities(
    project_id: UUID,
    schedule_id: UUID,
    skip: int = 0,
    limit: int = 100,
    status_filter: str | None = None,
    critical_only: bool = False,
    db: AsyncSession = Depends(get_db),
):
    query = select(Activity).where(Activity.schedule_id == schedule_id)
    count_query = select(func.count(Activity.id)).where(Activity.schedule_id == schedule_id)

    if status_filter:
        query = query.where(Activity.status == status_filter)
        count_query = count_query.where(Activity.status == status_filter)
    if critical_only:
        query = query.where(Activity.is_critical == True)  # noqa: E712
        count_query = count_query.where(Activity.is_critical == True)  # noqa: E712

    total = (await db.execute(count_query)).scalar_one()
    results = (
        await db.execute(query.offset(skip).limit(limit).order_by(Activity.planned_start.asc().nullslast()))
    ).scalars().all()
    return ActivityListResponse(items=results, total=total)
