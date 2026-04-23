"""Celery worker configuration."""

from celery import Celery

from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "miqyas",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,

    # ── Memory management (critical on Railway shared containers) ──────────
    # Restart the fork-worker process after it exceeds 450 MB RSS.
    # ifcopenshell can hold 200-400 MB after parsing; without recycling the
    # container accumulates until Railway sends SIGKILL (OOM).
    worker_max_memory_per_child=450_000,   # kilobytes = 450 MB

    # ── Global task time limits ────────────────────────────────────────────
    # IFC parsing can legitimately take several minutes on large files.
    task_time_limit=720,         # 12 min hard kill
    task_soft_time_limit=600,    # 10 min — raises SoftTimeLimitExceeded so
                                 # the task can log and clean up before kill

    task_routes={
        "app.tasks.ifc_tasks.*": {"queue": "parsing"},
        "app.tasks.p6_tasks.*": {"queue": "parsing"},
        "app.tasks.video_tasks.*": {"queue": "video"},
        "app.tasks.cv_tasks.*": {"queue": "gpu"},
        "app.tasks.procore_tasks.*": {"queue": "default"},
    },

    # Per-task tighter limits for lightweight tasks so they don't block the
    # single-concurrency worker for too long.
    task_annotations={
        "app.tasks.p6_tasks.parse_schedule": {
            "time_limit": 120,
            "soft_time_limit": 90,
        },
        "app.tasks.procore_tasks.*": {
            "time_limit": 60,
            "soft_time_limit": 45,
        },
    },
)

import app.tasks.ifc_tasks       # noqa: F401
import app.tasks.p6_tasks        # noqa: F401
import app.tasks.video_tasks     # noqa: F401
import app.tasks.cv_tasks        # noqa: F401
import app.tasks.pipeline        # noqa: F401
import app.tasks.procore_tasks   # noqa: F401
