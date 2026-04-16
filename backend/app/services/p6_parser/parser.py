"""
P6 XER Parser — parses Primavera P6 .xer files into structured schedule data.

XER Format:
    Tab-delimited text file with table markers:
    %T <TABLE_NAME>
    %F <field1> <field2> ...
    %R <value1> <value2> ...
    (repeat %R rows)

Key tables:
    PROJECT  — project-level info
    PROJWBS  — WBS hierarchy
    TASK     — activities (the main table)
    TASKPRED — predecessor/successor relationships
    CALENDAR — work calendars
"""

import logging
from datetime import date, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Activity,
    ActivityRelationship,
    ActivityStatus,
    Schedule,
    WBSNode,
)

logger = logging.getLogger(__name__)


class XERTable:
    """Parsed representation of one %T table from an XER file."""

    def __init__(self, name: str, fields: list[str]):
        self.name = name
        self.fields = fields
        self.rows: list[dict[str, str]] = []

    def add_row(self, values: list[str]):
        row = {}
        for i, field in enumerate(self.fields):
            row[field] = values[i] if i < len(values) else ""
        self.rows.append(row)

    def __len__(self):
        return len(self.rows)

    def __repr__(self):
        return f"XERTable({self.name}, {len(self.rows)} rows)"


class XERFileParser:
    """Low-level parser that reads an XER file into XERTable objects."""

    def __init__(self, filepath: str | Path):
        self.filepath = Path(filepath)
        self.tables: dict[str, XERTable] = {}

    def parse(self) -> dict[str, XERTable]:
        """Read and parse the XER file. Returns dict of table_name -> XERTable."""
        content = self.filepath.read_text(encoding="utf-8", errors="replace")
        lines = content.split("\n")

        current_table: XERTable | None = None

        for line in lines:
            line = line.rstrip("\r")

            if line.startswith("%T"):
                # Table header
                table_name = line.split("\t")[1].strip() if "\t" in line else line[3:].strip()
                current_table = XERTable(table_name, [])
                self.tables[table_name] = current_table

            elif line.startswith("%F") and current_table is not None:
                # Field definitions
                fields = line.split("\t")[1:]  # skip %F marker
                current_table.fields = [f.strip() for f in fields]

            elif line.startswith("%R") and current_table is not None:
                # Data row
                values = line.split("\t")[1:]  # skip %R marker
                current_table.add_row(values)

            elif line.startswith("%E"):
                # End of table
                current_table = None

        logger.info(f"Parsed XER with tables: {list(self.tables.keys())}")
        return self.tables


