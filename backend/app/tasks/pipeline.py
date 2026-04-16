"""
Pipeline Orchestrator — end-to-end analysis from video upload to progress report.

Chains:
  1. Frame extraction (FFmpeg)
  2. Segmentation (Mask2Former or mock)
  3. BIM expectation rendering
  4. IoU comparison
  5. Progress item generation with narratives

Can be triggered as a single Celery task that runs all steps sequentially,
or each step can be triggered individually via API.
"""

import asyncio
import logging
from datetime import date
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.tasks.worker import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()


class PipelineStatus:
    """Tracks the status of a multi-step pipeline run."""

    def __init__(self):
        self.steps: list[dict] = []
        self.current_step: str = ""
        self.error: str | None = None

    def start_step(self, name: str):
        self.current_step = name
        self.steps.append({"name": name, "status": "running", "result": None})

    def complete_step(self, result: Any = None):
        if self.steps:
            self.steps[-1]["status"] = "done"
            self.steps[-1]["result"] = result

    def fail_step(self, error: str):
        if self.steps:
            self.steps[-1]["status"] = "failed"
            self.steps[-1]["result"] = error
        self.error = error

    def to_dict(self) -> dict:
        return {
            "current_step": self.current_step,
            "steps": self.steps,
            "error": self.error,
            "completed": all(s["status"] == "done" for s in self.steps) and len(self.steps) > 0,
        }


@celery_app.task(
    bind=True,
    name="app.tasks.pipeline.run_full_analysis",
    max_retries=0,
    queue="video",
)
def run_full_analysis_task(
    self,
    capture_id: str,
    bim_model_id: str,
    schedule_id: str | None = None,
    frame_interval_seconds: float = 1.0,
    device: str | None = None,  # None = auto-detect
    use_mock: bool = False,
):
    """
    Run the complete analysis pipeline as a single Celery task.

    Steps:
      1. Extract frames
      2. Segment frames
      3. Render BIM expectations
      4. Compare IoU
      5. Generate progress items
    """

    async def _run():
        engine = create_async_engine(settings.database_url)
        session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        status = PipelineStatus()

        async with session_factory() as session:
            try:
                # ── Step 1: Frame Extraction ─────────────────────────
                status.start_step("frame_extraction")
                self.update_state(state="PROGRESS", meta=status.to_dict())

                from app.services.video_pipeline import FrameExtractionService
                extractor = FrameExtractionService(session)
                frame_count = await extractor.process_video(
                    capture_id=UUID(capture_id),
                    frame_interval_seconds=frame_interval_seconds,
                    generate_cubemaps=False,  # skip cubemaps for speed
                )
                await session.commit()
                status.complete_step({"frames": frame_count})

                # ── Step 2: Segmentation ─────────────────────────────
                status.start_step("segmentation")
                self.update_state(state="PROGRESS", meta=status.to_dict())

                from app.services.segmentation import SegmentationConfig, SegmentationService
                seg_service = SegmentationService(session)
                seg_count = await seg_service.segment_capture(
                    capture_id=UUID(capture_id),
                    config=SegmentationConfig(device=device, use_mock=use_mock),
                    keyframes_only=True,
                )
                await session.commit()
                status.complete_step({"segmented_frames": seg_count})

                # ── Step 3: BIM Expectation Rendering ────────────────
                status.start_step("bim_rendering")
                self.update_state(state="PROGRESS", meta=status.to_dict())

                from app.services.bim_renderer import BIMHeadlessRenderer
                renderer = BIMHeadlessRenderer(session)
                output_dir = (
                    Path(settings.frame_storage_dir)
                    / str(capture_id)
                    / "expected_masks"
                )
                expected_masks = await renderer.render_expectations(
                    capture_id=UUID(capture_id),
                    bim_model_id=UUID(bim_model_id),
                    output_dir=output_dir,
                )
                total_expectations = sum(len(v) for v in expected_masks.values())
                status.complete_step({"expectations_rendered": total_expectations})

                # ── Step 4: IoU Comparison ───────────────────────────
                status.start_step("iou_comparison")
                self.update_state(state="PROGRESS", meta=status.to_dict())

                from app.services.progress_engine import ProgressComparisonEngine
                comparison_engine = ProgressComparisonEngine(session)
                comp_count = await comparison_engine.compare_capture(
                    capture_id=UUID(capture_id),
                    bim_model_id=UUID(bim_model_id),
                    expected_masks=expected_masks,
                )
                await session.commit()
                status.complete_step({"comparisons": comp_count})

                # ── Step 5: Progress Items + Narratives ──────────────
                status.start_step("progress_generation")
                self.update_state(state="PROGRESS", meta=status.to_dict())

                item_count = await comparison_engine.generate_progress_items(
                    capture_id=UUID(capture_id),
                    schedule_id=UUID(schedule_id) if schedule_id else None,
                )
                await session.commit()
                status.complete_step({"progress_items": item_count})

                logger.info(
                    f"Full analysis pipeline complete: "
                    f"{frame_count} frames → {seg_count} segmented → "
                    f"{comp_count} comparisons → {item_count} progress items"
                )
                return status.to_dict()

            except Exception as e:
                status.fail_step(str(e))
                logger.error(f"Pipeline failed at {status.current_step}: {e}")
                await session.rollback()
                raise

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    return loop.run_until_complete(_run())


