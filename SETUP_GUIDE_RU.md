# MIQYAS — Полное руководство по установке и запуску

> Пошаговая инструкция для macOS. Инструменты: Cursor / VSCode, XCode (для нативных зависимостей), Terminal.

---

## Содержание

1. Системные требования и предварительная подготовка
2. Установка инструментов (Homebrew, Docker, Node, Python)
3. Клонирование и структура проекта
4. Настройка базы данных и Redis
5. Запуск бэкенда (FastAPI + Alembic + Celery)
6. Запуск фронтенда (React + Vite)
7. Проверка работоспособности
8. Работа в Cursor / VSCode
9. Docker Compose (всё одной командой)
10. Частые проблемы и решения

---

## 1. Системные требования

- **macOS** 13+ (Ventura / Sonoma / Sequoia)
- **XCode Command Line Tools** (для компиляции нативных модулей)
- **Минимум 8 ГБ RAM** (рекомендуется 16 ГБ, особенно для Docker)
- **10 ГБ свободного места** на диске

### Проверь, что XCode CLI установлен:

```bash
xcode-select --version
```

Если не установлен:

```bash
xcode-select --install
```

Появится окно — нажми «Install». Подожди завершения (5–10 минут).

---

## 2. Установка инструментов

### 2.1 Homebrew (менеджер пакетов для macOS)

```bash
# Проверь, установлен ли Homebrew
brew --version

# Если нет — установи:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# После установки на Apple Silicon (M1/M2/M3/M4) добавь в PATH:
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

### 2.2 Python 3.12

```bash
brew install python@3.12

# Проверь версию:
python3.12 --version
# Ожидаемый результат: Python 3.12.x
```

### 2.3 Node.js 20

```bash
brew install node@20

# Проверь:
node --version   # v20.x.x
npm --version    # 10.x.x
```

### 2.4 PostgreSQL 15

```bash
brew install postgresql@15

# Запусти как фоновый сервис:
brew services start postgresql@15

# Добавь в PATH:
echo 'export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Проверь:
psql --version
```

### 2.5 Redis

```bash
brew install redis

# Запусти как фоновый сервис:
brew services start redis

# Проверь:
redis-cli ping
# Ожидаемый результат: PONG
```

### 2.6 Docker Desktop (опционально — для Docker Compose варианта)

Скачай и установи: https://www.docker.com/products/docker-desktop/

После установки запусти Docker Desktop и подожди, пока иконка в трее станет стабильной.

```bash
docker --version
docker compose version
```

---

## 3. Клонирование и структура проекта

### 3.1 Распакуй архив (если скачал из Claude)

```bash
# Перейди в нужную директорию (например, ~/Projects)
cd ~/Projects

# Распакуй
tar xzf miqyas-monorepo.tar.gz
tar xzf miqyas-week2-frontend.tar.gz   # перезапишет frontend/ поверх

cd miqyas
```

### 3.2 Или создай Git-репозиторий

```bash
cd ~/Projects/miqyas

git init
git add .
git commit -m "Week 1+2: Foundation, ingest, frontend shell, BIM viewer"
```

### 3.3 Структура проекта

```
miqyas/
├── backend/                 ← FastAPI + SQLAlchemy + Celery
│   ├── app/
│   │   ├── api/v1/          ← REST-эндпоинты
│   │   ├── core/            ← Конфиг, БД, безопасность
│   │   ├── models/          ← ORM-модели (18 таблиц)
│   │   ├── schemas/         ← Pydantic-схемы
│   │   ├── services/        ← IFC-парсер, P6-парсер, авто-линкер
│   │   ├── tasks/           ← Celery-задачи
│   │   └── utils/
│   ├── migrations/          ← Alembic-миграции
│   ├── tests/
│   ├── alembic.ini
│   ├── requirements.txt
│   └── pyproject.toml
├── frontend/                ← React + TypeScript + Vite + Tailwind
│   ├── src/
│   │   ├── components/      ← UI-компоненты
│   │   ├── pages/           ← Страницы (Dashboard, Viewer, Wizard...)
│   │   ├── services/        ← API-клиент (Axios)
│   │   ├── store/           ← Zustand-стор
│   │   └── styles/          ← Глобальные стили
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
├── docker/                  ← Docker Compose + Dockerfile
├── scripts/                 ← Утилиты разработки
├── CONTEXT.md               ← Живой документ для Claude-сессий
├── .env.example
└── README.md
```

---

## 4. Настройка базы данных

### 4.1 Создай базу и пользователя

```bash
# Подключись к PostgreSQL (по умолчанию от имени текущего пользователя macOS)
psql postgres
```

В psql-консоли выполни:

```sql
-- Создай пользователя
CREATE USER miqyas WITH PASSWORD 'miqyas_dev';

