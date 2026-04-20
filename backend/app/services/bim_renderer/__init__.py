"""
BIM Headless Renderer — renders expected element visibility from camera viewpoints.

For each camera pose + BIM element, renders a binary mask of where that element
*should* appear in the frame according to the 3D model. This "expected mask" is
then compared to the actual segmentation result via IoU.

Phase 2 approach (mesh rasterization):
  1. Load BIM element triangle meshes (from geometry_mesh JSONB)
  2. Build trimesh.Trimesh per element
  3. Use pyrender.OffscreenRenderer to render per-element ID maps
  4. Extract per-element binary masks from the ID map

Falls back to bbox convex-hull projection when mesh data is unavailable.
"""

import logging
from pathlib import Path
from uuid import UUID

import numpy as np
from PIL import Image, ImageDraw
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BIMElement, CameraAlignment, CameraPose

logger = logging.getLogger(__name__)

# Try to import mesh rendering dependencies; mark available if found
_HAS_MESH_RENDERER = False
try:
    import pyrender
    import trimesh

    _HAS_MESH_RENDERER = True
except ImportError:
    logger.warning(
        "pyrender/trimesh not installed — falling back to bbox projection. "
        "Install with: pip install pyrender trimesh PyOpenGL"
    )


class BIMRendererConfig:
    """Configuration for BIM headless rendering."""

    def __init__(
        self,
        image_width: int = 1920,
        image_height: int = 1080,
        fov_degrees: float = 90.0,
        near_clip: float = 0.1,
        far_clip: float = 500.0,
    ):
        self.image_width = image_width
        self.image_height = image_height
        self.fov_degrees = fov_degrees
        self.near_clip = near_clip
        self.far_clip = far_clip


