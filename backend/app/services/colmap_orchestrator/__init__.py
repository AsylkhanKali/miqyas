"""
COLMAP Orchestration Service — runs SfM pipeline on extracted frames.

Pipeline:
  1. Feature extraction (SIFT)
  2. Feature matching (exhaustive or sequential)
  3. Sparse reconstruction (incremental mapper)
  4. Read camera poses from COLMAP output
  5. Apply transformation to BIM coordinate system

If COLMAP fails or quality is poor, falls back to manual alignment.

Dependencies:
  - colmap (system binary, must be on PATH)
"""

import asyncio
import logging
from collections import namedtuple
from pathlib import Path
from uuid import UUID

import numpy as np
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import (
    AlignmentMethod,
    CameraAlignment,
    CameraPose,
    Frame,
    VideoCapture,
    VideoStatus,
)

logger = logging.getLogger(__name__)
settings = get_settings()

# COLMAP image entry from images.txt
ColmapImage = namedtuple("ColmapImage", [
    "image_id", "qw", "qx", "qy", "qz", "tx", "ty", "tz", "camera_id", "name"
])


class COLMAPConfig:
    """Configuration for a COLMAP reconstruction run."""

    def __init__(
        self,
        matching_type: str = "sequential",  # "exhaustive" or "sequential"
        max_num_features: int = 8192,
        camera_model: str = "OPENCV_FISHEYE",  # good for 360° cubemap faces
        single_camera: bool = True,
        gpu_index: str = "-1",  # -1 = CPU, 0+ = GPU
    ):
        self.matching_type = matching_type
        self.max_num_features = max_num_features
        self.camera_model = camera_model
        self.single_camera = single_camera
        self.gpu_index = gpu_index


