"""
Comparison quality validation for Phase 2C.

Validates the quality of BIM-rendered expected masks against segmentation results.
Designed to help diagnose:
  - Bad alignment (IoU ~0 for elements that ARE visible)
  - Bad segmentation (IoU ~0 but expected mask looks correct)
  - Bad rendering (expected mask doesn't match real geometry)

Usage:
    validator = ComparisonQualityValidator(db)
    report = await validator.validate_capture(capture_id, bim_model_id)
"""

import logging
from pathlib import Path
from uuid import UUID

import numpy as np
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BIMElement,
    Frame,
    ProgressComparison,
    SegmentationResult,
)

logger = logging.getLogger(__name__)


class QualityReport:
    """Summary of comparison quality for a capture."""

    def __init__(self):
        self.total_comparisons: int = 0
        self.mesh_rendered: int = 0
        self.bbox_rendered: int = 0
        self.iou_distribution: dict[str, int] = {
            "high": 0,     # IoU >= 0.5
            "medium": 0,   # 0.2 <= IoU < 0.5
            "low": 0,      # 0.05 <= IoU < 0.2
            "zero": 0,     # IoU < 0.05
        }
        self.element_details: list[dict] = []
        self.warnings: list[str] = []

    def to_dict(self) -> dict:
        pct = lambda k: round(self.iou_distribution[k] / max(self.total_comparisons, 1) * 100, 1)
        return {
            "total_comparisons": self.total_comparisons,
            "mesh_rendered": self.mesh_rendered,
            "bbox_rendered": self.bbox_rendered,
            "iou_distribution": self.iou_distribution,
            "iou_distribution_pct": {
                "high": pct("high"),
                "medium": pct("medium"),
                "low": pct("low"),
                "zero": pct("zero"),
            },
            "mean_iou": round(
                np.mean([d["iou"] for d in self.element_details]) if self.element_details else 0, 4
            ),
            "warnings": self.warnings,
            "element_details": self.element_details[:50],  # cap detail output
        }


