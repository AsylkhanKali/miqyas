"""
MIQYAS — Full PostgreSQL Schema as SQLAlchemy ORM Models.

Tables cover the entire MVP:
  - Projects & organization
  - BIM / IFC elements
  - P6 Schedules (activities, relationships)
  - Auto-linking (BIM ↔ Schedule)
  - Video capture & frames
  - Camera alignment (COLMAP / manual)
  - CV segmentation results
  - Progress comparison & deviations
  - Reports
  - Procore integration
"""

import enum
import uuid

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base

# ── Helper ──────────────────────────────────────────────────────────────

def pk() -> Column:
    return Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


# timestamps helper removed — columns defined inline


# ── Enums ───────────────────────────────────────────────────────────────

class ProjectStatus(enum.StrEnum):
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class ElementCategory(enum.StrEnum):
    """High-level BIM element categories for segmentation mapping."""
    WALL = "wall"
    SLAB = "slab"
    COLUMN = "column"
    BEAM = "beam"
    DOOR = "door"
    WINDOW = "window"
    STAIR = "stair"
    RAILING = "railing"
    CEILING = "ceiling"
    CURTAIN_WALL = "curtain_wall"
    MEP = "mep"
    FURNITURE = "furniture"
    OTHER = "other"


class ActivityStatus(enum.StrEnum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    DELAYED = "delayed"


class VideoStatus(enum.StrEnum):
    UPLOADING = "uploading"
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    FRAMES_EXTRACTED = "frames_extracted"
    ALIGNED = "aligned"
    SEGMENTED = "segmented"
    COMPARED = "compared"
    FAILED = "failed"


class AlignmentMethod(enum.StrEnum):
    COLMAP = "colmap"
    MANUAL = "manual"


class DeviationType(enum.StrEnum):
    AHEAD = "ahead"
    ON_TRACK = "on_track"
    BEHIND = "behind"
    NOT_STARTED = "not_started"
    EXTRA_WORK = "extra_work"


class ReportStatus(enum.StrEnum):
    PENDING = "pending"
    GENERATING = "generating"
    READY = "ready"
    FAILED = "failed"


class ProcoreEntityType(enum.StrEnum):
    RFI = "rfi"
    ISSUE = "issue"
    OBSERVATION = "observation"


# ── 1. Projects ─────────────────────────────────────────────────────────

class Project(Base):
    __tablename__ = "projects"

    id = pk()
    name = Column(String(255), nullable=False)
    code = Column(String(50), unique=True, nullable=False, index=True)
    description = Column(Text, default="")
    status = Column(Enum(ProjectStatus, values_callable=lambda x: [e.value for e in x]), default=ProjectStatus.ACTIVE, nullable=False)
    location = Column(String(255), default="")
    client_name = Column(String(255), default="")
    contract_value = Column(Float, nullable=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    settings = Column(JSONB, default=dict)  # tolerance thresholds, defaults
    created_at = Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # relationships
    bim_models = relationship("BIMModel", back_populates="project", cascade="all, delete-orphan")
    schedules = relationship("Schedule", back_populates="project", cascade="all, delete-orphan")
    captures = relationship("VideoCapture", back_populates="project", cascade="all, delete-orphan")
    reports = relationship("Report", back_populates="project", cascade="all, delete-orphan")
    procore_config = relationship("ProcoreConfig", back_populates="project", uselist=False)


# ── 2. BIM / IFC ────────────────────────────────────────────────────────

class BIMModel(Base):
    __tablename__ = "bim_models"

    id = pk()
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String(500), nullable=False)
    storage_path = Column(String(1000), nullable=False)
    file_size_bytes = Column(Integer, nullable=True)
    ifc_schema_version = Column(String(20), default="IFC4")  # IFC2X3, IFC4
    authoring_tool = Column(String(255), default="")
    element_count = Column(Integer, default=0)
    parse_status = Column(String(50), default="pending")  # pending, parsing, parsed, failed
    parse_error = Column(Text, nullable=True)
    extra_data = Column("metadata", JSONB, default=dict)  # project info extracted from IFC header
    created_at = Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    project = relationship("Project", back_populates="bim_models")
    elements = relationship("BIMElement", back_populates="bim_model", cascade="all, delete-orphan")


class BIMElement(Base):
    """Individual IFC element extracted from a BIM model."""
    __tablename__ = "bim_elements"

    id = pk()
    bim_model_id = Column(UUID(as_uuid=True), ForeignKey("bim_models.id", ondelete="CASCADE"), nullable=False, index=True)
    ifc_guid = Column(String(64), nullable=False, index=True)
    ifc_type = Column(String(100), nullable=False)  # IfcWall, IfcSlab, etc.
    category = Column(Enum(ElementCategory, values_callable=lambda x: [e.value for e in x]), nullable=False)
    name = Column(String(500), default="")
    level = Column(String(100), default="")  # storey / floor
    zone = Column(String(100), default="")  # spatial zone if assigned
    material = Column(String(255), default="")
    geometry_bbox = Column(JSONB, nullable=True)  # {"min": [x,y,z], "max": [x,y,z]}
    geometry_mesh = Column(JSONB, nullable=True)  # {"vertices": [[x,y,z],...], "faces": [[i,j,k],...]}
    properties = Column(JSONB, default=dict)  # all IFC property sets
    quantity_data = Column(JSONB, default=dict)  # area, volume, length
    created_at = Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    bim_model = relationship("BIMModel", back_populates="elements")
    links = relationship("ElementActivityLink", back_populates="element", cascade="all, delete-orphan")
    progress_items = relationship("ProgressItem", back_populates="element", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("bim_model_id", "ifc_guid", name="uq_bim_element_guid"),
        Index("ix_bim_elements_category", "category"),
        Index("ix_bim_elements_level", "level"),
    )


# ── 3. Schedules (P6 XER/XML) ──────────────────────────────────────────

class Schedule(Base):
    __tablename__ = "schedules"

    id = pk()
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String(500), nullable=False)
    storage_path = Column(String(1000), nullable=False)
    source_format = Column(String(10), nullable=False)  # "xer" or "xml"
    data_date = Column(Date, nullable=True)  # P6 data date
    activity_count = Column(Integer, default=0)
    parse_status = Column(String(50), default="pending")
    parse_error = Column(Text, nullable=True)
    extra_data = Column("metadata", JSONB, default=dict)
    created_at = Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    project = relationship("Project", back_populates="schedules")
    activities = relationship("Activity", back_populates="schedule", cascade="all, delete-orphan")
    wbs_nodes = relationship("WBSNode", back_populates="schedule", cascade="all, delete-orphan")
    relationships_list = relationship("ActivityRelationship", back_populates="schedule", cascade="all, delete-orphan")


