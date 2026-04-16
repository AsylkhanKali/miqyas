# MIQYAS — AI-Powered Construction Progress Tracking

Платформа для автоматического мониторинга строительного прогресса: загружаешь видео с объекта, BIM-модель и расписание — система сравнивает реальное состояние с запланированным и выдаёт отчёты по отклонениям.

## Архитектура

```
miqyas/
├── backend/          # FastAPI + Celery + PostgreSQL
│   ├── app/
│   │   ├── api/v1/   # REST endpoints
│   │   ├── core/     # Config, security, database, logging
│   │   ├── models/   # SQLAlchemy ORM models
│   │   ├── schemas/  # Pydantic request/response schemas
│   │   ├── services/ # Business logic (IFC parser, P6 parser, storage, auto-linker)
│   │   ├── tasks/    # Celery async tasks (video, pipeline, procore)
│   │   └── utils/    # Shared helpers
│   ├── migrations/   # Alembic migrations
│   └── tests/        # Unit + integration tests
├── frontend/         # React + TypeScript + Vite
│   └── src/
│       ├── pages/    # DashboardPage, ProjectDetailPage, etc.
│       ├── components/
│       └── services/ # API client (axios)
├── docker/           # Docker Compose (dev + prod), Caddyfile, Prometheus
├── scripts/          # Dev utilities, Procore validation
└── docs/
```

## Быстрый старт

```bash
# 1. Скопировать окружение
cp .env.example .env

# 2. Поднять инфраструктуру (postgres + redis)
docker compose -f docker/docker-compose.yml up -d postgres redis

# 3. Бэкенд
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 4. Celery worker (отдельный терминал)
celery -A app.tasks.worker worker -Q default,parsing,video --loglevel=info

# 5. Фронтенд (отдельный терминал)
cd frontend
npm install
npm run dev
```

Открыть: http://localhost:5173

## Стек технологий

| Слой | Технологии |
|------|-----------|
| **Backend API** | FastAPI, SQLAlchemy 2.0 async, Alembic |
| **Task Queue** | Celery + Redis (queues: gpu, default, parsing, video) |
| **Database** | PostgreSQL 15 |
| **IFC Parsing** | IfcOpenShell |
| **Schedule Parsing** | Custom P6 XER/XML parser |
| **CV Pipeline** | FFmpeg + COLMAP + Mask2Former (HuggingFace) |
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, Three.js, recharts |
| **Storage** | Local FS (dev) / S3 (prod) |
| **Observability** | structlog, Prometheus + Grafana |
| **Reverse Proxy** | Caddy (SSL auto) |
| **Procore** | OAuth2 integration, bulk RFI/Issue push |

## Основные возможности

- 📁 **Загрузка IFC** — парсинг BIM-модели, извлечение элементов по категориям и уровням
- 📅 **Расписание P6** — парсинг XER/XML, критический путь, плановые сроки
- 🎥 **Видеозахват** — извлечение кадров через FFmpeg, COLMAP для 3D-реконструкции
- 🤖 **CV Pipeline** — сегментация Mask2Former, IoU-сравнение с BIM, расчёт отклонений
- 📊 **Investor Dashboard** — KPI-карты, donut chart отклонений, health score проектов
- 📄 **Отчёты** — PDF с executive summary, deviation breakdown
- 🔗 **Procore** — OAuth2, bulk push RFI/Issue с маппингом полей

## CV Pipeline

**Режим "real"** требует: PyTorch + HuggingFace transformers + FFmpeg.  
COLMAP опционален (без него — только ручное выравнивание).

Проверить состояние: `GET /api/v1/system/capabilities`

**Режим "mock"** — детерминированные заглушки для dev/demo без GPU.

## Production

```bash
# Запуск полного стека (Caddy, Prometheus, Grafana, backup)
make prod-up

# Логи
make logs-prod

# Метрики Prometheus
make metrics        # http://localhost:9090

# Grafana
make grafana        # http://localhost:3000
```

Переменные окружения: см. `.env.example`

## Тестирование

```bash
# Unit тесты
cd backend && pytest tests/unit/ -v

# Проверка Procore конфига
python scripts/check_procore.py

# API health
curl http://localhost:8000/api/v1/health
```
