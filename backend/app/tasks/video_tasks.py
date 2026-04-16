"""Celery tasks for video processing pipeline."""

import asyncio
import logging
from uuid import UUID

from app.core.config import get_settings
from app.tasks.worker import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()


@celery_app.task(bind=True, name="app.tasks.video_tasks.extract_frames", max_retries=1)
def extract_frames_task(
    self,
    capture_id: str,
    frame_interval_seconds: float = 1.0,
    generate_cubemaps: bool = True,
    cubemap_face_size: int = 1024,
):
    """Extract frames from uploaded video using FFmpeg."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    async def _run():
        engine = create_async_engine(settings.database_url)
        async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async with async_session() as session:
            from app.services.video_pipeline import FrameExtractionService
            service = FrameExtractionService(session)
            count = await service.process_video(
                capture_id=UUID(capture_id),
                frame_interval_seconds=frame_interval_seconds,
                generate_cubemaps=generate_cubemaps,
                cubemap_face_size=cubemap_face_size,
            )
            await session.commit()
            return count

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        count = loop.run_until_complete(_run())
        logger.info(f"Frame extraction complete: {count} frames")
        return {"status": "success", "frame_count": count}
    except Exception as exc:
        logger.error(f"Frame extraction failed: {exc}")
        raise self.retry(exc=exc, countdown=60)


@celery_app.task(bind=True, name="app.tasks.video_tasks.colmap_reconstruct", max_retries=1)
def colmap_reconstruct_task(
    self,
    capture_id: str,
    matching_type: str = "sequential",
    max_num_features: int = 8192,
    gpu_index: str = "-1",
):
    """Run COLMAP SfM reconstruction on extracted keyframes."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    async def _run():
        engine = create_async_engine(settings.database_url)
        async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async with async_session() as session:
            from app.services.colmap_orchestrator import COLMAPConfig, COLMAPOrchestrator
            config = COLMAPConfig(
                matching_type=matching_type,
                max_num_features=max_num_features,
                gpu_index=gpu_index,
            )
            orchestrator = COLMAPOrchestrator(session)
            alignment = await orchestrator.reconstruct(
                capture_id=UUID(capture_id),
                config=config,
            )
            await session.commit()
            return str(alignment.id)

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        alignment_id = loop.run_until_complete(_run())
        logger.info(f"COLMAP reconstruction complete: alignment {alignment_id}")
        return {"status": "success", "alignment_id": alignment_id}
    except Exception as exc:
        logger.error(f"COLMAP reconstruction failed: {exc}")
        raise self.retry(exc=exc, countdown=120)
