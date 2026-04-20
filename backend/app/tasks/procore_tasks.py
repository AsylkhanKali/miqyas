"""Celery tasks for Procore bulk push operations.

Pushes multiple ProgressItems as RFIs or Issues in a single background task,
reporting per-item results and overall summary.
"""

import asyncio
import logging
from uuid import UUID

from app.core.config import get_settings
from app.tasks.worker import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()


@celery_app.task(
    bind=True,
    name="app.tasks.procore_tasks.bulk_push",
    max_retries=0,
    queue="default",
)
def bulk_push_task(
    self,
    project_id: str,
    progress_item_ids: list[str],
    entity_type: str,  # "rfi" | "issue"
) -> dict:
    """Push multiple ProgressItems to Procore as RFIs or Issues.

    Returns a summary dict:
        {
            "total": int,
            "succeeded": int,
            "failed": int,
            "results": [{"progress_item_id": str, "success": bool, "procore_entity_id": str|None, "error": str|None}]
        }
    """
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from app.models.models import ProcoreConfig
    from app.services.procore import ProcoreClient

    async def _run():
        engine = create_async_engine(settings.database_url)
        async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        results = []
        succeeded = 0
        failed = 0

        async with async_session() as session:
            # Load Procore config for the project
            result = await session.execute(
                select(ProcoreConfig).where(
                    ProcoreConfig.project_id == UUID(project_id),
                    ProcoreConfig.is_active == True,  # noqa: E712
                )
            )
            config = result.scalar_one_or_none()

            if config is None:
                raise RuntimeError(
                    f"Procore integration is not active for project {project_id}. "
                    "Connect via the Integrations page first."
                )

            if not config.procore_project_id:
                raise RuntimeError(
                    "No Procore project linked. Select a project in the Integrations page."
                )

            client = ProcoreClient(session)

            for item_id in progress_item_ids:
                try:
                    if entity_type == "rfi":
                        log = await client.create_rfi(config, UUID(item_id))
                    elif entity_type == "issue":
                        log = await client.create_issue(config, UUID(item_id))
                    else:
                        raise ValueError(f"Unknown entity_type: {entity_type}")

                    results.append({
                        "progress_item_id": item_id,
                        "success": log.success,
                        "procore_entity_id": log.procore_entity_id,
                        "error": str(log.response_body.get("error", "")) if not log.success else None,
                    })
                    if log.success:
                        succeeded += 1
                    else:
                        failed += 1

                    logger.info(
                        "Bulk push item %s/%s: %s=%s success=%s",
                        len(results), len(progress_item_ids),
                        entity_type, item_id, log.success,
                    )

                except Exception as exc:
                    logger.error("Bulk push failed for item %s: %s", item_id, exc)
                    results.append({
                        "progress_item_id": item_id,
                        "success": False,
                        "procore_entity_id": None,
                        "error": str(exc),
                    })
                    failed += 1

            await session.commit()

        return {
            "total": len(progress_item_ids),
            "succeeded": succeeded,
            "failed": failed,
            "results": results,
        }

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        summary = loop.run_until_complete(_run())
        logger.info(
            "Bulk Procore push complete: %d/%d succeeded (%s)",
            summary["succeeded"], summary["total"], entity_type,
        )
        return summary
    except Exception as exc:
        logger.error("Bulk push task failed: %s", exc, exc_info=True)
        raise
    finally:
        loop.close()