class WBSNode(Base):
    """Work Breakdown Structure hierarchy from P6."""
    __tablename__ = "wbs_nodes"

    id = pk()
    schedule_id = Column(UUID(as_uuid=True), ForeignKey("schedules.id", ondelete="CASCADE"), nullable=False, index=True)
    p6_wbs_id = Column(String(100), nullable=False)
    parent_p6_wbs_id = Column(String(100), nullable=True)
    name = Column(String(500), nullable=False)
    code = Column(String(100), default="")
    level = Column(Integer, default=0)
    created_at = Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    schedule = relationship("Schedule", back_populates="wbs_nodes")

    __table_args__ = (
        UniqueConstraint("schedule_id", "p6_wbs_id", name="uq_wbs_node_p6id"),
    )


class Activity(Base):
    """Schedule activity from P6 XER/XML."""
    __tablename__ = "activities"

    id = pk()
    schedule_id = Column(UUID(as_uuid=True), ForeignKey("schedules.id", ondelete="CASCADE"), nullable=False, index=True)
    activity_id = Column(String(100), nullable=False)  # P6 activity ID
    activity_code = Column(String(100), default="")
    name = Column(String(500), nullable=False)
    wbs_p6_id = Column(String(100), nullable=True)  # link to WBSNode
    planned_start = Column(Date, nullable=True)
    planned_finish = Column(Date, nullable=True)
    actual_start = Column(Date, nullable=True)
    actual_finish = Column(Date, nullable=True)
    planned_duration_days = Column(Float, nullable=True)
    remaining_duration_days = Column(Float, nullable=True)
    percent_complete = Column(Float, default=0.0)
    status = Column(Enum(ActivityStatus, values_callable=lambda x: [e.value for e in x]), default=ActivityStatus.NOT_STARTED)
    activity_type = Column(String(50), default="Task")  # Task, Milestone, LOE, etc.
    is_critical = Column(Boolean, default=False)
    total_float_days = Column(Float, nullable=True)
    calendar_id = Column(String(50), nullable=True)
    resource_names = Column(ARRAY(String), default=list)
    cost_budget = Column(Float, nullable=True)
    cost_actual = Column(Float, nullable=True)
    properties = Column(JSONB, default=dict)
    created_at = Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    schedule = relationship("Schedule", back_populates="activities")
    links = relationship("ElementActivityLink", back_populates="activity", cascade="all, delete-orphan")
    progress_items = relationship("ProgressItem", back_populates="activity", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("schedule_id", "activity_id", name="uq_activity_p6id"),
        Index("ix_activities_status", "status"),
        Index("ix_activities_planned_dates", "planned_start", "planned_finish"),
    )


