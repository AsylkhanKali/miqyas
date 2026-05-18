"""API Key management endpoints."""

import hashlib
import os
import secrets
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import ApiKey
from app.schemas import ApiKeyCreate, ApiKeyCreatedResponse, ApiKeyResponse

router = APIRouter(prefix="/api-keys", tags=["api-keys"])

VALID_SCOPES = {"read", "write", "webhooks"}


def _generate_key() -> tuple[str, str, str]:
    """Returns (full_key, prefix, sha256_hash)."""
    raw = "mq_" + secrets.token_urlsafe(32)
    prefix = raw[:10]
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    return raw, prefix, key_hash


@router.post("", response_model=ApiKeyCreatedResponse, status_code=201)
async def create_api_key(body: ApiKeyCreate, db: AsyncSession = Depends(get_db)):
    invalid = set(body.scopes) - VALID_SCOPES
    if invalid:
        raise HTTPException(status_code=422, detail=f"Invalid scopes: {invalid}. Valid: {VALID_SCOPES}")

    raw_key, prefix, key_hash = _generate_key()

    api_key = ApiKey(
        name=body.name,
        key_prefix=prefix,
        key_hash=key_hash,
        scopes=body.scopes,
        expires_at=body.expires_at,
    )
    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)

    return ApiKeyCreatedResponse(
        id=api_key.id,
        name=api_key.name,
        key_prefix=api_key.key_prefix,
        scopes=api_key.scopes,
        is_active=api_key.is_active,
        last_used_at=api_key.last_used_at,
        expires_at=api_key.expires_at,
        created_at=api_key.created_at,
        key=raw_key,
    )


@router.get("", response_model=list[ApiKeyResponse])
async def list_api_keys(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ApiKey).order_by(ApiKey.created_at.desc()))
    return result.scalars().all()


@router.delete("/{key_id}", status_code=204)
async def revoke_api_key(key_id: UUID, db: AsyncSession = Depends(get_db)):
    api_key = await db.get(ApiKey, key_id)
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    api_key.is_active = False
    await db.commit()