class COLMAPOrchestrator:
    """Runs COLMAP SfM pipeline and extracts camera poses."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def reconstruct(
        self,
        capture_id: UUID,
        config: COLMAPConfig | None = None,
    ) -> CameraAlignment:
        """
        Run full COLMAP reconstruction pipeline.
        Returns the created CameraAlignment record.
        """
        if config is None:
            config = COLMAPConfig()

        capture = await self.db.get(VideoCapture, capture_id)
        if not capture:
            raise ValueError(f"VideoCapture {capture_id} not found")

        # Set up workspace
        workspace = Path(settings.upload_dir) / "colmap" / str(capture_id)
        images_dir = workspace / "images"
        sparse_dir = workspace / "sparse"
        database_path = workspace / "database.db"

        workspace.mkdir(parents=True, exist_ok=True)
        images_dir.mkdir(exist_ok=True)
        sparse_dir.mkdir(exist_ok=True)

        # Fail fast if COLMAP is not installed
        if not await self._colmap_available():
            raise RuntimeError(
                "COLMAP binary not found on PATH. "
                "Install it: brew install colmap (macOS) or apt install colmap (Linux). "
                "Alternatively, use manual alignment: POST /captures/{id}/align-manual"
            )

        try:
            # Symlink keyframes into images directory
            frames = await self._get_keyframes(capture_id)
            if len(frames) < 3:
                raise ValueError(f"Need at least 3 keyframes, got {len(frames)}")

            for frame in frames:
                src = Path(frame.equirect_path)
                dst = images_dir / src.name
                if not dst.exists():
                    dst.symlink_to(src.resolve())

            # Run COLMAP pipeline steps
            await self._run_feature_extractor(workspace, images_dir, database_path, config)
            await self._run_feature_matcher(workspace, database_path, config)
            await self._run_mapper(workspace, database_path, images_dir, sparse_dir, config)

            # Parse results
            model_dir = self._find_best_model(sparse_dir)
            if model_dir is None:
                raise RuntimeError("COLMAP reconstruction failed — no model produced")

            poses = self._read_colmap_images(model_dir / "images.txt")
            reproj_error = self._read_reprojection_error(model_dir)

            # Compute quality metrics
            total_input = len(frames)
            registered = len(poses)
            reg_ratio = registered / total_input if total_input > 0 else 0.0
            quality_grade, quality_warnings = self._assess_quality(
                registered, total_input, reg_ratio, reproj_error,
            )

            # Create alignment record
            alignment = CameraAlignment(
                capture_id=capture_id,
                method=AlignmentMethod.COLMAP,
                transformation_matrix=np.eye(4).tolist(),  # identity until BIM registration
                scale_factor=1.0,
                colmap_workspace_path=str(workspace),
                reprojection_error=reproj_error,
                registered_images=registered,
                total_input_images=total_input,
                registration_ratio=round(reg_ratio, 3),
                quality_grade=quality_grade,
                quality_warnings=quality_warnings,
                is_validated=False,
            )
            self.db.add(alignment)
            await self.db.flush()

            # Create camera poses for each reconstructed frame
            frame_name_map = {Path(f.equirect_path).name: f for f in frames}
            poses_created = 0

            for pose in poses:
                frame = frame_name_map.get(pose.name)
                if not frame:
                    continue

                camera_pose = CameraPose(
                    alignment_id=alignment.id,
                    frame_id=frame.id,
                    position=[pose.tx, pose.ty, pose.tz],
                    rotation=[pose.qw, pose.qx, pose.qy, pose.qz],
                )
                self.db.add(camera_pose)
                poses_created += 1

            capture.status = VideoStatus.ALIGNED
            await self.db.flush()

            logger.info(
                f"COLMAP reconstruction complete: {poses_created}/{total_input} poses registered, "
                f"reproj error={reproj_error}, quality={quality_grade}"
            )
            return alignment

        except Exception as e:
            logger.error(f"COLMAP reconstruction failed: {e}")
            raise

    def _assess_quality(
        self,
        registered: int,
        total: int,
        reg_ratio: float,
        reproj_error: float | None,
    ) -> tuple[str, list[str]]:
        """
        Assess COLMAP reconstruction quality.

        Returns (grade, warnings) where grade is one of:
          "good"       — >70% registered, reproj <2.0px
          "acceptable" — >50% registered, reproj <5.0px
          "poor"       — >30% registered or reproj >5.0px
          "failed"     — <30% registered
        """
        warnings: list[str] = []

        # Registration ratio checks
        if reg_ratio < 0.30:
            grade = "failed"
            warnings.append(
                f"Only {registered}/{total} frames registered ({reg_ratio:.0%}). "
                "Reconstruction is unreliable. Consider using manual alignment instead."
            )
        elif reg_ratio < 0.50:
            grade = "poor"
            warnings.append(
                f"{registered}/{total} frames registered ({reg_ratio:.0%}). "
                "Coverage is sparse — some viewpoints may have inaccurate poses."
            )
        elif reg_ratio < 0.70:
            grade = "acceptable"
        else:
            grade = "good"

        # Reprojection error checks
        if reproj_error is not None:
            if reproj_error > 5.0:
                if grade != "failed":
                    grade = "poor"
                warnings.append(
                    f"Mean reprojection error is {reproj_error:.2f}px (threshold: <2.0px good, <5.0px acceptable). "
                    "Camera poses may be inaccurate — downstream IoU comparisons will be noisy."
                )
            elif reproj_error > 2.0:
                if grade == "good":
                    grade = "acceptable"
                warnings.append(
                    f"Mean reprojection error is {reproj_error:.2f}px — acceptable but not ideal. "
                    "Consider adding more frames or using exhaustive matching."
                )

        # Absolute count check
        if registered < 5:
            if grade not in ("failed",):
                grade = "poor"
            warnings.append(
                f"Only {registered} frames registered — very few viewpoints. "
                "BIM comparison coverage will be limited."
            )

        return grade, warnings

    async def _colmap_available(self) -> bool:
        """Check if the colmap binary exists on PATH."""
        import shutil
        return shutil.which("colmap") is not None

    async def _get_keyframes(self, capture_id: UUID) -> list[Frame]:
        """Get all keyframes for a capture."""
        from sqlalchemy import select
        result = await self.db.execute(
            select(Frame)
            .where(Frame.capture_id == capture_id, Frame.is_keyframe)
            .order_by(Frame.frame_number)
        )
        return list(result.scalars().all())

    async def _run_colmap_cmd(self, cmd: list[str], label: str, timeout: int = 300) -> None:
        """Run a COLMAP command asynchronously with a timeout."""
        logger.info(f"COLMAP {label}: {' '.join(cmd[:5])}...")
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError:
            raise RuntimeError(
                "colmap binary not found on PATH. "
                "Install COLMAP or use manual alignment instead."
            )

        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except TimeoutError:
            proc.kill()
            raise RuntimeError(f"COLMAP {label} timed out after {timeout}s")

        if proc.returncode != 0:
            error_msg = stderr.decode()[-1000:]
            raise RuntimeError(f"COLMAP {label} failed (code {proc.returncode}): {error_msg}")

        logger.info(f"COLMAP {label} completed")

    async def _run_feature_extractor(
        self, workspace: Path, images_dir: Path, db_path: Path, config: COLMAPConfig
    ):
        cmd = [
            "colmap", "feature_extractor",
            "--database_path", str(db_path),
            "--image_path", str(images_dir),
            "--ImageReader.camera_model", config.camera_model,
            "--ImageReader.single_camera", "1" if config.single_camera else "0",
            "--SiftExtraction.max_num_features", str(config.max_num_features),
            "--SiftExtraction.use_gpu", "1" if config.gpu_index != "-1" else "0",
        ]
        if config.gpu_index != "-1":
            cmd.extend(["--SiftExtraction.gpu_index", config.gpu_index])
        await self._run_colmap_cmd(cmd, "feature_extractor")

    async def _run_feature_matcher(
        self, workspace: Path, db_path: Path, config: COLMAPConfig
    ):
        matcher = f"{config.matching_type}_matcher"
        cmd = [
            "colmap", matcher,
            "--database_path", str(db_path),
            "--SiftMatching.use_gpu", "1" if config.gpu_index != "-1" else "0",
        ]
        if config.gpu_index != "-1":
            cmd.extend(["--SiftMatching.gpu_index", config.gpu_index])
        await self._run_colmap_cmd(cmd, matcher)

    async def _run_mapper(
        self,
        workspace: Path,
        db_path: Path,
        images_dir: Path,
        sparse_dir: Path,
        config: COLMAPConfig,
    ):
        cmd = [
            "colmap", "mapper",
            "--database_path", str(db_path),
            "--image_path", str(images_dir),
            "--output_path", str(sparse_dir),
            "--Mapper.ba_global_max_num_iterations", "50",
            "--Mapper.ba_global_max_refinements", "3",
        ]
        await self._run_colmap_cmd(cmd, "mapper")

    def _find_best_model(self, sparse_dir: Path) -> Path | None:
        """Find the COLMAP model with most registered images."""
        models = [d for d in sparse_dir.iterdir() if d.is_dir()]
        if not models:
            return None

        best = None
        best_count = 0
        for model_dir in models:
            images_file = model_dir / "images.txt"
            if images_file.exists():
                # Count non-comment, non-empty lines (2 lines per image)
                count = sum(
                    1 for line in images_file.read_text().splitlines()
                    if line.strip() and not line.startswith("#")
                ) // 2
                if count > best_count:
                    best_count = count
                    best = model_dir

        return best

    def _read_colmap_images(self, images_path: Path) -> list[ColmapImage]:
        """Parse COLMAP images.txt text format."""
        poses = []
        lines = images_path.read_text().splitlines()
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if not line or line.startswith("#"):
                i += 1
                continue

            parts = line.split()
            if len(parts) >= 10:
                pose = ColmapImage(
                    image_id=int(parts[0]),
                    qw=float(parts[1]),
                    qx=float(parts[2]),
                    qy=float(parts[3]),
                    qz=float(parts[4]),
                    tx=float(parts[5]),
                    ty=float(parts[6]),
                    tz=float(parts[7]),
                    camera_id=int(parts[8]),
                    name=parts[9],
                )
                poses.append(pose)
                i += 2  # skip the 2D points line
            else:
                i += 1

        return poses

    def _read_reprojection_error(self, model_dir: Path) -> float | None:
        """Read mean reprojection error from COLMAP output if available."""
        try:
            points_file = model_dir / "points3D.txt"
            if not points_file.exists():
                return None
            errors = []
            for line in points_file.read_text().splitlines():
                if line.startswith("#") or not line.strip():
                    continue
                parts = line.split()
                if len(parts) >= 8:
                    errors.append(float(parts[7]))  # error column
            return float(np.mean(errors)) if errors else None
        except Exception:
            return None