class ActivityRelationship(Base):
    """Predecessor/successor relationships between activities."""
    __tablename__ = "activity_relationships"

    id = pk()
    schedule_id = Column(UUID(as_uuid=True), ForeignKey("schedules.id", ondelete="CASCADE"), nullable=False, index=True)
    predecessor_activity_id = Column(String(100), nullable=False)
    successor_activity_id = Column(String(100), nullable=False)
    relationship_type = Column(String(10), nullable=False)  # FS, FF, SS, SF
    lag_days = Column(Float, default=0.0)
    created_at = Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    schedule = relationship("Schedule", back_populates="relationships_list")


# ── 4. Auto-Linking (BIM Element ↔ Schedule Activity) ───────────────────

class ElementActivityLink(Base):
    """Link between a BIM element and a schedule activity."""
    __tablename__ = "element_activity_links"

    id = pk()
    element_id = Column(UUID(as_uuid=True), ForeignKey("bim_elements.id", ondelete="CASCADE"), nullable=False, index=True)
    activity_id = Column(UUID(as_uuid=True), ForeignKey("activities.id", ondelete="CASCADE"), nullable=False, index=True)
    confidence = Column(Float, default=0.0)  # 0.0–1.0 matching confidence
    link_method = Column(String(50), default="auto")  # auto, manual, code_match
    match_details = Column(JSONB, default=dict)  # why this link was created
    is_confirmed = Column(Boolean, default=False)  # user-confirmed
    created_at = Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    element = relationship("BIMElement", back_populates="links")
    activity = relationship("Activity", back_populates="links")

    __table_args__ = (
        UniqueConstraint("element_id", "activity_id", name="uq_element_activity_link"),
    )


# ── 5. Video Capture & Frames ──────────────────────────────────────────

class VideoCapture(Base):
    """A 360° video walkthrough uploaded for a project."""
    __tablename__ = "video_captures"

    id = pk()
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String(500), nullable=False)
    storage_path = Column(String(1000), nullable=False)
    file_size_bytes = Column(Integer, nullable=True)
    duration_seconds = Column(Float, nullable=True)
    resolution = Column(String(50), default="")  # e.g., "5760x2880"
    fps = Column(Float, nullable=True)
    capture_date = Column(Date, nullable=True)
    capture_location = Column(String(255), default="")  # floor / zone label
    status = Column(Enum(VideoStatus, values_callable=lambda x: [e.value for e in x]), default=VideoStatus.UPLOADING)
    processing_error = Column(Text, nullable=True)
    frame_count = Column(Integer, default=0)
    extra_data = Column("metadata", JSONB, default=dict)
    created_at = Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    project = relationship("Project", back_populates="captures")
    frames = relationship("Frame", back_populates="capture", cascade="all, delete-orphan")
    alignment = relationship("CameraAlignment", back_populates="capture", uselist=False)


