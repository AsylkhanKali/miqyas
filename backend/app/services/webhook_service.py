"""Webhook delivery service — HMAC-signed HTTP POST to registered endpoints."""

import hashlib
import hmac
import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Webhook

logger = logging.getLogger(__name__)


def sign_payload(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


async def dispatch(
    db: AsyncSession,
    event: str,
    payload: dict,
    project_id: UUID | None = None,
) -> None:
    """Find matching webhooks and enqueue delivery via Celery."""
    query = select(Webhook).where(Webhook.is_active == True)  # noqa: E712
    if project_id:
        from sqlalchemy import or_
        query = query.where(
            or_(Webhook.project_id == project_id, Webhook.project_id == None)  # noqa: E711
        )

    result = await db.execute(query)
    hooks = result.scalars().all()

    matching = [h for h in hooks if event in (h.events or [])]
    if not matching:
        return

    from app.tasks.webhook_tasks import deliver_webhook_task

    for hook in matching:
        deliver_webhook_task.delay(
            webhook_id=str(hook.id),
            event=event,
            payload=payload,
        )
        logger.info(f"Webhook enqueued: {event} → {hook.url}")
