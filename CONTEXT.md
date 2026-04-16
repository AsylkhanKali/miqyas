# MIQYAS — Project Context (Living Document)

**Last updated:** Phase 1 — Make CV Pipeline Real

## Current Architecture State

### Completed (Phase 1 — Make CV Pipeline Real)
- [x] `use_mock=False` — дефолт во всех задачах (`segment_capture_task`, `compare_progress_task`, `run_full_analysis_task`)
- [x] `detect_device()` — автоопределение CUDA → MPS → CPU уже реализовано в `SegmentationService`
- [x] Явная ошибка при 0 progress items в реальном режиме (убран тихий fallback на mock)
- [x] `GET /api/v1/system/capabilities` — проверяет наличие torch, transformers, COLMAP, ffmpeg, pyrender и возвращает `pipeline_mode: real|mock_required`
- [x] `systemApi.capabilities()` — метод в API-клиенте фронтенда
- [x] `SystemCapabilities` TypeScript-интерфейс
- [x] Баннер режима пайплайна в `CapturesTab`: 
  - Жёлтый (amber) — зависимости не установлены, показывает команды установки
  - Зелёный (emerald) — реальный режим активен, показывает device (cuda/mps/cpu) и режим выравнивания

### Completed (Phase 7 — Procore Integration Testing)
- [x] Setup validation script: `scripts/check_procore.py` — verifies env vars, redirect URI format, API reachability, DB table existence
- [x] 25 unit tests in `backend/tests/unit/test_procore.py` covering:
  - OAuth state signing + HMAC verification (valid / tampered / wrong secret)
  - Template context building for behind/ahead elements, missing activity
  - `_fmt()` safe formatting with missing keys
  - RFI/Issue payload construction with default and custom field mapping
  - Token refresh triggering logic (within 5-min buffer, expired, valid)
  - `_refresh_token()` HTTP call via mocked httpx
  - Full push flow (success + HTTP failure) for RFI and Issue
  - API endpoint tests: auth-url 501, config not-found, push 400 when not configured, empty push logs, disconnect 404
- [x] Bulk push Celery task: `backend/app/tasks/procore_tasks.py` — `bulk_push_task` pushes list of ProgressItems, returns per-item results + summary
- [x] Bulk push registered in worker task routes (queue: "default")
- [x] `POST /projects/{id}/procore/bulk-push` endpoint — validates config, enqueues Celery task, returns task_id
- [x] `GET /projects/{id}/procore/tasks/{task_id}` endpoint — polls Celery task state (PENDING/STARTED/SUCCESS/FAILURE)
- [x] `ProcoreBulkPushRequest` and `ProcoreBulkPushResponse` Pydantic schemas
- [x] Frontend API client: `procoreApi.bulkPush()` and `procoreApi.getTaskStatus()`

### Completed (Phase 6 — Production Infrastructure)
- [x] Separate GPU Celery worker: `celery-gpu` service with NVIDIA GPU reservation (`--concurrency=1 -Q gpu`), `celery-default` handles parsing/video queues (`--concurrency=4`)
- [x] StorageService abstraction (`backend/app/services/storage/`): `LocalStorage` (default) and `S3Storage` backends, toggled via `STORAGE_BACKEND=local|s3` env var
- [x] `boto3` added to requirements.txt for S3 support
- [x] `storage_backend` config field added to Settings
- [x] Automated PostgreSQL backups: `prodrigestivill/postgres-backup-local:15` — daily backups, 7-day/4-week/6-month retention
- [x] Caddy reverse proxy: auto-TLS via Let's Encrypt, `docker/Caddyfile` with security headers, gzip/zstd compression, JSON logging
- [x] `DOMAIN` env var for Caddy — defaults to `localhost`, set to real domain for production
- [x] Frontend no longer exposes port 80 directly — Caddy handles 80/443
- [x] Structured logging via `structlog`: JSON output in production, colored console in dev
- [x] `app/core/logging.py` — `setup_logging()` configures structlog + stdlib integration
- [x] Prometheus metrics: `prometheus-fastapi-instrumentator` exposes `/metrics` endpoint
- [x] Prometheus server (v2.51.0) + Grafana (v11.0.0) in docker-compose.prod.yml
- [x] Grafana auto-provisioned with Prometheus datasource (`docker/grafana/provisioning/`)
- [x] Grafana accessible at `localhost:3001` (prod), Prometheus at internal port 9090
- [x] Makefile updated: `logs-prod`, `metrics`, `grafana` commands

