"""Site Diary API — serves the Welcome Center 360° photo analysis dataset.

This is the MIQYAS validation dataset: 37 hand-classified 360° equirectangular
panoramas from a 9-week interior fit-out, with AI-reconstructed schedule and
per-capture progress analysis.

Endpoints:
  GET  /site-diary/welcome-center          → full analysis JSON
  GET  /site-diary/welcome-center/photos/{filename}  → serve individual JPG
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(prefix="/site-diary", tags=["site-diary"])

# ── Resolve asset paths once at import time ─────────────────────────────────
# Works regardless of current working directory.
_HERE = Path(__file__).resolve()
_ASSETS_DIR = _HERE.parents[4] / "assets" / "welcome_center"
_ANALYSIS_JSON = _ASSETS_DIR / "analysis.json"


@router.get("/welcome-center", summary="Welcome Center site diary analysis")
async def get_welcome_center_analysis():
    """Return the full 37-capture site diary analysis for the Welcome Center dataset."""
    if not _ANALYSIS_JSON.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                "analysis.json not found. "
                "Run: python3 scripts/analyze_site_diary.py --dry-run "
                "to generate the analysis file."
            ),
        )
    import json

    with open(_ANALYSIS_JSON) as f:
        return json.load(f)


@router.get(
    "/welcome-center/photos/{filename}",
    summary="Serve a Welcome Center 360° panorama photo",
    response_class=FileResponse,
)
async def get_welcome_center_photo(filename: str):
    """Stream a single JPG from the Welcome Center assets directory."""
    # Basic security: strip path traversal
    safe_name = Path(filename).name
    photo_path = _ASSETS_DIR / safe_name

    if not photo_path.exists() or not photo_path.suffix.lower() in {".jpg", ".jpeg"}:
        raise HTTPException(status_code=404, detail=f"Photo not found: {safe_name}")

    return FileResponse(
        path=photo_path,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )
