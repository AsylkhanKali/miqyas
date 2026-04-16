#!/usr/bin/env python3
"""
MIQYAS Demo Data Seeder.

Creates a realistic demo project with BIM elements, schedule activities,
auto-links, video capture, and progress items so the UI has data to display.

Usage (from project root):
    python scripts/seed_demo.py

Or via Makefile:
    make seed
"""

import random
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# Ensure backend is importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.core.config import get_settings

settings = get_settings()

engine = create_engine(settings.database_url_sync, echo=False)

# ── Helpers ──────────────────────────────────────────────────────────────

rng = random.Random(42)
NOW = datetime.now(timezone.utc)


def uid() -> uuid.UUID:
    return uuid.uuid4()


# ── Demo Data Constants ──────────────────────────────────────────────────

PROJECT_ID = uid()
BIM_MODEL_ID = uid()
SCHEDULE_ID = uid()
CAPTURE_ID = uid()

LEVELS = ["Level 00 - Foundation", "Level 01 - Ground Floor", "Level 02 - First Floor", "Level 03 - Second Floor", "Level 04 - Roof"]

CATEGORIES = {
    "wall": {"ifc_type": "IfcWall", "count": 48},
    "slab": {"ifc_type": "IfcSlab", "count": 12},
    "column": {"ifc_type": "IfcColumn", "count": 32},
    "beam": {"ifc_type": "IfcBeam", "count": 24},
    "door": {"ifc_type": "IfcDoor", "count": 16},
    "window": {"ifc_type": "IfcWindow", "count": 20},
    "stair": {"ifc_type": "IfcStairFlight", "count": 4},
    "railing": {"ifc_type": "IfcRailing", "count": 8},
    "ceiling": {"ifc_type": "IfcCovering", "count": 10},
}

ACTIVITY_TEMPLATES = [
    ("FND-010", "Foundation Excavation", "wall", 0),
    ("FND-020", "Foundation Concrete Pour", "slab", 0),
    ("FND-030", "Foundation Columns", "column", 0),
    ("STR-010", "Ground Floor Slab", "slab", 1),
    ("STR-020", "Ground Floor Walls", "wall", 1),
    ("STR-030", "Ground Floor Columns", "column", 1),
    ("STR-040", "Ground Floor Beams", "beam", 1),
    ("STR-050", "First Floor Slab", "slab", 2),
    ("STR-060", "First Floor Walls", "wall", 2),
    ("STR-070", "First Floor Columns", "column", 2),
    ("STR-080", "First Floor Beams", "beam", 2),
    ("STR-090", "Second Floor Slab", "slab", 3),
    ("STR-100", "Second Floor Walls", "wall", 3),
    ("STR-110", "Second Floor Columns", "column", 3),
    ("STR-120", "Second Floor Beams", "beam", 3),
    ("STR-130", "Roof Slab", "slab", 4),
    ("ARC-010", "Ground Floor Doors", "door", 1),
    ("ARC-020", "Ground Floor Windows", "window", 1),
    ("ARC-030", "First Floor Doors", "door", 2),
    ("ARC-040", "First Floor Windows", "window", 2),
    ("ARC-050", "Second Floor Doors", "door", 3),
    ("ARC-060", "Second Floor Windows", "window", 3),
    ("ARC-070", "Staircases", "stair", 1),
    ("ARC-080", "Railings", "railing", 2),
    ("FIN-010", "Ground Floor Ceiling", "ceiling", 1),
    ("FIN-020", "First Floor Ceiling", "ceiling", 2),
    ("FIN-030", "Second Floor Ceiling", "ceiling", 3),
]


