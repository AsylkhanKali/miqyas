"""Celery tasks for IFC file parsing."""

import asyncio
import logging
from uuid import UUID

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.tasks.worker import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()


def _get_sync_session() -> Session:
    """Create a synchronous session for Celery tasks."""
    from sqlalchemy.orm import sessionmaker
    engine = create_engine(settings.database_url_sync)
    SessionLocal = sessionmaker(bind=engine)
    return SessionLocal()


@celery_app.task(bind=True, name="app.tasks.ifc_tasks.parse_ifc", max_retries=2)
def parse_ifc_task(self, bim_model_id: str):
    """
    Parse an uploaded IFC file and extract BIM elements.

    Since IFCParserService uses async DB sessions, we run it in an event loop.
    For Celery, we use a sync wrapper approach.
    """
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    async def _run():
        engine = create_async_engine(settings.database_url)
        async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async with async_session() as session:
            from app.services.ifc_parser import IFCParserService
            parser = IFCParserService(session)
            count = await parser.parse(UUID(bim_model_id))
            await session.commit()
            return count

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        count = loop.run_until_complete(_run())
        logger.info(f"IFC parse complete: {count} elements")
        return {"status": "success", "element_count": count}
    except SoftTimeLimitExceeded:
        # 10-minute soft limit hit — mark model as failed so the UI stops
        # showing "pending" and the user can upload a smaller file or retry.
        logger.error(f"IFC parse timed out for model {bim_model_id}")
        try:
            from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
            from app.models.bim import BIMModel

            async def _mark_failed():
                engine = create_async_engine(settings.database_url)
                async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
                async with async_session() as session:
                    model = await session.get(BIMModel, UUID(bim_model_id))
                    if model:
                        model.parse_status = "failed"
                        model.parse_error = "Parse timed out (file may be too large)"
                        await session.commit()

            loop2 = asyncio.new_event_loop()
            loop2.run_until_complete(_mark_failed())
        except Exception as inner:
            logger.error(f"Could not mark model as failed: {inner}")
        return {"status": "failed", "error": "timeout"}
    except Exception as exc:
        logger.error(f"IFC parse failed: {exc}")
        raise self.retry(exc=exc, countdown=30)


@celery_app.task(bind=True, name="app.tasks.ifc_tasks.auto_link", max_retries=1)
def auto_link_task(self, bim_model_id: str, schedule_id: str):
    """Run auto-linking between BIM elements and schedule activities."""
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    async def _run():
        engine = create_async_engine(settings.database_url)
        async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async with async_session() as session:
            from app.services.auto_linker import AutoLinkerService
            linker = AutoLinkerService(session)
            count = await linker.link(UUID(bim_model_id), UUID(schedule_id))
            await session.commit()
            return count

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        count = loop.run_until_complete(_run())
        return {"status": "success", "links_created": count}
    except Exception as exc:
        logger.error(f"Auto-link failed: {exc}")
        raise self.retry(exc=exc, countdown=15)
