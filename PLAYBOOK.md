# MIQYAS — Production Playbook

**Goal:** Turn MIQYAS from a scaffolded demo into a working product.

This playbook is ordered by impact. Each phase builds on the previous one.
No phase requires all previous phases to be 100% done — but the order matters.

---

## Phase 1: Make the CV Pipeline Real

**Why first:** The entire value proposition — "AI sees your construction site and tells you what's behind schedule" — is currently fake. Segmentation is mocked, comparison falls back to random data. Fix this and the product actually works.

**Time estimate:** 1–2 weeks

### 1A. Install ML dependencies

```bash
# In backend venv
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install transformers accelerate
```

On M2 Pro, PyTorch supports MPS (Metal) natively. For production GPU server, use CUDA wheels instead.

Add to `backend/requirements.txt`:
```
torch>=2.2.0
torchvision>=0.17.0
transformers>=4.38.0
accelerate>=0.27.0
```

### 1B. Remove the mock flag

**File:** `backend/app/tasks/cv_tasks.py` line 35

Change:
```python
use_mock=True,  # Set False when real GPU + model are available
```
To:
```python
use_mock=False,
```

Change `device` default from `"cpu"` to `"mps"` for local M2 testing:
```python
device: str = "mps",  # "cuda" for GPU server, "cpu" for fallback
```

### 1C. Add device auto-detection

**File:** `backend/app/services/segmentation/__init__.py`

Add a helper at module top:
```python
def _best_device() -> str:
    import torch
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"
```

Use it as the default device instead of hardcoding.

### 1D. Test segmentation end-to-end

1. Upload a real 360° video to a project
2. Extract frames (uses FFmpeg — already works)
3. Trigger segmentation: `POST /api/v1/projects/{id}/captures/{id}/segment`
4. Check `segmentation_results` table — should have real mask paths and class maps
5. Verify masks on disk look like actual room segmentation, not geometric blocks

### 1E. Remove the silent mock fallback in comparison

**File:** `backend/app/tasks/cv_tasks.py` lines 148–162

The current code silently falls back to `_run_mock()` and generates random data. This is dangerous — a user gets a professional PDF with completely fake numbers.

Replace the try/except with explicit failure:
```python
async with async_session() as session:
    comp_count, item_count = await _run_real(session)
    if item_count == 0:
        raise RuntimeError(
            "Comparison produced 0 progress items. "
            "Check: 1) COLMAP alignment has real poses, "
            "2) Segmentation ran with use_mock=False, "
            "3) BIM elements have bounding boxes."
        )
    await session.commit()
    return comp_count, item_count
```

Keep `_run_mock()` available but only callable explicitly via a `?mock=true` API parameter for development/testing. Never silently.

---

## Phase 2: Fix BIM Expected Mask Rendering

**Why:** Even with real segmentation, the "expected vs observed" comparison is only as good as the expected masks. Currently the renderer projects bounding boxes (rectangles), not actual building geometry. IoU between a real wall segmentation and a projected rectangle will be low and noisy.

**Time estimate:** 1 week

### 2A. Replace bbox projection with mesh rasterization

**File:** `backend/app/services/bim_renderer/__init__.py`

Current approach: 8 bbox corners → project to 2D → fill convex hull.

Better approach using `pyrender` + `trimesh`:

```bash
pip install pyrender trimesh
```

1. Load IFC mesh geometry via IfcOpenShell (already extracts verts in `_compute_all_bboxes`)
2. Build `trimesh.Trimesh` per element from vertex data
3. Use `pyrender.OffscreenRenderer` to render depth + element ID maps
4. Extract per-element binary masks from the ID map

This gives pixel-accurate expected masks instead of rectangular approximations.

### 2B. Store mesh data during IFC parsing

**File:** `backend/app/services/ifc_parser/parser.py`

The parser already iterates geometry with `ifcopenshell.geom.iterator`. Currently it only extracts bboxes (min/max). Extend it to also store triangle mesh data:

Add a `geometry_mesh` JSONB column to `bim_elements` (or store as files):
```python
{
    "vertices": [[x,y,z], ...],
    "faces": [[i,j,k], ...],
}
```

