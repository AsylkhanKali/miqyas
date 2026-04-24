"""Celery tasks for P6 schedule parsing."""

import asyncio
import logging
from uuid import UUID

from celery.exceptions import SoftTimeLimitExceeded
from app.core.config import get_settings
from app.tasks.worker import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()


@celery_app.task(bind=True, name="app.tasks.p6_tasks.parse_schedule", max_retries=2)
def parse_schedule_task(self, schedule_id: str):
    """Parse an uploaded P6 XER or XML schedule file."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    async def _run():
        engine = create_async_engine(settings.database_url)
        async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async with async_session() as session:
            from app.models import Schedule
            schedule = await session.get(Schedule, UUID(schedule_id))
            if not schedule:
                raise ValueError(f"Schedule {schedule_id} not found")

            if schedule.source_format == "xer":
                from app.services.p6_parser import P6XERParserService
                parser = P6XERParserService(session)
            else:
                from app.services.p6_parser import P6XMLParserService
                parser = P6XMLParserService(session)

            count = await parser.parse(UUID(schedule_id))
            await session.commit()
            return count

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        count = loop.run_until_complete(_run())
        logger.info(f"Schedule parse complete: {count} activities")
        return {"status": "success", "activity_count": count}
    except SoftTimeLimitExceeded:
        logger.error(f"Schedule parse timed out for {schedule_id}")
        try:
            from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
            from app.models import Schedule

            async def _mark_failed():
                engine = create_async_engine(settings.database_url)
                async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
                async with async_session() as session:
                    sched = await session.get(Schedule, UUID(schedule_id))
                    if sched:
                        sched.parse_status = "failed"
                        sched.parse_error = "Parse timed out (file may be too large)"
                        await session.commit()

            loop2 = asyncio.new_event_loop()
            loop2.run_until_complete(_mark_failed())
        except Exception as inner:
            logger.error(f"Could not mark schedule as failed: {inner}")
        return {"status": "failed", "error": "timeout"}
    except Exception as exc:
        logger.error(f"Schedule parse failed: {exc}")
        raise self.retry(exc=exc, countdown=30)
