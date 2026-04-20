#!/bin/sh
set -e

echo "=== MIQYAS startup ==="

# Wait for the database to accept connections (Railway PostgreSQL may not
# be ready immediately when this container starts).
echo "Waiting for database..."
MAX_RETRIES=30
i=0
until python -c "
import sys
from sqlalchemy import create_engine, text
from app.core.config import get_settings
try:
    e = create_engine(get_settings().database_url_sync)
    e.connect().execute(text('SELECT 1')).close()
    sys.exit(0)
except Exception as ex:
    print(f'  not ready: {ex}')
    sys.exit(1)
" 2>&1; do
    i=$((i + 1))
    if [ "$i" -ge "$MAX_RETRIES" ]; then
        echo "Database did not become ready after ${MAX_RETRIES} retries — aborting."
        exit 1
    fi
    sleep 2
done
echo "Database ready."

echo "Running migrations..."
alembic upgrade head
echo "Migrations complete."

echo "Starting uvicorn on port ${PORT:-8000}..."
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port "${PORT:-8000}" \
    --workers 1 \
    --log-level info
