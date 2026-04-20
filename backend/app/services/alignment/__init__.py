"""
Manual Alignment Service — camera-to-BIM registration via control points.

Fallback when COLMAP reconstruction fails or is unreliable.
User picks corresponding points in a video frame (2D) and the BIM model (3D),
then we solve the Perspective-n-Point (PnP) problem to get the camera pose.

Minimum 6 point correspondences required for robust results.

The resulting transformation matrix maps from camera coordinates to BIM coordinates.
"""

import logging
from uuid import UUID

import numpy as np
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AlignmentMethod,
    CameraAlignment,
    VideoCapture,
    VideoStatus,
)

logger = logging.getLogger(__name__)


class ControlPoint:
    """A 2D-3D point correspondence."""

    def __init__(
        self,
        pixel_x: float,
        pixel_y: float,
        bim_x: float,
        bim_y: float,
        bim_z: float,
        label: str = "",
    ):
        self.pixel = np.array([pixel_x, pixel_y])
        self.bim = np.array([bim_x, bim_y, bim_z])
        self.label = label

    def to_dict(self) -> dict:
        return {
            "pixel": [float(self.pixel[0]), float(self.pixel[1])],
            "bim": [float(self.bim[0]), float(self.bim[1]), float(self.bim[2])],
            "label": self.label,
        }


