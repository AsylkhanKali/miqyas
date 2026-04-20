"""
MIQYAS — Procore Integration Service.

Pushes deviation data (RFIs, Issues) from construction progress analysis
to Procore via its REST API v1.1. Handles OAuth2 token lifecycle,
field mapping, and audit logging.
"""

import hashlib
import hmac
import logging
import uuid as _uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.models.models import (
    Activity,
    BIMElement,
    ProcoreConfig,
    ProcoreEntityType,
    ProcorePushLog,
    ProgressItem,
)

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────

PROCORE_API_BASE = "https://api.procore.com"
PROCORE_TOKEN_URL = "https://login.procore.com/oauth/token"
PROCORE_AUTH_URL = "https://login.procore.com/oauth/authorize"

TOKEN_EXPIRY_BUFFER = timedelta(minutes=5)

DEFAULT_FIELD_MAPPING: dict[str, Any] = {
    "rfi": {
        "subject": "{element_name} — Schedule Deviation ({deviation_type})",
        "question": (
            "Element '{element_name}' (type: {ifc_type}, level: {level}) linked to "
            "activity '{activity_name}' ({activity_id}) shows a deviation of "
            "{deviation_days} days. Observed progress: {observed_percent}%, "
            "scheduled progress: {scheduled_percent}%. {narrative}"
        ),
        "assignee_id": None,
        "priority": "normal",
    },
    "issue": {
        "title": "{element_name} — {deviation_type} Deviation",
        "description": (
            "Element '{element_name}' (type: {ifc_type}, level: {level}, zone: {zone}) "
            "linked to activity '{activity_name}' ({activity_id}) is "
            "{deviation_days} days {deviation_direction}. "
            "Observed: {observed_percent}% vs Scheduled: {scheduled_percent}%. "
            "Confidence: {confidence_score}%. {narrative}"
        ),
        "issue_type": "schedule_deviation",
        "priority": "medium",
        "status": "open",
    },
}


# ── Service ────────────────────────────────────────────────────────────

