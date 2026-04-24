"""Pydantic schemas for request/response validation."""

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ── Base ────────────────────────────────────────────────────────────────

class TimestampMixin(BaseModel):
    created_at: datetime
    updated_at: datetime


# ── Projects ────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str = Field(..., max_length=255)
    code: str = Field(..., max_length=50)
    description: str = ""
    location: str = ""
    client_name: str = ""
    contract_value: float | None = None
    start_date: date | None = None
    end_date: date | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    location: str | None = None
    client_name: str | None = None
    contract_value: float | None = None
    start_date: date | None = None
    end_date: date | None = None


class ProjectResponse(ProjectCreate, TimestampMixin):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    status: str


class ProjectListResponse(BaseModel):
    items: list[ProjectResponse]
    total: int


# ── BIM Models ──────────────────────────────────────────────────────────

class BIMModelResponse(TimestampMixin):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    project_id: UUID
    filename: str
    ifc_schema_version: str
    element_count: int
    parse_status: str
    parse_error: str | None = None
    file_size_bytes: int | None = None


class BIMElementResponse(TimestampMixin):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    bim_model_id: UUID
    ifc_guid: str
    ifc_type: str
    category: str
    name: str
    level: str
    zone: str
    material: str
    geometry_bbox: dict | None = None
    geometry_mesh: dict | None = None
    properties: dict = {}
    quantity_data: dict = {}


class BIMElementListResponse(BaseModel):
    items: list[BIMElementResponse]
    total: int


# ── Schedules ───────────────────────────────────────────────────────────

class ScheduleResponse(TimestampMixin):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    project_id: UUID
    filename: str
    source_format: str
    data_date: date | None = None
    activity_count: int
    parse_status: str
    parse_error: str | None = None


class ActivityResponse(TimestampMixin):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    schedule_id: UUID
    activity_id: str
    activity_code: str
    name: str
    planned_start: date | None = None
    planned_finish: date | None = None
    actual_start: date | None = None
    actual_finish: date | None = None
    planned_duration_days: float | None = None
    percent_complete: float
    status: str
    is_critical: bool
    total_float_days: float | None = None


class ActivityListResponse(BaseModel):
    items: list[ActivityResponse]
    total: int


# ── Links ───────────────────────────────────────────────────────────────

class LinkCreate(BaseModel):
    element_id: UUID
    activity_id: UUID
    confidence: float = 0.0
    link_method: str = "manual"


class LinkResponse(TimestampMixin):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    element_id: UUID
    activity_id: UUID
    confidence: float
    link_method: str
    is_confirmed: bool


# ── Video ───────────────────────────────────────────────────────────────

class VideoCaptureResponse(TimestampMixin):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    project_id: UUID
    filename: str
    duration_seconds: float | None = None
    status: str
    frame_count: int
    capture_date: date | None = None


# ── Progress ────────────────────────────────────────────────────────────

class ProgressItemResponse(TimestampMixin):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    element_id: UUID
    activity_id: UUID | None = None
    capture_id: UUID
    observed_percent: float
    scheduled_percent: float
    deviation_type: str
    deviation_days: float | None = None
    confidence_score: float
    narrative: str


# ── Procore ────────────────────────────────────────────────────────────

class ProcoreAuthUrlResponse(BaseModel):
    auth_url: str


class ProcoreConfigResponse(TimestampMixin):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    project_id: UUID
    procore_project_id: str | None = None
    procore_company_id: str | None = None
    field_mapping: dict = {}
    is_active: bool = False


class ProcoreConfigUpdate(BaseModel):
    procore_project_id: str | None = None
    procore_company_id: str | None = None
    field_mapping: dict | None = None
    is_active: bool | None = None


class ProcoreProjectListItem(BaseModel):
    id: str
    name: str
    company: dict | None = None


class ProcorePushRequest(BaseModel):
    progress_item_id: UUID
    entity_type: str  # "rfi" or "issue"


class ProcorePushResponse(BaseModel):
    success: bool
    procore_entity_id: str | None = None
    error: str | None = None


class ProcorePushLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    entity_type: str
    procore_entity_id: str | None = None
    payload: dict = {}
    response_status: int | None = None
    success: bool = False
    created_at: datetime


class ProcoreBulkPushRequest(BaseModel):
    progress_item_ids: list[UUID]
    entity_type: str  # "rfi" or "issue"


class ProcoreBulkPushResponse(BaseModel):
    task_id: str
    queued: int
    message: str


# ── Error ──────────────────────────────────────────────────────────────

class ErrorResponse(BaseModel):
    detail: str
    type: str = "error"


# ── Health ──────────────────────────────────────────────────────────────

class ServiceStatus(BaseModel):
    status: str  # "ok" | "error"
    latency_ms: float | None = None
    error: str | None = None


class HealthResponse(BaseModel):
    status: str = "healthy"
    version: str = "0.1.0"
    database: ServiceStatus = ServiceStatus(status="ok")
    redis: ServiceStatus = ServiceStatus(status="ok")
    uptime_seconds: float = 0.0


# ── Stats ──────────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    projects: int = 0
    bim_models: int = 0
    schedules: int = 0
    captures: int = 0
    progress_items: int = 0
    reports: int = 0


# ── Investor Dashboard ─────────────────────────────────────────────────

class DeviationBreakdown(BaseModel):
    ahead: int = 0
    on_track: int = 0
    behind: int = 0
    not_started: int = 0
    extra_work: int = 0
    total: int = 0


class ProjectHealthCard(BaseModel):
    id: str
    name: str
    code: str
    health_score: float          # 0–100
    health_label: str            # "Healthy" | "At Risk" | "Critical"
    behind_count: int
    total_elements: int
    last_capture_at: datetime | None = None


class CriticalElement(BaseModel):
    element_name: str
    ifc_type: str
    project_name: str
    project_id: str
    deviation_days: float | None
    observed_percent: float
    scheduled_percent: float
    activity_name: str | None = None
    is_critical_path: bool = False


class InvestorDashboard(BaseModel):
    """Rich analytics for investor/executive dashboard."""
    # KPI bar
    total_projects: int = 0
    total_elements_analyzed: int = 0
    avg_health_score: float = 0.0
    elements_at_risk: int = 0          # behind + not_started

    # Donut chart data
    deviation_breakdown: DeviationBreakdown = DeviationBreakdown()

    # Per-project health cards
    projects: list[ProjectHealthCard] = []

    # Top 5 most critical elements across all projects
    critical_elements: list[CriticalElement] = []

    # Timestamp
    generated_at: datetime
