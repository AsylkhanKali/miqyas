"""
Semantic Segmentation Service — Mask2Former / MMSeg inference wrapper.

Pipeline:
  1. Load pre-trained Mask2Former (Swin-L backbone, ADE20K weights)
  2. Run inference on extracted video frames
  3. Map ADE20K class IDs → construction element categories
  4. Save segmentation masks + per-class pixel counts
  5. Persist results to database

Dependencies:
  - torch, torchvision
  - mmdet, mmengine, mmseg (OpenMMLab stack) — OR —
  - transformers (HuggingFace Mask2FormerForUniversalSegmentation)

This implementation uses HuggingFace transformers for easier setup.
For production with fine-tuned models, swap to MMSeg/MMDet.
"""

import logging
import time
from pathlib import Path
from typing import Any
from uuid import UUID

import numpy as np
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Frame, SegmentationResult, VideoCapture

logger = logging.getLogger(__name__)
settings = get_settings()


def detect_device() -> str:
    """Auto-detect the best available compute device."""
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
        if torch.backends.mps.is_available():
            return "mps"
    except ImportError:
        pass
    return "cpu"


# ── ADE20K → Construction Category Mapping ───────────────────────────────
# ADE20K has 150 classes. We map relevant ones to our construction categories.
# Full list: https://github.com/CSAILVision/placeschallenge/blob/master/instancesegmentation/categoryMapping.txt

ADE20K_TO_CONSTRUCTION: dict[int, str] = {
    # Walls
    0: "wall",       # wall
    5: "wall",       # ceiling → treated as wall context
    9: "window",     # windowpane
    14: "door",      # door
    # Floors / Slabs
    3: "slab",       # floor
    28: "slab",      # rug (floor-level)
    # Columns
    42: "column",    # column
    # Ceilings
    5: "ceiling",    # ceiling
    # Stairs
    53: "stair",     # stairs / stairway
    # Railings
    38: "railing",   # railing
    # Beams (no direct ADE20K class — use structural indicators)
    # MEP
    133: "mep",      # pipe
    134: "mep",      # pipe (variant)
    # Furniture
    7: "furniture",  # bed → furniture
    15: "furniture",  # table
    19: "furniture",  # sofa
    24: "furniture",  # chair
    36: "furniture",  # desk
    62: "furniture",  # cabinet
    63: "furniture",  # shelf
    # Curtain walls / Glass
    85: "curtain_wall",  # glass
    # Other common construction elements
    1: "other",      # building (exterior)
    2: "other",      # sky
    4: "other",      # tree
    6: "other",      # road
    8: "other",      # grass
    10: "other",     # earth
    11: "other",     # mountain
    12: "other",     # plant
    13: "other",     # curtain (fabric)
    16: "other",     # person
}

# Reverse: construction category → list of ADE20K class IDs
CONSTRUCTION_TO_ADE20K: dict[str, list[int]] = {}
for ade_id, cat in ADE20K_TO_CONSTRUCTION.items():
    CONSTRUCTION_TO_ADE20K.setdefault(cat, []).append(ade_id)

# Colors for visualization (same as frontend CATEGORY_COLORS)
CATEGORY_COLORS: dict[str, tuple[int, int, int]] = {
    "wall": (100, 116, 139),
    "slab": (139, 92, 246),
    "column": (245, 158, 11),
    "beam": (239, 68, 68),
    "door": (16, 185, 129),
    "window": (6, 182, 212),
    "stair": (236, 72, 153),
    "railing": (120, 113, 108),
    "ceiling": (167, 139, 250),
    "curtain_wall": (56, 189, 248),
    "mep": (34, 197, 94),
    "furniture": (217, 119, 6),
    "other": (148, 163, 184),
}


