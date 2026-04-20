"""API v1 — aggregate all sub-routers."""

import time
from datetime import UTC

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.bim import router as bim_router
from app.api.v1.captures import router as captures_router
from app.api.v1.cv_pipeline import router as cv_router
from app.api.v1.pipeline import router as pipeline_router
from app.api.v1.procore import router as procore_router
from app.api.v1.projects import router as projects_router
from app.api.v1.reports import router as reports_router
from app.api.v1.schedules import router as schedules_router
from app.core.config import get_settings
from app.core.database import get_db
from app.schemas import DashboardStats, HealthResponse, InvestorDashboard, ServiceStatus

_START_TIME = time.time()

api_router = APIRouter()


# ── System capabilities ────────────────────────────────────────────────

@api_router.get("/system/capabilities", tags=["system"])
async def system_capabilities():
    """
    Check availability of ML and CV dependencies required for real pipeline.
    Returns per-component status so the frontend can show the correct mode banner.
    """
    import shutil

    caps: dict = {}

    # ── PyTorch ──────────────────────────────────────────────────────
    try:
        import torch
        device = "cpu"
        if torch.cuda.is_available():
            device = f"cuda ({torch.cuda.get_device_name(0)})"
        elif torch.backends.mps.is_available():
            device = "mps (Apple Metal)"
        caps["torch"] = {
            "available": True,
            "version": torch.__version__,
            "device": device,
        }
    except ImportError:
        caps["torch"] = {
            "available": False,
            "install": "pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu",
        }

    # ── HuggingFace transformers ──────────────────────────────────────
    try:
        import transformers
        caps["transformers"] = {"available": True, "version": transformers.__version__}
    except ImportError:
        caps["transformers"] = {
            "available": False,
            "install": "pip install transformers accelerate",
        }

    # ── COLMAP ────────────────────────────────────────────────────────
    colmap_path = shutil.which("colmap")
    caps["colmap"] = {
        "available": colmap_path is not None,
        "path": colmap_path,
        "install": "brew install colmap  # macOS" if not colmap_path else None,
    }

    # ── FFmpeg ────────────────────────────────────────────────────────
    ffmpeg_path = shutil.which("ffmpeg")
    caps["ffmpeg"] = {
        "available": ffmpeg_path is not None,
        "path": ffmpeg_path,
        "install": "brew install ffmpeg  # macOS" if not ffmpeg_path else None,
    }

    # ── pyrender / trimesh (BIM mesh rendering) ───────────────────────
    try:
        import pyrender  # noqa: F401
        import trimesh  # noqa: F401
        caps["bim_mesh_renderer"] = {"available": True}
    except ImportError:
        caps["bim_mesh_renderer"] = {
            "available": False,
            "install": "pip install pyrender trimesh PyOpenGL",
        }

    # ── Overall pipeline mode ─────────────────────────────────────────
    can_run_real = (
        caps["torch"]["available"]
        and caps["transformers"]["available"]
        and caps["ffmpeg"]["available"]
    )
    caps["pipeline_mode"] = "real" if can_run_real else "mock_required"
    caps["alignment_mode"] = (
        "colmap_or_manual" if caps["colmap"]["available"] else "manual_only"
    )

    return caps


# ── Health check ───────────────────────────────────────────────────────

@api_router.get("/health", response_model=HealthResponse, tags=["system"])
async def health(db: AsyncSession = Depends(get_db)):
    uptime = time.time() - _START_TIME
    db_status = ServiceStatus(status="ok")
    redis_status = ServiceStatus(status="ok")

    # Check database
    try:
        t0 = time.time()
        await db.execute(text("SELECT 1"))
        db_status.latency_ms = round((time.time() - t0) * 1000, 1)
    except Exception as e:
        db_status = ServiceStatus(status="error", error=str(e))

    # Check Redis
    try:
        import redis as redis_lib
        settings = get_settings()
        t0 = time.time()
        r = redis_lib.from_url(settings.redis_url, socket_connect_timeout=2)
        r.ping()
        redis_status.latency_ms = round((time.time() - t0) * 1000, 1)
        r.close()
    except Exception as e:
        redis_status = ServiceStatus(status="error", error=str(e))

    overall = "healthy" if db_status.status == "ok" and redis_status.status == "ok" else "degraded"

    return HealthResponse(
        status=overall,
        version="0.1.0",
        database=db_status,
        redis=redis_status,
        uptime_seconds=round(uptime, 1),
    )