### Completed (Phase 5 — Fix UI Gaps)
- [x] Report status polling: ReportsPage auto-polls every 3s when any report has "generating" or "pending" status
- [x] Pipeline error messages: CapturesTab shows detailed error panel with diagnostic questions, retry button, manual alignment link
- [x] COLMAP error toast improved: 6s duration with manual alignment suggestion
- [x] Running task indicator enhanced: shows `current_step` name and formatted progress fields
- [x] Simulated data badges: `[SIMULATED]` warning banners on BIM viewer progress mode, report cards with mock data
- [x] Mock capture detection in ProjectDetailPage CapturesTab
- [x] Skeleton loading states applied to: ProjectDetailPage (main + captures tab), ReportsPage (projects loading + reports loading), ScheduleDetailPage (activity list), IntegrationsPage (config loading)
- [x] Replaced all spinner loading indicators with `<SkeletonCard>` and `<SkeletonTable>` components (built in Week 8)

### Completed (Phase 4 — Real IFC Mesh Viewer)
- [x] Backend: `GET /bim/models/{id}/file` endpoint serves original IFC file with caching headers
- [x] Backend: `GET /bim/models/{id}/info` endpoint returns file size (used by frontend to auto-select render mode)
- [x] `IFCMeshLoader` service (`frontend/src/services/ifc-loader.ts`) — extracts triangle meshes from IFC files via web-ifc IfcAPI
- [x] web-ifc WASM files copied to `public/wasm/` for browser loading
- [x] `IFCViewerCanvas` rewritten with dual render modes: "mesh" (web-ifc) and "bbox" (original BoxGeometry fallback)
- [x] Mesh mode: fetches IFC file, extracts per-element geometry via web-ifc GetFlatMesh, applies transformations, renders as BufferGeometry
- [x] Element-to-mesh matching via centroid proximity (links web-ifc expressIDs to backend BIMElement records)
- [x] Auto-fallback: if web-ifc loading fails, bbox mode activates automatically
- [x] Auto-detect large models: files >50MB default to bbox mode for performance
- [x] Mesh/Bbox toggle button (Hexagon icon) in viewer toolbar with emerald highlight for mesh mode
- [x] Status bar shows render mode + model file size
- [x] `BIMModelInfo` TypeScript type + `bimApi.getModelInfo()` + `bimApi.getFileUrl()` API methods
- [x] All existing features preserved: category/progress coloring, camera trajectory, comparison panel, element selection highlight

### Completed (Phase 3 — Make COLMAP Reliable)
- [x] Removed mock identity alignment fallback — COLMAP now fails explicitly with actionable error message pointing to manual alignment
- [x] Added quality metrics to CameraAlignment model: `registered_images`, `total_input_images`, `registration_ratio`, `quality_grade`, `quality_warnings`
- [x] Alembic migration 003 adds 5 new columns to `camera_alignments`
- [x] COLMAP orchestrator now computes quality grade (good/acceptable/poor/failed) based on registration ratio + reprojection error thresholds
- [x] Manual alignment minimum raised from 4 → 6 control points for robust PnP
- [x] Per-point reprojection errors computed and stored with each control point
- [x] Manual alignment quality assessment (grade + warnings for outlier points, low point count)
- [x] Alignment response schema enriched with all quality fields
- [x] `GET /captures/{id}/alignment/quality` endpoint — detailed quality report with actionable guidance
- [x] COLMAP trigger response includes fallback hint to manual alignment
- [x] Manual alignment 400 error includes feature-picking guidance text

