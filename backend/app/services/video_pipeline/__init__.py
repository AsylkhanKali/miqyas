"""
FFmpeg Frame Extraction & Cubemap Conversion Service.

Pipeline:
  1. Probe video metadata (resolution, fps, duration, codec)
  2. Extract equirectangular frames at configurable interval
  3. Score frame quality (blur detection via Laplacian variance)
  4. Mark keyframes (scene-change detection or fixed interval)
  5. Convert selected frames from equirectangular → 6 cubemap faces

Dependencies:
  - ffmpeg / ffprobe (system-level, must be on PATH)
  - Pillow (for cubemap conversion)
  - numpy (for blur scoring)
"""

import asyncio
import json
import logging
import math
import subprocess
from pathlib import Path
from typing import Any
from uuid import UUID

import numpy as np
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models import Frame, VideoCapture, VideoStatus

logger = logging.getLogger(__name__)
settings = get_settings()


class VideoProbeResult:
    """Parsed ffprobe output for a video file."""

    def __init__(self, data: dict):
        video_stream = next(
            (s for s in data.get("streams", []) if s["codec_type"] == "video"), {}
        )
        self.width = int(video_stream.get("width", 0))
        self.height = int(video_stream.get("height", 0))
        self.fps = self._parse_fps(video_stream.get("r_frame_rate", "30/1"))
        self.duration = float(data.get("format", {}).get("duration", 0))
        self.codec = video_stream.get("codec_name", "unknown")
        self.bitrate = int(data.get("format", {}).get("bit_rate", 0))
        self.resolution = f"{self.width}x{self.height}"
        self.total_frames = int(self.fps * self.duration)

    @staticmethod
    def _parse_fps(fps_str: str) -> float:
        if "/" in fps_str:
            num, den = fps_str.split("/")
            return float(num) / float(den) if float(den) != 0 else 30.0
        return float(fps_str)


