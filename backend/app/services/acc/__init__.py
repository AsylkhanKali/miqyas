"""
MIQYAS — Autodesk Construction Cloud (ACC) Integration Service.

Pushes deviation data as Issues into ACC projects via Autodesk Platform Services API.
Handles OAuth2 (3-legged) token lifecycle, hub/project discovery, and audit logging.

API reference: https://aps.autodesk.com/en/docs/construction/v1/reference/http/issues/
"""

import logging
import uuid as _uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.models import AccConfig, AccPushLog, Activity, BIMElement, ProgressItem

logger = logging.getLogger(__name__)

ACC_AUTH_URL = "https://developer.api.autodesk.com/authentication/v2/authorize"
ACC_TOKEN_URL = "https://developer.api.autodesk.com/authentication/v2/token"
ACC_API_BASE = "https://developer.api.autodesk.com"

TOKEN_EXPIRY_BUFFER = timedelta(minutes=5)

DEFAULT_FIELD_MAPPING: dict[str, Any] = {
    "title": "{element_name} — {deviation_type} ({deviation_days:.0f}d)",
    "description": (
        "Element '{element_name}' (type: {ifc_type}, level: {level}) "
        "linked to activity '{activity_name}' is {deviation_days:.0f} days "
        "{deviation_direction}. Observed: {observed_percent:.0f}% vs "
        "Scheduled: {scheduled_percent:.0f}%. {narrative}"
    ),
    "status": "open",
    "issue_type": "schedule_deviation",
}


