"""Celery task for webhook delivery with retry logic."""

import hashlib
import hmac
import json
import logging
from datetime import UTC, datetime

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.tasks.worker import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()


@celery_app.task(
    bind=True,
    name="app.tasks.webhook_tasks.deliver_webhook_task",
    queue="default",
    max_retries=4,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
)
def deliver_webhook_task(self, webhook_id: str, event: str, payload: dict) -> dict:
    import asyncio
    return asyncio.get_event_loop().run_until_complete(
        _deliver(self, webhook_id, event, payload)
    )


async def _deliver(task, webhook_id: str, event: str, payload: dict) -> dict:
    from app.models import Webhook

    engine = create_async_engine(settings.database_url)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    try:
        async with async_session() as db:
            hook = await db.get(Webhook, webhook_id)
            if not hook or not hook.is_active:
                return {"skipped": True}

            body = json.dumps({
                "event": event,
                "timestamp": datetime.now(UTC).isoformat(),
                "data": payload,
            }).encode()

            signature = hmac.new(hook.secret.encode(), body, hashlib.sha256).hexdigest()

            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    hook.url,
                    content=body,
                    headers={
                        "Content-Type": "application/json",
                        "X-Miqyas-Event": event,
                        "X-Miqyas-Signature": f"sha256={signature}",
                    },
                )
                resp.raise_for_status()

            hook.last_triggered_at = datetime.now(UTC)
            await db.commit()

            logger.info(f"Webhook delivered: {event} → {hook.url} [{resp.status_code}]")
            return {"status": resp.status_code, "url": hook.url}

    finally:
        await engine.dispose()
