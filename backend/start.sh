#!/bin/bash
set -e

# Start Celery worker in background.
#
# Memory constraints on Railway (shared container with FastAPI):
#   --concurrency=1        — single worker process; ifcopenshell can spike to
#                            300-500 MB per parse, two workers would OOM-kill.
#   --max-tasks-per-child=1 — restart the fork-worker after every task so
#                            ifcopenshell memory is fully freed between runs.
#   -O fair                — fair scheduling, prevents one big task starving others.
#
celery -A app.tasks.worker worker \
  --loglevel=info \
  --queues=default,parsing \
  --concurrency=1 \
  --max-tasks-per-child=1 \
  -O fair &

# Start FastAPI in foreground
exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