class Frame(Base):
    """Individual frame extracted from a video capture."""
    __tablename__ = "frames"

    id = pk()
    capture_id = Column(UUID(as_uuid=True), ForeignKey("video_captures.id", ondelete="CASCADE"), nullable=False, index=True)
    frame_number = Column(Integer, nullable=False)
    timestamp_seconds = Column(Float, nullable=False)
    equirect_path = Column(String(1000), nullable=False)  # equirectangular frame
    cubemap_paths = Column(JSONB, nullable=True)  # {"front": "...", "back": "...", ...}
    is_keyframe = Column(Boolean, default=False)
    quality_score = Column(Float, nullable=True)  # blur detection score
    created_at = Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    capture = relationship("VideoCapture", back_populates="frames")
    segmentation = relationship("SegmentationResult", back_populates="frame", uselist=False)

    __table_args__ = (
        UniqueConstraint("capture_id", "frame_number", name="uq_frame_number"),
        Index("ix_frames_keyframe", "is_keyframe"),
    )


# ── 6. Camera Alignment ────────────────────────────────────────────────

class CameraAlignment(Base):
    """Camera-to-BIM coordinate alignment for a video capture."""
    __tablename__ = "camera_alignments"

    id = pk()
    capture_id = Column(UUID(as_uuid=True), ForeignKey("video_captures.id", ondelete="CASCADE"), nullable=False, unique=True)
    method = Column(Enum(AlignmentMethod, values_callable=lambda x: [e.value for e in x]), nullable=False)
    transformation_matrix = Column(JSONB, nullable=False)  # 4x4 matrix
    scale_factor = Column(Float, default=1.0)
    control_points = Column(JSONB, default=list)  # manual alignment points
    reprojection_error = Column(Float, nullable=True)
    registered_images = Column(Integer, nullable=True)  # COLMAP: how many frames were registered
    total_input_images = Column(Integer, nullable=True)  # COLMAP: total frames submitted
    registration_ratio = Column(Float, nullable=True)  # registered / total (0.0–1.0)
    quality_grade = Column(String(20), nullable=True)  # "good", "acceptable", "poor", "failed"
    quality_warnings = Column(JSONB, default=list)  # list of warning strings
    colmap_workspace_path = Column(String(1000), nullable=True)
    is_validated = Column(Boolean, default=False)
    created_at = Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    capture = relationship("VideoCapture", back_populates="alignment")
    camera_poses = relationship("CameraPose", back_populates="alignment", cascade="all, delete-orphan")


class CameraPose(Base):
    """Per-frame camera pose in BIM coordinates."""
    __tablename__ = "camera_poses"

    id = pk()
    alignment_id = Column(UUID(as_uuid=True), ForeignKey("camera_alignments.id", ondelete="CASCADE"), nullable=False, index=True)
    frame_id = Column(UUID(as_uuid=True), ForeignKey("frames.id", ondelete="CASCADE"), nullable=False, index=True)
    position = Column(JSONB, nullable=False)  # [x, y, z] in BIM coords
    rotation = Column(JSONB, nullable=False)  # quaternion [w, x, y, z]
    intrinsics = Column(JSONB, nullable=True)  # camera intrinsic params
    created_at = Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    alignment = relationship("CameraAlignment", back_populates="camera_poses")


# ── 7. Segmentation Results ────────────────────────────────────────────

class SegmentationResult(Base):
    """CV segmentation output for a single frame."""
    __tablename__ = "segmentation_results"

    id = pk()
    frame_id = Column(UUID(as_uuid=True), ForeignKey("frames.id", ondelete="CASCADE"), nullable=False, unique=True)
    model_name = Column(String(100), nullable=False)  # e.g. "mask2former_swin_l_ade20k"
    model_version = Column(String(50), default="")
    mask_path = Column(String(1000), nullable=False)  # path to segmentation mask
    class_map = Column(JSONB, nullable=False)  # {class_id: label} mapping used
    class_pixel_counts = Column(JSONB, default=dict)  # {label: pixel_count}
    confidence_scores = Column(JSONB, default=dict)  # per-class confidence
    inference_time_ms = Column(Float, nullable=True)
    created_at = Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    frame = relationship("Frame", back_populates="segmentation")
    comparisons = relationship("ProgressComparison", back_populates="segmentation", cascade="all, delete-orphan")


# ── 8. Progress Comparison & Deviations ─────────────────────────────────