-- Создай базу данных
CREATE DATABASE miqyas OWNER miqyas;

-- Дай все права
GRANT ALL PRIVILEGES ON DATABASE miqyas TO miqyas;

-- Выйди
\q
```

### 4.2 Проверь подключение

```bash
psql -U miqyas -d miqyas -h localhost
# Введи пароль: miqyas_dev

# Если подключился — всё ок. Выйди:
\q
```

#### Если psql ругается на аутентификацию:

Найди и отредактируй файл `pg_hba.conf`:

```bash
# Найди файл:
psql postgres -c "SHOW hba_file;"

# Открой в редакторе (например, в Cursor):
cursor $(psql postgres -tA -c "SHOW hba_file;")
```

Найди строку с `local all all` и измени метод на `md5`:

```
# TYPE  DATABASE  USER  METHOD
local   all       all   md5
host    all       all   127.0.0.1/32   md5
host    all       all   ::1/128        md5
```

Перезапусти PostgreSQL:

```bash
brew services restart postgresql@15
```

### 4.3 Создай файл .env

```bash
cd ~/Projects/miqyas
cp .env.example .env
```

Открой `.env` и убедись, что строки подключения правильные:

```env
DATABASE_URL=postgresql+asyncpg://miqyas:miqyas_dev@localhost:5432/miqyas
DATABASE_URL_SYNC=postgresql://miqyas:miqyas_dev@localhost:5432/miqyas
REDIS_URL=redis://localhost:6379/0
CELERY_BROKER_URL=redis://localhost:6379/1
CELERY_RESULT_BACKEND=redis://localhost:6379/2
```

---

## 5. Запуск бэкенда

### 5.1 Создай виртуальное окружение Python

```bash
cd ~/Projects/miqyas/backend

# Создай venv
python3.12 -m venv .venv

# Активируй
source .venv/bin/activate

# Убедись, что активировалось (в промпте должно быть (.venv)):
which python
# Ожидаемый результат: .../miqyas/backend/.venv/bin/python
```

### 5.2 Установи зависимости

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

#### Возможные проблемы при установке:

**psycopg2-binary не компилируется:**

```bash
# Установи libpq через Homebrew:
brew install libpq
export LDFLAGS="-L/opt/homebrew/opt/libpq/lib"
export CPPFLAGS="-I/opt/homebrew/opt/libpq/include"
pip install psycopg2-binary
```

**ifcopenshell не ставится через pip:**

```bash
# Попробуй conda-forge (если используешь conda):
# conda install -c conda-forge ifcopenshell

# Или установи из wheel:
pip install ifcopenshell
# Если не получается — пока пропусти, парсинг IFC будет недоступен,
# но всё остальное будет работать.
```

### 5.3 Запусти миграции Alembic

```bash
# Убедись, что ты в директории backend/ и venv активирован
cd ~/Projects/miqyas/backend

# Запусти миграции
alembic upgrade head
```

Ожидаемый результат:

```
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
INFO  [alembic.runtime.migration] Running upgrade  -> 001_initial, initial schema — full MIQYAS MVP tables
```

#### Проверь, что таблицы создались:

```bash
psql -U miqyas -d miqyas -h localhost -c "\dt"
```

Должно быть 18 таблиц + `alembic_version`.

### 5.4 Запусти FastAPI сервер

```bash
# Из директории backend/, с активированным venv:
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Ожидаемый результат:

```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [xxxxx]
INFO:     Started server process [xxxxx]
INFO:     Application startup complete.
```

**Открой в браузере:**

- http://localhost:8000 — корневой эндпоинт (JSON-ответ)
- http://localhost:8000/docs — Swagger UI (интерактивная документация API)
- http://localhost:8000/redoc — ReDoc (альтернативная документация)

### 5.5 Запусти Celery (в отдельном терминале)

```bash
# Открой новый терминал (Cmd+T в Terminal)
cd ~/Projects/miqyas/backend
source .venv/bin/activate

celery -A app.tasks.worker worker --loglevel=info --concurrency=2 -Q parsing,default
```

