#!/usr/bin/env bash
set -euo pipefail

echo "=== MIQYAS Dev Environment Setup ==="

# 1. Start infrastructure
echo "[1/4] Starting PostgreSQL and Redis..."
docker compose -f docker/docker-compose.yml up -d postgres redis

# 2. Wait for Postgres
echo "[2/4] Waiting for PostgreSQL..."
until docker exec miqyas-postgres pg_isready -U miqyas > /dev/null 2>&1; do
    sleep 1
done
echo "  PostgreSQL is ready."

# 3. Run migrations
echo "[3/4] Running Alembic migrations..."
cd backend
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt
alembic upgrade head
cd ..

# 4. Start backend
echo "[4/4] Starting FastAPI server..."
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..

echo ""
echo "=== MIQYAS is running ==="
echo "  API:     http://localhost:8000"
echo "  Docs:    http://localhost:8000/docs"
echo "  ReDoc:   http://localhost:8000/redoc"
echo ""
echo "Press Ctrl+C to stop."

trap "kill $BACKEND_PID 2>/dev/null; echo 'Stopped.'" EXIT
wait $BACKEND_PID