This data feeds into Phase 2A's mesh rasterization.

### 2C. Validate comparison quality

After implementing real rendering:
1. Pick 5 BIM elements visible in a frame
2. Compare the rendered expected mask vs the segmentation mask visually
3. IoU should be 0.3–0.8 for elements that actually exist on site
4. IoU near 0.0 = element not built yet (correct "not_started")
5. IoU near 0.0 but element IS visible = bad alignment or bad segmentation

---

## Phase 3: Make COLMAP Reliable

**Why:** Camera alignment is the bridge between "what the camera sees" and "where things are in BIM space." If alignment is wrong, every comparison is wrong.

**Time estimate:** 3–5 days

### 3A. Remove identity matrix fallback

**File:** `backend/app/services/colmap_orchestrator/__init__.py` lines 176–196

The mock alignment creates an identity transformation matrix. Downstream code doesn't know it's fake. Remove this and fail explicitly:

```python
if not await self._colmap_available():
    raise RuntimeError(
        "COLMAP binary not found. Install it: brew install colmap"
    )
```

### 3B. Validate COLMAP output quality

After COLMAP runs, check:
- Number of registered images (should be >50% of input frames)
- Mean reprojection error (<2.0 pixels is good, >5.0 is bad)
- Store these as fields on `CameraAlignment` and expose in API

Add quality gate: if <30% of frames register, warn user that alignment is unreliable.

### 3C. Improve manual alignment as backup

The manual alignment (PnP solver) is already implemented. It's the honest alternative when COLMAP fails. Improve the UI to guide users:
- Show which corners/features to click
- Show reprojection error in real time
- Require minimum 6 control points

---

## Phase 4: Frontend — Real IFC Mesh Viewer

**Why:** The 3D viewer currently shows axis-aligned boxes. For a construction product, users need to see actual building geometry — walls, columns, slabs with real shapes.

**Time estimate:** 1 week

### 4A. Implement web-ifc mesh loading

`web-ifc` is already in `package.json` but never used. The viewer at `BIMViewerPage.tsx` line 734 creates `BoxGeometry` from bboxes.

Replace bbox rendering with IFC mesh loading:

```typescript
import { IfcAPI } from "web-ifc";

const ifcApi = new IfcAPI();
await ifcApi.Init();
// Load IFC file from backend URL
const data = await fetch(`/api/v1/projects/${projectId}/bim/models/${modelId}/file`);
const buffer = await data.arrayBuffer();
const modelID = ifcApi.OpenModel(new Uint8Array(buffer));
// Extract mesh geometry per element
```

### 4B. Add IFC file download endpoint

**File:** `backend/app/api/v1/bim.py`

Add endpoint to serve the original IFC file:
```python
@router.get("/projects/{project_id}/bim/models/{model_id}/file")
async def download_ifc(project_id: UUID, model_id: UUID, db: AsyncSession = Depends(get_db)):
    model = await db.get(BIMModel, model_id)
    return FileResponse(model.storage_path, media_type="application/octet-stream")
```

### 4C. Keep bbox fallback for large models

IFC mesh loading can be slow for models >50MB. Keep bboxes as a fast-load mode that switches to full mesh on demand.

---

## Phase 5: Fix UI Gaps

**Time estimate:** 3–5 days

### 5A. Report status polling

**File:** `frontend/src/pages/ReportsPage.tsx`

Currently, after clicking "Generate Report", the UI doesn't poll for completion. Add:
```typescript
useEffect(() => {
  if (!reports.some(r => r.status === "generating" || r.status === "pending")) return;
  const timer = setInterval(() => fetchReports(selectedProject), 3000);
  return () => clearInterval(timer);
}, [reports, selectedProject]);
```

### 5B. Pipeline progress visibility

**File:** `frontend/src/pages/ProjectDetailPage.tsx` — Captures tab

The task polling exists (2s interval) but error messages are generic. Show:
- Which step failed (extraction? alignment? segmentation? comparison?)
- Actionable message ("COLMAP failed — try manual alignment instead")
- Link to manual alignment UI when COLMAP fails