class SegmentationConfig:
    """Configuration for segmentation inference."""

    def __init__(
        self,
        model_name: str = "facebook/mask2former-swin-large-ade-semantic",
        device: str | None = None,  # None = auto-detect (cuda > mps > cpu)
        confidence_threshold: float = 0.5,
        batch_size: int = 1,
        save_colored_masks: bool = True,
        use_mock: bool = False,  # Only True for explicit dev/testing
    ):
        self.model_name = model_name
        self.device = device or detect_device()
        self.confidence_threshold = confidence_threshold
        self.batch_size = batch_size
        self.save_colored_masks = save_colored_masks
        self.use_mock = use_mock


class SegmentationService:
    """Runs semantic segmentation on video frames."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._model = None
        self._processor = None

    async def segment_capture(
        self,
        capture_id: UUID,
        config: SegmentationConfig | None = None,
        keyframes_only: bool = True,
    ) -> int:
        """
        Run segmentation on all frames (or keyframes) of a capture.
        Returns number of frames segmented.
        """
        if config is None:
            config = SegmentationConfig()

        capture = await self.db.get(VideoCapture, capture_id)
        if not capture:
            raise ValueError(f"VideoCapture {capture_id} not found")

        # Get frames to process
        query = select(Frame).where(Frame.capture_id == capture_id)
        if keyframes_only:
            query = query.where(Frame.is_keyframe == True)
        query = query.order_by(Frame.frame_number)
        frames = (await self.db.execute(query)).scalars().all()

        if not frames:
            raise ValueError("No frames to segment")

        # Load model
        self._load_model(config)

        # Output directory
        masks_dir = Path(settings.frame_storage_dir) / str(capture.project_id) / str(capture_id) / "masks"
        masks_dir.mkdir(parents=True, exist_ok=True)

        count = 0
        for frame in frames:
            try:
                result = self._segment_frame(frame, masks_dir, config)
                self.db.add(result)
                count += 1
            except Exception as e:
                logger.warning(f"Segmentation failed for frame {frame.frame_number}: {e}")
                continue

        from app.models import VideoStatus
        capture.status = VideoStatus.SEGMENTED
        await self.db.flush()

        logger.info(f"Segmented {count} frames for capture {capture.filename}")
        return count

    def _load_model(self, config: SegmentationConfig):
        """Load the segmentation model (lazy, cached)."""
        if self._model is not None:
            return

        # Use mock mode explicitly, or if torch/transformers not available
        if config.use_mock:
            logger.info("Segmentation running in mock mode (use_mock=True)")
            self._model = "mock"
            self._processor = "mock"
            return

        try:
            from transformers import Mask2FormerForUniversalSegmentation, Mask2FormerImageProcessor
            import torch

            logger.info(f"Loading model: {config.model_name} on {config.device}")
            self._processor = Mask2FormerImageProcessor.from_pretrained(config.model_name)
            self._model = Mask2FormerForUniversalSegmentation.from_pretrained(config.model_name)
            self._model.to(config.device)
            self._model.eval()
            logger.info("Model loaded successfully")

        except ImportError as e:
            raise RuntimeError(
                "torch/transformers not installed. Cannot run real segmentation. "
                "Install: pip install torch torchvision transformers  "
                "Or pass use_mock=True explicitly for testing."
            ) from e

    def _segment_frame(
        self,
        frame: Frame,
        masks_dir: Path,
        config: SegmentationConfig,
    ) -> SegmentationResult:
        """Run segmentation on a single frame."""
        start_time = time.time()
        image = Image.open(frame.equirect_path).convert("RGB")

        if self._model == "mock":
            # Fallback: generate random segmentation for testing
            seg_mask, class_probs = self._mock_segment(image)
        else:
            seg_mask, class_probs = self._run_inference(image, config)

        inference_ms = (time.time() - start_time) * 1000

        # Compute per-class pixel counts
        unique_classes, counts = np.unique(seg_mask, return_counts=True)
        class_pixel_counts = {}
        confidence_scores = {}

        for cls_id, pixel_count in zip(unique_classes, counts):
            construction_cat = ADE20K_TO_CONSTRUCTION.get(int(cls_id), "other")
            class_pixel_counts[construction_cat] = (
                class_pixel_counts.get(construction_cat, 0) + int(pixel_count)
            )
            if int(cls_id) in class_probs:
                confidence_scores[construction_cat] = max(
                    confidence_scores.get(construction_cat, 0),
                    class_probs[int(cls_id)],
                )

        # Save mask
        mask_filename = f"mask_{frame.frame_number:06d}.png"
        mask_path = masks_dir / mask_filename
        mask_img = Image.fromarray(seg_mask.astype(np.uint8))
        mask_img.save(mask_path)

        # Save colored visualization
        if config.save_colored_masks:
            colored = self._colorize_mask(seg_mask)
            colored_path = masks_dir / f"mask_{frame.frame_number:06d}_colored.png"
            Image.fromarray(colored).save(colored_path)

        # Build class map (what each ID means)
        class_map = {
            str(int(cls_id)): ADE20K_TO_CONSTRUCTION.get(int(cls_id), "other")
            for cls_id in unique_classes
        }

        return SegmentationResult(
            frame_id=frame.id,
            model_name=config.model_name,
            model_version="ade20k-semantic",
            mask_path=str(mask_path),
            class_map=class_map,
            class_pixel_counts=class_pixel_counts,
            confidence_scores=confidence_scores,
            inference_time_ms=round(inference_ms, 1),
        )

    def _run_inference(
        self, image: Image.Image, config: SegmentationConfig
    ) -> tuple[np.ndarray, dict[int, float]]:
        """Run actual Mask2Former inference."""
        import torch

        inputs = self._processor(images=image, return_tensors="pt")
        inputs = {k: v.to(config.device) for k, v in inputs.items()}

        with torch.no_grad():
            outputs = self._model(**inputs)

        # Post-process for semantic segmentation
        result = self._processor.post_process_semantic_segmentation(
            outputs, target_sizes=[image.size[::-1]]
        )[0]

        seg_mask = result.cpu().numpy()

        # Extract confidence scores per class
        class_probs = {}
        if hasattr(outputs, "class_queries_logits"):
            logits = outputs.class_queries_logits[0].softmax(-1)
            for cls_id in range(logits.shape[-1]):
                max_prob = logits[:, cls_id].max().item()
                if max_prob > config.confidence_threshold:
                    class_probs[cls_id] = round(max_prob, 3)

        return seg_mask, class_probs

    def _mock_segment(self, image: Image.Image) -> tuple[np.ndarray, dict[int, float]]:
        """Generate mock segmentation for testing without GPU/model."""
        w, h = image.size
        # Create zones that roughly simulate a construction scene
        mask = np.zeros((h, w), dtype=np.uint8)

        # Bottom 30% = floor (class 3)
        mask[int(h * 0.7):, :] = 3

        # Top 15% = ceiling (class 5)
        mask[:int(h * 0.15), :] = 5

        # Left/right strips = walls (class 0)
        mask[:, :int(w * 0.1)] = 0
        mask[:, int(w * 0.9):] = 0

        # Middle band = wall (class 0)
        mask[int(h * 0.15):int(h * 0.7), int(w * 0.1):int(w * 0.9)] = 0

        # A few "doors" (class 14)
        mask[int(h * 0.3):int(h * 0.7), int(w * 0.4):int(w * 0.45)] = 14

        # A "column" (class 42)
        mask[int(h * 0.2):int(h * 0.7), int(w * 0.7):int(w * 0.73)] = 42

        class_probs = {0: 0.92, 3: 0.88, 5: 0.85, 14: 0.78, 42: 0.72}
        return mask, class_probs

    def _colorize_mask(self, mask: np.ndarray) -> np.ndarray:
        """Convert class-ID mask to RGB colored visualization."""
        h, w = mask.shape
        colored = np.zeros((h, w, 3), dtype=np.uint8)

        for cls_id in np.unique(mask):
            cat = ADE20K_TO_CONSTRUCTION.get(int(cls_id), "other")
            color = CATEGORY_COLORS.get(cat, (148, 163, 184))
            colored[mask == cls_id] = color

        return colored