class AccClient:
    """Async Autodesk Construction Cloud API client."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._settings = get_settings()

    # ── OAuth2 ─────────────────────────────────────────────────────────

    def get_authorization_url(self, project_id: UUID) -> str:
        import urllib.parse
        params = urllib.parse.urlencode({
            "response_type": "code",
            "client_id": self._settings.acc_client_id,
            "redirect_uri": self._settings.acc_redirect_uri,
            "scope": "data:read data:write",
            "state": str(project_id),
        })
        return f"{ACC_AUTH_URL}?{params}"

    async def exchange_code(self, code: str, project_id: UUID) -> AccConfig:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                ACC_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": self._settings.acc_client_id,
                    "client_secret": self._settings.acc_client_secret,
                    "redirect_uri": self._settings.acc_redirect_uri,
                },
            )
            resp.raise_for_status()
            token_data = resp.json()

        expires_at = datetime.now(UTC) + timedelta(seconds=token_data["expires_in"])

        result = await self.db.execute(select(AccConfig).where(AccConfig.project_id == project_id))
        config = result.scalar_one_or_none()

        if config is None:
            config = AccConfig(
                id=_uuid.uuid4(),
                project_id=project_id,
                access_token=token_data["access_token"],
                refresh_token=token_data.get("refresh_token"),
                token_expires_at=expires_at,
                field_mapping=DEFAULT_FIELD_MAPPING,
                is_active=True,
            )
            self.db.add(config)
        else:
            config.access_token = token_data["access_token"]
            config.refresh_token = token_data.get("refresh_token", config.refresh_token)
            config.token_expires_at = expires_at
            config.is_active = True

        await self.db.flush()
        return config

    async def _refresh_token(self, config: AccConfig) -> AccConfig:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                ACC_TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": config.refresh_token,
                    "client_id": self._settings.acc_client_id,
                    "client_secret": self._settings.acc_client_secret,
                },
            )
            resp.raise_for_status()
            token_data = resp.json()

        config.access_token = token_data["access_token"]
        config.refresh_token = token_data.get("refresh_token", config.refresh_token)
        config.token_expires_at = datetime.now(UTC) + timedelta(seconds=token_data["expires_in"])
        await self.db.flush()
        return config

    async def _get_valid_token(self, config: AccConfig) -> str:
        if config.token_expires_at and config.token_expires_at - TOKEN_EXPIRY_BUFFER < datetime.now(UTC):
            config = await self._refresh_token(config)
        return config.access_token

    async def _request(self, config: AccConfig, method: str, path: str, **kwargs) -> dict:
        token = await self._get_valid_token(config)
        async with httpx.AsyncClient() as client:
            resp = await client.request(
                method,
                f"{ACC_API_BASE}{path}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=30.0,
                **kwargs,
            )
            resp.raise_for_status()
            return resp.json()

    # ── Hub / Project Discovery ─────────────────────────────────────────

    async def list_hubs(self, config: AccConfig) -> list[dict]:
        data = await self._request(config, "GET", "/project/v1/hubs")
        return [{"id": h["id"], "name": h["attributes"]["name"]} for h in data.get("data", [])]

    async def list_projects(self, config: AccConfig, hub_id: str) -> list[dict]:
        data = await self._request(config, "GET", f"/project/v1/hubs/{hub_id}/projects")
        return [{"id": p["id"], "name": p["attributes"]["name"]} for p in data.get("data", [])]

    async def list_issue_types(self, config: AccConfig) -> list[dict]:
        data = await self._request(
            config, "GET",
            f"/construction/issues/v1/projects/{config.acc_project_id}/issue-attribute-definitions",
        )
        return data.get("results", [])

    # ── Issue Push ──────────────────────────────────────────────────────

    def _build_payload(self, item: ProgressItem, element: BIMElement, activity: Activity | None, mapping: dict) -> dict:
        ctx = {
            "element_name": element.name or element.global_id,
            "ifc_type": element.ifc_type or "",
            "level": element.level or "",
            "deviation_type": item.deviation_type or "unknown",
            "deviation_days": abs(item.deviation_days or 0),
            "deviation_direction": "behind" if (item.deviation_days or 0) > 0 else "ahead",
            "observed_percent": (item.observed_progress or 0) * 100,
            "scheduled_percent": (item.scheduled_progress or 0) * 100,
            "narrative": item.narrative or "",
            "activity_name": activity.name if activity else "N/A",
        }
        return {
            "title": mapping.get("title", "{element_name}").format(**ctx)[:250],
            "description": mapping.get("description", "").format(**ctx),
            "status": mapping.get("status", "open"),
            "locationDescription": f"Level: {element.level}" if element.level else None,
        }

    async def push_issue(self, project_id: UUID, item_id: UUID) -> dict:
        result = await self.db.execute(select(AccConfig).where(AccConfig.project_id == project_id))
        config = result.scalar_one_or_none()
        if not config or not config.is_active:
            raise ValueError("ACC not configured for this project")
        if not config.acc_project_id:
            raise ValueError("ACC project not selected — set acc_project_id in config")

        item = await self.db.get(ProgressItem, item_id)
        if not item:
            raise ValueError(f"ProgressItem {item_id} not found")

        element = await self.db.get(BIMElement, item.bim_element_id)
        activity = await self.db.get(Activity, item.activity_id) if item.activity_id else None

        mapping = config.field_mapping or DEFAULT_FIELD_MAPPING
        payload = self._build_payload(item, element, activity, mapping)

        success, response_status, response_body, acc_issue_id = False, None, {}, None
        try:
            data = await self._request(
                config, "POST",
                f"/construction/issues/v1/projects/{config.acc_project_id}/issues",
                json=payload,
            )
            acc_issue_id = data.get("id")
            response_status = 201
            response_body = data
            success = True
            logger.info("ACC issue created: %s for element %s", acc_issue_id, element.name)
        except httpx.HTTPStatusError as e:
            response_status = e.response.status_code
            response_body = {"error": e.response.text}
            logger.error("ACC push failed: %s — %s", response_status, response_body)

        log = AccPushLog(
            config_id=config.id,
            acc_issue_id=acc_issue_id,
            payload=payload,
            response_status=response_status,
            response_body=response_body,
            success=success,
        )
        self.db.add(log)
        await self.db.flush()
        return {"success": success, "acc_issue_id": acc_issue_id, "log_id": str(log.id)}
