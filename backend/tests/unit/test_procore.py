"""
Unit tests for the Procore integration service.

Tests cover:
- OAuth state signing + verification
- Template context building + field formatting
- RFI / Issue payload construction
- Token refresh logic
- Push flow with mocked HTTP responses
- Callback endpoint (OAuth code exchange)
- Push API endpoint
"""

import hashlib
import hmac
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from httpx import AsyncClient

from app.services.procore import (
    DEFAULT_FIELD_MAPPING,
    ProcoreClient,
    _fmt,
    _template_context,
)

# ── Helpers ────────────────────────────────────────────────────────────


def _make_progress_item(
    deviation_type_value: str = "behind",
    observed: float = 40.0,
    scheduled: float = 60.0,
    deviation_days: float = 15.0,
    confidence: float = 0.85,
    narrative: str = "Wall is behind schedule.",
):
    item = MagicMock()
    item.id = uuid.uuid4()
    item.observed_percent = observed
    item.scheduled_percent = scheduled
    item.deviation_days = deviation_days
    item.confidence_score = confidence
    item.narrative = narrative
    item.deviation_type = MagicMock()
    item.deviation_type.value = deviation_type_value
    return item


def _make_element(
    name: str = "External Wall W-01",
    ifc_type: str = "IfcWall",
    level: str = "L3",
    zone: str = "Zone A",
    material: str = "Concrete",
):
    el = MagicMock()
    el.name = name
    el.ifc_type = ifc_type
    el.level = level
    el.zone = zone
    el.material = material
    el.category = MagicMock()
    el.category.__str__ = lambda s: "wall"
    return el


def _make_activity(
    name: str = "Concrete Wall Construction",
    activity_id: str = "A1010",
    planned_start: str = "2024-01-15",
    planned_finish: str = "2024-03-30",
):
    act = MagicMock()
    act.name = name
    act.activity_id = activity_id
    act.planned_start = planned_start
    act.planned_finish = planned_finish
    return act


# ── OAuth State Tests ──────────────────────────────────────────────────


class TestOAuthState:
    SECRET = "test-secret-key-for-hmac"

    def _sign(self, project_id_str: str) -> str:
        sig = hmac.new(
            self.SECRET.encode(),
            project_id_str.encode(),
            hashlib.sha256,
        ).hexdigest()
        return f"{project_id_str}:{sig}"

    def test_verify_state_valid(self):
        project_id = uuid.uuid4()
        state = self._sign(str(project_id))
        result = ProcoreClient.verify_state(state, self.SECRET)
        assert result == project_id

    def test_verify_state_tampered_project_id(self):
        project_id = uuid.uuid4()
        other_id = uuid.uuid4()
        state = self._sign(str(project_id))
        tampered = f"{other_id}:{state.split(':')[1]}"
        with pytest.raises(ValueError, match="signature"):
            ProcoreClient.verify_state(tampered, self.SECRET)

    def test_verify_state_missing_separator(self):
        with pytest.raises(ValueError, match="format"):
            ProcoreClient.verify_state("invalidsignature", self.SECRET)

    def test_verify_state_wrong_secret(self):
        project_id = uuid.uuid4()
        state = self._sign(str(project_id))
        with pytest.raises(ValueError, match="signature"):
            ProcoreClient.verify_state(state, "wrong-secret")


# ── Template Formatting Tests ──────────────────────────────────────────


class TestTemplateFormatting:
    def test_fmt_all_vars_present(self):
        result = _fmt("Hello {name}, you are {age}", {"name": "Alice", "age": "30"})
        assert result == "Hello Alice, you are 30"

    def test_fmt_missing_key_returns_original(self):
        template = "Hello {name}, you are {missing_key}"
        result = _fmt(template, {"name": "Alice"})
        assert result == template  # original preserved, not partial

    def test_fmt_empty_template(self):
        assert _fmt("", {}) == ""

    def test_template_context_behind_element(self):
        item = _make_progress_item(deviation_type_value="behind", deviation_days=12.0)
        element = _make_element()
        activity = _make_activity()
        ctx = _template_context(item, element, activity)

        assert ctx["element_name"] == "External Wall W-01"
        assert ctx["ifc_type"] == "IfcWall"
        assert ctx["level"] == "L3"
        assert ctx["zone"] == "Zone A"
        assert ctx["deviation_type"] == "behind"
        assert ctx["deviation_days"] == "12.0"
        assert ctx["deviation_direction"] == "behind"
        assert ctx["observed_percent"] == "40.0"
        assert ctx["scheduled_percent"] == "60.0"
        assert ctx["confidence_score"] == "85"
        assert ctx["activity_name"] == "Concrete Wall Construction"
        assert ctx["activity_id"] == "A1010"

    def test_template_context_ahead_element(self):
        item = _make_progress_item(deviation_type_value="ahead", deviation_days=-5.0)
        ctx = _template_context(item, _make_element(), None)
        assert ctx["deviation_direction"] == "ahead"
        assert ctx["deviation_days"] == "5.0"

    def test_template_context_no_activity(self):
        ctx = _template_context(_make_progress_item(), _make_element(), None)
        assert ctx["activity_name"] == "N/A"
        assert ctx["activity_id"] == "N/A"
        assert ctx["planned_start"] == "N/A"
        assert ctx["planned_finish"] == "N/A"


