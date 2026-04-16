"""Reports API — generate, list, download PDF progress reports."""

from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models import Report, ReportStatus

router = APIRouter(prefix="/projects/{project_id}/reports", tags=["reports"])


# ── Schemas ─────────────────────────────────────────────────────────────

class ReportCreateRequest(BaseModel):
    capture_id: str | None = None
    report_type: str = "progress"
    title: str | None = None


class ReportResponse(BaseModel):
    id: str
    project_id: str
    capture_id: str | None
    title: str
    report_type: str
    status: str
    pdf_path: str | None
    summary: dict
    generated_at: str | None
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


# ── Endpoints ───────────────────────────────────────────────────────────

@router.get("/", response_model=list[ReportResponse])
async def list_reports(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """List all reports for a project, newest first."""
    result = await db.execute(
        select(Report)
        .where(Report.project_id == project_id)
        .order_by(Report.created_at.desc())
    )
    reports = result.scalars().all()

    return [
        ReportResponse(
            id=str(r.id),
            project_id=str(r.project_id),
            capture_id=str(r.capture_id) if r.capture_id else None,
            title=r.title,
            report_type=r.report_type,
            status=r.status.value if isinstance(r.status, ReportStatus) else r.status,
            pdf_path=r.pdf_path,
            summary=r.summary or {},
            generated_at=r.generated_at.isoformat() if r.generated_at else None,
            created_at=r.created_at.isoformat(),
            updated_at=r.updated_at.isoformat(),
        )
        for r in reports
    ]


@router.post("/generate", response_model=ReportResponse)
async def generate_report(
    project_id: UUID,
    body: ReportCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """Generate a new PDF report for the project."""
    from app.services.report_generator import ReportGenerator

    generator = ReportGenerator(db)

    capture_id = UUID(body.capture_id) if body.capture_id else None

    try:
        from app.core.config import get_settings
        settings = get_settings()
        report = await generator.create_report(
            project_id=project_id,
            capture_id=capture_id,
            report_type=body.report_type,
            output_dir=settings.report_storage_dir,
        )
        await db.commit()
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Report generation failed: {e}")

    return ReportResponse(
        id=str(report.id),
        project_id=str(report.project_id),
        capture_id=str(report.capture_id) if report.capture_id else None,
        title=report.title,
        report_type=report.report_type,
        status=report.status.value if isinstance(report.status, ReportStatus) else report.status,
        pdf_path=report.pdf_path,
        summary=report.summary or {},
        generated_at=report.generated_at.isoformat() if report.generated_at else None,
        created_at=report.created_at.isoformat(),
        updated_at=report.updated_at.isoformat(),
    )


@router.get("/{report_id}", response_model=ReportResponse)
async def get_report(
    project_id: UUID,
    report_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Get a single report's details."""
    report = await db.get(Report, report_id)
    if not report or report.project_id != project_id:
        raise HTTPException(status_code=404, detail="Report not found")

    return ReportResponse(
        id=str(report.id),
        project_id=str(report.project_id),
        capture_id=str(report.capture_id) if report.capture_id else None,
        title=report.title,
        report_type=report.report_type,
        status=report.status.value if isinstance(report.status, ReportStatus) else report.status,
        pdf_path=report.pdf_path,
        summary=report.summary or {},
        generated_at=report.generated_at.isoformat() if report.generated_at else None,
        created_at=report.created_at.isoformat(),
        updated_at=report.updated_at.isoformat(),
    )


@router.get("/{report_id}/download")
async def download_report_pdf(
    project_id: UUID,
    report_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Download the PDF file for a report."""
    report = await db.get(Report, report_id)
    if not report or report.project_id != project_id:
        raise HTTPException(status_code=404, detail="Report not found")

    if not report.pdf_path:
        raise HTTPException(status_code=404, detail="PDF not yet generated")

    pdf_path = Path(report.pdf_path)
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF file not found on disk")

    return FileResponse(
        path=str(pdf_path),
        media_type="application/pdf",
        filename=pdf_path.name,
    )


@router.delete("/{report_id}")
async def delete_report(
    project_id: UUID,
    report_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """Delete a report and its PDF file."""
    report = await db.get(Report, report_id)
    if not report or report.project_id != project_id:
        raise HTTPException(status_code=404, detail="Report not found")

    # Delete PDF file
    if report.pdf_path:
        pdf_path = Path(report.pdf_path)
        if pdf_path.exists():
            pdf_path.unlink()

    await db.delete(report)
    await db.commit()

    return {"status": "deleted", "report_id": str(report_id)}
