"""API Key authentication dependency."""

import hashlib
from datetime import UTC, datetime

from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import ApiKey

_header_scheme = APIKeyHeader(name="X-API-Key", auto_error=False)


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def require_api_key(
    raw_key: str | None = Security(_header_scheme),
    db: AsyncSession = Security(get_db),
) -> ApiKey:
    if not raw_key:
        raise HTTPException(status_code=401, detail="X-API-Key header required")

    key_hash = _hash_key(raw_key)
    result = await db.execute(select(ApiKey).where(ApiKey.key_hash == key_hash))
    api_key = result.scalar_one_or_none()

    if not api_key or not api_key.is_active:
        raise HTTPException(status_code=401, detail="Invalid or revoked API key")

    if api_key.expires_at and api_key.expires_at < datetime.now(UTC):
        raise HTTPException(status_code=401, detail="API key expired")

    api_key.last_used_at = datetime.now(UTC)
    await db.commit()

    return api_key
