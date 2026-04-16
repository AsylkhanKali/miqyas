"""Pipeline API — single endpoint to run full analysis + task status polling."""

from uuid import UUID

from celery.result import AsyncResult
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import VideoCapture, VideoStatus
from app.tasks.worker import celery_app

router = APIRouter(prefix="/projects/{project_id}", tags=["pipeline"])


class AnalyzeRequest(BaseModel):
    capture_id: str
    bim_model_id: str
    schedule_id: str | None = None
    frame_interval_seconds: float = 1.0
    device: str | None = None  # None = auto-detect
    use_mock: bool = False  # True = use mock segmentation + comparison


class TaskStatusResponse(BaseModel):
    task_id: str
    state: str
    progress: dict | None = None
    result: dict | None = None
    error: str | None = None


@router.post("/analyze")
async def analyze_capture(
    project_id: UUID,
    body: AnalyzeRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Run the full analysis pipeline on a video capture:
    frames → segmentation → BIM render → IoU → progress items.

    Returns a task_id for polling status.
    """
    capture = await db.get(VideoCapture, UUID(body.capture_id))
    if not capture:
        raise HTTPException(status_code=404, detail="Capture not found")

    if capture.status not in (
        VideoStatus.UPLOADED, VideoStatus.FAILED,
        VideoStatus.FRAMES_EXTRACTED, VideoStatus.ALIGNED,
        VideoStatus.SEGMENTED,
    ):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot analyze capture in status: {capture.status}",
        )

    from app.tasks.pipeline import run_full_analysis_task
    task = run_full_analysis_task.delay(
        body.capture_id,
        body.bim_model_id,
        body.schedule_id,
        body.frame_interval_seconds,
        body.device,
        body.use_mock,
    )

    return {
        "task_id": task.id,
        "status": "started",
        "message": "Full analysis pipeline started. Poll /tasks/{task_id} for progress.",
    }


@router.get("/tasks/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(project_id: UUID, task_id: str):
    """Poll the status of a pipeline or any Celery task."""
    result = AsyncResult(task_id, app=celery_app)

    response = TaskStatusResponse(
        task_id=task_id,
        state=result.state,
    )

    if result.state == "PROGRESS":
        response.progress = result.info
    elif result.state == "SUCCESS":
        response.result = result.result
    elif result.state == "FAILURE":
        response.error = str(result.result)

    return response
