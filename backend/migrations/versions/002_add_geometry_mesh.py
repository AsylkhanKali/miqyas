"""add geometry_mesh column to bim_elements

Revision ID: 002_add_geometry_mesh
Revises: 001_initial
Create Date: 2026-04-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision: str = "002_add_geometry_mesh"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "bim_elements",
        sa.Column("geometry_mesh", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("bim_elements", "geometry_mesh")
