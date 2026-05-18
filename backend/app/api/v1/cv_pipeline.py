"""Segmentation, progress comparison, and quality validation API endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import (
    Frame,
    ProgressItem,
    SegmentationResult,
    VideoCapture,
    VideoStatus,
)

router = APIRouter(prefix="/projects/{project_id}", tags=["cv-pipeline"])


# ── Schemas ──────────────────────────────────────────────────────────────

class SegmentRequest(BaseModel):
    model_name: str = "facebook/mask2former-swin-large-ade-semantic"
    device: str | None = None  # None = auto-detect (cuda > mps > cpu)
    keyframes_only: bool = True
    use_mock: bool = False  # True = skip real model, use synthetic masks


class CompareRequest(BaseModel):
    bim_model_id: str
    schedule_id: str | None = None
    use_mock: bool = False  # True = generate simulated progress data


class SegResultResponse(BaseModel):
    id: str
    frame_id: str
    model_name: str
    class_pixel_counts: dict
    confidence_scores: dict
    inference_time_ms: float | None

    class Config:
        from_attributes = True


class ProgressItemResponse(BaseModel):
    id: UUID
    element_id: UUID
    activity_id: UUID | None = None
    capture_id: UUID
    observed_percent: float
    scheduled_percent: float
    deviation_type: str
    deviation_days: float | None = None
    confidence_score: float
    narrative: str = ""

    model_config = {"from_attributes": True}


class ProgressSummary(BaseModel):
    total_elements: int
    ahead: int
    on_track: int
    behind: int
    not_started: int
    avg_observed_percent: float
    avg_confidence: float


# ── Segmentation ─────────────────────────────────────────────────────────

@router.post("/captures/{capture_id}/segment")
async def trigger_segmentation(
    project_id: UUID,
    capture_id: UUID,
    body: SegmentRequest | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Trigger Mask2Former segmentation on video frames (async via Celery)."""
    capture = await db.get(VideoCapture, capture_id)
    if not capture:
        raise HTTPException(status_code=404, detail="Capture not found")

    if capture.status not in (VideoStatus.FRAMES_EXTRACTED, VideoStatus.ALIGNED):
        raise HTTPException(
            status_code=400,
            detail=f"Frames must be extracted first. Current status: {capture.status}",
        )

    from app.tasks.cv_tasks import segment_capture_task
    params = body or SegmentRequest()
    task = segment_capture_task.delay(
        str(capture_id),
        params.model_name,
        params.device,
        params.keyframes_only,
        params.use_mock,
    )

    return {
        "task_id": task.id,
        "status": "segmenting",
        "capture_id": str(capture_id),
        "mock": params.use_mock,
    }


@router.get("/captures/{capture_id}/segmentation-results", response_model=list[SegResultResponse])
async def list_segmentation_results(
    project_id: UUID,
    capture_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """List segmentation results for all frames in a capture."""
    result = await db.execute(
        select(SegmentationResult)
        .join(Frame)
        .where(Frame.capture_id == capture_id)
        .order_by(Frame.frame_number)
    )
    return result.scalars().all()


# ── Progress Comparison ──────────────────────────────────────────────────

@router.post("/captures/{capture_id}/compare")
async def trigger_comparison(
    project_id: UUID,
    capture_id: UUID,
    body: CompareRequest,
    db: AsyncSession = Depends(get_db),
):
    """Trigger full comparison pipeline: BIM render → IoU → progress items."""
    capture = await db.get(VideoCapture, capture_id)
    if not capture:
        raise HTTPException(status_code=404, detail="Capture not found")

    if capture.status not in (VideoStatus.SEGMENTED, VideoStatus.ALIGNED):
        raise HTTPException(
            status_code=400,
            detail=f"Segmentation must be complete first. Current status: {capture.status}",
        )

    from app.tasks.cv_tasks import compare_progress_task
    task = compare_progress_task.delay(
        str(capture_id),
        body.bim_model_id,
        body.schedule_id,
        body.use_mock,
    )

    return {
        "task_id": task.id,
        "status": "comparing",
        "capture_id": str(capture_id),
        "mock": body.use_mock,
    }


# ── Progress Items ───────────────────────────────────────────────────────

@router.get("/captures/{capture_id}/progress", response_model=list[ProgressItemResponse])
async def list_progress_items(
    project_id: UUID,
    capture_id: UUID,
    deviation_type: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """List progress items (deviations) for a capture."""
    query = select(ProgressItem).where(ProgressItem.capture_id == capture_id)
    if deviation_type:
        query = query.where(ProgressItem.deviation_type == deviation_type)
    query = query.order_by(ProgressItem.deviation_type, ProgressItem.observed_percent.desc())

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/captures/{capture_id}/progress/summary", response_model=ProgressSummary)
async def progress_summary(
    project_id: UUID,
    capture_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Aggregated progress summary for a capture."""
    items_result = await db.execute(
        select(ProgressItem).where(ProgressItem.capture_id == capture_id)
    )
    items = items_result.scalars().all()

    if not items:
        return ProgressSummary(
            total_elements=0, ahead=0, on_track=0, behind=0,
            not_started=0, avg_observed_percent=0, avg_confidence=0,
        )

    return ProgressSummary(
        total_elements=len(items),
        ahead=sum(1 for i in items if i.deviation_type.value == "ahead"),
        on_track=sum(1 for i in items if i.deviation_type.value == "on_track"),
        behind=sum(1 for i in items if i.deviation_type.value == "behind"),
        not_started=sum(1 for i in items if i.deviation_type.value == "not_started"),
        avg_observed_percent=round(sum(i.observed_percent for i in items) / len(items), 1),
        avg_confidence=round(sum(i.confidence_score for i in items) / len(items), 3),
    )


# ── Quality Validation (Phase 2C) ─────────────────────────────────────────

class ValidateRequest(BaseModel):
    bim_model_id: str
    sample_limit: int = 50


class ValidateElementsRequest(BaseModel):
    element_ids: list[str]


@router.post("/captures/{capture_id}/validate-quality")
async def validate_comparison_quality(
    project_id: UUID,
    capture_id: UUID,
    body: ValidateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Validate the quality of BIM vs segmentation comparisons.

    Returns IoU distribution, render method breakdown, anomaly warnings,
    and per-element detail. Use after running the comparison pipeline
    to diagnose alignment, segmentation, or rendering issues.
    """
    capture = await db.get(VideoCapture, capture_id)
    if not capture:
        raise HTTPException(status_code=404, detail="Capture not found")

    from app.services.bim_renderer.quality import ComparisonQualityValidator
    validator = ComparisonQualityValidator(db)
    report = await validator.validate_capture(
        capture_id=capture_id,
        bim_model_id=UUID(body.bim_model_id),
        sample_limit=body.sample_limit,
    )
    return report.to_dict()


@router.post("/captures/{capture_id}/validate-elements")
async def validate_specific_elements(
    project_id: UUID,
    capture_id: UUID,
    body: ValidateElementsRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Detailed quality validation for specific BIM elements.

    Returns per-element IoU stats across all frames: mean, max, min, std,
    and a human-readable interpretation.
    """
    capture = await db.get(VideoCapture, capture_id)
    if not capture:
        raise HTTPException(status_code=404, detail="Capture not found")

    from app.services.bim_renderer.quality import ComparisonQualityValidator
    validator = ComparisonQualityValidator(db)
    results = await validator.validate_elements(
        capture_id=capture_id,
        element_ids=[UUID(eid) for eid in body.element_ids],
    )
    return results