### 5C. Mark mock data in UI

If mock data is detected (narrative starts with "Mock:"), show a warning badge:
```typescript
{item.narrative.startsWith("Mock:") && (
  <span className="badge badge-warning">Simulated</span>
)}
```

### 5D. Loading states for all pages

Apply `<SkeletonTable>` and `<SkeletonCard>` (already built in Week 8) to:
- ProjectDetailPage tab content
- ScheduleDetailPage activity list
- ReportsPage report list
- IntegrationsPage sections

---

## Phase 6: Production Infrastructure

**Time estimate:** 1 week

### 6A. Separate GPU worker

The ML inference (segmentation) should run on a dedicated Celery worker with GPU access:

```yaml
# docker-compose.prod.yml
celery-gpu:
  build: ...
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
  command: celery -A app.tasks.worker worker -Q gpu --concurrency=1
  environment:
    DEVICE: cuda
```

For M2 Pro local dev, run a single worker with all queues — MPS handles it.

### 6B. File storage migration (local → S3)

Currently all files (IFC, videos, frames, masks, PDFs) are stored on local disk.

For production:
1. Add `boto3` to requirements
2. Create a `StorageService` with `upload()`, `download()`, `url()` methods
3. Abstract file paths throughout codebase to use StorageService
4. Config toggle: `STORAGE_BACKEND=local|s3`

### 6C. Database backups

Add to production compose:
```yaml
backup:
  image: prodrigestivill/postgres-backup-local
  volumes:
    - ./backups:/backups
  environment:
    POSTGRES_HOST: postgres
    SCHEDULE: "@daily"
    BACKUP_KEEP_DAYS: 7
```

### 6D. SSL/HTTPS

Add Caddy or Traefik as reverse proxy with automatic Let's Encrypt:
```yaml
caddy:
  image: caddy:2-alpine
  ports:
    - "80:80"
    - "443:443"
  volumes:
    - ./Caddyfile:/etc/caddy/Caddyfile
    - caddy_data:/data
```

### 6E. Logging and monitoring

- Structured JSON logging (replace print/logger with `structlog`)
- Prometheus metrics endpoint (`prometheus-fastapi-instrumentator`)
- Grafana dashboard for request latency, error rates, task queue depth

---

## Phase 7: Procore Integration Testing

**Time estimate:** 3–5 days (requires Procore Developer account)

### 7A. Get Procore sandbox credentials

1. Create account at https://developers.procore.com
2. Create an app in their Developer Portal
3. Get Client ID + Client Secret
4. Set redirect URI to `http://localhost:3000/projects/{id}/integrations`

### 7B. Test OAuth flow

1. Set credentials in `.env`
2. Open Integrations page, click Connect
3. Complete OAuth in Procore sandbox
4. Verify `procore_configs` table has access_token

### 7C. Test RFI/Issue push

1. Select a project with progress items
2. Push a "behind" element as RFI
3. Verify it appears in Procore sandbox project

---

## What to Build First

If you have **1 day**: Phase 1A + 1B + 1E → real segmentation, no silent mocks

If you have **1 week**: Phases 1 + 3A + 5A + 5C → real pipeline with honest errors

If you have **2 weeks**: Phases 1–3 + 5 → fully real CV pipeline + polished UI

If you have **1 month**: All 7 phases → production-ready product

---

## Architecture After All Phases

```
User uploads 360° video
  → FFmpeg extracts frames (REAL — already works)
  → COLMAP reconstructs camera poses (REAL — already works with binary)
  → Mask2Former segments each frame (REAL — after Phase 1)
  → BIM renderer creates expected masks from IFC mesh (REAL — after Phase 2)
  → IoU engine compares observed vs expected (REAL — already works)
  → Progress engine determines deviation per element (REAL — already works)
  → Report generator creates PDF (REAL — already works)
  → Procore push creates RFI for behind elements (REAL — after Phase 7)
  → 3D viewer shows actual IFC geometry with deviation colors (REAL — after Phase 4)
```

Every step produces real data. No mocks. No silent fallbacks.
