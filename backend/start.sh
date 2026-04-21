#!/bin/bash
set -e

# Start Celery worker in background
celery -A app.tasks.worker worker --loglevel=info --queues=default,parsing --concurrency=2 &

# Start FastAPI in foreground
exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