class P6XERParserService:
    """High-level service that parses a P6 XER file and persists to database."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def parse(self, schedule_id: UUID) -> int:
        """
        Parse the XER file for the given Schedule and persist activities.
        Returns the count of activities extracted.
        """
        schedule = await self.db.get(Schedule, schedule_id)
        if not schedule:
            raise ValueError(f"Schedule {schedule_id} not found")

        schedule.parse_status = "parsing"
        await self.db.flush()

        try:
            parser = XERFileParser(schedule.storage_path)
            tables = parser.parse()

            # Extract metadata from PROJECT table
            schedule.extra_data = self._extract_project_metadata(tables)
            schedule.data_date = self._extract_data_date(tables)

            # Parse WBS hierarchy
            wbs_count = await self._persist_wbs(schedule, tables)

            # Parse activities
            activity_count = await self._persist_activities(schedule, tables)

            # Parse relationships
            rel_count = await self._persist_relationships(schedule, tables)

            schedule.activity_count = activity_count
            schedule.parse_status = "parsed"
            await self.db.flush()

            logger.info(
                f"Parsed {schedule.filename}: "
                f"{wbs_count} WBS nodes, {activity_count} activities, {rel_count} relationships"
            )
            return activity_count

        except Exception as e:
            schedule.parse_status = "failed"
            schedule.parse_error = str(e)
            await self.db.flush()
            logger.error(f"XER parse failed for {schedule.filename}: {e}")
            raise

    def _extract_project_metadata(self, tables: dict[str, XERTable]) -> dict:
        """Extract project-level metadata from the PROJECT table."""
        meta = {}
        if "PROJECT" in tables and tables["PROJECT"].rows:
            row = tables["PROJECT"].rows[0]
            meta["proj_short_name"] = row.get("proj_short_name", "")
            meta["proj_long_name"] = row.get("proj_long_name", "")
            meta["plan_start_date"] = row.get("plan_start_date", "")
            meta["plan_end_date"] = row.get("plan_end_date", "")
            meta["last_recalc_date"] = row.get("last_recalc_date", "")
        return meta

    def _extract_data_date(self, tables: dict[str, XERTable]) -> date | None:
        """Extract the P6 data date from PROJECT table."""
        if "PROJECT" in tables and tables["PROJECT"].rows:
            raw = tables["PROJECT"].rows[0].get("last_recalc_date", "")
            return self._parse_date(raw)
        return None

    async def _persist_wbs(self, schedule: Schedule, tables: dict[str, XERTable]) -> int:
        """Persist WBS hierarchy from PROJWBS table."""
        if "PROJWBS" not in tables:
            return 0

        wbs_nodes = []
        for row in tables["PROJWBS"].rows:
            node = WBSNode(
                schedule_id=schedule.id,
                p6_wbs_id=row.get("wbs_id", ""),
                parent_p6_wbs_id=row.get("parent_wbs_id", "") or None,
                name=row.get("wbs_name", row.get("wbs_short_name", "")),
                code=row.get("wbs_short_name", ""),
                level=self._safe_int(row.get("seq_num", "0")),
            )
            wbs_nodes.append(node)

        self.db.add_all(wbs_nodes)
        await self.db.flush()
        return len(wbs_nodes)

    async def _persist_activities(self, schedule: Schedule, tables: dict[str, XERTable]) -> int:
        """Persist activities from the TASK table."""
        if "TASK" not in tables:
            return 0

        activities = []
        for row in tables["TASK"].rows:
            # Determine activity status
            status = self._resolve_status(row)

            # Parse resource names from TASKRSRC if available
            resource_names = []

            activity = Activity(
                schedule_id=schedule.id,
                activity_id=row.get("task_code", row.get("task_id", "")),
                activity_code=row.get("task_code", ""),
                name=row.get("task_name", ""),
                wbs_p6_id=row.get("wbs_id", "") or None,
                planned_start=self._parse_date(row.get("target_start_date", "")),
                planned_finish=self._parse_date(row.get("target_end_date", "")),
                actual_start=self._parse_date(row.get("act_start_date", "")),
                actual_finish=self._parse_date(row.get("act_end_date", "")),
                planned_duration_days=self._safe_float(row.get("target_drtn_hr_cnt", "0")) / 8.0,
                remaining_duration_days=self._safe_float(row.get("remain_drtn_hr_cnt", "0")) / 8.0,
                percent_complete=self._safe_float(row.get("phys_complete_pct", "0")),
                status=status,
                activity_type=self._resolve_activity_type(row.get("task_type", "")),
                is_critical=row.get("driving_path_flag", "").upper() == "Y",
                total_float_days=self._safe_float(row.get("total_float_hr_cnt")) / 8.0 if row.get("total_float_hr_cnt") else None,
                calendar_id=row.get("clndr_id", "") or None,
                resource_names=resource_names,
                cost_budget=self._safe_float(row.get("target_cost", "")),
                cost_actual=self._safe_float(row.get("act_cost", "")),
                properties={
                    "task_id": row.get("task_id", ""),
                    "priority_type": row.get("priority_type", ""),
                    "suspend_date": row.get("suspend_date", ""),
                    "resume_date": row.get("resume_date", ""),
                },
            )
            activities.append(activity)

        self.db.add_all(activities)
        await self.db.flush()
        return len(activities)

    async def _persist_relationships(self, schedule: Schedule, tables: dict[str, XERTable]) -> int:
        """Persist predecessor/successor relationships from TASKPRED table."""
        if "TASKPRED" not in tables:
            return 0

        # Build a lookup from task_id (internal P6 ID) to task_code
        task_id_to_code = {}
        if "TASK" in tables:
            for row in tables["TASK"].rows:
                task_id_to_code[row.get("task_id", "")] = row.get("task_code", row.get("task_id", ""))

        relationships = []
        for row in tables["TASKPRED"].rows:
            pred_task_id = row.get("pred_task_id", "")
            succ_task_id = row.get("task_id", "")

            rel = ActivityRelationship(
                schedule_id=schedule.id,
                predecessor_activity_id=task_id_to_code.get(pred_task_id, pred_task_id),
                successor_activity_id=task_id_to_code.get(succ_task_id, succ_task_id),
                relationship_type=self._normalize_rel_type(row.get("pred_type", "FS")),
                lag_days=self._safe_float(row.get("lag_hr_cnt", "0")) / 8.0,
            )
            relationships.append(rel)

        self.db.add_all(relationships)
        await self.db.flush()
        return len(relationships)

    # ── Helpers ──────────────────────────────────────────────────────────

    def _resolve_status(self, row: dict[str, str]) -> ActivityStatus:
        """Determine activity status from P6 status code and dates."""
        p6_status = row.get("status_code", "").upper()
        if p6_status == "TK_COMPLETE":
            return ActivityStatus.COMPLETED
        elif p6_status == "TK_ACTIVE":
            return ActivityStatus.IN_PROGRESS
        elif p6_status == "TK_NOT_START":
            return ActivityStatus.NOT_STARTED
        # Fallback: check dates
        if row.get("act_end_date"):
            return ActivityStatus.COMPLETED
        elif row.get("act_start_date"):
            return ActivityStatus.IN_PROGRESS
        return ActivityStatus.NOT_STARTED

    def _resolve_activity_type(self, task_type: str) -> str:
        """Map P6 task_type codes to readable labels."""
        mapping = {
            "TT_TASK": "Task",
            "TT_MILE": "Milestone",
            "TT_LOE": "LOE",
            "TT_RSRC": "Resource Dependent",
            "TT_WBS": "WBS Summary",
            "TT_FINMILE": "Finish Milestone",
        }
        return mapping.get(task_type.upper(), task_type or "Task")

    def _normalize_rel_type(self, rel_type: str) -> str:
        """Normalize relationship type to standard codes."""
        mapping = {
            "PR_FS": "FS",
            "PR_FF": "FF",
            "PR_SS": "SS",
            "PR_SF": "SF",
        }
        return mapping.get(rel_type.upper(), rel_type[:2].upper() if rel_type else "FS")

    def _parse_date(self, date_str: str) -> date | None:
        """Parse P6 date strings (multiple formats)."""
        if not date_str or date_str.strip() == "":
            return None
        formats = [
            "%Y-%m-%d %H:%M",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%d",
            "%d-%b-%y",
            "%d-%b-%Y",
        ]
        for fmt in formats:
            try:
                return datetime.strptime(date_str.strip(), fmt).date()
            except ValueError:
                continue
        logger.warning(f"Could not parse date: {date_str}")
        return None

    def _safe_float(self, val: str | None) -> float:
        if not val or val.strip() == "":
            return 0.0
        try:
            return float(val)
        except (ValueError, TypeError):
            return 0.0

    def _safe_int(self, val: str | None) -> int:
        if not val or val.strip() == "":
            return 0
        try:
            return int(float(val))
        except (ValueError, TypeError):
            return 0


class P6XMLParserService:
    """
    Placeholder for P6 XML (.xml) parsing.

    P6 XML uses a different structure (standard XML with PMXML schema).
    This will be implemented if the client provides XML exports instead of XER.
    The API router already accepts both; this service mirrors XERParserService.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def parse(self, schedule_id: UUID) -> int:
        """Parse a P6 XML schedule file. Implementation follows XER parser pattern."""
        from lxml import etree

        schedule = await self.db.get(Schedule, schedule_id)
        if not schedule:
            raise ValueError(f"Schedule {schedule_id} not found")

        schedule.parse_status = "parsing"
        await self.db.flush()

        try:
            tree = etree.parse(schedule.storage_path)
            root = tree.getroot()

            # Remove namespace prefixes for easier XPath
            ns = {"p6": root.nsmap.get(None, "")}

            # Find project node
            project_nodes = root.findall(".//Project", ns) if ns["p6"] else root.findall(".//Project")
            if not project_nodes:
                # Try without namespace
                project_nodes = root.findall(".//{*}Project")

            activities = []
            for proj in project_nodes:
                for act_node in proj.findall(".//{*}Activity"):
                    activity_id = self._xml_text(act_node, "Id")
                    name = self._xml_text(act_node, "Name")
                    if not activity_id:
                        continue

                    activity = Activity(
                        schedule_id=schedule.id,
                        activity_id=activity_id,
                        activity_code=activity_id,
                        name=name or activity_id,
                        planned_start=self._xml_date(act_node, "PlannedStartDate"),
                        planned_finish=self._xml_date(act_node, "PlannedFinishDate"),
                        actual_start=self._xml_date(act_node, "ActualStartDate"),
                        actual_finish=self._xml_date(act_node, "ActualFinishDate"),
                        percent_complete=self._xml_float(act_node, "PhysicalPercentComplete"),
                        status=ActivityStatus.NOT_STARTED,
                    )
                    activities.append(activity)

            self.db.add_all(activities)
            schedule.activity_count = len(activities)
            schedule.parse_status = "parsed"
            await self.db.flush()
            return len(activities)

        except Exception as e:
            schedule.parse_status = "failed"
            schedule.parse_error = str(e)
            await self.db.flush()
            raise

    def _xml_text(self, node, tag: str) -> str:
        """Get text from a child element, namespace-agnostic."""
        child = node.find(f"{{*}}{tag}")
        if child is None:
            child = node.find(tag)
        return child.text.strip() if child is not None and child.text else ""

    def _xml_date(self, node, tag: str) -> date | None:
        text = self._xml_text(node, tag)
        if not text:
            return None
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
        except ValueError:
            return None

    def _xml_float(self, node, tag: str) -> float:
        text = self._xml_text(node, tag)
        try:
            return float(text) if text else 0.0
        except ValueError:
            return 0.0