Ожидаемый результат:

```
 -------------- celery@your-mac v5.4.0 (opalescent)
--- ***** -----
-- ******* ---- [config]
- *** --- * --- .> app:         miqyas
- ** ---------- .> transport:   redis://localhost:6379/1
...
[tasks]
  . app.tasks.ifc_tasks.auto_link
  . app.tasks.ifc_tasks.parse_ifc
  . app.tasks.p6_tasks.parse_schedule

[... ready.]
```

---

## 6. Запуск фронтенда

### 6.1 Установи npm-зависимости

```bash
# Открой ещё один терминал
cd ~/Projects/miqyas/frontend

npm install
```

Это установит React, Three.js, Framer Motion, Tailwind и все остальные пакеты. Процесс занимает 1–3 минуты.

### 6.2 Запусти dev-сервер

```bash
npm run dev
```

Ожидаемый результат:

```
  VITE v6.0.5  ready in 800 ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: http://192.168.x.x:3000/
  ➜  press h + enter to show help
```

**Открой в браузере:** http://localhost:3000

Ты увидишь дашборд MIQYAS с тёмной темой. Попробуй:
1. Нажми «New Project» → пройди через визард
2. Создай проект → перейди на его страницу
3. Загрузи IFC-файл и XER-файл через вкладки

---

## 7. Проверка работоспособности

### 7.1 Быстрый тест API

```bash
# Создай проект через API:
curl -X POST http://localhost:8000/api/v1/projects/ \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Tower",
    "code": "TT-001",
    "location": "Riyadh, KSA",
    "client_name": "Saudi Giga Projects"
  }'

# Получи список проектов:
curl http://localhost:8000/api/v1/projects/
```

### 7.2 Запусти тесты

```bash
cd ~/Projects/miqyas/backend
source .venv/bin/activate

# Установи дополнительную зависимость для тестов:
pip install aiosqlite

# Запусти тесты:
pytest tests/ -v
```

### 7.3 Проверь все сервисы

| Сервис | URL | Статус |
|--------|-----|--------|
| FastAPI | http://localhost:8000 | `{"service": "MIQYAS"}` |
| Swagger | http://localhost:8000/docs | Интерактивная документация |
| Health Check | http://localhost:8000/api/v1/health | `{"status": "healthy"}` |
| Frontend | http://localhost:3000 | Дашборд MIQYAS |
| PostgreSQL | `psql -U miqyas -d miqyas -h localhost` | 18 таблиц |
| Redis | `redis-cli ping` | `PONG` |

---

## 8. Работа в Cursor / VSCode

### 8.1 Открой проект

```bash
# Cursor:
cursor ~/Projects/miqyas

# VSCode:
code ~/Projects/miqyas
```

### 8.2 Рекомендуемые расширения

Установи эти расширения (Cmd+Shift+X → поиск):

**Для Python (бэкенд):**
- `ms-python.python` — Python language support
- `ms-python.vscode-pylance` — Pylance (типы, автодополнение)
- `charliermarsh.ruff` — Ruff (линтер + форматтер)

**Для TypeScript/React (фронтенд):**
- `bradlc.vscode-tailwindcss` — Tailwind CSS IntelliSense
- `esbenp.prettier-vscode` — Prettier
- `dbaeumer.vscode-eslint` — ESLint

**Общие:**
- `ms-azuretools.vscode-docker` — Docker
- `mtxr.sqltools` — SQL клиент (для просмотра БД)
- `eamodio.gitlens` — Git история

### 8.3 Настройки рабочего пространства

Создай файл `.vscode/settings.json` в корне проекта:

```bash
mkdir -p ~/Projects/miqyas/.vscode
```