class ManualAlignmentService:
    """Computes camera-to-BIM transformation from manually picked control points."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # Minimum control points for a robust PnP solution
    MIN_CONTROL_POINTS = 6

    async def align(
        self,
        capture_id: UUID,
        control_points: list[ControlPoint],
        image_width: int,
        image_height: int,
        fov_degrees: float = 90.0,
    ) -> CameraAlignment:
        """
        Compute alignment from control point correspondences.

        Args:
            capture_id: Video capture to align
            control_points: List of 2D-3D correspondences (minimum 6)
            image_width: Width of the frame image in pixels
            image_height: Height of the frame image in pixels
            fov_degrees: Estimated horizontal field of view

        Returns:
            CameraAlignment record with transformation matrix
        """
        if len(control_points) < self.MIN_CONTROL_POINTS:
            raise ValueError(
                f"Need at least {self.MIN_CONTROL_POINTS} control points for robust alignment, "
                f"got {len(control_points)}. "
                "Tip: pick corners of walls, columns, door frames, or window edges "
                "that are clearly identifiable in both the video frame and the BIM model."
            )

        capture = await self.db.get(VideoCapture, capture_id)
        if not capture:
            raise ValueError(f"VideoCapture {capture_id} not found")

        # Build camera intrinsic matrix
        fx = image_width / (2 * np.tan(np.radians(fov_degrees / 2)))
        fy = fx  # square pixels assumed
        cx, cy = image_width / 2, image_height / 2
        camera_matrix = np.array([
            [fx, 0, cx],
            [0, fy, cy],
            [0,  0,  1],
        ], dtype=np.float64)

        # Solve PnP
        points_2d = np.array([cp.pixel for cp in control_points], dtype=np.float64)
        points_3d = np.array([cp.bim for cp in control_points], dtype=np.float64)

        success, rvec, tvec, reprojection_error = self._solve_pnp(
            points_3d, points_2d, camera_matrix
        )

        if not success:
            raise RuntimeError("PnP solver failed — check control point quality")

        # Convert rotation vector to matrix, then build 4x4 transform
        R = self._rodrigues(rvec)
        transform_4x4 = np.eye(4)
        transform_4x4[:3, :3] = R
        transform_4x4[:3, 3] = tvec.flatten()

        # Compute scale from control points
        scale = self._estimate_scale(points_3d, R, tvec)

        # Per-point reprojection errors for diagnostics
        per_point_errors = self._compute_per_point_errors(
            points_3d, points_2d, R, tvec, camera_matrix
        )
        control_points_with_errors = []
        for cp, err in zip(control_points, per_point_errors):
            d = cp.to_dict()
            d["reprojection_error_px"] = round(float(err), 2)
            control_points_with_errors.append(d)

        # Quality assessment
        quality_grade, quality_warnings = self._assess_alignment_quality(
            reprojection_error, per_point_errors, len(control_points)
        )

        # Persist alignment
        alignment = CameraAlignment(
            capture_id=capture_id,
            method=AlignmentMethod.MANUAL,
            transformation_matrix=transform_4x4.tolist(),
            scale_factor=float(scale),
            control_points=control_points_with_errors,
            reprojection_error=float(reprojection_error),
            registered_images=None,
            total_input_images=None,
            registration_ratio=None,
            quality_grade=quality_grade,
            quality_warnings=quality_warnings,
            is_validated=False,
        )
        self.db.add(alignment)

        capture.status = VideoStatus.ALIGNED
        await self.db.flush()

        logger.info(
            f"Manual alignment complete: {len(control_points)} control points, "
            f"reprojection error: {reprojection_error:.2f}px, quality: {quality_grade}"
        )
        return alignment

    def _compute_per_point_errors(
        self,
        points_3d: np.ndarray,
        points_2d: np.ndarray,
        R: np.ndarray,
        t: np.ndarray,
        K: np.ndarray,
    ) -> list[float]:
        """Compute reprojection error for each individual control point."""
        projected = self._project_points(points_3d, R, t, K)
        return [float(np.linalg.norm(projected[i] - points_2d[i])) for i in range(len(points_2d))]

    def _assess_alignment_quality(
        self,
        mean_error: float,
        per_point_errors: list[float],
        num_points: int,
    ) -> tuple[str, list[str]]:
        """
        Assess manual alignment quality.

        Returns (grade, warnings) where grade is:
          "good"       — mean reproj <3px, no outliers
          "acceptable" — mean reproj <8px
          "poor"       — mean reproj >=8px or outlier points
        """
        warnings: list[str] = []

        if mean_error < 3.0:
            grade = "good"
        elif mean_error < 8.0:
            grade = "acceptable"
        else:
            grade = "poor"
            warnings.append(
                f"Mean reprojection error is {mean_error:.1f}px — alignment is inaccurate. "
                "Try re-picking control points on sharper features (wall corners, column edges)."
            )

        # Check for outlier points (>3x mean error)
        if mean_error > 0:
            outliers = [
                (i, err) for i, err in enumerate(per_point_errors)
                if err > max(mean_error * 3, 10.0)
            ]
            if outliers:
                if grade == "good":
                    grade = "acceptable"
                for idx, err in outliers:
                    warnings.append(
                        f"Control point #{idx + 1} has high error ({err:.1f}px) — "
                        "consider removing or re-picking it."
                    )

        if num_points < 8:
            warnings.append(
                f"Only {num_points} control points used. "
                "Adding more points (8+) improves robustness, especially spread across the frame."
            )

        return grade, warnings

    def _solve_pnp(
        self,
        points_3d: np.ndarray,
        points_2d: np.ndarray,
        camera_matrix: np.ndarray,
    ) -> tuple[bool, np.ndarray, np.ndarray, float]:
        """
        Solve PnP using Direct Linear Transform (DLT) + iterative refinement.
        Pure numpy implementation — no OpenCV dependency.
        """
        n = len(points_3d)

        # Normalize 2D points
        mean_2d = points_2d.mean(axis=0)
        std_2d = points_2d.std()
        if std_2d < 1e-10:
            return False, np.zeros(3), np.zeros(3), float("inf")

        T_norm = np.array([
            [1/std_2d, 0, -mean_2d[0]/std_2d],
            [0, 1/std_2d, -mean_2d[1]/std_2d],
            [0, 0, 1],
        ])
        pts_2d_norm = (T_norm @ np.hstack([points_2d, np.ones((n, 1))]).T).T

        # Build DLT system
        A = []
        for i in range(n):
            X, Y, Z = points_3d[i]
            u, v, _ = pts_2d_norm[i]
            A.append([X, Y, Z, 1, 0, 0, 0, 0, -u*X, -u*Y, -u*Z, -u])
            A.append([0, 0, 0, 0, X, Y, Z, 1, -v*X, -v*Y, -v*Z, -v])

        A = np.array(A)
        _, _, Vt = np.linalg.svd(A)
        P_norm = Vt[-1].reshape(3, 4)

        # Denormalize
        K_inv = np.linalg.inv(camera_matrix)
        P = np.linalg.inv(T_norm) @ P_norm
        M = K_inv @ P[:, :3]

        # Extract R and t via SVD
        U, S, Vt = np.linalg.svd(M)
        R = U @ Vt
        if np.linalg.det(R) < 0:
            R = -R

        t = K_inv @ P[:, 3] / S[0]

        # Convert to rotation vector
        rvec = self._rotation_to_rodrigues(R)

        # Compute reprojection error
        projected = self._project_points(points_3d, R, t, camera_matrix)
        errors = np.linalg.norm(projected - points_2d, axis=1)
        mean_error = float(np.mean(errors))

        return True, rvec, t, mean_error

    def _rodrigues(self, rvec: np.ndarray) -> np.ndarray:
        """Convert rotation vector to rotation matrix (Rodrigues formula)."""
        theta = np.linalg.norm(rvec)
        if theta < 1e-10:
            return np.eye(3)

        k = rvec / theta
        K = np.array([
            [0, -k[2], k[1]],
            [k[2], 0, -k[0]],
            [-k[1], k[0], 0],
        ])
        R = np.eye(3) + np.sin(theta) * K + (1 - np.cos(theta)) * (K @ K)
        return R

    def _rotation_to_rodrigues(self, R: np.ndarray) -> np.ndarray:
        """Convert rotation matrix to rotation vector."""
        theta = np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1))
        if theta < 1e-10:
            return np.zeros(3)

        k = np.array([
            R[2, 1] - R[1, 2],
            R[0, 2] - R[2, 0],
            R[1, 0] - R[0, 1],
        ]) / (2 * np.sin(theta))

        return k * theta

    def _project_points(
        self,
        points_3d: np.ndarray,
        R: np.ndarray,
        t: np.ndarray,
        K: np.ndarray,
    ) -> np.ndarray:
        """Project 3D points to 2D using camera parameters."""
        projected = []
        for pt in points_3d:
            p_cam = R @ pt + t.flatten()
            if abs(p_cam[2]) < 1e-10:
                projected.append([0, 0])
                continue
            p_norm = p_cam[:2] / p_cam[2]
            p_px = K[:2, :2] @ p_norm + K[:2, 2]
            projected.append(p_px)
        return np.array(projected)

    def _estimate_scale(
        self,
        points_3d: np.ndarray,
        R: np.ndarray,
        t: np.ndarray,
    ) -> float:
        """Estimate scale factor from 3D point distances."""
        if len(points_3d) < 2:
            return 1.0

        # Compare BIM distances to camera-frame distances
        bim_dists = []
        cam_dists = []
        for i in range(len(points_3d)):
            for j in range(i + 1, len(points_3d)):
                bim_dists.append(np.linalg.norm(points_3d[i] - points_3d[j]))
                p_i = R @ points_3d[i] + t.flatten()
                p_j = R @ points_3d[j] + t.flatten()
                cam_dists.append(np.linalg.norm(p_i - p_j))

        bim_dists = np.array(bim_dists)
        cam_dists = np.array(cam_dists)

        valid = cam_dists > 1e-10
        if not valid.any():
            return 1.0

        return float(np.median(bim_dists[valid] / cam_dists[valid]))