class FrameExtractionService:
    """Extracts frames from 360° video files using FFmpeg."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def process_video(
        self,
        capture_id: UUID,
        frame_interval_seconds: float = 1.0,
        generate_cubemaps: bool = True,
        cubemap_face_size: int = 1024,
    ) -> int:
        """
        Full pipeline: probe → extract → score → cubemap.
        Returns number of frames extracted.
        """
        capture = await self.db.get(VideoCapture, capture_id)
        if not capture:
            raise ValueError(f"VideoCapture {capture_id} not found")

        capture.status = VideoStatus.PROCESSING
        await self.db.flush()

        try:
            video_path = Path(capture.storage_path)
            if not video_path.exists():
                raise FileNotFoundError(f"Video file not found: {video_path}")

            # 1. Probe video
            probe = await self._probe_video(video_path)
            capture.duration_seconds = probe.duration
            capture.resolution = probe.resolution
            capture.fps = probe.fps

            # 2. Create output directories
            project_dir = settings.frame_storage_dir / str(capture.project_id)
            capture_dir = project_dir / str(capture_id)
            equirect_dir = capture_dir / "equirect"
            cubemap_dir = capture_dir / "cubemap"
            equirect_dir.mkdir(parents=True, exist_ok=True)
            cubemap_dir.mkdir(parents=True, exist_ok=True)

            # 3. Extract frames
            frame_paths = await self._extract_frames(
                video_path, equirect_dir, frame_interval_seconds, probe.fps
            )

            # 4. Score and persist frames
            frames_created = 0
            for i, frame_path in enumerate(frame_paths):
                timestamp = i * frame_interval_seconds
                quality = self._compute_blur_score(frame_path)
                is_keyframe = (i % 5 == 0) or quality > 100  # every 5th or high-quality

                cubemap_paths_dict = None
                if generate_cubemaps and is_keyframe:
                    cubemap_paths_dict = self._equirect_to_cubemap(
                        frame_path, cubemap_dir, i, cubemap_face_size
                    )

                frame = Frame(
                    capture_id=capture_id,
                    frame_number=i,
                    timestamp_seconds=round(timestamp, 3),
                    equirect_path=str(frame_path),
                    cubemap_paths=cubemap_paths_dict,
                    is_keyframe=is_keyframe,
                    quality_score=round(quality, 2),
                )
                self.db.add(frame)
                frames_created += 1

            capture.frame_count = frames_created
            capture.status = VideoStatus.FRAMES_EXTRACTED
            await self.db.flush()

            logger.info(
                f"Extracted {frames_created} frames from {capture.filename} "
                f"({probe.duration:.1f}s, {probe.resolution})"
            )
            return frames_created

        except Exception as e:
            capture.status = VideoStatus.FAILED
            capture.processing_error = str(e)
            await self.db.flush()
            logger.error(f"Frame extraction failed for {capture.filename}: {e}")
            raise

    async def _probe_video(self, video_path: Path) -> VideoProbeResult:
        """Run ffprobe and parse output."""
        cmd = [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            str(video_path),
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        if proc.returncode != 0:
            raise RuntimeError(f"ffprobe failed: {stderr.decode()}")

        data = json.loads(stdout.decode())
        return VideoProbeResult(data)

    async def _extract_frames(
        self,
        video_path: Path,
        output_dir: Path,
        interval_seconds: float,
        fps: float,
    ) -> list[Path]:
        """Extract equirectangular frames at fixed intervals using ffmpeg."""
        output_pattern = str(output_dir / "frame_%06d.jpg")

        cmd = [
            "ffmpeg",
            "-i", str(video_path),
            "-vf", f"fps=1/{interval_seconds}",
            "-qmin", "1",
            "-q:v", "2",  # high quality JPEG
            "-y",
            output_pattern,
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()

        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg extraction failed: {stderr.decode()[-500:]}")

        # Collect extracted frame paths in order
        frames = sorted(output_dir.glob("frame_*.jpg"))
        logger.info(f"Extracted {len(frames)} frames to {output_dir}")
        return frames

    def _compute_blur_score(self, frame_path: Path) -> float:
        """
        Compute blur score using Laplacian variance.
        Higher = sharper. Typically: <50 = blurry, >100 = sharp.
        """
        try:
            img = Image.open(frame_path).convert("L")
            # Resize for speed
            img = img.resize((640, 320))
            arr = np.array(img, dtype=np.float64)

            # Laplacian kernel convolution (approximate via numpy)
            laplacian = (
                np.roll(arr, 1, axis=0) + np.roll(arr, -1, axis=0) +
                np.roll(arr, 1, axis=1) + np.roll(arr, -1, axis=1) -
                4 * arr
            )
            return float(np.var(laplacian))
        except Exception:
            return 0.0

    def _equirect_to_cubemap(
        self,
        equirect_path: Path,
        output_dir: Path,
        frame_index: int,
        face_size: int = 1024,
    ) -> dict[str, str]:
        """
        Convert an equirectangular image to 6 cubemap faces.
        Returns dict with paths: {front, back, left, right, top, bottom}.
        """
        img = Image.open(equirect_path)
        w, h = img.size
        eq_arr = np.array(img, dtype=np.float32)

        face_names = ["front", "right", "back", "left", "top", "bottom"]
        paths = {}

        for face_idx, face_name in enumerate(face_names):
            face_arr = self._render_cubemap_face(eq_arr, face_idx, face_size, w, h)
            face_img = Image.fromarray(face_arr.astype(np.uint8))

            face_path = output_dir / f"frame_{frame_index:06d}_{face_name}.jpg"
            face_img.save(face_path, quality=90)
            paths[face_name] = str(face_path)

        return paths

    def _render_cubemap_face(
        self,
        eq_arr: np.ndarray,
        face_idx: int,
        face_size: int,
        eq_w: int,
        eq_h: int,
    ) -> np.ndarray:
        """Render a single cubemap face from equirectangular source."""
        out = np.zeros((face_size, face_size, 3), dtype=np.float32)

        # Generate pixel coordinates for this face
        u = np.linspace(-1, 1, face_size)
        v = np.linspace(-1, 1, face_size)
        uu, vv = np.meshgrid(u, v)

        # Convert face UV to 3D direction vectors
        if face_idx == 0:    # front (+Z)
            x, y, z = uu, -vv, np.ones_like(uu)
        elif face_idx == 1:  # right (+X)
            x, y, z = np.ones_like(uu), -vv, -uu
        elif face_idx == 2:  # back (-Z)
            x, y, z = -uu, -vv, -np.ones_like(uu)
        elif face_idx == 3:  # left (-X)
            x, y, z = -np.ones_like(uu), -vv, uu
        elif face_idx == 4:  # top (+Y)
            x, y, z = uu, np.ones_like(uu), vv
        else:                # bottom (-Y)
            x, y, z = uu, -np.ones_like(uu), -vv

        # 3D direction → spherical → equirectangular UV
        norm = np.sqrt(x**2 + y**2 + z**2)
        x, y, z = x / norm, y / norm, z / norm

        theta = np.arctan2(x, z)       # longitude [-pi, pi]
        phi = np.arcsin(np.clip(y, -1, 1))  # latitude [-pi/2, pi/2]

        # Map to pixel coordinates
        px = ((theta / math.pi + 1) / 2 * (eq_w - 1)).astype(np.int32)
        py = ((0.5 - phi / math.pi) * (eq_h - 1)).astype(np.int32)

        px = np.clip(px, 0, eq_w - 1)
        py = np.clip(py, 0, eq_h - 1)

        out = eq_arr[py, px]
        return out