# ── Narrative Templates ──────────────────────────────────────────────────

NARRATIVE_TEMPLATES = {
    "ahead": {
        "strong": (
            "{activity_name}: Construction is significantly ahead of schedule. "
            "Observed {observed:.0f}% complete vs {scheduled:.0f}% planned "
            "(+{diff:.0f}pp, ~{days:.0f} days ahead). "
            "Quality confidence: {confidence:.0f}%."
        ),
        "moderate": (
            "{activity_name}: Progressing ahead of schedule. "
            "Observed {observed:.0f}% vs {scheduled:.0f}% planned. "
            "Confidence: {confidence:.0f}%."
        ),
    },
    "on_track": {
        "high_confidence": (
            "{activity_name}: On track. "
            "Observed {observed:.0f}% matches scheduled {scheduled:.0f}% "
            "(±{diff:.0f}pp). Confidence: {confidence:.0f}%."
        ),
        "low_confidence": (
            "{activity_name}: Appears on track ({observed:.0f}% vs {scheduled:.0f}%), "
            "but confidence is low ({confidence:.0f}%). "
            "Manual verification recommended."
        ),
    },
    "behind": {
        "critical": (
            "{activity_name}: ⚠️ BEHIND SCHEDULE — Critical path activity. "
            "Observed {observed:.0f}% vs {scheduled:.0f}% planned "
            "({diff:.0f}pp behind, ~{days:.0f} days). "
            "Immediate action required."
        ),
        "moderate": (
            "{activity_name}: Behind schedule. "
            "Observed {observed:.0f}% vs {scheduled:.0f}% planned "
            "({diff:.0f}pp gap). Consider resource reallocation."
        ),
        "minor": (
            "{activity_name}: Slightly behind schedule. "
            "Observed {observed:.0f}% vs {scheduled:.0f}% planned. "
            "Monitor closely."
        ),
    },
    "not_started": {
        "overdue": (
            "{activity_name}: NOT STARTED — was scheduled to begin {start_date}. "
            "{overdue_days:.0f} days overdue. Escalation recommended."
        ),
        "upcoming": (
            "{activity_name}: Not yet started. "
            "Scheduled to begin {start_date}."
        ),
    },
    "extra_work": (
        "{activity_name}: Extra work detected — element observed at {observed:.0f}% "
        "but not scheduled for this period. Verify if change order applies."
    ),
    "unlinked": (
        "Element detected (IoU={iou:.2f}, confidence={confidence:.0f}%) "
        "but not linked to any schedule activity. "
        "Review auto-linking or assign manually."
    ),
}


def generate_narrative(
    activity_name: str | None,
    observed: float,
    scheduled: float,
    deviation_type: str,
    deviation_days: float | None,
    confidence: float,
    is_critical: bool = False,
    planned_start: date | None = None,
    iou: float = 0.0,
) -> str:
    """Generate a detailed narrative from template based on deviation type."""
    diff = observed - scheduled
    abs_diff = abs(diff)

    params = {
        "activity_name": activity_name or "Unknown Activity",
        "observed": observed,
        "scheduled": scheduled,
        "diff": abs_diff,
        "days": abs(deviation_days) if deviation_days else 0,
        "confidence": confidence * 100,
        "start_date": planned_start.isoformat() if planned_start else "TBD",
        "overdue_days": abs(deviation_days) if deviation_days else 0,
        "iou": iou,
    }

    if not activity_name:
        return NARRATIVE_TEMPLATES["unlinked"].format(**params)

    if deviation_type == "ahead":
        template = NARRATIVE_TEMPLATES["ahead"]
        key = "strong" if abs_diff > 20 else "moderate"
        return template[key].format(**params)

    elif deviation_type == "on_track":
        template = NARRATIVE_TEMPLATES["on_track"]
        key = "high_confidence" if confidence > 0.6 else "low_confidence"
        return template[key].format(**params)

    elif deviation_type == "behind":
        template = NARRATIVE_TEMPLATES["behind"]
        if is_critical and abs_diff > 15:
            key = "critical"
        elif abs_diff > 15:
            key = "moderate"
        else:
            key = "minor"
        return template[key].format(**params)

    elif deviation_type == "not_started":
        template = NARRATIVE_TEMPLATES["not_started"]
        if planned_start and deviation_days and deviation_days < 0:
            key = "overdue"
        else:
            key = "upcoming"
        return template[key].format(**params)

    elif deviation_type == "extra_work":
        return NARRATIVE_TEMPLATES["extra_work"].format(**params)

    return f"{activity_name}: {observed:.0f}% complete."