class ProgressComparison(Base):
    """IoU comparison between segmentation result and BIM expectation."""
    __tablename__ = "progress_comparisons"

    id = pk()
    segmentation_id = Column(UUID(as_uuid=True), ForeignKey("segmentation_results.id", ondelete="CASCADE"), nullable=False, index=True)
    element_id = Column(UUID(as_uuid=True), ForeignKey("bim_elements.id", ondelete="CASCADE"), nullable=False, index=True)
    expected_mask_path = Column(String(1000), nullable=True)  # rendered BIM expectation
    iou_score = Column(Float, nullable=False)  # intersection over union
    pixel_overlap = Column(Integer, default=0)
    pixel_expected = Column(Integer, default=0)
    pixel_observed = Column(Integer, default=0)
    is_present = Column(Boolean, nullable=False)  # element detected in frame
    confidence = Column(Float, default=0.0)
    created_at = Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    segmentation = relationship("SegmentationResult", back_populates="comparisons")


class ProgressItem(Base):
    """Aggregated progress status for a BIM element in a given capture."""
    __tablename__ = "progress_items"

    id = pk()
    element_id = Column(UUID(as_uuid=True), ForeignKey("bim_elements.id", ondelete="CASCADE"), nullable=False, index=True)
    activity_id = Column(UUID(as_uuid=True), ForeignKey("activities.id", ondelete="CASCADE"), nullable=True, index=True)
    capture_id = Column(UUID(as_uuid=True), ForeignKey("video_captures.id", ondelete="CASCADE"), nullable=False, index=True)
    observed_percent = Column(Float, default=0.0)  # CV-derived completion %
    scheduled_percent = Column(Float, default=0.0)  # P6-derived expected %
    deviation_type = Column(Enum(DeviationType, values_callable=lambda x: [e.value for e in x]), default=DeviationType.ON_TRACK)
    deviation_days = Column(Float, nullable=True)  # estimated days ahead/behind
    confidence_score = Column(Float, default=0.0)
    notes = Column(Text, default="")
    narrative = Column(Text, default="")  # auto-generated description
    created_at = Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    element = relationship("BIMElement", back_populates="progress_items")
    activity = relationship("Activity", back_populates="progress_items")

    __table_args__ = (
        Index("ix_progress_items_deviation", "deviation_type"),
    )


# ── 9. Reports ──────────────────────────────────────────────────────────

class Report(Base):
    __tablename__ = "reports"

    id = pk()
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    capture_id = Column(UUID(as_uuid=True), ForeignKey("video_captures.id", ondelete="CASCADE"), nullable=True)
    title = Column(String(500), nullable=False)
    report_type = Column(String(50), default="progress")  # progress, deviation, executive
    status = Column(Enum(ReportStatus, values_callable=lambda x: [e.value for e in x]), default=ReportStatus.PENDING)
    pdf_path = Column(String(1000), nullable=True)
    summary = Column(JSONB, default=dict)  # aggregated stats
    generated_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    project = relationship("Project", back_populates="reports")


# ── 10. Procore Integration ─────────────────────────────────────────────

class ProcoreConfig(Base):
    """OAuth2 tokens and mapping config for a project's Procore integration."""
    __tablename__ = "procore_configs"

    id = pk()
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True)
    procore_project_id = Column(String(100), nullable=True)
    procore_company_id = Column(String(100), nullable=True)
    access_token = Column(Text, nullable=True)
    refresh_token = Column(Text, nullable=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=True)
    field_mapping = Column(JSONB, default=dict)
    is_active = Column(Boolean, default=False)
    created_at = Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    project = relationship("Project", back_populates="procore_config")
    push_logs = relationship("ProcorePushLog", back_populates="config", cascade="all, delete-orphan")


class ProcorePushLog(Base):
    """Audit log for items pushed to Procore."""
    __tablename__ = "procore_push_logs"

    id = pk()
    config_id = Column(UUID(as_uuid=True), ForeignKey("procore_configs.id", ondelete="CASCADE"), nullable=False, index=True)
    entity_type = Column(Enum(ProcoreEntityType, values_callable=lambda x: [e.value for e in x]), nullable=False)
    procore_entity_id = Column(String(100), nullable=True)
    payload = Column(JSONB, default=dict)
    response_status = Column(Integer, nullable=True)
    response_body = Column(JSONB, default=dict)
    success = Column(Boolean, default=False)
    created_at = Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column("updated_at", DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    config = relationship("ProcoreConfig", back_populates="push_logs")
