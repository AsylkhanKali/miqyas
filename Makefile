.PHONY: dev prod stop seed migrate test lint build clean logs health

# ── Development ────────────────────────────────────────────────────────

dev: ## Start dev environment (Postgres + Redis + backend + frontend)
	docker compose -f docker/docker-compose.yml up -d postgres redis
	@echo "Waiting for Postgres..."
	@until docker exec miqyas-postgres pg_isready -U miqyas > /dev/null 2>&1; do sleep 1; done
	@echo "Postgres ready. Run backend and frontend in separate terminals:"
	@echo "  Terminal 1 (Backend):  cd backend && source .venv/bin/activate && alembic upgrade head && uvicorn app.main:app --reload --port 8000"
	@echo "  Terminal 2 (Celery):   cd backend && source .venv/bin/activate && celery -A app.tasks.worker worker --loglevel=info -Q parsing,video,gpu,celery,default"
	@echo "  Terminal 3 (Frontend): cd frontend && npm run dev"

dev-up: ## Start all dev services via Docker
	docker compose -f docker/docker-compose.yml up -d
	@echo "All services started. Frontend: http://localhost:3000  API: http://localhost:8000/docs"

dev-down: ## Stop dev services
	docker compose -f docker/docker-compose.yml down

# ── Production ─────────────────────────────────────────────────────────

prod: ## Start production environment
	docker compose -f docker/docker-compose.prod.yml up -d --build
	@echo "Production started. Frontend: http://localhost  API: http://localhost:8000"

prod-down: ## Stop production environment
	docker compose -f docker/docker-compose.prod.yml down

# ── Database ───────────────────────────────────────────────────────────

migrate: ## Run database migrations
	cd backend && alembic upgrade head

seed: ## Seed demo data
	cd backend && python3 ../scripts/seed_demo.py

# ── Testing ────────────────────────────────────────────────────────────

test: ## Run backend tests
	cd backend && python3 -m pytest tests/ -v

lint: ## Lint backend code
	cd backend && ruff check app/ tests/

lint-fix: ## Auto-fix lint issues
	cd backend && ruff check app/ tests/ --fix

# ── Build ──────────────────────────────────────────────────────────────

build-frontend: ## Build frontend for production
	cd frontend && npm run build

build-backend: ## Build backend Docker image
	docker build -f docker/Dockerfile.backend -t miqyas-backend .

build: build-frontend build-backend ## Build all

# ── Monitoring ─────────────────────────────────────────────────────────

logs: ## Tail all container logs
	docker compose -f docker/docker-compose.yml logs -f

logs-backend: ## Tail backend logs
	docker compose -f docker/docker-compose.yml logs -f backend

logs-celery: ## Tail Celery worker logs
	docker compose -f docker/docker-compose.yml logs -f celery-worker

logs-prod: ## Tail all production logs
	docker compose -f docker/docker-compose.prod.yml logs -f

health: ## Check service health
	@curl -s http://localhost:8000/api/v1/health | python -m json.tool

metrics: ## Check Prometheus metrics endpoint
	@curl -s http://localhost:8000/metrics | head -30

grafana: ## Open Grafana dashboard (prod only)
	@echo "Grafana: http://localhost:3001  (admin / \$$GRAFANA_PASSWORD)"

# ── Cleanup ────────────────────────────────────────────────────────────

clean: ## Remove build artifacts and caches
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name node_modules -exec rm -rf {} + 2>/dev/null || true
	rm -rf frontend/dist backend/.mypy_cache

# ── Help ───────────────────────────────────────────────────────────────

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-18s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
