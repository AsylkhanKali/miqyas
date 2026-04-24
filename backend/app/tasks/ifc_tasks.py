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


async def _mark_bim_status(bim_model_id: str, status: str, error: str | None = None) -> None:
    """Write parse_status + parse_error in a brand-new session.

    Used from exception handlers where the main session has already been
    rolled back (SQLAlchemy rolls back on context-manager exit with an
    unhandled exception), so we open a fresh connection to commit the update.
    """
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from app.models.bim import BIMModel

    engine = create_async_engine(settings.database_url)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        model = await session.get(BIMModel, UUID(bim_model_id))
        if model and model.parse_status != "parsed":   # never overwrite a success
            model.parse_status = status
            if error is not None:
                model.parse_error = error[:500]
            await session.commit()


def _run_mark_status(bim_model_id: str, status: str, error: str | None = None) -> None:
    """Sync wrapper around _mark_bim_status for use inside Celery tasks."""
    try:
        loop = asyncio.new_event_loop()
        loop.run_until_complete(_mark_bim_status(bim_model_id, status, error))
    except Exception as inner:
        logger.error(f"Could not update model status to {status!r}: {inner}")


@celery_app.task(bind=True, name="app.tasks.ifc_tasks.parse_ifc", max_retries=2)
def parse_ifc_task(self, bim_model_id: str):
    """
    Parse an uploaded IFC file and extract BIM elements.

    Since IFCParserService uses async DB sessions, we run it in an event loop.
    For Celery, we use a sync wrapper approach.

    Status flow:
      pending → parsing (set inside IFCParserService.parse)
              → parsed  (success)
              → failed  (exception or soft-time-limit)

    Important: the main session is rolled back on exception, so failures are
    committed via a *fresh* session in each except handler.
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
        # 10-minute soft limit — mark as failed so the UI stops showing "pending".
        logger.error(f"IFC parse timed out for model {bim_model_id}")
        _run_mark_status(bim_model_id, "failed", "Parse timed out (file may be too large)")
        return {"status": "failed", "error": "timeout"}

    except Exception as exc:
        logger.error(f"IFC parse failed (attempt {self.request.retries + 1}): {exc}")

        # The main async session was rolled back by its context manager, so the
        # "failed" flush inside IFCParserService.parse() was lost.  Persist it
        # now in a fresh session so the UI reflects the real state instead of
        # staying stuck at "pending".
        if self.request.retries >= self.max_retries:
            # Final attempt exhausted — mark permanently as failed.
            _run_mark_status(bim_model_id, "failed", str(exc))
        else:
            # Intermediate retry — still mark failed so UI doesn't stay "pending",
            # the next retry will flip it back to "parsing" when it starts.
            _run_mark_status(bim_model_id, "failed",
                             f"Attempt {self.request.retries + 1} failed, retrying… ({exc})")

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
