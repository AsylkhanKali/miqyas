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
    task_routes={
        "app.tasks.ifc_tasks.*": {"queue": "parsing"},
        "app.tasks.p6_tasks.*": {"queue": "parsing"},
        "app.tasks.video_tasks.*": {"queue": "video"},
        "app.tasks.cv_tasks.*": {"queue": "gpu"},
        "app.tasks.procore_tasks.*": {"queue": "default"},
    },
)

import app.tasks.ifc_tasks       # noqa: F401
import app.tasks.p6_tasks        # noqa: F401
import app.tasks.video_tasks     # noqa: F401
import app.tasks.cv_tasks        # noqa: F401
import app.tasks.pipeline        # noqa: F401
import app.tasks.procore_tasks   # noqa: F401