```json
{
  "python.defaultInterpreterPath": "${workspaceFolder}/backend/.venv/bin/python",
  "python.analysis.typeCheckingMode": "basic",
  "python.analysis.extraPaths": ["${workspaceFolder}/backend"],

  "[python]": {
    "editor.defaultFormatter": "charliermarsh.ruff",
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": {
      "source.fixAll.ruff": "explicit",
      "source.organizeImports.ruff": "explicit"
    }
  },

  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.formatOnSave": true
  },

  "[typescriptreact]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode",
    "editor.formatOnSave": true
  },

  "tailwindCSS.experimental.classRegex": [
    ["clsx\\(([^)]*)\\)", "(?:'|\"|`)([^']*)(?:'|\"|`)"]
  ],

  "files.exclude": {
    "**/__pycache__": true,
    "**/.pytest_cache": true,
    "**/node_modules": true
  },

  "editor.minimap.enabled": false,
  "editor.fontSize": 14,
  "editor.lineHeight": 1.6
}
```

### 8.4 Настрой запуск/дебаг в Cursor/VSCode

Создай `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "FastAPI Backend",
      "type": "debugpy",
      "request": "launch",
      "module": "uvicorn",
      "args": ["app.main:app", "--reload", "--port", "8000"],
      "cwd": "${workspaceFolder}/backend",
      "envFile": "${workspaceFolder}/.env",
      "jinja": true
    },
    {
      "name": "Pytest",
      "type": "debugpy",
      "request": "launch",
      "module": "pytest",
      "args": ["tests/", "-v"],
      "cwd": "${workspaceFolder}/backend",
      "envFile": "${workspaceFolder}/.env"
    }
  ]
}
```

Теперь можешь запускать бэкенд через F5 (Run → Start Debugging) с полноценной отладкой, точками останова и т.д.

---

## 9. Docker Compose (всё одной командой)

Если не хочешь настраивать PostgreSQL/Redis вручную:

```bash
cd ~/Projects/miqyas

# Скопируй .env
cp .env.example .env

# Запусти всю инфраструктуру:
docker compose -f docker/docker-compose.yml up --build
```

Это поднимет:
- PostgreSQL 15 на порту 5432
- Redis 7 на порту 6379
- FastAPI бэкенд на порту 8000 (с автоматическими миграциями)
- Celery воркер
- React фронтенд на порту 3000 (через nginx)

**Остановить:**

```bash
docker compose -f docker/docker-compose.yml down
```

**Остановить и удалить данные:**

```bash
docker compose -f docker/docker-compose.yml down -v
```

---

## 10. Частые проблемы и решения

### «Port 5432 already in use»

У тебя уже запущен PostgreSQL (через Homebrew или другой).

```bash
# Проверь, что занимает порт:
lsof -i :5432

# Если это Homebrew PostgreSQL и ты хочешь Docker:
brew services stop postgresql@15
```

### «psycopg2 — pg_config not found»

```bash
brew install libpq
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
pip install psycopg2-binary
```

### «ModuleNotFoundError: No module named 'app'»

Убедись, что ты запускаешь `uvicorn` из директории `backend/`:

```bash
cd ~/Projects/miqyas/backend
source .venv/bin/activate
uvicorn app.main:app --reload
```

### «alembic.util.exc.CommandError: Can't locate revision»

```bash
# Пересоздай базу:
psql postgres -c "DROP DATABASE miqyas;"
psql postgres -c "CREATE DATABASE miqyas OWNER miqyas;"

# Запусти миграции заново:
alembic upgrade head
```

### Frontend: «CORS error» или «Network Error»

Убедись, что бэкенд запущен на порту 8000. Vite проксирует `/api` на `http://localhost:8000`.

### Frontend: «Module not found: three/examples/jsm/...»

```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

### Docker: «Cannot connect to the Docker daemon»

Запусти Docker Desktop. Подожди, пока иконка кита в трее перестанет мигать.

### «Permission denied» при записи в uploads/

```bash
mkdir -p ~/Projects/miqyas/backend/uploads/{ifc,video,frames}
chmod -R 755 ~/Projects/miqyas/backend/uploads
```

---

## Порядок запуска (памятка)

Каждый раз, когда садишься работать:

```bash
# Терминал 1 — Бэкенд
cd ~/Projects/miqyas/backend
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000

# Терминал 2 — Celery
cd ~/Projects/miqyas/backend
source .venv/bin/activate
celery -A app.tasks.worker worker --loglevel=info -Q parsing,default

# Терминал 3 — Фронтенд
cd ~/Projects/miqyas/frontend
npm run dev
```

Или одной командой через Docker:

```bash
cd ~/Projects/miqyas
docker compose -f docker/docker-compose.yml up
```

---

## Готово!

Открой http://localhost:3000 — ты увидишь MIQYAS.

Для следующей сессии с Claude начни с:

> «Let's build Week 3: FFmpeg frame extraction service, cubemap conversion, COLMAP orchestration scripts, and manual alignment UI.»

И вставь содержимое `CONTEXT.md` в начало разговора.