class BIMHeadlessRenderer:
    """Renders BIM element expectations from camera viewpoints.

    Uses mesh rasterization when geometry_mesh data is available (Phase 2),
    falling back to bbox convex-hull projection for elements without mesh data.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def render_expectations(
        self,
        capture_id: UUID,
        bim_model_id: UUID,
        output_dir: Path,
        config: BIMRendererConfig | None = None,
    ) -> dict[str, list[dict]]:
        """
        Render expected visibility masks for all elements visible from each camera pose.

        Returns: {frame_id: [{element_id, mask_path, pixel_count, category}, ...]}
        """
        if config is None:
            config = BIMRendererConfig()

        output_dir.mkdir(parents=True, exist_ok=True)

        # Load alignment + poses
        alignment = await self._get_alignment(capture_id)
        if not alignment:
            raise ValueError(f"No alignment found for capture {capture_id}")

        poses = await self._get_camera_poses(alignment.id)
        if not poses:
            raise ValueError("No camera poses available")

        # Load BIM elements with geometry
        elements = await self._get_elements_with_geometry(bim_model_id)
        if not elements:
            raise ValueError("No BIM elements with geometry")

        # Partition elements: mesh-renderable vs bbox-only
        mesh_elements = [e for e in elements if e.geometry_mesh]
        bbox_elements = [e for e in elements if not e.geometry_mesh and e.geometry_bbox]

        logger.info(
            f"Rendering {len(mesh_elements)} mesh elements + "
            f"{len(bbox_elements)} bbox-fallback elements across {len(poses)} poses"
        )

        # Parse alignment transformation
        T_align = np.array(alignment.transformation_matrix)
        scale = alignment.scale_factor
        K = self._build_intrinsics(config)

        results: dict[str, list[dict]] = {}

        for pose in poses:
            frame_id = str(pose.frame_id)
            frame_results: list[dict] = []

            # Camera extrinsics
            R_cam = self._quaternion_to_rotation(pose.rotation)
            t_cam = np.array(pose.position)

            # --- Mesh rendering (Phase 2) ---
            if mesh_elements and _HAS_MESH_RENDERER:
                mesh_results = self._render_mesh_elements(
                    mesh_elements, R_cam, t_cam, T_align, scale, config, output_dir, frame_id,
                )
                frame_results.extend(mesh_results)

            # --- Bbox fallback ---
            if bbox_elements:
                bbox_results = self._render_bbox_elements(
                    bbox_elements, R_cam, t_cam, T_align, scale, K, config, output_dir, frame_id,
                )
                frame_results.extend(bbox_results)

            results[frame_id] = frame_results

        total_rendered = sum(len(v) for v in results.values())
        logger.info(
            f"Rendered {total_rendered} element expectations across {len(poses)} camera poses"
        )
        return results

    # ── Mesh rendering (pyrender/trimesh) ────────────────────────────────

    def _render_mesh_elements(
        self,
        elements: list[BIMElement],
        R_cam: np.ndarray,
        t_cam: np.ndarray,
        T_align: np.ndarray,
        scale: float,
        config: BIMRendererConfig,
        output_dir: Path,
        frame_id: str,
    ) -> list[dict]:
        """Render per-element masks using pyrender offscreen renderer with element ID map."""
        results = []

        # Build the scene with one mesh per element, each with a unique flat color
        scene = pyrender.Scene(bg_color=[0, 0, 0, 0], ambient_light=[1.0, 1.0, 1.0])

        element_color_map: dict[int, BIMElement] = {}  # color_id → element

        for idx, element in enumerate(elements):
            mesh_data = element.geometry_mesh
            if not mesh_data:
                continue

            vertices = np.array(mesh_data["vertices"], dtype=np.float64)
            faces = np.array(mesh_data["faces"], dtype=np.int32)

            if len(vertices) < 3 or len(faces) < 1:
                continue

            # Transform vertices: BIM coords → world coords via alignment
            verts_world = (T_align[:3, :3] @ (vertices * scale).T).T + T_align[:3, 3]

            try:
                tm = trimesh.Trimesh(vertices=verts_world, faces=faces, process=False)
            except Exception:
                continue

            # Encode element index as a unique flat color (R, G, B)
            # Use idx+1 so that background (0,0,0) is never confused with an element
            color_id = idx + 1
            r = (color_id & 0xFF) / 255.0
            g = ((color_id >> 8) & 0xFF) / 255.0
            b = ((color_id >> 16) & 0xFF) / 255.0

            material = pyrender.MetallicRoughnessMaterial(
                baseColorFactor=[r, g, b, 1.0],
                metallicFactor=0.0,
                roughnessFactor=1.0,
            )
            mesh = pyrender.Mesh.from_trimesh(tm, material=material, smooth=False)
            scene.add(mesh)
            element_color_map[color_id] = element

        if not element_color_map:
            return results

        # Build camera pose matrix (world-to-camera → camera-to-world for pyrender)
        cam_pose = np.eye(4)
        cam_pose[:3, :3] = R_cam.T  # pyrender wants camera-to-world rotation
        cam_pose[:3, 3] = -R_cam.T @ t_cam  # camera position in world

        # pyrender uses OpenGL convention (Y up, -Z forward); apply correction
        gl_correction = np.diag([1, -1, -1, 1]).astype(np.float64)
        cam_pose = cam_pose @ gl_correction

        camera = pyrender.IntrinsicsCamera(
            fx=config.image_width / (2 * np.tan(np.radians(config.fov_degrees / 2))),
            fy=config.image_width / (2 * np.tan(np.radians(config.fov_degrees / 2))),
            cx=config.image_width / 2,
            cy=config.image_height / 2,
            znear=config.near_clip,
            zfar=config.far_clip,
        )
        scene.add(camera, pose=cam_pose)

        # Add a flat directional light so all surfaces are equally lit
        light = pyrender.DirectionalLight(color=[1.0, 1.0, 1.0], intensity=3.0)
        scene.add(light, pose=cam_pose)

        # Render
        try:
            renderer = pyrender.OffscreenRenderer(config.image_width, config.image_height)
            color_img, _ = renderer.render(scene, flags=pyrender.constants.RenderFlags.FLAT)
            renderer.delete()
        except Exception as e:
            logger.warning(f"Offscreen render failed for frame {frame_id}: {e}")
            return results

        # Extract per-element masks from the color-coded render
        for color_id, element in element_color_map.items():
            r_val = color_id & 0xFF
            g_val = (color_id >> 8) & 0xFF
            b_val = (color_id >> 16) & 0xFF

            # Match pixels (allow ±1 tolerance for rendering artifacts)
            mask = (
                (np.abs(color_img[:, :, 0].astype(int) - r_val) <= 1)
                & (np.abs(color_img[:, :, 1].astype(int) - g_val) <= 1)
                & (np.abs(color_img[:, :, 2].astype(int) - b_val) <= 1)
            ).astype(np.uint8) * 255

            pixel_count = int(np.sum(mask > 0))
            if pixel_count < 100:
                continue

            mask_filename = f"expected_{frame_id[:8]}_{str(element.id)[:8]}.png"
            mask_path = output_dir / mask_filename
            Image.fromarray(mask).save(mask_path)

            results.append({
                "element_id": str(element.id),
                "mask_path": str(mask_path),
                "pixel_count": pixel_count,
                "category": element.category.value if hasattr(element.category, "value") else str(element.category),
                "render_method": "mesh",
            })

        return results

    # ── Bbox fallback rendering ──────────────────────────────────────────

    def _render_bbox_elements(
        self,
        elements: list[BIMElement],
        R_cam: np.ndarray,
        t_cam: np.ndarray,
        T_align: np.ndarray,
        scale: float,
        K: np.ndarray,
        config: BIMRendererConfig,
        output_dir: Path,
        frame_id: str,
    ) -> list[dict]:
        """Render per-element masks using bbox corner projection + convex hull (original approach)."""
        results = []

        for element in elements:
            bbox = element.geometry_bbox
            if not bbox:
                continue

            corners_bim = self._bbox_to_corners(bbox)

            corners_cam = []
            for corner in corners_bim:
                p_world = T_align[:3, :3] @ (np.array(corner) * scale) + T_align[:3, 3]
                p_cam = R_cam @ p_world + t_cam
                corners_cam.append(p_cam)

            corners_cam = np.array(corners_cam)

            depths = corners_cam[:, 2]
            if np.all(depths < config.near_clip):
                continue

            pixels = self._project_to_image(corners_cam, K, config)
            if pixels is None:
                continue

            px_x = pixels[:, 0]
            px_y = pixels[:, 1]

            if (np.all(px_x < 0) or np.all(px_x > config.image_width) or
                np.all(px_y < 0) or np.all(px_y > config.image_height)):
                continue

            mask = self._render_element_mask(pixels, config)
            pixel_count = int(np.sum(mask > 0))

            if pixel_count < 100:
                continue

            mask_filename = f"expected_{frame_id[:8]}_{str(element.id)[:8]}.png"
            mask_path = output_dir / mask_filename
            Image.fromarray(mask).save(mask_path)

            results.append({
                "element_id": str(element.id),
                "mask_path": str(mask_path),
                "pixel_count": pixel_count,
                "category": element.category.value if hasattr(element.category, "value") else str(element.category),
                "render_method": "bbox",
            })

        return results

    # ── Database queries ─────────────────────────────────────────────────

    async def _get_alignment(self, capture_id: UUID) -> CameraAlignment | None:
        result = await self.db.execute(
            select(CameraAlignment).where(CameraAlignment.capture_id == capture_id)
        )
        return result.scalar_one_or_none()

    async def _get_camera_poses(self, alignment_id: UUID) -> list[CameraPose]:
        result = await self.db.execute(
            select(CameraPose).where(CameraPose.alignment_id == alignment_id)
        )
        return list(result.scalars().all())

    async def _get_elements_with_geometry(self, bim_model_id: UUID) -> list[BIMElement]:
        """Load elements that have either mesh or bbox geometry."""
        result = await self.db.execute(
            select(BIMElement)
            .where(
                BIMElement.bim_model_id == bim_model_id,
                # At least one of mesh or bbox must exist
                (BIMElement.geometry_mesh.isnot(None)) | (BIMElement.geometry_bbox.isnot(None)),
            )
        )
        return list(result.scalars().all())

    # ── Geometry helpers ─────────────────────────────────────────────────

    def _build_intrinsics(self, config: BIMRendererConfig) -> np.ndarray:
        """Build camera intrinsic matrix."""
        fx = config.image_width / (2 * np.tan(np.radians(config.fov_degrees / 2)))
        fy = fx
        cx = config.image_width / 2
        cy = config.image_height / 2
        return np.array([
            [fx, 0, cx],
            [0, fy, cy],
            [0,  0,  1],
        ])

    def _bbox_to_corners(self, bbox: dict) -> list[list[float]]:
        """Convert min/max bounding box to 8 corner points."""
        mn = bbox["min"]
        mx = bbox["max"]
        return [
            [mn[0], mn[1], mn[2]],
            [mx[0], mn[1], mn[2]],
            [mx[0], mx[1], mn[2]],
            [mn[0], mx[1], mn[2]],
            [mn[0], mn[1], mx[2]],
            [mx[0], mn[1], mx[2]],
            [mx[0], mx[1], mx[2]],
            [mn[0], mx[1], mx[2]],
        ]

    def _quaternion_to_rotation(self, quat: list[float]) -> np.ndarray:
        """Convert [qw, qx, qy, qz] quaternion to 3x3 rotation matrix."""
        w, x, y, z = quat
        return np.array([
            [1 - 2*(y*y + z*z),     2*(x*y - z*w),     2*(x*z + y*w)],
            [    2*(x*y + z*w), 1 - 2*(x*x + z*z),     2*(y*z - x*w)],
            [    2*(x*z - y*w),     2*(y*z + x*w), 1 - 2*(x*x + y*y)],
        ])

    def _project_to_image(
        self,
        points_cam: np.ndarray,
        K: np.ndarray,
        config: BIMRendererConfig,
    ) -> np.ndarray | None:
        """Project 3D camera-space points to 2D image coordinates."""
        valid = points_cam[:, 2] > config.near_clip
        if not np.any(valid):
            return None

        projected = []
        for p in points_cam:
            if p[2] <= config.near_clip:
                p = p.copy()
                p[2] = config.near_clip

            px = K @ p
            px = px[:2] / px[2]
            projected.append(px)

        return np.array(projected)

    def _render_element_mask(
        self,
        projected_corners: np.ndarray,
        config: BIMRendererConfig,
    ) -> np.ndarray:
        """Render a binary mask from projected 3D bounding box corners."""
        mask = Image.new("L", (config.image_width, config.image_height), 0)
        draw = ImageDraw.Draw(mask)

        points = projected_corners.astype(int).tolist()
        hull_points = self._convex_hull(points)
        if len(hull_points) >= 3:
            draw.polygon([tuple(p) for p in hull_points], fill=255)

        return np.array(mask)

    def _convex_hull(self, points: list[list[int]]) -> list[list[int]]:
        """Simple convex hull (Graham scan) for 2D points."""
        points = sorted(set(tuple(p) for p in points))
        if len(points) <= 2:
            return [list(p) for p in points]

        def cross(o, a, b):
            return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

        lower = []
        for p in points:
            while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
                lower.pop()
            lower.append(p)

        upper = []
        for p in reversed(points):
            while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
                upper.pop()
            upper.append(p)

        return [list(p) for p in lower[:-1] + upper[:-1]]