# ── Payload Building Tests ─────────────────────────────────────────────


class TestPayloadBuilders:
    def test_rfi_payload_uses_default_mapping(self):
        item = _make_progress_item()
        element = _make_element()
        activity = _make_activity()
        payload = ProcoreClient._build_rfi_payload(item, element, activity, DEFAULT_FIELD_MAPPING)

        assert "subject" in payload
        assert "question" in payload
        assert "External Wall W-01" in payload["subject"]
        assert "behind" in payload["subject"]
        assert payload.get("priority") == "normal"

    def test_issue_payload_uses_default_mapping(self):
        item = _make_progress_item()
        element = _make_element()
        activity = _make_activity()
        payload = ProcoreClient._build_issue_payload(item, element, activity, DEFAULT_FIELD_MAPPING)

        assert "title" in payload
        assert "description" in payload
        assert "External Wall W-01" in payload["title"]
        assert payload.get("priority") == "medium"
        assert payload.get("status") == "open"

    def test_rfi_payload_custom_mapping(self):
        custom = {
            "rfi": {
                "subject": "MIQYAS Alert: {element_name}",
                "question": "Observed {observed_percent}% vs scheduled {scheduled_percent}%",
            }
        }
        item = _make_progress_item(observed=35.0, scheduled=70.0)
        payload = ProcoreClient._build_rfi_payload(item, _make_element(), None, custom)
        assert payload["subject"] == "MIQYAS Alert: External Wall W-01"
        assert "35.0" in payload["question"]
        assert "70.0" in payload["question"]

    def test_issue_payload_missing_optional_fields(self):
        minimal = {
            "issue": {
                "title": "{element_name}",
                "description": "Deviation detected",
            }
        }
        payload = ProcoreClient._build_issue_payload(
            _make_progress_item(), _make_element(), None, minimal
        )
        assert "issue_type" not in payload
        assert "status" not in payload


# ── Token Management Tests ─────────────────────────────────────────────


class TestTokenManagement:
    def _make_config(self, expires_in_seconds: int = 7200, has_refresh: bool = True):
        config = MagicMock()
        config.id = uuid.uuid4()
        config.access_token = "old-access-token"
        config.refresh_token = "old-refresh-token" if has_refresh else None
        config.token_expires_at = datetime.now(UTC) + timedelta(seconds=expires_in_seconds)
        return config

    @pytest.mark.asyncio
    async def test_ensure_token_valid_not_near_expiry(self):
        db = AsyncMock()
        client = ProcoreClient(db)
        config = self._make_config(expires_in_seconds=7200)

        with patch.object(client, "_refresh_token", new_callable=AsyncMock) as mock_refresh:
            token = await client._ensure_token(config)
            mock_refresh.assert_not_called()
            assert token == "old-access-token"

    @pytest.mark.asyncio
    async def test_ensure_token_triggers_refresh_within_buffer(self):
        db = AsyncMock()
        client = ProcoreClient(db)
        # Token expires in 2 minutes — within the 5-minute buffer
        config = self._make_config(expires_in_seconds=120)

        fresh_config = MagicMock()
        fresh_config.access_token = "new-access-token"

        with patch.object(client, "_refresh_token", new_callable=AsyncMock, return_value=fresh_config):
            token = await client._ensure_token(config)
            assert token == "new-access-token"

    @pytest.mark.asyncio
    async def test_ensure_token_triggers_refresh_when_expired(self):
        db = AsyncMock()
        client = ProcoreClient(db)
        config = self._make_config(expires_in_seconds=-60)  # already expired

        fresh_config = MagicMock()
        fresh_config.access_token = "refreshed-token"

        with patch.object(client, "_refresh_token", new_callable=AsyncMock, return_value=fresh_config):
            token = await client._ensure_token(config)
            assert token == "refreshed-token"

    @pytest.mark.asyncio
    async def test_refresh_token_http_call(self):
        db = AsyncMock()
        db.flush = AsyncMock()
        client = ProcoreClient(db)
        config = MagicMock()
        config.id = uuid.uuid4()
        config.refresh_token = "old-refresh"

        mock_response = MagicMock()
        mock_response.json.return_value = {
            "access_token": "brand-new-token",
            "refresh_token": "brand-new-refresh",
            "expires_in": 7200,
        }
        mock_response.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as MockClient:
            instance = AsyncMock()
            instance.post = AsyncMock(return_value=mock_response)
            MockClient.return_value.__aenter__ = AsyncMock(return_value=instance)
            MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

            await client._refresh_token(config)
            assert config.access_token == "brand-new-token"
            assert config.refresh_token == "brand-new-refresh"


