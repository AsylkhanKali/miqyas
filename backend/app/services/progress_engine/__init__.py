"""
Progress Comparison Engine — IoU-based comparison between observed and expected.

For each frame:
  1. Load segmentation mask (observed construction state)
  2. Load BIM-rendered expected masks (what should be there)
  3. Compute Intersection over Union (IoU) per element
  4. Determine: is the element present? How much matches?
  5. Cross-reference with P6 schedule to compute deviation

IoU thresholds:
  - IoU > 0.5  → element IS present (construction matches expectation)
  - IoU 0.2–0.5 → partially present (in progress or partially obstructed)
  - IoU < 0.2  → NOT present (not yet built, or demolished)
"""

import logging
from datetime import date
from pathlib import Path
from typing import Any
from uuid import UUID

import numpy as np
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Activity,
    BIMElement,
    DeviationType,
    ElementActivityLink,
    Frame,
    ProgressComparison,
    ProgressItem,
    SegmentationResult,
    VideoCapture,
)
from app.services.segmentation import ADE20K_TO_CONSTRUCTION

logger = logging.getLogger(__name__)

# IoU thresholds
IOU_PRESENT_THRESHOLD = 0.5
IOU_PARTIAL_THRESHOLD = 0.2
IOU_ABSENT_THRESHOLD = 0.05


class ComparisonConfig:
    """Configuration for progress comparison."""

    def __init__(
        self,
        iou_present: float = 0.5,
        iou_partial: float = 0.2,
        confidence_weight_iou: float = 0.7,
        confidence_weight_seg: float = 0.3,
    ):
        self.iou_present = iou_present
        self.iou_partial = iou_partial
        self.confidence_weight_iou = confidence_weight_iou
        self.confidence_weight_seg = confidence_weight_seg