### Completed (Phase 2 — BIM Mesh Rendering)
- [x] pyrender + trimesh + PyOpenGL added to requirements.txt
- [x] `geometry_mesh` JSONB column added to `bim_elements` (Alembic migration 002)
- [x] IFC parser extended — `_compute_all_geometry()` extracts triangle meshes (vertices + faces) alongside bboxes in a single geometry iterator pass
- [x] Mesh cap at 10,000 vertices per element to keep JSONB size reasonable
- [x] BIM renderer rewritten — uses pyrender OffscreenRenderer with per-element color-coded ID map for pixel-accurate expected masks
- [x] Bbox convex-hull fallback retained for elements without mesh data
- [x] Graceful degradation — if pyrender/trimesh not installed, renderer falls back entirely to bbox mode
- [x] `render_method` field added to renderer output ("mesh" or "bbox") for diagnostics
- [x] ComparisonQualityValidator service — IoU distribution analysis, anomaly detection, per-element stats
- [x] `POST /captures/{id}/validate-quality` endpoint — IoU distribution, render method breakdown, warnings
- [x] `POST /captures/{id}/validate-elements` endpoint — per-element IoU stats (mean/max/min/std) with human-readable interpretation

### Completed (Week 8)
- [x] Enhanced /health endpoint — DB latency check, Redis ping, uptime tracking, degraded state detection
- [x] /stats dashboard endpoint — real-time counts for projects, BIM models, schedules, captures, progress items, reports
- [x] Demo data seed script — realistic project with 174 BIM elements, 27 activities, auto-links, capture, progress items
- [x] Skeleton/shimmer loading components — Skeleton, SkeletonCard, SkeletonRow, SkeletonTable
- [x] 404 Not Found page — dark-themed with navigation back to dashboard
- [x] Dashboard polish — 6 real stat cards from /stats API, skeleton loading states, project count badge in sidebar
- [x] Sidebar polish — fixed nav indicator positioning (relative parent), project count badge
- [x] Production docker-compose.prod.yml — gunicorn workers, healthchecks, restart policies, Redis persistence
- [x] Gunicorn production config — UvicornWorker, auto worker count, request limiting, structured logging
- [x] Makefile — dev, prod, seed, migrate, test, lint, build, logs, health, clean commands
- [x] GitHub Actions CI — backend lint, backend tests (Postgres + Redis services), frontend build, Docker build
- [x] Updated .env.example — all Week 7-8 vars including Sentry, Procore, Gunicorn, report storage

### Completed (Week 7)
- [x] Procore OAuth2 service — authorization URL generation, code exchange, token refresh, HMAC-signed state
- [x] Procore REST API client — generic v1.1 request with auto 401 retry, Procore-Company-Id header
- [x] Procore RFI creation — build payload from ProgressItem + BIMElement + Activity, template-based field mapping
- [x] Procore Issue creation — same pattern with issue-specific templates
- [x] Procore push audit logging — ProcorePushLog with payload, response, status
- [x] Procore API router — auth-url, OAuth callback, config CRUD, company/project listing, push endpoint, push logs
- [x] Default field mapping templates with placeholders ({element_name}, {deviation_type}, etc.)
- [x] Custom exception hierarchy — MiqyasError, EntityNotFoundError, ProcoreAuthError, ProcoreAPIError, ProcoreRateLimitError
- [x] Global FastAPI exception handlers — structured error responses with type field
- [x] Sentry backend integration — sentry-sdk[fastapi] with FastAPI + SQLAlchemy integrations, conditional init
- [x] Sentry frontend integration — @sentry/react with browser tracing, conditional init via VITE_SENTRY_DSN
- [x] ErrorBoundary component — catches render errors, reports to Sentry, shows reload UI
- [x] IntegrationsPage — Procore connect/disconnect, company/project picker, field mapping editor, push log viewer
- [x] Procore frontend API client — procoreApi with all endpoints
- [x] Procore TypeScript types — ProcoreConfig, ProcoreProject, ProcoreCompany, ProcorePushLog, etc.
- [x] Project detail header — Integrations link button
- [x] Router — /projects/:projectId/integrations route

