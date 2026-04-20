"""
Report Generator Service — generates PDF progress reports from pipeline results.

Uses ReportLab to build professional PDF reports containing:
  - Executive summary with overall progress
  - Deviation breakdown (ahead / on_track / behind / not_started)
  - Per-element progress table with confidence scores
  - Narrative summaries for each deviation category
  - Activity-level schedule cross-reference
"""

import logging
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BIMElement,
    DeviationType,
    ProgressItem,
    Project,
    Report,
    ReportStatus,
    VideoCapture,
)

logger = logging.getLogger(__name__)


class ReportData:
    """Aggregated data for report generation."""

    def __init__(self):
        self.project_name: str = ""
        self.project_code: str = ""
        self.report_title: str = ""
        self.generated_at: datetime = datetime.utcnow()
        self.capture_date: str | None = None
        self.capture_filename: str = ""
        self.total_elements: int = 0
        self.ahead_count: int = 0
        self.on_track_count: int = 0
        self.behind_count: int = 0
        self.not_started_count: int = 0
        self.extra_work_count: int = 0
        self.avg_observed: float = 0.0
        self.avg_scheduled: float = 0.0
        self.avg_confidence: float = 0.0
        self.items: list[dict[str, Any]] = []
        self.executive_summary: str = ""


class ReportGenerator:
    """Generates PDF reports from progress analysis results."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def gather_report_data(
        self,
        project_id: UUID,
        capture_id: UUID | None = None,
    ) -> ReportData:
        """Gather all data needed for report generation."""
        data = ReportData()

        # Project info
        project = await self.db.get(Project, project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")
        data.project_name = project.name
        data.project_code = project.code

        # Capture info
        capture = None
        if capture_id:
            capture = await self.db.get(VideoCapture, capture_id)
            if capture:
                data.capture_filename = capture.filename
                data.capture_date = str(capture.capture_date) if capture.capture_date else None

        # Progress items
        query = select(ProgressItem).where(ProgressItem.element_id.isnot(None))
        if capture_id:
            query = query.where(ProgressItem.capture_id == capture_id)
        else:
            # Get latest capture for project
            cap_result = await self.db.execute(
                select(VideoCapture)
                .where(VideoCapture.project_id == project_id)
                .order_by(VideoCapture.created_at.desc())
                .limit(1)
            )
            capture = cap_result.scalar_one_or_none()
            if capture:
                query = query.where(ProgressItem.capture_id == capture.id)
                data.capture_filename = capture.filename
                data.capture_date = str(capture.capture_date) if capture.capture_date else None

        result = await self.db.execute(query)
        progress_items = list(result.scalars().all())

        data.total_elements = len(progress_items)

        if not progress_items:
            data.report_title = f"Progress Report — {project.name}"
            data.executive_summary = "No progress data available. Run the analysis pipeline first."
            return data

        # Aggregate stats
        for item in progress_items:
            dev = item.deviation_type
            if isinstance(dev, DeviationType):
                dev = dev.value
            if dev == "ahead":
                data.ahead_count += 1
            elif dev == "on_track":
                data.on_track_count += 1
            elif dev == "behind":
                data.behind_count += 1
            elif dev == "not_started":
                data.not_started_count += 1
            elif dev == "extra_work":
                data.extra_work_count += 1

        data.avg_observed = round(
            sum(i.observed_percent for i in progress_items) / len(progress_items), 1
        )
        data.avg_scheduled = round(
            sum(i.scheduled_percent for i in progress_items) / len(progress_items), 1
        )
        data.avg_confidence = round(
            sum(i.confidence_score for i in progress_items) / len(progress_items), 3
        )

        # Per-item details with element names
        for item in progress_items:
            element = await self.db.get(BIMElement, item.element_id)
            element_name = element.name if element else str(item.element_id)[:8]
            dev = item.deviation_type
            if isinstance(dev, DeviationType):
                dev = dev.value

            data.items.append({
                "element_name": element_name,
                "ifc_type": element.ifc_type if element else "",
                "level": element.level if element else "",
                "observed_percent": item.observed_percent,
                "scheduled_percent": item.scheduled_percent,
                "deviation_type": dev,
                "deviation_days": item.deviation_days,
                "confidence_score": item.confidence_score,
                "narrative": item.narrative,
            })

        # Sort: behind first, then not_started, then on_track, then ahead
        priority = {"behind": 0, "not_started": 1, "extra_work": 2, "on_track": 3, "ahead": 4}
        data.items.sort(key=lambda x: (priority.get(x["deviation_type"], 5), -x["observed_percent"]))

        # Generate executive summary
        data.report_title = f"Progress Report — {project.name}"
        data.executive_summary = self._build_executive_summary(data)

        return data

    def _build_executive_summary(self, data: ReportData) -> str:
        """Build a text executive summary from aggregated data."""
        total = data.total_elements
        lines = [
            f"Analysis of {total} tracked elements shows an average observed completion "
            f"of {data.avg_observed}% against {data.avg_scheduled}% scheduled.",
        ]

        if data.behind_count > 0:
            pct = round(data.behind_count / total * 100)
            lines.append(
                f"ATTENTION: {data.behind_count} elements ({pct}%) are behind schedule. "
                f"Immediate review recommended."
            )

        if data.ahead_count > 0:
            pct = round(data.ahead_count / total * 100)
            lines.append(f"{data.ahead_count} elements ({pct}%) are ahead of schedule.")

        if data.on_track_count > 0:
            pct = round(data.on_track_count / total * 100)
            lines.append(f"{data.on_track_count} elements ({pct}%) are on track.")

        if data.not_started_count > 0:
            pct = round(data.not_started_count / total * 100)
            lines.append(f"{data.not_started_count} elements ({pct}%) have not yet started.")

        lines.append(f"Average confidence score: {data.avg_confidence:.1%}.")

        return " ".join(lines)

    def generate_pdf_bytes(self, data: ReportData) -> bytes:
        """Generate a PDF report and return raw bytes."""
        try:
            return self._build_pdf_reportlab(data)
        except ImportError:
            logger.warning("ReportLab not installed, generating simple text-based PDF")
            return self._build_pdf_simple(data)

    def _build_pdf_reportlab(self, data: ReportData) -> bytes:
        """Build PDF using ReportLab."""
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import (
            Paragraph,
            SimpleDocTemplate,
            Spacer,
            Table,
            TableStyle,
        )

        buffer = BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            leftMargin=20 * mm,
            rightMargin=20 * mm,
            topMargin=25 * mm,
            bottomMargin=20 * mm,
        )

        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            "CustomTitle",
            parent=styles["Title"],
            fontSize=20,
            spaceAfter=6 * mm,
            textColor=colors.HexColor("#0a7cff"),
        )
        heading_style = ParagraphStyle(
            "CustomHeading",
            parent=styles["Heading2"],
            fontSize=14,
            spaceBefore=8 * mm,
            spaceAfter=4 * mm,
            textColor=colors.HexColor("#1e293b"),
        )
        body_style = ParagraphStyle(
            "CustomBody",
            parent=styles["Normal"],
            fontSize=10,
            leading=14,
            textColor=colors.HexColor("#334155"),
        )
        small_style = ParagraphStyle(
            "SmallText",
            parent=styles["Normal"],
            fontSize=8,
            textColor=colors.HexColor("#64748b"),
        )

        story = []

        # Header
        story.append(Paragraph("MIQYAS", ParagraphStyle(
            "Brand", parent=styles["Normal"],
            fontSize=10, textColor=colors.HexColor("#64748b"),
            spaceAfter=2 * mm,
        )))
        story.append(Paragraph(data.report_title, title_style))

        # Metadata
        meta_lines = [
            f"Project: {data.project_name} ({data.project_code})",
            f"Generated: {data.generated_at.strftime('%Y-%m-%d %H:%M UTC')}",
        ]
        if data.capture_filename:
            meta_lines.append(f"Video Capture: {data.capture_filename}")
        if data.capture_date:
            meta_lines.append(f"Capture Date: {data.capture_date}")

        for line in meta_lines:
            story.append(Paragraph(line, small_style))
        story.append(Spacer(1, 6 * mm))

        # Executive Summary
        story.append(Paragraph("Executive Summary", heading_style))
        story.append(Paragraph(data.executive_summary, body_style))
        story.append(Spacer(1, 4 * mm))

        # Deviation Breakdown
        story.append(Paragraph("Deviation Breakdown", heading_style))

        dev_colors = {
            "ahead": colors.HexColor("#10b981"),
            "on_track": colors.HexColor("#0a7cff"),
            "behind": colors.HexColor("#ef4444"),
            "not_started": colors.HexColor("#64748b"),
            "extra_work": colors.HexColor("#f59e0b"),
        }

        breakdown_data = [
            ["Status", "Count", "Percentage"],
            ["Ahead", str(data.ahead_count), f"{data.ahead_count / max(data.total_elements, 1) * 100:.0f}%"],
            ["On Track", str(data.on_track_count), f"{data.on_track_count / max(data.total_elements, 1) * 100:.0f}%"],
            ["Behind", str(data.behind_count), f"{data.behind_count / max(data.total_elements, 1) * 100:.0f}%"],
            ["Not Started", str(data.not_started_count), f"{data.not_started_count / max(data.total_elements, 1) * 100:.0f}%"],
        ]
        if data.extra_work_count:
            breakdown_data.append([
                "Extra Work", str(data.extra_work_count),
                f"{data.extra_work_count / max(data.total_elements, 1) * 100:.0f}%",
            ])

        breakdown_table = Table(breakdown_data, colWidths=[60 * mm, 30 * mm, 30 * mm])
        breakdown_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
            ("ALIGN", (1, 0), (-1, -1), "CENTER"),
            # Color-code status cells
            ("TEXTCOLOR", (0, 1), (0, 1), dev_colors["ahead"]),
            ("TEXTCOLOR", (0, 2), (0, 2), dev_colors["on_track"]),
            ("TEXTCOLOR", (0, 3), (0, 3), dev_colors["behind"]),
            ("TEXTCOLOR", (0, 4), (0, 4), dev_colors["not_started"]),
        ]))
        story.append(breakdown_table)
        story.append(Spacer(1, 6 * mm))

        # Element Details Table
        if data.items:
            story.append(Paragraph("Element Progress Details", heading_style))

            table_data = [["Element", "Type", "Level", "Observed", "Scheduled", "Status", "Conf."]]
            for item in data.items[:100]:  # Cap at 100 rows
                table_data.append([
                    item["element_name"][:30],
                    item["ifc_type"][:15],
                    item["level"][:10],
                    f"{item['observed_percent']:.0f}%",
                    f"{item['scheduled_percent']:.0f}%",
                    item["deviation_type"].replace("_", " ").title(),
                    f"{item['confidence_score']:.0%}",
                ])

            col_widths = [45 * mm, 25 * mm, 20 * mm, 20 * mm, 20 * mm, 22 * mm, 18 * mm]
            detail_table = Table(table_data, colWidths=col_widths)

            table_style_cmds = [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                ("ALIGN", (3, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]

            # Color-code deviation status column
            for i, item in enumerate(data.items[:100], start=1):
                dev = item["deviation_type"]
                if dev in dev_colors:
                    table_style_cmds.append(("TEXTCOLOR", (5, i), (5, i), dev_colors[dev]))

            detail_table.setStyle(TableStyle(table_style_cmds))
            story.append(detail_table)

        # Narratives for behind-schedule items
        behind_items = [i for i in data.items if i["deviation_type"] == "behind"]
        if behind_items:
            story.append(Spacer(1, 6 * mm))
            story.append(Paragraph("Items Requiring Attention", heading_style))
            for item in behind_items[:20]:
                story.append(Paragraph(
                    f"<b>{item['element_name']}</b>: {item['narrative']}",
                    body_style,
                ))
                story.append(Spacer(1, 2 * mm))

        # Footer
        story.append(Spacer(1, 10 * mm))
        story.append(Paragraph(
            "Generated by MIQYAS — AI-Powered Construction Progress Tracking",
            small_style,
        ))

        doc.build(story)
        return buffer.getvalue()

    def _build_pdf_simple(self, data: ReportData) -> bytes:
        """Fallback: build a minimal PDF without ReportLab using raw PDF spec."""
        lines = [
            data.report_title,
            f"Generated: {data.generated_at.strftime('%Y-%m-%d %H:%M UTC')}",
            "",
            "EXECUTIVE SUMMARY",
            data.executive_summary,
            "",
            f"Total Elements: {data.total_elements}",
            f"Ahead: {data.ahead_count}  |  On Track: {data.on_track_count}  |  Behind: {data.behind_count}  |  Not Started: {data.not_started_count}",
            f"Avg Observed: {data.avg_observed}%  |  Avg Scheduled: {data.avg_scheduled}%",
            f"Avg Confidence: {data.avg_confidence:.1%}",
            "",
            "--- Element Details ---",
        ]
        for item in data.items[:50]:
            lines.append(
                f"{item['element_name']} | {item['deviation_type']} | "
                f"Obs: {item['observed_percent']:.0f}% | Sched: {item['scheduled_percent']:.0f}%"
            )

        text = "\n".join(lines)

        # Minimal PDF 1.4
        content = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        content_stream = f"BT /F1 10 Tf 50 750 Td ({content[:3000]}) Tj ET"
        stream_length = len(content_stream)

        pdf = f"""%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length {stream_length} >> stream
{content_stream}
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
trailer << /Size 6 /Root 1 0 R >>
startxref
%%EOF"""
        return pdf.encode("latin-1")

    async def create_report(
        self,
        project_id: UUID,
        capture_id: UUID | None = None,
        report_type: str = "progress",
        output_dir: Path | None = None,
    ) -> Report:
        """
        Full report creation flow:
        1. Gather data
        2. Generate PDF
        3. Save to disk
        4. Create DB record
        """
        data = await self.gather_report_data(project_id, capture_id)

        if output_dir is None:
            output_dir = Path("./uploads/reports")
        output_dir.mkdir(parents=True, exist_ok=True)

        # Generate PDF
        pdf_bytes = self.generate_pdf_bytes(data)

        # Save file
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        filename = f"miqyas_report_{data.project_code}_{timestamp}.pdf"
        pdf_path = output_dir / filename
        pdf_path.write_bytes(pdf_bytes)

        logger.info(f"PDF report saved: {pdf_path} ({len(pdf_bytes)} bytes)")

        # Create DB record
        report = Report(
            project_id=project_id,
            capture_id=capture_id,
            title=data.report_title,
            report_type=report_type,
            status=ReportStatus.READY,
            pdf_path=str(pdf_path),
            summary={
                "total_elements": data.total_elements,
                "ahead": data.ahead_count,
                "on_track": data.on_track_count,
                "behind": data.behind_count,
                "not_started": data.not_started_count,
                "extra_work": data.extra_work_count,
                "avg_observed": data.avg_observed,
                "avg_scheduled": data.avg_scheduled,
                "avg_confidence": data.avg_confidence,
                "executive_summary": data.executive_summary,
            },
            generated_at=datetime.utcnow(),
        )
        self.db.add(report)
        await self.db.flush()

        return report
