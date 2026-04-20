"""Video capture upload, processing, and alignment router."""

from uuid import UUID

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.models import CameraAlignment, Frame, Project, VideoCapture, VideoStatus
from app.schemas import VideoCaptureResponse

router = APIRouter(prefix="/projects/{project_id}/captures", tags=["captures"])
settings = get_settings()

ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}


# ── Schemas ──────────────────────────────────────────────────────────────

class ProcessVideoRequest(BaseModel):
    frame_interval_seconds: float = 1.0
    generate_cubemaps: bool = True
    cubemap_face_size: int = 1024


class ControlPointInput(BaseModel):
    pixel_x: float
    pixel_y: float
    bim_x: float
    bim_y: float
    bim_z: float
    label: str = ""


class ManualAlignRequest(BaseModel):
    control_points: list[ControlPointInput]
    image_width: int = 1920
    image_height: int = 960
    fov_degrees: float = 90.0


class ColmapRequest(BaseModel):
    matching_type: str = "sequential"
    max_num_features: int = 8192
    gpu_index: str = "-1"


class FrameResponse(BaseModel):
    id: str
    frame_number: int
    timestamp_seconds: float
    equirect_path: str
    is_keyframe: bool
    quality_score: float | None

    class Config:
        from_attributes = True


class AlignmentResponse(BaseModel):
    id: str
    method: str
    scale_factor: float
    reprojection_error: float | None
    registered_images: int | None = None
    total_input_images: int | None = None
    registration_ratio: float | None = None
    quality_grade: str | None = None
    quality_warnings: list[str] | None = None
    is_validated: bool
    control_points: list | None = None

    class Config:
        from_attributes = True


# ── Upload ───────────────────────────────────────────────────────────────