class ProcoreClient:
    """Async Procore REST API client for the MIQYAS platform."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db
        self._settings = get_settings()

    # ── OAuth2 helpers ─────────────────────────────────────────────────

    def get_authorization_url(self, project_id: UUID) -> str:
        """Build the Procore OAuth2 authorization URL.

        The *state* parameter carries the project_id signed with an HMAC
        so the callback can verify it was not tampered with.
        """
        state = self._sign_state(str(project_id))
        params = {
            "response_type": "code",
            "client_id": self._settings.procore_client_id,
            "redirect_uri": self._settings.procore_redirect_uri,
            "state": state,
        }
        qs = "&".join(f"{k}={httpx.URL('', params={k: v}).params[k]}" for k, v in params.items())
        url = f"{PROCORE_AUTH_URL}?{qs}"
        logger.info("Generated Procore authorization URL for project %s", project_id)
        return url

    async def exchange_code(self, code: str, project_id: UUID) -> ProcoreConfig:
        """Exchange an authorization code for access/refresh tokens and persist them."""
        logger.info("Exchanging authorization code for project %s", project_id)
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                PROCORE_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": self._settings.procore_client_id,
                    "client_secret": self._settings.procore_client_secret,
                    "redirect_uri": self._settings.procore_redirect_uri,
                },
            )
            resp.raise_for_status()
            token_data = resp.json()

        expires_at = datetime.now(UTC) + timedelta(seconds=token_data["expires_in"])

        # Upsert config for the project
        result = await self.db.execute(
            select(ProcoreConfig).where(ProcoreConfig.project_id == project_id)
        )
        config = result.scalar_one_or_none()

        if config is None:
            config = ProcoreConfig(
                id=_uuid.uuid4(),
                project_id=project_id,
                access_token=token_data["access_token"],
                refresh_token=token_data["refresh_token"],
                token_expires_at=expires_at,
                field_mapping=DEFAULT_FIELD_MAPPING,
                is_active=True,
            )
            self.db.add(config)
        else:
            config.access_token = token_data["access_token"]
            config.refresh_token = token_data["refresh_token"]
            config.token_expires_at = expires_at
            config.is_active = True

        await self.db.flush()
        logger.info("Stored Procore tokens for project %s (config %s)", project_id, config.id)
        return config

    async def _refresh_token(self, config: ProcoreConfig) -> ProcoreConfig:
        """Refresh an expired access token using the stored refresh token."""
        logger.info("Refreshing Procore token for config %s", config.id)
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                PROCORE_TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": config.refresh_token,
                    "client_id": self._settings.procore_client_id,
                    "client_secret": self._settings.procore_client_secret,
                },
            )
            resp.raise_for_status()
            token_data = resp.json()

        config.access_token = token_data["access_token"]
        config.refresh_token = token_data["refresh_token"]
        config.token_expires_at = datetime.now(UTC) + timedelta(
            seconds=token_data["expires_in"]
        )
        await self.db.flush()
        logger.info("Procore token refreshed for config %s", config.id)
        return config

    async def _ensure_token(self, config: ProcoreConfig) -> str:
        """Return a valid access token, refreshing if within the expiry buffer."""
        now = datetime.now(UTC)
        if config.token_expires_at is None or config.token_expires_at - TOKEN_EXPIRY_BUFFER <= now:
            config = await self._refresh_token(config)
        return config.access_token

    # ── Generic API request ────────────────────────────────────────────

    async def _api_request(
        self,
        config: ProcoreConfig,
        method: str,
        path: str,
        json: dict | None = None,
    ) -> dict:
        """Execute a Procore API v1.1 request with automatic 401 retry.

        Includes the ``Procore-Company-Id`` header required by the v1.1 API.
        """
        token = await self._ensure_token(config)
        url = f"{PROCORE_API_BASE}{path}"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        if config.procore_company_id:
            headers["Procore-Company-Id"] = config.procore_company_id

        async with httpx.AsyncClient() as client:
            resp = await client.request(method, url, headers=headers, json=json)

            # Retry once on 401 (token may have been revoked server-side)
            if resp.status_code == 401:
                logger.warning("Received 401 from Procore, refreshing token and retrying")
                config = await self._refresh_token(config)
                headers["Authorization"] = f"Bearer {config.access_token}"
                resp = await client.request(method, url, headers=headers, json=json)

            resp.raise_for_status()
            return resp.json()

    # ── Company / Project listing ──────────────────────────────────────

    async def list_companies(self, config: ProcoreConfig) -> list[dict]:
        """GET /rest/v1.1/companies — list companies accessible by the token."""
        logger.info("Listing Procore companies for config %s", config.id)
        return await self._api_request(config, "GET", "/rest/v1.1/companies")

    async def list_projects(self, config: ProcoreConfig) -> list[dict]:
        """GET /rest/v1.1/projects — list projects filtered by company_id."""
        logger.info("Listing Procore projects for config %s", config.id)
        path = f"/rest/v1.1/projects?company_id={config.procore_company_id}"
        return await self._api_request(config, "GET", path)

    # ── RFI creation ───────────────────────────────────────────────────

    async def create_rfi(
        self, config: ProcoreConfig, progress_item_id: UUID
    ) -> ProcorePushLog:
        """Build an RFI from a ProgressItem and push it to Procore."""
        progress_item, element, activity = await self._load_progress_context(progress_item_id)
        mapping = config.field_mapping or DEFAULT_FIELD_MAPPING
        payload = self._build_rfi_payload(progress_item, element, activity, mapping)

        logger.info(
            "Creating Procore RFI for progress_item %s (element %s)",
            progress_item_id,
            element.name,
        )

        log = ProcorePushLog(
            id=_uuid.uuid4(),
            config_id=config.id,
            entity_type=ProcoreEntityType.RFI,
            payload=payload,
        )

        try:
            path = f"/rest/v1.1/projects/{config.procore_project_id}/rfis"
            result = await self._api_request(config, "POST", path, json={"rfi": payload})
            log.procore_entity_id = str(result.get("id", ""))
            log.response_status = 201
            log.response_body = result
            log.success = True
            logger.info("Procore RFI created: %s", log.procore_entity_id)
        except httpx.HTTPStatusError as exc:
            log.response_status = exc.response.status_code
            log.response_body = _safe_json(exc.response)
            log.success = False
            logger.error("Failed to create Procore RFI: %s %s", exc.response.status_code, log.response_body)
        except Exception as exc:
            log.response_status = 0
            log.response_body = {"error": str(exc)}
            log.success = False
            logger.exception("Unexpected error creating Procore RFI")

        self.db.add(log)
        await self.db.flush()
        return log

    # ── Issue creation ─────────────────────────────────────────────────

    async def create_issue(
        self, config: ProcoreConfig, progress_item_id: UUID
    ) -> ProcorePushLog:
        """Build an Issue from a ProgressItem and push it to Procore."""
        progress_item, element, activity = await self._load_progress_context(progress_item_id)
        mapping = config.field_mapping or DEFAULT_FIELD_MAPPING
        payload = self._build_issue_payload(progress_item, element, activity, mapping)

        logger.info(
            "Creating Procore Issue for progress_item %s (element %s)",
            progress_item_id,
            element.name,
        )

        log = ProcorePushLog(
            id=_uuid.uuid4(),
            config_id=config.id,
            entity_type=ProcoreEntityType.ISSUE,
            payload=payload,
        )

        try:
            path = f"/rest/v1.1/projects/{config.procore_project_id}/issues"
            result = await self._api_request(config, "POST", path, json={"issue": payload})
            log.procore_entity_id = str(result.get("id", ""))
            log.response_status = 201
            log.response_body = result
            log.success = True
            logger.info("Procore Issue created: %s", log.procore_entity_id)
        except httpx.HTTPStatusError as exc:
            log.response_status = exc.response.status_code
            log.response_body = _safe_json(exc.response)
            log.success = False
            logger.error("Failed to create Procore Issue: %s %s", exc.response.status_code, log.response_body)
        except Exception as exc:
            log.response_status = 0
            log.response_body = {"error": str(exc)}
            log.success = False
            logger.exception("Unexpected error creating Procore Issue")

        self.db.add(log)
        await self.db.flush()
        return log

    # ── Payload builders ───────────────────────────────────────────────

    @staticmethod
    def _build_rfi_payload(
        progress_item: ProgressItem,
        element: BIMElement,
        activity: Activity | None,
        mapping: dict[str, Any],
    ) -> dict:
        """Construct the Procore RFI JSON payload using field mapping templates."""
        rfi_map = mapping.get("rfi", DEFAULT_FIELD_MAPPING["rfi"])
        ctx = _template_context(progress_item, element, activity)
        payload: dict[str, Any] = {
            "subject": _fmt(rfi_map.get("subject", ""), ctx),
            "question": _fmt(rfi_map.get("question", ""), ctx),
        }
        if rfi_map.get("assignee_id"):
            payload["assignee_id"] = rfi_map["assignee_id"]
        if rfi_map.get("priority"):
            payload["priority"] = rfi_map["priority"]
        return payload

    @staticmethod
    def _build_issue_payload(
        progress_item: ProgressItem,
        element: BIMElement,
        activity: Activity | None,
        mapping: dict[str, Any],
    ) -> dict:
        """Construct the Procore Issue JSON payload using field mapping templates."""
        issue_map = mapping.get("issue", DEFAULT_FIELD_MAPPING["issue"])
        ctx = _template_context(progress_item, element, activity)
        payload: dict[str, Any] = {
            "title": _fmt(issue_map.get("title", ""), ctx),
            "description": _fmt(issue_map.get("description", ""), ctx),
        }
        for key in ("issue_type", "priority", "status"):
            val = issue_map.get(key)
            if val:
                payload[key] = val
        return payload

    # ── Internal helpers ───────────────────────────────────────────────

    async def _load_progress_context(
        self, progress_item_id: UUID
    ) -> tuple[ProgressItem, BIMElement, Activity | None]:
        """Load a ProgressItem together with its related BIMElement and Activity."""
        result = await self.db.execute(
            select(ProgressItem)
            .options(
                selectinload(ProgressItem.element),
                selectinload(ProgressItem.activity),
            )
            .where(ProgressItem.id == progress_item_id)
        )
        item = result.scalar_one_or_none()
        if item is None:
            raise ValueError(f"ProgressItem {progress_item_id} not found")
        return item, item.element, item.activity

    def _sign_state(self, project_id_str: str) -> str:
        """Create an HMAC-signed state parameter: ``{project_id}:{signature}``."""
        sig = hmac.new(
            self._settings.secret_key.encode(),
            project_id_str.encode(),
            hashlib.sha256,
        ).hexdigest()
        return f"{project_id_str}:{sig}"

    @staticmethod
    def verify_state(state: str, secret_key: str) -> UUID:
        """Verify the HMAC signature on a state parameter and return the project_id.

        Raises ``ValueError`` if the signature is invalid.
        """
        if ":" not in state:
            raise ValueError("Invalid state parameter format")
        project_id_str, received_sig = state.rsplit(":", 1)
        expected_sig = hmac.new(
            secret_key.encode(),
            project_id_str.encode(),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected_sig, received_sig):
            raise ValueError("State signature verification failed")
        return UUID(project_id_str)


# ── Module-level helpers ───────────────────────────────────────────────

def _template_context(
    progress_item: ProgressItem,
    element: BIMElement,
    activity: Activity | None,
) -> dict[str, str]:
    """Build a template context dict from domain models."""
    deviation_days_abs = abs(progress_item.deviation_days or 0)
    deviation_direction = "behind" if (progress_item.deviation_days or 0) > 0 else "ahead"
    return {
        "element_name": element.name or "Unnamed Element",
        "ifc_type": element.ifc_type or "",
        "category": str(element.category) if element.category else "",
        "level": element.level or "",
        "zone": element.zone or "",
        "material": element.material or "",
        "activity_name": activity.name if activity else "N/A",
        "activity_id": activity.activity_id if activity else "N/A",
        "planned_start": str(activity.planned_start) if activity and activity.planned_start else "N/A",
        "planned_finish": str(activity.planned_finish) if activity and activity.planned_finish else "N/A",
        "observed_percent": f"{progress_item.observed_percent:.1f}",
        "scheduled_percent": f"{progress_item.scheduled_percent:.1f}",
        "deviation_type": str(progress_item.deviation_type.value) if progress_item.deviation_type else "unknown",
        "deviation_days": f"{deviation_days_abs:.1f}",
        "deviation_direction": deviation_direction,
        "confidence_score": f"{(progress_item.confidence_score or 0) * 100:.0f}",
        "narrative": progress_item.narrative or "",
    }


def _fmt(template: str, ctx: dict[str, str]) -> str:
    """Safe string format — missing keys resolve to empty strings."""
    try:
        return template.format_map(ctx)
    except (KeyError, ValueError):
        logger.warning("Template formatting failed for: %s", template)
        return template


def _safe_json(response: httpx.Response) -> dict:
    """Extract JSON from an httpx response, falling back to raw text."""
    try:
        return response.json()
    except Exception:
        return {"raw": response.text[:2000]}