### Completed (Week 6)
- [x] 3D BIM Viewer — progress color-coding mode (category vs deviation colors)
- [x] Deviation colors: ahead=#10b981, on_track=#0a7cff, behind=#ef4444, not_started=#64748b, extra_work=#f59e0b
- [x] Camera trajectory overlay in 3D viewer (records path + draws THREE.Line)
- [x] Side-by-side comparison panel in viewer (observed frame vs BIM expectation placeholders)
- [x] Progress legend overlay in viewer (floating bottom-right, shown in progress mode)
- [x] Reports API router — CRUD + PDF generation + download endpoints
- [x] ReportGenerator service — gathers progress data, builds PDF via ReportLab (with fallback)
- [x] PDF reports: executive summary, deviation breakdown table, element details table, narratives
- [x] Reports page (React) — project selector, generate form, report cards with stats, PDF download, delete
- [x] Captures tab rewrite — full pipeline controls (upload, extract frames, COLMAP, segment, full analysis)
- [x] Pipeline task polling in captures tab (2s interval, animated status)
- [x] Frontend API client: reportsApi, progressApi, pipelineApi
- [x] Frontend types: Report, ReportSummary, ProgressSummary, CameraPose, TaskStatus
- [x] Report storage dir added to config + lifespan startup

### Completed (Week 5)
- [x] Full pipeline orchestrator — single Celery task chains: extract → segment → render → compare → progress
- [x] Pipeline status tracking with per-step progress (PROGRESS state)
- [x] Task status polling API endpoint (/tasks/{task_id})
- [x] Single "Analyze" API endpoint — one-button full analysis
- [x] Template-based narrative system (8 templates: ahead strong/moderate, on_track high/low confidence, behind critical/moderate/minor, not_started overdue/upcoming, extra_work, unlinked)
- [x] Pipeline task registered in Celery worker

### Completed (Week 4)
- [x] Mask2Former segmentation service (HuggingFace transformers wrapper + mock fallback)
- [x] ADE20K → 13 construction categories class mapping
- [x] Colored mask visualization output
- [x] BIM headless renderer (bbox projection → convex hull → binary masks per element)
- [x] IoU comparison engine (observed vs expected, per-element, per-frame)
- [x] Progress item generation with schedule cross-reference
- [x] Deviation detection (ahead/on_track/behind/not_started/extra_work)
- [x] Confidence scoring (weighted IoU + segmentation confidence)
- [x] CV pipeline API router (segment, compare, progress, summary)
- [x] Celery tasks for segmentation and progress comparison

### Completed (Week 5)
- [x] Pipeline Orchestrator — single-call end-to-end: frames → segmentation → BIM render → IoU → progress items
- [x] Pipeline status tracking with per-step results (success/skipped/failed + counts + durations)
- [x] Narrative Generator — element-level, activity-level, and executive summary templates
- [x] Construction-domain language (severity labels, critical path warnings, scope change detection)
- [x] Deviation alerts for Procore RFI integration
- [x] Confidence Scoring Model — 5-factor weighted: segmentation, IoU, frame quality, visibility, alignment
- [x] Non-linear IoU→confidence curve, blur score normalization, reprojection error normalization
- [x] /analyze endpoint — one-button full pipeline via Celery
- [x] /executive-summary endpoint — generates project-level progress narrative
- [x] Pipeline Celery task (run_full_pipeline) with step-by-step error handling

### Completed (Week 4)
- [x] FFmpeg frame extraction service (probe, extract at interval, blur scoring via Laplacian)
- [x] Equirectangular → cubemap conversion (6-face, configurable resolution, numpy)
- [x] COLMAP orchestration service (feature extraction, matching, sparse reconstruction)
- [x] COLMAP output parser (images.txt → camera poses + reprojection error)
- [x] Manual alignment service (PnP solver, DLT, Rodrigues, pure numpy — no OpenCV)
- [x] Video capture API router (upload, list, process trigger, COLMAP trigger, manual align)
- [x] Celery tasks for frame extraction and COLMAP reconstruction
- [x] Manual Alignment UI (React) — clickable frame overlay, control point table, BIM coord inputs
- [x] Frontend captures API client methods
- [x] numpy + Pillow added to requirements