# ── Dashboard stats ────────────────────────────────────────────────────

@api_router.get("/stats", response_model=DashboardStats, tags=["system"])
async def dashboard_stats(db: AsyncSession = Depends(get_db)):
    counts = {}
    for table in ["projects", "bim_models", "schedules", "video_captures", "progress_items", "reports"]:
        result = await db.execute(text(f"SELECT COUNT(*) FROM {table}"))  # noqa: S608
        counts[table] = result.scalar() or 0
    return DashboardStats(
        projects=counts["projects"],
        bim_models=counts["bim_models"],
        schedules=counts["schedules"],
        captures=counts["video_captures"],
        progress_items=counts["progress_items"],
        reports=counts["reports"],
    )


@api_router.get("/stats/dashboard", response_model=InvestorDashboard, tags=["system"])
async def investor_dashboard(db: AsyncSession = Depends(get_db)):
    """Rich analytics for investor / executive dashboard.

    Returns: KPI bar, deviation donut, per-project health scores,
    top 5 most critical behind-schedule elements.
    """
    from datetime import datetime

    from sqlalchemy import func, select

    from app.models import (
        Activity,
        BIMElement,
        DeviationType,
        ProgressItem,
        Project,
        VideoCapture,
    )
    from app.schemas import (
        CriticalElement,
        DeviationBreakdown,
        ProjectHealthCard,
    )

    now = datetime.now(UTC)

    # ── Global deviation counts ────────────────────────────────────────
    dev_rows = (await db.execute(
        select(ProgressItem.deviation_type, func.count().label("cnt"))
        .group_by(ProgressItem.deviation_type)
    )).all()

    dev_map = {str(r.deviation_type.value if hasattr(r.deviation_type, "value") else r.deviation_type): r.cnt
               for r in dev_rows}

    breakdown = DeviationBreakdown(
        ahead=dev_map.get("ahead", 0),
        on_track=dev_map.get("on_track", 0),
        behind=dev_map.get("behind", 0),
        not_started=dev_map.get("not_started", 0),
        extra_work=dev_map.get("extra_work", 0),
        total=sum(dev_map.values()),
    )

    elements_at_risk = breakdown.behind + breakdown.not_started

    # ── Per-project health scores ──────────────────────────────────────
    projects_result = (await db.execute(
        select(Project).order_by(Project.created_at.desc())
    )).scalars().all()

    health_cards: list[ProjectHealthCard] = []
    for proj in projects_result:
        # Direct join through capture → project
        proj_counts_result = (await db.execute(
            select(ProgressItem.deviation_type, func.count().label("cnt"))
            .join(VideoCapture, ProgressItem.capture_id == VideoCapture.id)
            .where(VideoCapture.project_id == proj.id)
            .group_by(ProgressItem.deviation_type)
        )).all()

        proj_dev = {str(r.deviation_type.value if hasattr(r.deviation_type, "value") else r.deviation_type): r.cnt
                    for r in proj_counts_result}

        total = sum(proj_dev.values())
        behind = proj_dev.get("behind", 0)
        not_started = proj_dev.get("not_started", 0)
        ahead = proj_dev.get("ahead", 0)
        on_track = proj_dev.get("on_track", 0)

        # Health score: weighted formula
        if total == 0:
            health_score = 100.0
        else:
            positive = (ahead + on_track) / total * 100
            negative = (behind * 1.5 + not_started * 0.8) / total * 100
            health_score = max(0.0, min(100.0, positive - negative * 0.5 + 50))

        if health_score >= 70:
            health_label = "Healthy"
        elif health_score >= 45:
            health_label = "At Risk"
        else:
            health_label = "Critical"

        # Last capture date
        last_cap = (await db.execute(
            select(VideoCapture.created_at)
            .where(VideoCapture.project_id == proj.id)
            .order_by(VideoCapture.created_at.desc())
            .limit(1)
        )).scalar_one_or_none()

        health_cards.append(ProjectHealthCard(
            id=str(proj.id),
            name=proj.name,
            code=proj.code,
            health_score=round(health_score, 1),
            health_label=health_label,
            behind_count=behind + not_started,
            total_elements=total,
            last_capture_at=last_cap,
        ))

    # ── Top 5 critical elements ────────────────────────────────────────
    critical_rows = (await db.execute(
        select(
            ProgressItem.observed_percent,
            ProgressItem.scheduled_percent,
            ProgressItem.deviation_days,
            BIMElement.name.label("element_name"),
            BIMElement.ifc_type,
            Project.name.label("project_name"),
            Project.id.label("project_id"),
            Activity.name.label("activity_name"),
            Activity.is_critical.label("is_critical"),
        )
        .join(BIMElement, ProgressItem.element_id == BIMElement.id)
        .join(VideoCapture, ProgressItem.capture_id == VideoCapture.id)
        .join(Project, VideoCapture.project_id == Project.id)
        .outerjoin(Activity, ProgressItem.activity_id == Activity.id)
        .where(ProgressItem.deviation_type.in_([
            DeviationType.BEHIND, DeviationType.NOT_STARTED
        ]))
        .order_by(
            Activity.is_critical.desc().nullslast(),
            ProgressItem.deviation_days.desc().nullslast(),
        )
        .limit(5)
    )).all()

    critical_elements = [
        CriticalElement(
            element_name=r.element_name or "Unknown",
            ifc_type=r.ifc_type or "",
            project_name=r.project_name,
            project_id=str(r.project_id),
            deviation_days=r.deviation_days,
            observed_percent=r.observed_percent,
            scheduled_percent=r.scheduled_percent,
            activity_name=r.activity_name,
            is_critical_path=bool(r.is_critical),
        )
        for r in critical_rows
    ]

    avg_health = (
        sum(c.health_score for c in health_cards) / len(health_cards)
        if health_cards else 0.0
    )

    return InvestorDashboard(
        total_projects=len(projects_result),
        total_elements_analyzed=breakdown.total,
        avg_health_score=round(avg_health, 1),
        elements_at_risk=elements_at_risk,
        deviation_breakdown=breakdown,
        projects=health_cards,
        critical_elements=critical_elements,
        generated_at=now,
    )