# ── Push Flow Tests ────────────────────────────────────────────────────


class TestPushFlow:
    def _make_db_and_config(self):
        config = MagicMock()
        config.id = uuid.uuid4()
        config.access_token = "valid-token"
        config.refresh_token = "refresh"
        config.token_expires_at = datetime.now(UTC) + timedelta(hours=1)
        config.procore_project_id = "12345"
        config.procore_company_id = "67890"
        config.field_mapping = DEFAULT_FIELD_MAPPING
        config.is_active = True

        db = AsyncMock()
        db.add = MagicMock()
        db.flush = AsyncMock()
        return db, config

    @pytest.mark.asyncio
    async def test_create_rfi_success(self):
        db, config = self._make_db_and_config()
        client = ProcoreClient(db)

        item = _make_progress_item()
        element = _make_element()
        activity = _make_activity()

        with (
            patch.object(client, "_load_progress_context", new_callable=AsyncMock,
                         return_value=(item, element, activity)),
            patch.object(client, "_api_request", new_callable=AsyncMock,
                         return_value={"id": 9001, "subject": "Wall Deviation"}),
        ):
            log = await client.create_rfi(config, item.id)

        assert log.success is True
        assert log.procore_entity_id == "9001"
        assert log.response_status == 201

    @pytest.mark.asyncio
    async def test_create_rfi_api_failure(self):
        db, config = self._make_db_and_config()
        client = ProcoreClient(db)

        item = _make_progress_item()
        element = _make_element()

        mock_response = MagicMock()
        mock_response.status_code = 422
        mock_response.json.return_value = {"error": "invalid payload"}
        mock_response.text = '{"error": "invalid payload"}'

        with (
            patch.object(client, "_load_progress_context", new_callable=AsyncMock,
                         return_value=(item, element, None)),
            patch.object(client, "_api_request", new_callable=AsyncMock,
                         side_effect=httpx.HTTPStatusError(
                             "422", request=MagicMock(), response=mock_response
                         )),
        ):
            log = await client.create_rfi(config, item.id)

        assert log.success is False
        assert log.response_status == 422

    @pytest.mark.asyncio
    async def test_create_issue_success(self):
        db, config = self._make_db_and_config()
        client = ProcoreClient(db)

        item = _make_progress_item()
        element = _make_element()

        with (
            patch.object(client, "_load_progress_context", new_callable=AsyncMock,
                         return_value=(item, element, None)),
            patch.object(client, "_api_request", new_callable=AsyncMock,
                         return_value={"id": 5555}),
        ):
            log = await client.create_issue(config, item.id)

        assert log.success is True
        assert log.procore_entity_id == "5555"


# ── API Endpoint Tests ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_auth_url_no_credentials(client: AsyncClient):
    """Should return 501 if Procore credentials are not configured."""
    resp = await client.get("/api/v1/projects/00000000-0000-0000-0000-000000000001/procore/auth-url")
    # With empty PROCORE_CLIENT_ID, expect 501
    assert resp.status_code == 501
    assert "not configured" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_get_config_not_found(client: AsyncClient):
    """GET config for a project with no Procore setup returns null."""
    resp = await client.get("/api/v1/projects/00000000-0000-0000-0000-000000000001/procore/config")
    assert resp.status_code == 200
    assert resp.json() is None


@pytest.mark.asyncio
async def test_push_to_procore_not_configured(client: AsyncClient):
    """Push should return 400 if Procore is not connected."""
    payload = {
        "progress_item_id": "00000000-0000-0000-0000-000000000099",
        "entity_type": "rfi",
    }
    resp = await client.post(
        "/api/v1/projects/00000000-0000-0000-0000-000000000001/procore/push",
        json=payload,
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_push_logs_empty_when_no_config(client: AsyncClient):
    """Push logs should return empty list when no config exists."""
    resp = await client.get("/api/v1/projects/00000000-0000-0000-0000-000000000001/procore/push-logs")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_disconnect_not_found(client: AsyncClient):
    """Disconnect should return 404 if no config exists."""
    resp = await client.delete(
        "/api/v1/projects/00000000-0000-0000-0000-000000000001/procore/config"
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_config_not_found(client: AsyncClient):
    """Update config should return 404 if no config exists."""
    resp = await client.put(
        "/api/v1/projects/00000000-0000-0000-0000-000000000001/procore/config",
        json={"procore_project_id": "12345"},
    )
    assert resp.status_code == 404
