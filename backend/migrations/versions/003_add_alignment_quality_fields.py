"""add quality metrics to camera_alignments

Revision ID: 003_alignment_quality
Revises: 002_add_geometry_mesh
Create Date: 2026-04-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "003_alignment_quality"
down_revision: Union[str, None] = "002_add_geometry_mesh"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("camera_alignments", sa.Column("registered_images", sa.Integer(), nullable=True))
    op.add_column("camera_alignments", sa.Column("total_input_images", sa.Integer(), nullable=True))
    op.add_column("camera_alignments", sa.Column("registration_ratio", sa.Float(), nullable=True))
    op.add_column("camera_alignments", sa.Column("quality_grade", sa.String(20), nullable=True))
    op.add_column("camera_alignments", sa.Column("quality_warnings", postgresql.JSONB(), server_default="[]", nullable=True))


def downgrade() -> None:
    op.drop_column("camera_alignments", "quality_warnings")
    op.drop_column("camera_alignments", "quality_grade")
    op.drop_column("camera_alignments", "registration_ratio")
    op.drop_column("camera_alignments", "total_input_images")
    op.drop_column("camera_alignments", "registered_images")