@router.post("/upload", response_model=VideoCaptureResponse, status_code=status.HTTP_201_CREATED)
async def upload_video(
    project_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    project = await db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename required")

    ext = "." + file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Only {ALLOWED_VIDEO_EXTENSIONS} accepted")

    storage_dir = settings.video_storage_dir / str(project_id)
    storage_dir.mkdir(parents=True, exist_ok=True)
    dest = storage_dir / file.filename

    async with aiofiles.open(dest, "wb") as f:
        content = await file.read()
        await f.write(content)

    capture = VideoCapture(
        project_id=project_id,
        filename=file.filename,
        storage_path=str(dest),
        file_size_bytes=len(content),
        status=VideoStatus.UPLOADED,
    )
    db.add(capture)
    await db.flush()
    await db.refresh(capture)

    return capture


# ── List & Get ───────────────────────────────────────────────────────────

@router.get("/", response_model=list[VideoCaptureResponse])
async def list_captures(project_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(VideoCapture)
        .where(VideoCapture.project_id == project_id)
        .order_by(VideoCapture.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{capture_id}", response_model=VideoCaptureResponse)
async def get_capture(project_id: UUID, capture_id: UUID, db: AsyncSession = Depends(get_db)):
    capture = await db.get(VideoCapture, capture_id)
    if not capture:
        raise HTTPException(status_code=404, detail="Capture not found")
    return capture


# ── Frame Extraction ─────────────────────────────────────────────────────

@router.post("/{capture_id}/process")
async def process_video(
    project_id: UUID,
    capture_id: UUID,
    body: ProcessVideoRequest | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Trigger frame extraction (async via Celery)."""
    capture = await db.get(VideoCapture, capture_id)
    if not capture:
        raise HTTPException(status_code=404, detail="Capture not found")

    if capture.status not in (VideoStatus.UPLOADED, VideoStatus.FAILED):
        raise HTTPException(status_code=400, detail=f"Cannot process capture in status: {capture.status}")

    # Dispatch Celery task
    from app.tasks.video_tasks import extract_frames_task
    params = body or ProcessVideoRequest()
    task = extract_frames_task.delay(
        str(capture_id),
        params.frame_interval_seconds,
        params.generate_cubemaps,
        params.cubemap_face_size,
    )

    return {"task_id": task.id, "status": "processing", "capture_id": str(capture_id)}


# ── Frames ───────────────────────────────────────────────────────────────

@router.get("/{capture_id}/frames", response_model=list[FrameResponse])
async def list_frames(
    project_id: UUID,
    capture_id: UUID,
    keyframes_only: bool = False,
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    query = select(Frame).where(Frame.capture_id == capture_id)
    if keyframes_only:
        query = query.where(Frame.is_keyframe)
    query = query.order_by(Frame.frame_number).offset(skip).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


# ── COLMAP Reconstruction ────────────────────────────────────────────────

@router.post("/{capture_id}/colmap")
async def run_colmap(
    project_id: UUID,
    capture_id: UUID,
    body: ColmapRequest | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Trigger COLMAP reconstruction (async via Celery)."""
    capture = await db.get(VideoCapture, capture_id)
    if not capture:
        raise HTTPException(status_code=404, detail="Capture not found")

    if capture.status != VideoStatus.FRAMES_EXTRACTED:
        raise HTTPException(status_code=400, detail="Frames must be extracted first")

    from app.tasks.video_tasks import colmap_reconstruct_task
    params = body or ColmapRequest()
    task = colmap_reconstruct_task.delay(
        str(capture_id),
        params.matching_type,
        params.max_num_features,
        params.gpu_index,
    )

    return {
        "task_id": task.id,
        "status": "reconstructing",
        "capture_id": str(capture_id),
        "fallback_hint": "If COLMAP fails, use manual alignment: POST /captures/{id}/align-manual",
    }


# ── Manual Alignment ─────────────────────────────────────────────────────

@router.post("/{capture_id}/align-manual", response_model=AlignmentResponse)
async def manual_align(
    project_id: UUID,
    capture_id: UUID,
    body: ManualAlignRequest,
    db: AsyncSession = Depends(get_db),
):
    """Compute camera-to-BIM alignment from manually picked control points."""
    if len(body.control_points) < 6:
        raise HTTPException(
            status_code=400,
            detail=(
                "Need at least 6 control points for robust alignment. "
                "Pick corners of walls, columns, door frames, or window edges "
                "that are clearly identifiable in both the video frame and BIM model."
            ),
        )

    from app.services.alignment import ControlPoint, ManualAlignmentService

    points = [
        ControlPoint(
            pixel_x=cp.pixel_x, pixel_y=cp.pixel_y,
            bim_x=cp.bim_x, bim_y=cp.bim_y, bim_z=cp.bim_z,
            label=cp.label,
        )
        for cp in body.control_points
    ]

    service = ManualAlignmentService(db)
    alignment = await service.align(
        capture_id=capture_id,
        control_points=points,
        image_width=body.image_width,
        image_height=body.image_height,
        fov_degrees=body.fov_degrees,
    )

    return alignment


# ── Alignment Status ─────────────────────────────────────────────────────

@router.get("/{capture_id}/alignment", response_model=AlignmentResponse | None)
async def get_alignment(
    project_id: UUID,
    capture_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CameraAlignment).where(CameraAlignment.capture_id == capture_id)
    )
    return result.scalar_one_or_none()


@router.get("/{capture_id}/reprojection")
async def get_reprojection(
    project_id: UUID,
    capture_id: UUID,
    bim_model_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Project BIM element bounding boxes onto the video frame using stored alignment.

    Returns a list of elements with their 2D projected polygon (8 corners → convex hull),
    plus deviation/progress info for colour-coding in the frontend overlay.
    """
    import numpy as np
    from sqlalchemy import select

    from app.models import BIMElement, ProgressItem

    # ── Load alignment ────────────────────────────────────────────────────
    result = await db.execute(
        select(CameraAlignment).where(CameraAlignment.capture_id == capture_id)
    )
    alignment = result.scalar_one_or_none()
    if not alignment:
        raise HTTPException(status_code=404, detail="No alignment found. Run manual alignment first.")

    # Parse transformation matrix → R, t, K
    T = np.array(alignment.transformation_matrix, dtype=np.float64)
    R = T[:3, :3]
    t = T[:3, 3]

    # Re-derive intrinsics from stored control points (or use sensible defaults)
    cp_list = alignment.control_points or []
    if cp_list:
        # Try to infer image size from pixel range in control points
        max_px = max((cp.get("pixel", [0, 0])[0] for cp in cp_list), default=1920)
        max_py = max((cp.get("pixel", [0, 0])[1] for cp in cp_list), default=960)
        img_w = int(max(max_px * 1.1, 1280))
        img_h = int(max(max_py * 1.1, 720))
    else:
        img_w, img_h = 1920, 960

    fov = 90.0
    fx = img_w / (2 * np.tan(np.radians(fov / 2)))
    K = np.array([[fx, 0, img_w / 2], [0, fx, img_h / 2], [0, 0, 1]], dtype=np.float64)

    def project_3d(x: float, y: float, z: float):
        """Project a single 3D BIM point to 2D pixel coordinates."""
        p_cam = R @ np.array([x, y, z]) + t
        if abs(p_cam[2]) < 1e-6:
            return None
        if p_cam[2] < 0:  # behind camera
            return None
        px = float(K[0, 0] * p_cam[0] / p_cam[2] + K[0, 2])
        py = float(K[1, 1] * p_cam[1] / p_cam[2] + K[1, 2])
        return [px, py]

    def bbox_corners(bbox: dict):
        """Return the 8 corners of an axis-aligned bounding box."""
        mn = bbox.get("min", [0, 0, 0])
        mx = bbox.get("max", [0, 0, 0])
        return [
            [mn[0], mn[1], mn[2]], [mx[0], mn[1], mn[2]],
            [mn[0], mx[1], mn[2]], [mx[0], mx[1], mn[2]],
            [mn[0], mn[1], mx[2]], [mx[0], mn[1], mx[2]],
            [mn[0], mx[1], mx[2]], [mx[0], mx[1], mx[2]],
        ]

    def convex_hull_2d(pts: list[list[float]]) -> list[list[float]]:
        """Minimal convex hull via Graham scan (for polygon outline)."""
        if len(pts) < 3:
            return pts
        pts = sorted(pts, key=lambda p: (p[0], p[1]))
        lower, upper = [], []
        for p in pts:
            while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
                lower.pop()
            lower.append(p)
        for p in reversed(pts):
            while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
                upper.pop()
            upper.append(p)
        hull = lower[:-1] + upper[:-1]
        return hull

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    # ── Load BIM elements ─────────────────────────────────────────────────
    elements_result = await db.execute(
        select(BIMElement)
        .where(BIMElement.bim_model_id == bim_model_id)
        .where(BIMElement.geometry_bbox.isnot(None))
        .limit(500)  # cap for performance
    )
    elements = elements_result.scalars().all()

    # ── Load progress items for this capture (for colour coding) ─────────
    progress_result = await db.execute(
        select(ProgressItem).where(ProgressItem.capture_id == capture_id)
    )
    progress_items = {str(pi.element_id): pi for pi in progress_result.scalars().all()}

    # ── Project each element ──────────────────────────────────────────────
    projected = []
    for el in elements:
        if not el.geometry_bbox:
            continue

        corners_3d = bbox_corners(el.geometry_bbox)
        pts_2d = [project_3d(*c) for c in corners_3d]
        pts_2d = [p for p in pts_2d if p is not None]

        if len(pts_2d) < 2:
            continue  # fully behind camera

        # Keep only on-screen points for the hull
        on_screen = [
            p for p in pts_2d
            if -img_w * 0.5 <= p[0] <= img_w * 1.5 and -img_h * 0.5 <= p[1] <= img_h * 1.5
        ]
        if len(on_screen) < 2:
            continue

        hull = convex_hull_2d(on_screen) if len(on_screen) >= 3 else on_screen

        pi = progress_items.get(str(el.id))
        deviation_type = str(pi.deviation_type.value if hasattr(pi.deviation_type, "value") else pi.deviation_type) if pi else None

        projected.append({
            "element_id": str(el.id),
            "element_name": el.name or el.ifc_type,
            "ifc_type": el.ifc_type,
            "category": str(el.category.value if hasattr(el.category, "value") else el.category),
            "level": el.level,
            "polygon_2d": [[round(x, 1), round(y, 1)] for x, y in hull],
            "deviation_type": deviation_type,
            "observed_percent": float(pi.observed_percent) if pi else None,
            "scheduled_percent": float(pi.scheduled_percent) if pi else None,
            "confidence_score": float(pi.confidence_score) if pi else None,
            "narrative": pi.narrative if pi else None,
        })

    return {
        "capture_id": str(capture_id),
        "alignment_method": str(alignment.method.value if hasattr(alignment.method, "value") else alignment.method),
        "reprojection_error": alignment.reprojection_error,
        "quality_grade": alignment.quality_grade,
        "image_width": img_w,
        "image_height": img_h,
        "elements_total": len(elements),
        "elements_projected": len(projected),
        "projected_elements": projected,
    }


@router.get("/{capture_id}/alignment/quality")
async def get_alignment_quality(
    project_id: UUID,
    capture_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get detailed alignment quality assessment with actionable guidance."""
    result = await db.execute(
        select(CameraAlignment).where(CameraAlignment.capture_id == capture_id)
    )
    alignment = result.scalar_one_or_none()
    if not alignment:
        raise HTTPException(status_code=404, detail="No alignment found for this capture")

    response = {
        "method": alignment.method.value if hasattr(alignment.method, "value") else str(alignment.method),
        "quality_grade": alignment.quality_grade,
        "reprojection_error": alignment.reprojection_error,
        "warnings": alignment.quality_warnings or [],
        "is_validated": alignment.is_validated,
    }

    if alignment.method.value == "colmap":
        response["registered_images"] = alignment.registered_images
        response["total_input_images"] = alignment.total_input_images
        response["registration_ratio"] = alignment.registration_ratio
        if alignment.quality_grade in ("poor", "failed"):
            response["recommended_action"] = (
                "COLMAP alignment is unreliable. Try manual alignment instead: "
                "pick at least 6 clearly identifiable features (wall corners, column edges, "
                "door frames) in both the video frame and the BIM model."
            )
    else:
        response["control_point_count"] = len(alignment.control_points) if alignment.control_points else 0
        if alignment.quality_grade == "poor":
            response["recommended_action"] = (
                "Alignment quality is poor. Try re-picking control points on sharper features, "
                "or add more points (8+ recommended) spread across different areas of the frame."
            )

    return response