def seed():
    """Insert demo data into the database."""
    with Session(engine) as db:
        # Check if demo project already exists
        exists = db.execute(
            text("SELECT 1 FROM projects WHERE id = :id"),
            {"id": str(PROJECT_ID)},
        ).scalar()
        if exists:
            print(f"Demo project {PROJECT_ID} already exists. Deleting and re-seeding...")
            db.execute(text("DELETE FROM projects WHERE id = :id"), {"id": str(PROJECT_ID)})
            db.commit()

        # ── 1. Project ──────────────────────────────────────────
        db.execute(text("""
            INSERT INTO projects (id, name, code, description, status, location, client_name, contract_value, start_date, end_date, settings, created_at, updated_at)
            VALUES (:id, :name, :code, :desc, :status, :loc, :client, :val, :sd, :ed, :settings, :ca, :ua)
        """), {
            "id": str(PROJECT_ID), "name": "Al Khor Tower — Phase 2",
            "code": "AKT-P2", "desc": "45-story mixed-use tower in Al Khor, Qatar. Phase 2 covers structural + architectural finishes for levels 1-4.",
            "status": "active", "loc": "Al Khor, Qatar", "client": "Qatar Real Estate Development Co.",
            "val": 28500000.0, "sd": date(2025, 3, 1), "ed": date(2026, 12, 31),
            "settings": "{}", "ca": NOW, "ua": NOW,
        })

        # ── 2. BIM Model ────────────────────────────────────────
        db.execute(text("""
            INSERT INTO bim_models (id, project_id, filename, storage_path, file_size_bytes, ifc_schema_version, authoring_tool, element_count, parse_status, metadata, created_at, updated_at)
            VALUES (:id, :pid, :fn, :sp, :fs, :sv, :at, :ec, :ps, :md, :ca, :ua)
        """), {
            "id": str(BIM_MODEL_ID), "pid": str(PROJECT_ID),
            "fn": "AKT_P2_Structural_Arch.ifc", "sp": "/uploads/ifc/demo.ifc",
            "fs": 85_000_000, "sv": "IFC4", "at": "Autodesk Revit 2024",
            "ec": 0, "ps": "parsed", "md": "{}", "ca": NOW, "ua": NOW,
        })

        # ── 3. BIM Elements ─────────────────────────────────────
        elements = []
        element_map = {}  # (category, level_idx) -> [element_ids]

        for cat, info in CATEGORIES.items():
            for i in range(info["count"]):
                eid = uid()
                level_idx = i % len(LEVELS)
                level = LEVELS[level_idx]

                x = rng.uniform(-20, 20)
                y = rng.uniform(-15, 15)
                z_base = level_idx * 3.5
                z_top = z_base + rng.uniform(0.3, 3.2)

                elements.append({
                    "id": str(eid),
                    "bim_model_id": str(BIM_MODEL_ID),
                    "ifc_guid": f"3{rng.getrandbits(80):020x}"[:22],
                    "ifc_type": info["ifc_type"],
                    "category": cat,
                    "name": f"{cat.title()} {level.split(' - ')[0]}_{i+1:03d}",
                    "level": level,
                    "zone": f"Zone {chr(65 + (i % 4))}",
                    "material": rng.choice(["Concrete C40", "Concrete C30", "Steel S355", "Aluminum", "Glass", "Gypsum Board"]),
                    "geometry_bbox": f'{{"min": [{x:.1f}, {y:.1f}, {z_base:.1f}], "max": [{x+rng.uniform(0.2, 4.0):.1f}, {y+rng.uniform(0.2, 4.0):.1f}, {z_top:.1f}]}}',
                    "properties": "{}",
                    "quantity_data": "{}",
                    "ca": NOW, "ua": NOW,
                })

                key = (cat, level_idx)
                element_map.setdefault(key, []).append(str(eid))

        for el in elements:
            db.execute(text("""
                INSERT INTO bim_elements (id, bim_model_id, ifc_guid, ifc_type, category, name, level, zone, material, geometry_bbox, properties, quantity_data, created_at, updated_at)
                VALUES (:id, :bim_model_id, :ifc_guid, :ifc_type, :category, :name, :level, :zone, :material, :geometry_bbox::jsonb, :properties::jsonb, :quantity_data::jsonb, :ca, :ua)
            """), el)

        total_elements = len(elements)
        db.execute(text("UPDATE bim_models SET element_count = :ec WHERE id = :id"),
                   {"ec": total_elements, "id": str(BIM_MODEL_ID)})

        print(f"  Created {total_elements} BIM elements")

        # ── 4. Schedule + Activities ────────────────────────────
        db.execute(text("""
            INSERT INTO schedules (id, project_id, filename, storage_path, source_format, data_date, activity_count, parse_status, metadata, created_at, updated_at)
            VALUES (:id, :pid, :fn, :sp, :sf, :dd, :ac, :ps, :md, :ca, :ua)
        """), {
            "id": str(SCHEDULE_ID), "pid": str(PROJECT_ID),
            "fn": "AKT_P2_Master_Schedule.xer", "sp": "/uploads/schedules/demo.xer",
            "sf": "xer", "dd": date(2026, 4, 1), "ac": len(ACTIVITY_TEMPLATES),
            "ps": "parsed", "md": "{}", "ca": NOW, "ua": NOW,
        })

        activity_ids = {}  # activity_code -> (activity_uuid, category, level_idx)
        base_date = date(2025, 3, 1)

        for idx, (code, name, cat, level_idx) in enumerate(ACTIVITY_TEMPLATES):
            aid = uid()
            pstart = base_date + timedelta(days=idx * 14 + rng.randint(0, 7))
            pdur = rng.randint(14, 45)
            pfinish = pstart + timedelta(days=pdur)

            # Activities earlier in schedule are more complete
            progress_ratio = max(0.0, min(1.0, 1.0 - (idx / len(ACTIVITY_TEMPLATES))))
            pct = round(min(100.0, progress_ratio * 100 + rng.uniform(-15, 10)), 1)
            pct = max(0.0, pct)

            if pct >= 100:
                status = "completed"
                actual_start = pstart - timedelta(days=rng.randint(0, 3))
                actual_finish = pfinish + timedelta(days=rng.randint(-5, 5))
            elif pct > 0:
                status = "in_progress"
                actual_start = pstart + timedelta(days=rng.randint(-3, 5))
                actual_finish = None
            else:
                status = "not_started"
                actual_start = None
                actual_finish = None

            is_critical = code.startswith("STR") or code.startswith("FND")
            total_float = 0.0 if is_critical else rng.uniform(3, 25)

            db.execute(text("""
                INSERT INTO activities (id, schedule_id, activity_id, activity_code, name, wbs_p6_id, planned_start, planned_finish, actual_start, actual_finish, planned_duration_days, percent_complete, status, activity_type, is_critical, total_float_days, properties, created_at, updated_at)
                VALUES (:id, :sid, :aid, :ac, :name, :wbs, :ps, :pf, :as_, :af, :pd, :pct, :st, :at, :ic, :tf, :props, :ca, :ua)
            """), {
                "id": str(aid), "sid": str(SCHEDULE_ID),
                "aid": code, "ac": code, "name": name, "wbs": None,
                "ps": pstart, "pf": pfinish, "as_": actual_start, "af": actual_finish,
                "pd": float(pdur), "pct": pct, "st": status,
                "at": "Task", "ic": is_critical, "tf": round(total_float, 1),
                "props": "{}", "ca": NOW, "ua": NOW,
            })

            activity_ids[code] = (str(aid), cat, level_idx)

        print(f"  Created {len(ACTIVITY_TEMPLATES)} activities")

        # ── 5. Element-Activity Links ───────────────────────────
        link_count = 0
        for code, (act_id, cat, level_idx) in activity_ids.items():
            key = (cat, level_idx)
            if key in element_map:
                for eid in element_map[key]:
                    conf = rng.uniform(0.65, 0.98)
                    db.execute(text("""
                        INSERT INTO element_activity_links (id, element_id, activity_id, confidence, link_method, match_details, is_confirmed, created_at, updated_at)
                        VALUES (:id, :eid, :aid, :conf, :lm, :md, :ic, :ca, :ua)
                    """), {
                        "id": str(uid()), "eid": eid, "aid": act_id,
                        "conf": round(conf, 3), "lm": "auto",
                        "md": '{"strategy": "level_category"}', "ic": False,
                        "ca": NOW, "ua": NOW,
                    })
                    link_count += 1

        print(f"  Created {link_count} element-activity links")

        # ── 6. Video Capture ────────────────────────────────────
        db.execute(text("""
            INSERT INTO video_captures (id, project_id, filename, storage_path, file_size_bytes, duration_seconds, resolution, fps, capture_date, status, frame_count, metadata, created_at, updated_at)
            VALUES (:id, :pid, :fn, :sp, :fs, :dur, :res, :fps, :cd, :st, :fc, :md, :ca, :ua)
        """), {
            "id": str(CAPTURE_ID), "pid": str(PROJECT_ID),
            "fn": "walkthrough_2026-04-01.mp4", "sp": "/uploads/video/demo.mp4",
            "fs": 450_000_000, "dur": 180.0, "res": "5760x2880", "fps": 30.0,
            "cd": date(2026, 4, 1), "st": "compared", "fc": 30,
            "md": "{}", "ca": NOW, "ua": NOW,
        })

        # ── 7. Progress Items ───────────────────────────────────
        deviation_weights = [
            ("on_track", 0.40),
            ("behind", 0.25),
            ("ahead", 0.20),
            ("not_started", 0.10),
            ("extra_work", 0.05),
        ]
        dev_types = [d for d, _ in deviation_weights]
        dev_probs = [w for _, w in deviation_weights]

        narratives = {
            "ahead": "Element is ahead of schedule. Observed progress exceeds planned baseline.",
            "on_track": "Element is progressing as planned. No deviation detected.",
            "behind": "Element is behind schedule. Observed progress lags the planned baseline.",
            "not_started": "Element has not started. Expected work has not been observed on site.",
            "extra_work": "Unplanned work detected. Element shows progress not in the current schedule.",
        }

        pi_count = 0
        for el in elements:
            eid = el["id"]
            dev = rng.choices(dev_types, weights=dev_probs, k=1)[0]
            obs = round(rng.uniform(0, 100), 1)
            sched = round(rng.uniform(0, 100), 1)

            if dev == "ahead":
                obs = round(rng.uniform(60, 100), 1)
                sched = round(obs - rng.uniform(10, 30), 1)
            elif dev == "on_track":
                base = rng.uniform(20, 90)
                obs = round(base, 1)
                sched = round(base + rng.uniform(-5, 5), 1)
            elif dev == "behind":
                sched = round(rng.uniform(40, 100), 1)
                obs = round(sched - rng.uniform(15, 40), 1)
            elif dev == "not_started":
                obs = 0.0
                sched = round(rng.uniform(10, 50), 1)
            else:  # extra_work
                obs = round(rng.uniform(20, 60), 1)
                sched = 0.0

            obs = max(0.0, min(100.0, obs))
            sched = max(0.0, min(100.0, sched))

            dev_days = round((obs - sched) / 100 * rng.uniform(5, 30), 1) if dev != "on_track" else 0.0
            confidence = round(rng.uniform(0.55, 0.95), 3)

            db.execute(text("""
                INSERT INTO progress_items (id, element_id, activity_id, capture_id, observed_percent, scheduled_percent, deviation_type, deviation_days, confidence_score, notes, narrative, created_at, updated_at)
                VALUES (:id, :eid, :aid, :cid, :obs, :sched, :dev, :dd, :conf, :notes, :narr, :ca, :ua)
            """), {
                "id": str(uid()), "eid": eid, "aid": None, "cid": str(CAPTURE_ID),
                "obs": obs, "sched": sched, "dev": dev, "dd": dev_days,
                "conf": confidence, "notes": "", "narr": narratives[dev],
                "ca": NOW, "ua": NOW,
            })
            pi_count += 1

        print(f"  Created {pi_count} progress items")

        db.commit()
        print(f"\nDemo project seeded successfully!")
        print(f"  Project ID: {PROJECT_ID}")
        print(f"  Project:    Al Khor Tower — Phase 2 (AKT-P2)")
        print(f"  BIM Model:  {total_elements} elements across {len(LEVELS)} levels")
        print(f"  Schedule:   {len(ACTIVITY_TEMPLATES)} activities")
        print(f"  Links:      {link_count} element-activity links")
        print(f"  Capture:    1 video (status=compared)")
        print(f"  Progress:   {pi_count} deviation items")


if __name__ == "__main__":
    print("MIQYAS Demo Data Seeder")
    print("=" * 40)
    seed()