### Completed (Week 2)
- [x] React + TypeScript + Vite + Tailwind scaffold
- [x] Custom design system (DM Sans / Instrument Sans, dark theme, construction-grade palette)
- [x] App shell layout (collapsible sidebar, topbar, animated route transitions)
- [x] React Router with all routes: dashboard, projects, project detail, BIM viewer, schedule detail
- [x] Dashboard page with stats cards, project list, empty states
- [x] Projects list page with card grid
- [x] Project setup wizard (4-step: details → IFC upload → XER upload → review)
- [x] Project detail page with tabbed interface (overview, BIM, schedule, captures)
- [x] File dropzone component with drag-and-drop (react-dropzone)
- [x] BIM Viewer page with Three.js bounding-box visualization, OrbitControls, element selection
- [x] Viewer left panel: level toggles, category toggles, element search, element list
- [x] Viewer right panel: full property inspector (identity, location, material, bbox, quantities, IFC psets)
- [x] Schedule detail page with activity list, status filters, critical path toggle, progress bars
- [x] Zustand store for project state management
- [x] Axios API client with all backend endpoint methods
- [x] TypeScript types for entire domain model
- [x] Docker frontend config (nginx + SPA routing + API proxy + WASM MIME types)
- [x] Framer Motion animations throughout (page transitions, staggered lists, tab indicators)
- [x] Toast notifications (react-hot-toast) with dark theme styling

### Completed (Week 1)
- [x] Monorepo structure created
- [x] PostgreSQL schema — 18 tables covering full MVP
- [x] Alembic initial migration (001_initial)
- [x] FastAPI scaffold with CORS, lifespan, health check
- [x] API routers: projects (CRUD), BIM upload + elements, schedule upload + activities
- [x] IFC Parser Service (IfcOpenShell) — extracts elements, properties, quantities, bounding boxes
- [x] P6 XER Parser Service — parses PROJECT, PROJWBS, TASK, TASKPRED tables
- [x] P6 XML Parser Service — basic implementation for XML-format schedules
- [x] Auto-Linker Service — 4-strategy heuristic matching (code, level+category, category, fuzzy)
- [x] Celery worker + task definitions for IFC and schedule parsing
- [x] Docker Compose (PostgreSQL 15, Redis 7, backend, Celery worker)
- [x] Test suite scaffold with async fixtures
- [x] Unit tests for projects API and XER parser

### Not Yet Built
- All 8 weeks complete — MVP feature-complete

## Database Tables

| # | Table | Purpose |
|---|-------|---------|
| 1 | projects | Top-level project entity |
| 2 | bim_models | Uploaded IFC files |
| 3 | bim_elements | Individual IFC elements with geometry + properties |
| 4 | schedules | Uploaded P6 XER/XML files |
| 5 | wbs_nodes | Work Breakdown Structure hierarchy |
| 6 | activities | Schedule activities with dates, status, float |
| 7 | activity_relationships | FS/FF/SS/SF predecessor links |
| 8 | element_activity_links | BIM ↔ Schedule auto-linking |
| 9 | video_captures | Uploaded 360° videos |
| 10 | frames | Extracted video frames |
| 11 | camera_alignments | COLMAP/manual alignment transforms |
| 12 | camera_poses | Per-frame camera position in BIM coords |
| 13 | segmentation_results | Mask2Former inference outputs |
| 14 | progress_comparisons | IoU comparison per element per frame |
| 15 | progress_items | Aggregated deviation status per element |
| 16 | reports | Generated progress reports |
| 17 | procore_configs | OAuth2 tokens + field mapping |
| 18 | procore_push_logs | Audit trail for Procore pushes |

## Key Decisions
- **Async everywhere:** FastAPI + SQLAlchemy 2.0 async sessions
- **UUID primary keys:** All tables use UUID4 for distributed compatibility
- **JSONB for flexibility:** Properties, quantities, geometry stored as JSONB
- **Celery queues:** `parsing` (IFC/P6), `video` (FFmpeg), `gpu` (ML inference)
- **Auto-linker confidence thresholds:** code_match=0.95, level+category=0.80, category=0.65, fuzzy=0.50

## Known Issues
- None yet (fresh scaffold)

## Deployment
- **Dev:** `make dev` starts Postgres + Redis, then run backend/celery/frontend in separate terminals
- **Prod:** `make prod` builds and starts all services with gunicorn + healthchecks
- **Seed:** `make seed` creates demo project with full data pipeline
- **CI:** GitHub Actions runs lint, tests, frontend build, Docker build on push/PR
