"""Celery tasks for Autodesk Construction Cloud bulk push."""

import asyncio
import logging
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.tasks.worker import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()


@celery_app.task(
    bind=True,
    name="app.tasks.acc_tasks.bulk_acc_push_task",
    queue="default",
    max_retries=2,
)
def bulk_acc_push_task(self, project_id: str, item_ids: list[str]) -> dict:
    return asyncio.get_event_loop().run_until_complete(_bulk_push(project_id, item_ids))


async def _bulk_push(project_id: str, item_ids: list[str]) -> dict:
    from app.services.acc import AccClient

    engine = create_async_engine(settings.database_url)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    results = []
    try:
        async with async_session() as db:
            client = AccClient(db)
            for item_id in item_ids:
                try:
                    result = await client.push_issue(UUID(project_id), UUID(item_id))
                    results.append(result)
                except Exception as e:
                    logger.error("ACC push failed for item %s: %s", item_id, e)
                    results.append({"item_id": item_id, "success": False, "error": str(e)})
            await db.commit()
    finally:
        await engine.dispose()

    success_count = sum(1 for r in results if r.get("success"))
    return {"total": len(results), "success": success_count, "failed": len(results) - success_count, "results": results}
