"""add acc_configs and acc_push_logs tables

Revision ID: 006_add_acc
Revises: 005_add_webhooks
Create Date: 2026-05-18
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "006_add_acc"
down_revision: Union[str, None] = "005_add_webhooks"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "acc_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("acc_hub_id", sa.String(200), nullable=True),
        sa.Column("acc_project_id", sa.String(200), nullable=True),
        sa.Column("access_token", sa.Text, nullable=True),
        sa.Column("refresh_token", sa.Text, nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("field_mapping", postgresql.JSONB(), server_default="{}", nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "acc_push_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("config_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("acc_configs.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("acc_issue_id", sa.String(200), nullable=True),
        sa.Column("payload", postgresql.JSONB(), server_default="{}", nullable=True),
        sa.Column("response_status", sa.Integer, nullable=True),
        sa.Column("response_body", postgresql.JSONB(), server_default="{}", nullable=True),
        sa.Column("success", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("acc_push_logs")
    op.drop_table("acc_configs")