@api_router.get("/stats/progress-timeline", tags=["system"])
async def progress_timeline(
    project_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Time-series progress data for S-curve chart.

    Returns per-capture averages of observed vs scheduled percent,
    used to render the Actual vs Planned S-curve on the dashboard.
    """
    from sqlalchemy import func, select

    from app.models import ProgressItem, VideoCapture

    query = (
        select(
            VideoCapture.id.label("capture_id"),
            VideoCapture.created_at.label("captured_at"),
            func.avg(ProgressItem.observed_percent).label("avg_actual"),
            func.avg(ProgressItem.scheduled_percent).label("avg_planned"),
            func.count(ProgressItem.id).label("element_count"),
        )
        .join(ProgressItem, ProgressItem.capture_id == VideoCapture.id)
        .group_by(VideoCapture.id, VideoCapture.created_at)
        .order_by(VideoCapture.created_at)
    )

    if project_id:
        import uuid as _uuid
        try:
            pid = _uuid.UUID(project_id)
            query = query.where(VideoCapture.project_id == pid)
        except ValueError:
            pass

    rows = (await db.execute(query)).all()

    return [
        {
            "date": row.captured_at.strftime("%Y-%m-%d"),
            "actual": round(float(row.avg_actual), 1),
            "planned": round(float(row.avg_planned), 1),
            "elements": int(row.element_count),
        }
        for row in rows
    ]


# Sub-routers
api_router.include_router(projects_router)
api_router.include_router(bim_router)
api_router.include_router(schedules_router)
api_router.include_router(captures_router)
api_router.include_router(cv_router)
api_router.include_router(pipeline_router)
api_router.include_router(reports_router)
api_router.include_router(procore_router)
