"""Celery tasks for CV pipeline — segmentation and progress comparison."""

import asyncio
import logging
from pathlib import Path
from uuid import UUID

from app.core.config import get_settings
from app.tasks.worker import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()


@celery_app.task(bind=True, name="app.tasks.cv_tasks.segment_capture", max_retries=1)
def segment_capture_task(
    self,
    capture_id: str,
    model_name: str = "facebook/mask2former-swin-large-ade-semantic",
    device: str | None = None,  # None = auto-detect
    keyframes_only: bool = True,
    use_mock: bool = False,
):
    """Run semantic segmentation on video frames."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    async def _run():
        engine = create_async_engine(settings.database_url)
        async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async with async_session() as session:
            from app.services.segmentation import SegmentationConfig, SegmentationService
            config = SegmentationConfig(
                model_name=model_name,
                device=device,  # None → auto-detect (cuda > mps > cpu)
                use_mock=use_mock,
            )
            service = SegmentationService(session)
            count = await service.segment_capture(
                capture_id=UUID(capture_id),
                config=config,
                keyframes_only=keyframes_only,
            )
            await session.commit()
            return count

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        count = loop.run_until_complete(_run())
        logger.info(f"Segmentation complete: {count} frames (mock={use_mock})")
        return {"status": "success", "frames_segmented": count, "mock": use_mock}
    except Exception as exc:
        logger.error(f"Segmentation failed: {exc}")
        raise self.retry(exc=exc, countdown=120)


@celery_app.task(bind=True, name="app.tasks.cv_tasks.compare_progress", max_retries=0)
def compare_progress_task(
    self,
    capture_id: str,
    bim_model_id: str,
    schedule_id: str | None = None,
    use_mock: bool = False,
):
    """Run full comparison pipeline: render expectations → IoU → progress items.

    If use_mock=True, generates deterministic random progress data for dev/demo.
    Real mode requires: real COLMAP poses + real segmentation masks.
    """
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    async def _run_real(session):
        from app.services.bim_renderer import BIMHeadlessRenderer
        from app.services.progress_engine import ProgressComparisonEngine

        output_dir = Path(settings.frame_storage_dir) / capture_id / "expected_masks"
        renderer = BIMHeadlessRenderer(session)
        expected = await renderer.render_expectations(
            capture_id=UUID(capture_id),
            bim_model_id=UUID(bim_model_id),
            output_dir=output_dir,
        )
        engine_svc = ProgressComparisonEngine(session)
        comp_count = await engine_svc.compare_capture(
            capture_id=UUID(capture_id),
            bim_model_id=UUID(bim_model_id),
            expected_masks=expected,
        )
        item_count = await engine_svc.generate_progress_items(
            capture_id=UUID(capture_id),
            schedule_id=UUID(schedule_id) if schedule_id else None,
        )
        return comp_count, item_count

    async def _run_mock(session):
        """
        Generate deterministic mock ProgressItems for dev/demo.
        Only called when use_mock=True is explicitly passed.
        """
        import random
        from sqlalchemy import delete, select
        from app.models import BIMElement, DeviationType, ProgressItem, VideoCapture, VideoStatus

        rng = random.Random(bim_model_id)
        deviation_weights = [
            (DeviationType.ON_TRACK,    0.40),
            (DeviationType.AHEAD,       0.20),
            (DeviationType.BEHIND,      0.25),
            (DeviationType.NOT_STARTED, 0.10),
            (DeviationType.EXTRA_WORK,  0.05),
        ]
        population = [d for d, w in deviation_weights for _ in range(int(w * 100))]

        result = await session.execute(
            select(BIMElement).where(BIMElement.bim_model_id == UUID(bim_model_id))
        )
        elements = list(result.scalars().all())

        await session.execute(
            delete(ProgressItem).where(ProgressItem.capture_id == UUID(capture_id))
        )

        items = []
        for el in elements:
            dev = rng.choice(population)
            obs = rng.uniform(20, 100) if dev != DeviationType.NOT_STARTED else rng.uniform(0, 15)
            sch = rng.uniform(10, 90)
            items.append(ProgressItem(
                element_id=el.id,
                capture_id=UUID(capture_id),
                deviation_type=dev,
                observed_percent=round(obs, 1),
                scheduled_percent=round(sch, 1),
                confidence_score=round(rng.uniform(0.55, 0.95), 3),
                narrative=f"[SIMULATED] {dev.value} ({obs:.0f}% observed vs {sch:.0f}% scheduled)",
            ))

        session.add_all(items)

        capture = await session.get(VideoCapture, UUID(capture_id))
        if capture:
            capture.status = VideoStatus.COMPARED

        await session.flush()
        logger.info(f"Mock comparison: created {len(items)} progress items for capture {capture_id}")
        return 0, len(items)

    async def _run():
        engine = create_async_engine(settings.database_url)
        async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async with async_session() as session:
            if use_mock:
                logger.info("Running comparison in MOCK mode (use_mock=True)")
                comp_count, item_count = await _run_mock(session)
            else:
                comp_count, item_count = await _run_real(session)
                if item_count == 0:
                    raise RuntimeError(
                        "Real comparison pipeline produced 0 progress items. "
                        "Check: 1) COLMAP created real camera poses (not mock identity), "
                        "2) Segmentation ran with use_mock=False, "
                        "3) BIM elements have valid bounding boxes. "
                        "To generate demo data, use use_mock=True explicitly."
                    )
            await session.commit()
            return comp_count, item_count

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        comp_count, item_count = loop.run_until_complete(_run())
        logger.info(f"Progress comparison complete: {comp_count} comparisons, {item_count} items (mock={use_mock})")
        return {
            "status": "success",
            "comparisons": comp_count,
            "progress_items": item_count,
            "mock": use_mock,
        }
    except Exception as exc:
        logger.error(f"Progress comparison failed: {exc}", exc_info=True)
        raise