class ProgressComparisonEngine:
    """Compares segmentation results against BIM expectations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def compare_capture(
        self,
        capture_id: UUID,
        bim_model_id: UUID,
        expected_masks: dict[str, list[dict]],
        config: ComparisonConfig | None = None,
    ) -> int:
        """
        Run IoU comparison for all frames in a capture.

        Args:
            capture_id: Video capture ID
            bim_model_id: BIM model to compare against
            expected_masks: Output from BIMHeadlessRenderer.render_expectations()
            config: Comparison thresholds

        Returns:
            Number of comparisons created
        """
        if config is None:
            config = ComparisonConfig()

        capture = await self.db.get(VideoCapture, capture_id)
        if not capture:
            raise ValueError(f"VideoCapture {capture_id} not found")

        comparisons_created = 0

        for frame_id_str, element_expectations in expected_masks.items():
            frame_id = UUID(frame_id_str)

            # Get segmentation result for this frame
            seg_result = await self._get_segmentation(frame_id)
            if not seg_result:
                continue

            # Load the segmentation mask
            seg_mask = self._load_mask(seg_result.mask_path)
            if seg_mask is None:
                continue

            for expectation in element_expectations:
                element_id = UUID(expectation["element_id"])
                expected_mask_path = expectation["mask_path"]
                expected_category = expectation["category"]

                # Load expected mask
                expected_mask = self._load_mask(expected_mask_path)
                if expected_mask is None:
                    continue

                # Build observed mask for this category from segmentation
                observed_mask = self._extract_category_mask(
                    seg_mask, expected_category, seg_result.class_map
                )

                # Compute IoU
                iou, overlap, expected_px, observed_px = self._compute_iou(
                    observed_mask, expected_mask
                )

                # Determine presence
                is_present = iou >= config.iou_partial

                # Confidence score (weighted combination)
                seg_confidence = seg_result.confidence_scores.get(expected_category, 0.5)
                confidence = (
                    config.confidence_weight_iou * min(iou / config.iou_present, 1.0) +
                    config.confidence_weight_seg * seg_confidence
                )

                comparison = ProgressComparison(
                    segmentation_id=seg_result.id,
                    element_id=element_id,
                    expected_mask_path=expected_mask_path,
                    iou_score=round(iou, 4),
                    pixel_overlap=overlap,
                    pixel_expected=expected_px,
                    pixel_observed=observed_px,
                    is_present=is_present,
                    confidence=round(confidence, 3),
                )
                self.db.add(comparison)
                comparisons_created += 1

        await self.db.flush()
        logger.info(f"Created {comparisons_created} progress comparisons")
        return comparisons_created

    async def generate_progress_items(
        self,
        capture_id: UUID,
        schedule_id: UUID | None = None,
        reference_date: date | None = None,
    ) -> int:
        """
        Aggregate comparisons into progress items with deviation analysis.
        Cross-references P6 schedule if available.

        Returns number of progress items created.
        """
        if reference_date is None:
            reference_date = date.today()

        # Get all comparisons for this capture's frames
        comparisons = await self._get_comparisons_for_capture(capture_id)
        if not comparisons:
            return 0

        # Group comparisons by element
        element_comparisons: dict[UUID, list[ProgressComparison]] = {}
        for comp in comparisons:
            element_comparisons.setdefault(comp.element_id, []).append(comp)

        items_created = 0

        for element_id, comps in element_comparisons.items():
            # Aggregate: average IoU across all frames where this element appears
            avg_iou = np.mean([c.iou_score for c in comps])
            max_iou = max(c.iou_score for c in comps)
            is_present = any(c.is_present for c in comps)
            avg_confidence = np.mean([c.confidence for c in comps])

            # Derive observed completion percentage from IoU
            observed_percent = self._iou_to_completion(max_iou)

            # Get scheduled percentage from P6 if linked
            scheduled_percent = 0.0
            linked_activity = await self._get_linked_activity(element_id)
            deviation_type = DeviationType.NOT_STARTED
            deviation_days = None
            narrative = ""

            if linked_activity:
                scheduled_percent = self._compute_scheduled_percent(
                    linked_activity, reference_date
                )
                deviation_type, deviation_days = self._compute_deviation(
                    observed_percent, scheduled_percent, linked_activity, reference_date
                )
                narrative = self._generate_narrative(
                    element_id, linked_activity, observed_percent,
                    scheduled_percent, deviation_type, deviation_days
                )
            elif is_present:
                deviation_type = DeviationType.ON_TRACK
                narrative = f"Element observed (IoU={max_iou:.2f}) but not linked to schedule."
            else:
                deviation_type = DeviationType.NOT_STARTED
                narrative = "Element not detected in video frames."

            item = ProgressItem(
                element_id=element_id,
                activity_id=linked_activity.id if linked_activity else None,
                capture_id=capture_id,
                observed_percent=round(observed_percent, 1),
                scheduled_percent=round(scheduled_percent, 1),
                deviation_type=deviation_type,
                deviation_days=round(deviation_days, 1) if deviation_days else None,
                confidence_score=round(float(avg_confidence), 3),
                narrative=narrative,
            )
            self.db.add(item)
            items_created += 1

        from app.models import VideoStatus
        capture = await self.db.get(VideoCapture, capture_id)
        if capture:
            capture.status = VideoStatus.COMPARED

        await self.db.flush()
        logger.info(f"Generated {items_created} progress items")
        return items_created

    # ── Helpers ──────────────────────────────────────────────────────────

    def _load_mask(self, path: str) -> np.ndarray | None:
        """Load a mask image as numpy array."""
        try:
            return np.array(Image.open(path).convert("L"))
        except Exception:
            return None

    def _extract_category_mask(
        self,
        seg_mask: np.ndarray,
        category: str,
        class_map: dict[str, str],
    ) -> np.ndarray:
        """Extract binary mask for a specific construction category from segmentation."""
        binary = np.zeros_like(seg_mask, dtype=np.uint8)

        for cls_id_str, cat in class_map.items():
            if cat == category:
                binary[seg_mask == int(cls_id_str)] = 255

        return binary

    def _compute_iou(
        self,
        observed: np.ndarray,
        expected: np.ndarray,
    ) -> tuple[float, int, int, int]:
        """
        Compute Intersection over Union between two binary masks.
        Returns (iou, intersection_pixels, expected_pixels, observed_pixels).
        """
        # Ensure same size
        if observed.shape != expected.shape:
            from PIL import Image as PILImage
            expected_img = PILImage.fromarray(expected)
            expected_img = expected_img.resize(
                (observed.shape[1], observed.shape[0]),
                PILImage.Resampling.NEAREST,
            )
            expected = np.array(expected_img)

        obs_binary = observed > 127
        exp_binary = expected > 127

        intersection = int(np.sum(obs_binary & exp_binary))
        union = int(np.sum(obs_binary | exp_binary))
        expected_px = int(np.sum(exp_binary))
        observed_px = int(np.sum(obs_binary))

        iou = intersection / union if union > 0 else 0.0

        return iou, intersection, expected_px, observed_px

    def _iou_to_completion(self, iou: float) -> float:
        """Convert IoU score to estimated completion percentage."""
        if iou >= 0.8:
            return 100.0
        elif iou >= 0.5:
            return 60.0 + (iou - 0.5) / 0.3 * 40.0
        elif iou >= 0.2:
            return 20.0 + (iou - 0.2) / 0.3 * 40.0
        elif iou >= 0.05:
            return 5.0 + (iou - 0.05) / 0.15 * 15.0
        else:
            return 0.0

    def _compute_scheduled_percent(
        self, activity: Activity, reference_date: date
    ) -> float:
        """Compute expected % complete based on P6 schedule and reference date."""
        if activity.actual_finish:
            return 100.0
        if activity.percent_complete:
            return activity.percent_complete

        if activity.planned_start and activity.planned_finish:
            total_days = (activity.planned_finish - activity.planned_start).days
            if total_days <= 0:
                return 0.0
            elapsed = (reference_date - activity.planned_start).days
            return max(0.0, min(100.0, (elapsed / total_days) * 100))

        return 0.0

    def _compute_deviation(
        self,
        observed: float,
        scheduled: float,
        activity: Activity,
        reference_date: date,
    ) -> tuple[DeviationType, float | None]:
        """Determine deviation type and estimated days ahead/behind."""
        diff = observed - scheduled

        if observed < 5.0 and scheduled < 5.0:
            return DeviationType.NOT_STARTED, None

        if diff > 10:
            # Ahead of schedule
            days = None
            if activity.planned_duration_days and activity.planned_duration_days > 0:
                days = (diff / 100) * activity.planned_duration_days
            return DeviationType.AHEAD, days

        elif diff < -10:
            # Behind schedule
            days = None
            if activity.planned_duration_days and activity.planned_duration_days > 0:
                days = (abs(diff) / 100) * activity.planned_duration_days
            return DeviationType.BEHIND, -abs(days) if days else None

        else:
            return DeviationType.ON_TRACK, 0.0

    def _generate_narrative(
        self,
        element_id: UUID,
        activity: Activity,
        observed: float,
        scheduled: float,
        deviation_type: DeviationType,
        deviation_days: float | None,
    ) -> str:
        """Generate human-readable progress narrative."""
        act_name = activity.name

        if deviation_type == DeviationType.AHEAD:
            days_str = f" (~{abs(deviation_days):.0f} days)" if deviation_days else ""
            return (
                f"{act_name}: Observed {observed:.0f}% complete vs {scheduled:.0f}% scheduled. "
                f"Ahead of schedule{days_str}."
            )
        elif deviation_type == DeviationType.BEHIND:
            days_str = f" (~{abs(deviation_days):.0f} days)" if deviation_days else ""
            return (
                f"{act_name}: Observed {observed:.0f}% complete vs {scheduled:.0f}% scheduled. "
                f"Behind schedule{days_str}. Action may be required."
            )
        elif deviation_type == DeviationType.ON_TRACK:
            return (
                f"{act_name}: Observed {observed:.0f}% complete vs {scheduled:.0f}% scheduled. "
                f"On track."
            )
        elif deviation_type == DeviationType.NOT_STARTED:
            return f"{act_name}: Not yet started. Scheduled to begin {activity.planned_start}."
        else:
            return f"{act_name}: Observed {observed:.0f}% complete. Extra work detected."

    async def _get_segmentation(self, frame_id: UUID) -> SegmentationResult | None:
        result = await self.db.execute(
            select(SegmentationResult).where(SegmentationResult.frame_id == frame_id)
        )
        return result.scalar_one_or_none()

    async def _get_comparisons_for_capture(
        self, capture_id: UUID
    ) -> list[ProgressComparison]:
        """Get all comparisons for frames belonging to this capture."""
        result = await self.db.execute(
            select(ProgressComparison)
            .join(SegmentationResult)
            .join(Frame)
            .where(Frame.capture_id == capture_id)
        )
        return list(result.scalars().all())

    async def _get_linked_activity(self, element_id: UUID) -> Activity | None:
        """Get the schedule activity linked to this BIM element."""
        result = await self.db.execute(
            select(Activity)
            .join(ElementActivityLink)
            .where(ElementActivityLink.element_id == element_id)
            .order_by(ElementActivityLink.confidence.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()
