"""Webhook management endpoints."""

import secrets
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import Webhook
from app.schemas import WEBHOOK_EVENTS, WebhookCreate, WebhookCreatedResponse, WebhookResponse

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("", response_model=WebhookCreatedResponse, status_code=201)
async def register_webhook(body: WebhookCreate, db: AsyncSession = Depends(get_db)):
    invalid = set(body.events) - WEBHOOK_EVENTS
    if invalid:
        raise HTTPException(status_code=422, detail=f"Unknown events: {invalid}. Valid: {sorted(WEBHOOK_EVENTS)}")

    if not body.url.startswith("https://"):
        raise HTTPException(status_code=422, detail="Webhook URL must use HTTPS")

    secret = secrets.token_hex(32)

    hook = Webhook(
        url=body.url,
        secret=secret,
        events=body.events,
        project_id=body.project_id,
    )
    db.add(hook)
    await db.commit()
    await db.refresh(hook)

    return WebhookCreatedResponse(
        id=hook.id,
        url=hook.url,
        events=hook.events,
        project_id=hook.project_id,
        is_active=hook.is_active,
        last_triggered_at=hook.last_triggered_at,
        created_at=hook.created_at,
        secret=secret,
    )


@router.get("", response_model=list[WebhookResponse])
async def list_webhooks(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Webhook).order_by(Webhook.created_at.desc()))
    return result.scalars().all()


@router.delete("/{webhook_id}", status_code=204)
async def delete_webhook(webhook_id: UUID, db: AsyncSession = Depends(get_db)):
    hook = await db.get(Webhook, webhook_id)
    if not hook:
        raise HTTPException(status_code=404, detail="Webhook not found")
    await db.delete(hook)
    await db.commit()


@router.post("/{webhook_id}/test", status_code=202)
async def test_webhook(webhook_id: UUID, db: AsyncSession = Depends(get_db)):
    """Fire a test ping event to verify the endpoint is reachable."""
    hook = await db.get(Webhook, webhook_id)
    if not hook:
        raise HTTPException(status_code=404, detail="Webhook not found")

    from app.tasks.webhook_tasks import deliver_webhook_task
    deliver_webhook_task.delay(
        webhook_id=str(hook.id),
        event="ping",
        payload={"message": "Webhook test from MIQYAS"},
    )
    return {"queued": True}
