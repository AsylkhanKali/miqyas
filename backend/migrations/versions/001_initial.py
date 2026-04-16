"""initial schema — full MIQYAS MVP tables

Revision ID: 001_initial
Revises:
Create Date: 2026-04-05
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # === Enums ===
    project_status = postgresql.ENUM("active", "paused", "completed", "archived", name="projectstatus", create_type=False)
    element_category = postgresql.ENUM(
        "wall", "slab", "column", "beam", "door", "window", "stair", "railing",
        "ceiling", "curtain_wall", "mep", "furniture", "other",
        name="elementcategory", create_type=False,
    )
    activity_status = postgresql.ENUM("not_started", "in_progress", "completed", "delayed", name="activitystatus", create_type=False)
    video_status = postgresql.ENUM(
        "uploading", "uploaded", "processing", "frames_extracted", "aligned",
        "segmented", "compared", "failed",
        name="videostatus", create_type=False,
    )
    alignment_method = postgresql.ENUM("colmap", "manual", name="alignmentmethod", create_type=False)
    deviation_type = postgresql.ENUM("ahead", "on_track", "behind", "not_started", "extra_work", name="deviationtype", create_type=False)
    report_status = postgresql.ENUM("pending", "generating", "ready", "failed", name="reportstatus", create_type=False)
    procore_entity_type = postgresql.ENUM("rfi", "issue", "observation", name="procoreentitytype", create_type=False)

    for e in [project_status, element_category, activity_status, video_status, alignment_method, deviation_type, report_status, procore_entity_type]:
        e.create(op.get_bind(), checkfirst=True)

    # === 1. projects ===
    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(50), nullable=False, unique=True),
        sa.Column("description", sa.Text, server_default=""),
        sa.Column("status", project_status, nullable=False, server_default="active"),
        sa.Column("location", sa.String(255), server_default=""),
        sa.Column("client_name", sa.String(255), server_default=""),
        sa.Column("contract_value", sa.Float, nullable=True),
        sa.Column("start_date", sa.Date, nullable=True),
        sa.Column("end_date", sa.Date, nullable=True),
        sa.Column("settings", postgresql.JSONB, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_projects_code", "projects", ["code"])

    # === 2. bim_models ===
    op.create_table(
        "bim_models",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.String(500), nullable=False),
        sa.Column("storage_path", sa.String(1000), nullable=False),
        sa.Column("file_size_bytes", sa.Integer, nullable=True),
        sa.Column("ifc_schema_version", sa.String(20), server_default="IFC4"),
        sa.Column("authoring_tool", sa.String(255), server_default=""),
        sa.Column("element_count", sa.Integer, server_default="0"),
        sa.Column("parse_status", sa.String(50), server_default="pending"),
        sa.Column("parse_error", sa.Text, nullable=True),
        sa.Column("metadata", postgresql.JSONB, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_bim_models_project_id", "bim_models", ["project_id"])

    # === 3. bim_elements ===
    op.create_table(
        "bim_elements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("bim_model_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("bim_models.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ifc_guid", sa.String(64), nullable=False),
        sa.Column("ifc_type", sa.String(100), nullable=False),
        sa.Column("category", element_category, nullable=False),
        sa.Column("name", sa.String(500), server_default=""),
        sa.Column("level", sa.String(100), server_default=""),
        sa.Column("zone", sa.String(100), server_default=""),
        sa.Column("material", sa.String(255), server_default=""),
        sa.Column("geometry_bbox", postgresql.JSONB, nullable=True),
        sa.Column("properties", postgresql.JSONB, server_default="{}"),
        sa.Column("quantity_data", postgresql.JSONB, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_bim_elements_bim_model_id", "bim_elements", ["bim_model_id"])
    op.create_index("ix_bim_elements_ifc_guid", "bim_elements", ["ifc_guid"])
    op.create_index("ix_bim_elements_category", "bim_elements", ["category"])
    op.create_index("ix_bim_elements_level", "bim_elements", ["level"])
    op.create_unique_constraint("uq_bim_element_guid", "bim_elements", ["bim_model_id", "ifc_guid"])

    # === 4. schedules ===
    op.create_table(
        "schedules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.String(500), nullable=False),
        sa.Column("storage_path", sa.String(1000), nullable=False),
        sa.Column("source_format", sa.String(10), nullable=False),
        sa.Column("data_date", sa.Date, nullable=True),
        sa.Column("activity_count", sa.Integer, server_default="0"),
        sa.Column("parse_status", sa.String(50), server_default="pending"),
        sa.Column("parse_error", sa.Text, nullable=True),
        sa.Column("metadata", postgresql.JSONB, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_schedules_project_id", "schedules", ["project_id"])

    # === 5. wbs_nodes ===
    op.create_table(
        "wbs_nodes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("schedule_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("schedules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("p6_wbs_id", sa.String(100), nullable=False),
        sa.Column("parent_p6_wbs_id", sa.String(100), nullable=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("code", sa.String(100), server_default=""),
        sa.Column("level", sa.Integer, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_wbs_nodes_schedule_id", "wbs_nodes", ["schedule_id"])
    op.create_unique_constraint("uq_wbs_node_p6id", "wbs_nodes", ["schedule_id", "p6_wbs_id"])

    # === 6. activities ===
    op.create_table(
        "activities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("schedule_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("schedules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("activity_id", sa.String(100), nullable=False),
        sa.Column("activity_code", sa.String(100), server_default=""),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("wbs_p6_id", sa.String(100), nullable=True),
        sa.Column("planned_start", sa.Date, nullable=True),
        sa.Column("planned_finish", sa.Date, nullable=True),
        sa.Column("actual_start", sa.Date, nullable=True),
        sa.Column("actual_finish", sa.Date, nullable=True),
        sa.Column("planned_duration_days", sa.Float, nullable=True),
        sa.Column("remaining_duration_days", sa.Float, nullable=True),
        sa.Column("percent_complete", sa.Float, server_default="0"),
        sa.Column("status", activity_status, server_default="not_started"),
        sa.Column("activity_type", sa.String(50), server_default="Task"),
        sa.Column("is_critical", sa.Boolean, server_default="false"),
        sa.Column("total_float_days", sa.Float, nullable=True),
        sa.Column("calendar_id", sa.String(50), nullable=True),
        sa.Column("resource_names", postgresql.ARRAY(sa.String), server_default="{}"),
        sa.Column("cost_budget", sa.Float, nullable=True),
        sa.Column("cost_actual", sa.Float, nullable=True),
        sa.Column("properties", postgresql.JSONB, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_activities_schedule_id", "activities", ["schedule_id"])
    op.create_index("ix_activities_status", "activities", ["status"])
    op.create_index("ix_activities_planned_dates", "activities", ["planned_start", "planned_finish"])
    op.create_unique_constraint("uq_activity_p6id", "activities", ["schedule_id", "activity_id"])

    # === 7. activity_relationships ===
    op.create_table(
        "activity_relationships",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("schedule_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("schedules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("predecessor_activity_id", sa.String(100), nullable=False),
        sa.Column("successor_activity_id", sa.String(100), nullable=False),
        sa.Column("relationship_type", sa.String(10), nullable=False),
        sa.Column("lag_days", sa.Float, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_activity_relationships_schedule_id", "activity_relationships", ["schedule_id"])

    # === 8. element_activity_links ===
    op.create_table(
        "element_activity_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("element_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("bim_elements.id", ondelete="CASCADE"), nullable=False),
        sa.Column("activity_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("activities.id", ondelete="CASCADE"), nullable=False),
        sa.Column("confidence", sa.Float, server_default="0"),
        sa.Column("link_method", sa.String(50), server_default="auto"),
        sa.Column("match_details", postgresql.JSONB, server_default="{}"),
        sa.Column("is_confirmed", sa.Boolean, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_element_activity_links_element_id", "element_activity_links", ["element_id"])
    op.create_index("ix_element_activity_links_activity_id", "element_activity_links", ["activity_id"])
    op.create_unique_constraint("uq_element_activity_link", "element_activity_links", ["element_id", "activity_id"])

    # === 9. video_captures ===
    op.create_table(
        "video_captures",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.String(500), nullable=False),
        sa.Column("storage_path", sa.String(1000), nullable=False),
        sa.Column("file_size_bytes", sa.Integer, nullable=True),
        sa.Column("duration_seconds", sa.Float, nullable=True),
        sa.Column("resolution", sa.String(50), server_default=""),
        sa.Column("fps", sa.Float, nullable=True),
        sa.Column("capture_date", sa.Date, nullable=True),
        sa.Column("capture_location", sa.String(255), server_default=""),
        sa.Column("status", video_status, server_default="uploading"),
        sa.Column("processing_error", sa.Text, nullable=True),
        sa.Column("frame_count", sa.Integer, server_default="0"),
        sa.Column("metadata", postgresql.JSONB, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_video_captures_project_id", "video_captures", ["project_id"])

    # === 10. frames ===
    op.create_table(
        "frames",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("capture_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("video_captures.id", ondelete="CASCADE"), nullable=False),
        sa.Column("frame_number", sa.Integer, nullable=False),
        sa.Column("timestamp_seconds", sa.Float, nullable=False),
        sa.Column("equirect_path", sa.String(1000), nullable=False),
        sa.Column("cubemap_paths", postgresql.JSONB, nullable=True),
        sa.Column("is_keyframe", sa.Boolean, server_default="false"),
        sa.Column("quality_score", sa.Float, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_frames_capture_id", "frames", ["capture_id"])
    op.create_index("ix_frames_keyframe", "frames", ["is_keyframe"])
    op.create_unique_constraint("uq_frame_number", "frames", ["capture_id", "frame_number"])

    # === 11. camera_alignments ===
    op.create_table(
        "camera_alignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("capture_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("video_captures.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("method", alignment_method, nullable=False),
        sa.Column("transformation_matrix", postgresql.JSONB, nullable=False),
        sa.Column("scale_factor", sa.Float, server_default="1.0"),
        sa.Column("control_points", postgresql.JSONB, server_default="[]"),
        sa.Column("reprojection_error", sa.Float, nullable=True),
        sa.Column("colmap_workspace_path", sa.String(1000), nullable=True),
        sa.Column("is_validated", sa.Boolean, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # === 12. camera_poses ===
    op.create_table(
        "camera_poses",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("alignment_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("camera_alignments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("frame_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("frames.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", postgresql.JSONB, nullable=False),
        sa.Column("rotation", postgresql.JSONB, nullable=False),
        sa.Column("intrinsics", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_camera_poses_alignment_id", "camera_poses", ["alignment_id"])
    op.create_index("ix_camera_poses_frame_id", "camera_poses", ["frame_id"])

    # === 13. segmentation_results ===
    op.create_table(
        "segmentation_results",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("frame_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("frames.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("model_name", sa.String(100), nullable=False),
        sa.Column("model_version", sa.String(50), server_default=""),
        sa.Column("mask_path", sa.String(1000), nullable=False),
        sa.Column("class_map", postgresql.JSONB, nullable=False),
        sa.Column("class_pixel_counts", postgresql.JSONB, server_default="{}"),
        sa.Column("confidence_scores", postgresql.JSONB, server_default="{}"),
        sa.Column("inference_time_ms", sa.Float, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # === 14. progress_comparisons ===
    op.create_table(
        "progress_comparisons",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("segmentation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("segmentation_results.id", ondelete="CASCADE"), nullable=False),
        sa.Column("element_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("bim_elements.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expected_mask_path", sa.String(1000), nullable=True),
        sa.Column("iou_score", sa.Float, nullable=False),
        sa.Column("pixel_overlap", sa.Integer, server_default="0"),
        sa.Column("pixel_expected", sa.Integer, server_default="0"),
        sa.Column("pixel_observed", sa.Integer, server_default="0"),
        sa.Column("is_present", sa.Boolean, nullable=False),
        sa.Column("confidence", sa.Float, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_progress_comparisons_segmentation_id", "progress_comparisons", ["segmentation_id"])
    op.create_index("ix_progress_comparisons_element_id", "progress_comparisons", ["element_id"])

    # === 15. progress_items ===
    op.create_table(
        "progress_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("element_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("bim_elements.id", ondelete="CASCADE"), nullable=False),
        sa.Column("activity_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("activities.id", ondelete="CASCADE"), nullable=True),
        sa.Column("capture_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("video_captures.id", ondelete="CASCADE"), nullable=False),
        sa.Column("observed_percent", sa.Float, server_default="0"),
        sa.Column("scheduled_percent", sa.Float, server_default="0"),
        sa.Column("deviation_type", deviation_type, server_default="on_track"),
        sa.Column("deviation_days", sa.Float, nullable=True),
        sa.Column("confidence_score", sa.Float, server_default="0"),
        sa.Column("notes", sa.Text, server_default=""),
        sa.Column("narrative", sa.Text, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_progress_items_element_id", "progress_items", ["element_id"])
    op.create_index("ix_progress_items_deviation", "progress_items", ["deviation_type"])

    # === 16. reports ===
    op.create_table(
        "reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("capture_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("video_captures.id", ondelete="CASCADE"), nullable=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("report_type", sa.String(50), server_default="progress"),
        sa.Column("status", report_status, server_default="pending"),
        sa.Column("pdf_path", sa.String(1000), nullable=True),
        sa.Column("summary", postgresql.JSONB, server_default="{}"),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_reports_project_id", "reports", ["project_id"])

    # === 17. procore_configs ===
    op.create_table(
        "procore_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("procore_project_id", sa.String(100), nullable=True),
        sa.Column("procore_company_id", sa.String(100), nullable=True),
        sa.Column("access_token", sa.Text, nullable=True),
        sa.Column("refresh_token", sa.Text, nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("field_mapping", postgresql.JSONB, server_default="{}"),
        sa.Column("is_active", sa.Boolean, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    # === 18. procore_push_logs ===
    op.create_table(
        "procore_push_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("config_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("procore_configs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entity_type", procore_entity_type, nullable=False),
        sa.Column("procore_entity_id", sa.String(100), nullable=True),
        sa.Column("payload", postgresql.JSONB, server_default="{}"),
        sa.Column("response_status", sa.Integer, nullable=True),
        sa.Column("response_body", postgresql.JSONB, server_default="{}"),
        sa.Column("success", sa.Boolean, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_procore_push_logs_config_id", "procore_push_logs", ["config_id"])


def downgrade() -> None:
    tables = [
        "procore_push_logs", "procore_configs", "reports", "progress_items",
        "progress_comparisons", "segmentation_results", "camera_poses",
        "camera_alignments", "frames", "video_captures", "element_activity_links",
        "activity_relationships", "activities", "wbs_nodes", "schedules",
        "bim_elements", "bim_models", "projects",
    ]
    for t in tables:
        op.drop_table(t)

    enums = [
        "procoreentitytype", "reportstatus", "deviationtype", "alignmentmethod",
        "videostatus", "activitystatus", "elementcategory", "projectstatus",
    ]
    for e in enums:
        postgresql.ENUM(name=e).drop(op.get_bind(), checkfirst=True)
