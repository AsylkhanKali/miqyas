"""add webhooks table

Revision ID: 005_add_webhooks
Revises: 004_add_api_keys
Create Date: 2026-05-18
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "005_add_webhooks"
down_revision: Union[str, None] = "004_add_api_keys"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "webhooks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("url", sa.String(2048), nullable=False),
        sa.Column("secret", sa.String(64), nullable=False),
        sa.Column("events", postgresql.JSONB(), server_default="[]", nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_webhooks_project_id", "webhooks", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_webhooks_project_id", "webhooks")
    op.drop_table("webhooks")