class ComparisonQualityValidator:
    """Validates the quality of BIM vs segmentation comparisons."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def validate_capture(
        self,
        capture_id: UUID,
        bim_model_id: UUID,
        sample_limit: int = 50,
    ) -> QualityReport:
        """
        Run quality validation on comparisons for a capture.

        Checks:
        1. IoU distribution — are most comparisons meaningful (IoU 0.3-0.8)?
        2. Render method breakdown — mesh vs bbox
        3. Anomaly detection — elements with suspiciously low/high IoU
        """
        report = QualityReport()

        # Get all comparisons for this capture
        comparisons = await self._get_comparisons(capture_id)
        report.total_comparisons = len(comparisons)

        if not comparisons:
            report.warnings.append("No comparisons found for this capture.")
            return report

        # Load elements to check render method
        elements = await self._get_elements(bim_model_id)
        element_map = {e.id: e for e in elements}

        for comp in comparisons[:sample_limit]:
            iou = comp.iou_score

            # Classify IoU
            if iou >= 0.5:
                report.iou_distribution["high"] += 1
            elif iou >= 0.2:
                report.iou_distribution["medium"] += 1
            elif iou >= 0.05:
                report.iou_distribution["low"] += 1
            else:
                report.iou_distribution["zero"] += 1

            # Check render method
            element = element_map.get(comp.element_id)
            has_mesh = element and element.geometry_mesh is not None
            if has_mesh:
                report.mesh_rendered += 1
            else:
                report.bbox_rendered += 1

            report.element_details.append({
                "element_id": str(comp.element_id),
                "element_name": element.name if element else "unknown",
                "iou": round(iou, 4),
                "is_present": comp.is_present,
                "confidence": round(comp.confidence, 3),
                "pixel_expected": comp.pixel_expected,
                "pixel_observed": comp.pixel_observed,
                "pixel_overlap": comp.pixel_overlap,
                "render_method": "mesh" if has_mesh else "bbox",
            })

        # Generate warnings
        total = report.total_comparisons
        zero_pct = report.iou_distribution["zero"] / total * 100

        if zero_pct > 60:
            report.warnings.append(
                f"{zero_pct:.0f}% of comparisons have near-zero IoU. "
                "Likely causes: bad camera alignment, segmentation model failure, "
                "or BIM model misaligned with physical site."
            )

        if report.bbox_rendered > 0 and report.mesh_rendered == 0:
            report.warnings.append(
                "All elements rendered via bbox fallback. Re-parse the IFC file "
                "to extract mesh geometry for more accurate expected masks."
            )

        high_pct = report.iou_distribution["high"] / total * 100
        if high_pct > 90:
            report.warnings.append(
                f"{high_pct:.0f}% of comparisons have high IoU (>0.5). "
                "This is unusually good — verify this isn't mock data."
            )

        # Check for elements with large expected area but zero overlap
        for detail in report.element_details:
            if detail["pixel_expected"] > 5000 and detail["iou"] < 0.05:
                report.warnings.append(
                    f"Element '{detail['element_name']}' has large expected mask "
                    f"({detail['pixel_expected']}px) but IoU={detail['iou']:.3f}. "
                    "Either element is not built yet, or alignment/segmentation is wrong."
                )
                if len(report.warnings) > 20:
                    break

        return report

    async def validate_elements(
        self,
        capture_id: UUID,
        element_ids: list[UUID],
    ) -> list[dict]:
        """
        Detailed validation for specific elements.
        Returns per-element comparison stats across all frames.
        """
        results = []

        for element_id in element_ids:
            comps = await self._get_element_comparisons(capture_id, element_id)
            if not comps:
                results.append({
                    "element_id": str(element_id),
                    "status": "no_comparisons",
                    "frames_checked": 0,
                })
                continue

            ious = [c.iou_score for c in comps]
            results.append({
                "element_id": str(element_id),
                "status": "ok",
                "frames_checked": len(comps),
                "iou_mean": round(float(np.mean(ious)), 4),
                "iou_max": round(float(np.max(ious)), 4),
                "iou_min": round(float(np.min(ious)), 4),
                "iou_std": round(float(np.std(ious)), 4),
                "present_in_frames": sum(1 for c in comps if c.is_present),
                "interpretation": self._interpret_iou(float(np.max(ious))),
            })

        return results

    def _interpret_iou(self, max_iou: float) -> str:
        """Human-readable interpretation of IoU for a single element."""
        if max_iou >= 0.5:
            return "Element clearly visible and matches BIM — likely built as planned."
        elif max_iou >= 0.3:
            return "Element partially matches — may be in progress or partially obstructed."
        elif max_iou >= 0.1:
            return "Weak match — element may be started but not yet matching expectation."
        elif max_iou >= 0.05:
            return "Marginal detection — could be noise or very early construction."
        else:
            return "Not detected — element is likely not started, or alignment/segmentation issue."

    async def _get_comparisons(self, capture_id: UUID) -> list[ProgressComparison]:
        result = await self.db.execute(
            select(ProgressComparison)
            .join(SegmentationResult)
            .join(Frame)
            .where(Frame.capture_id == capture_id)
        )
        return list(result.scalars().all())

    async def _get_elements(self, bim_model_id: UUID) -> list[BIMElement]:
        result = await self.db.execute(
            select(BIMElement).where(BIMElement.bim_model_id == bim_model_id)
        )
        return list(result.scalars().all())

    async def _get_element_comparisons(
        self, capture_id: UUID, element_id: UUID
    ) -> list[ProgressComparison]:
        result = await self.db.execute(
            select(ProgressComparison)
            .join(SegmentationResult)
            .join(Frame)
            .where(
                Frame.capture_id == capture_id,
                ProgressComparison.element_id == element_id,
            )
        )
        return list(result.scalars().all())
