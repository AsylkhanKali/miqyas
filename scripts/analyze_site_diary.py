#!/usr/bin/env python3
"""
MIQYAS — Welcome Center Site Diary Analyzer

Classifies 360° construction photos using Claude Vision, then produces
a structured JSON file used by the frontend timeline and PDF report.

Usage:
    python3 scripts/analyze_site_diary.py \
        --photos assets/welcome_center \
        --output assets/welcome_center/analysis.json
"""

import argparse
import base64
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import anthropic

# ── Reconstructed schedule (inferred from DWG + visual evidence) ────────────
# This is a 9-week interior fit-out / refurbishment of a Welcome Center lobby.
# No formal schedule was provided; this is the MIQYAS-reconstructed baseline.

SCHEDULE = [
    {
        "activity_id": "A001",
        "name": "Strip-out & MEP Rough-in",
        "description": "Remove existing finishes, install new MEP rough-in routes (conduit, cable trays, HVAC rough)",
        "planned_start": date(2025, 5, 26),
        "planned_finish": date(2025, 6, 6),
        "zone": "Full floor area",
    },
    {
        "activity_id": "A002",
        "name": "Intensive MEP Installation",
        "description": "Main electrical distribution, data cabling, HVAC ductwork and FCUs, fire protection",
        "planned_start": date(2025, 6, 9),
        "planned_finish": date(2025, 6, 20),
        "zone": "Ceiling plenum + walls",
    },
    {
        "activity_id": "A003",
        "name": "MEP Completion & First Fix",
        "description": "Complete MEP above ceiling, close ceiling structure, first-fix plumbing, HVAC commissioning",
        "planned_start": date(2025, 6, 23),
        "planned_finish": date(2025, 7, 4),
        "zone": "Ceiling + columns",
    },
    {
        "activity_id": "A004",
        "name": "Finishes — Ceiling, Flooring & Walls",
        "description": "Install acoustic ceiling baffles, lay marble flooring, apply wall paint/cladding, second fix",
        "planned_start": date(2025, 7, 7),
        "planned_finish": date(2025, 7, 18),
        "zone": "Full interior",
    },
    {
        "activity_id": "A005",
        "name": "Final Fit-out & Commissioning",
        "description": "Furniture installation, interior landscaping (trees), signage, AV, final commissioning & snagging",
        "planned_start": date(2025, 7, 21),
        "planned_finish": date(2025, 7, 28),
        "zone": "Full space",
    },
]

PHASE_MAP = {
    "strip_out_mep_roughin": "A001",
    "mep_installation": "A002",
    "mep_completion": "A003",
    "finishes": "A004",
    "final_fitout": "A005",
}

VISION_PROMPT = """You are analyzing a 360° equirectangular panorama taken inside an interior fit-out construction site — a Welcome Center lobby in a commercial building. The shell/structure is already complete; the work shown is interior renovation and fit-out.

Analyze the visible construction state carefully and respond ONLY with a valid JSON object. No markdown, no explanation, just the JSON.

{
  "phase": "<one of: strip_out_mep_roughin | mep_installation | mep_completion | finishes | final_fitout>",
  "overall_completion_pct": <integer 0-100, your estimate of how complete the total fit-out scope is>,
  "element_status": {
    "ceiling": {"visible": <bool>, "completion_pct": <int>, "notes": "<what you see>"},
    "flooring": {"visible": <bool>, "completion_pct": <int>, "notes": "<what you see>"},
    "walls": {"visible": <bool>, "completion_pct": <int>, "notes": "<what you see>"},
    "mep_systems": {"visible": <bool>, "completion_pct": <int>, "notes": "<HVAC, electrical, plumbing>"},
    "glazing_facade": {"visible": <bool>, "completion_pct": <int>, "notes": "<curtain wall, glass doors>"},
    "furnishings": {"visible": <bool>, "completion_pct": <int>, "notes": "<furniture, plants, signage>"}
  },
  "activities_in_progress": ["<list of active work you can see — be specific, e.g. 'conduit installation', 'acoustic panel mounting'>"],
  "crew_present": <bool>,
  "scaffolding_present": <bool>,
  "key_observation": "<single most important sentence describing what this photo shows about construction progress>",
  "schedule_assessment": "<one of: ahead_of_plan | on_track | behind_plan>",
  "schedule_assessment_reason": "<one sentence explaining why>"
}"""


def date_from_filename(filename: str) -> date:
    """Extract date from YYYYMMDD_HHMMSS prefix."""
    m = re.match(r"(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})", Path(filename).stem)
    if not m:
        raise ValueError(f"Cannot parse date from: {filename}")
    y, mo, d, h, mi, s = [int(x) for x in m.groups()]
    return date(y, mo, d)


def photographer_from_filename(filename: str) -> str:
    """Extract photographer name from filename."""
    stem = Path(filename).stem
    parts = stem.split("_Image1_")
    return parts[1] if len(parts) > 1 else "Unknown"


def planned_pct_on_date(capture_date: date) -> float:
    """
    Calculate the planned overall completion % for a given date,
    treating all 5 activities as equal weight (20% each).
    """
    total_days = (date(2025, 7, 28) - date(2025, 5, 26)).days
    days_elapsed = max(0, min((capture_date - date(2025, 5, 26)).days, total_days))
    return round(days_elapsed / total_days * 100, 1)


def active_activity_on_date(capture_date: date) -> dict | None:
    """Return the scheduled activity that should be active on a given date."""
    for act in SCHEDULE:
        if act["planned_start"] <= capture_date <= act["planned_finish"]:
            return act
    # Return closest activity if between activities
    for i, act in enumerate(SCHEDULE[:-1]):
        if act["planned_finish"] < capture_date < SCHEDULE[i + 1]["planned_start"]:
            return SCHEDULE[i + 1]  # next upcoming
    return SCHEDULE[-1]


def encode_image(path: Path) -> str:
    with open(path, "rb") as f:
        return base64.standard_b64encode(f.read()).decode("utf-8")


def classify_photo(client: anthropic.Anthropic, photo_path: Path, capture_date: date) -> dict:
    """Call Claude Vision to classify a single photo. Returns structured dict."""
    print(f"  Analyzing {photo_path.name} ({capture_date})...", end=" ", flush=True)

    image_data = encode_image(photo_path)

    try:
        message = client.messages.create(
            model="claude-opus-4-5",
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",
                                "data": image_data,
                            },
                        },
                        {
                            "type": "text",
                            "text": VISION_PROMPT,
                        },
                    ],
                }
            ],
        )

        raw = message.content[0].text.strip()
        # Strip any accidental markdown fences
        raw = re.sub(r"^```json\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        result = json.loads(raw)
        print("✓")
        return result

    except json.JSONDecodeError as e:
        print(f"✗ JSON parse error: {e}")
        print(f"  Raw response: {raw[:200]}")
        return _fallback_classification(capture_date)
    except Exception as e:
        print(f"✗ API error: {e}")
        return _fallback_classification(capture_date)


def _fallback_classification(capture_date: date) -> dict:
    """Fallback when API fails — infer from date position in schedule."""
    planned = planned_pct_on_date(capture_date)
    act = active_activity_on_date(capture_date)
    phase = next((k for k, v in PHASE_MAP.items() if v == act["activity_id"]), "mep_installation")
    return {
        "phase": phase,
        "overall_completion_pct": int(planned),
        "element_status": {
            "ceiling": {"visible": True, "completion_pct": int(planned), "notes": "Not classified"},
            "flooring": {"visible": True, "completion_pct": int(planned), "notes": "Not classified"},
            "walls": {"visible": True, "completion_pct": int(planned), "notes": "Not classified"},
            "mep_systems": {"visible": True, "completion_pct": int(planned), "notes": "Not classified"},
            "glazing_facade": {"visible": True, "completion_pct": 80, "notes": "Not classified"},
            "furnishings": {"visible": False, "completion_pct": 0, "notes": "Not classified"},
        },
        "activities_in_progress": [],
        "crew_present": True,
        "scaffolding_present": planned < 80,
        "key_observation": f"Photo from {capture_date} — classification unavailable.",
        "schedule_assessment": "on_track",
        "schedule_assessment_reason": "Fallback: inferred from date.",
        "_fallback": True,
    }


def build_output(photos_dir: Path, results: list[dict]) -> dict:
    """Assemble the final JSON structure."""
    first_date = results[0]["capture_date"]
    last_date = results[-1]["capture_date"]
    total_days = (datetime.fromisoformat(last_date) - datetime.fromisoformat(first_date)).days

    # Compute overall deviation
    final = results[-1]
    final_actual = final["vision"]["overall_completion_pct"]
    final_planned = final["planned_completion_pct"]
    deviation = final_actual - final_planned

    # Weekly summaries
    weeks = _group_by_week(results)

    return {
        "project": {
            "name": "Welcome Center",
            "location": "Interior Fit-out",
            "type": "Interior Refurbishment",
            "start_date": first_date,
            "end_date": last_date,
            "total_photos": len(results),
            "total_days_covered": total_days,
            "note": "Schedule is MIQYAS-reconstructed — no formal baseline was provided.",
        },
        "schedule": [
            {
                **{k: v.isoformat() if isinstance(v, date) else v for k, v in act.items()},
            }
            for act in SCHEDULE
        ],
        "captures": results,
        "summary": {
            "final_actual_completion": final_actual,
            "final_planned_completion": final_planned,
            "overall_deviation_pct": deviation,
            "deviation_label": "ahead_of_plan" if deviation > 5 else ("behind_plan" if deviation < -5 else "on_track"),
            "phases_observed": list({r["vision"]["phase"] for r in results}),
            "total_crew_days": sum(1 for r in results if r["vision"].get("crew_present")),
            "weeks": weeks,
        },
        "generated_at": datetime.now().isoformat(),
    }


def _group_by_week(results: list[dict]) -> list[dict]:
    """Group captures by ISO week and summarise."""
    from collections import defaultdict

    weeks: dict[str, list] = defaultdict(list)
    for r in results:
        d = datetime.fromisoformat(r["capture_date"]).date()
        iso = d.isocalendar()
        key = f"{iso.year}-W{iso.week:02d}"
        weeks[key].append(r)

    output = []
    for week_key in sorted(weeks):
        captures = weeks[week_key]
        avg_actual = round(sum(c["vision"]["overall_completion_pct"] for c in captures) / len(captures), 1)
        avg_planned = round(sum(c["planned_completion_pct"] for c in captures) / len(captures), 1)
        latest = max(captures, key=lambda c: c["capture_date"])
        output.append({
            "week": week_key,
            "captures": len(captures),
            "avg_actual_completion": avg_actual,
            "avg_planned_completion": avg_planned,
            "deviation": round(avg_actual - avg_planned, 1),
            "phase": latest["vision"]["phase"],
            "key_observation": latest["vision"]["key_observation"],
        })
    return output


def main():
    parser = argparse.ArgumentParser(description="Analyze Welcome Center site diary photos")
    parser.add_argument("--photos", default="assets/welcome_center", help="Directory of JPG photos")
    parser.add_argument("--output", default="assets/welcome_center/analysis.json", help="Output JSON path")
    parser.add_argument("--skip-existing", action="store_true", help="Skip photos already in output")
    parser.add_argument("--dry-run", action="store_true", help="Parse filenames only, skip API calls")
    args = parser.parse_args()

    photos_dir = Path(args.photos)
    output_path = Path(args.output)

    # Load existing results if any
    existing: dict[str, dict] = {}
    if args.skip_existing and output_path.exists():
        with open(output_path) as f:
            prev = json.load(f)
        existing = {r["filename"]: r for r in prev.get("captures", [])}
        print(f"Loaded {len(existing)} existing results.")

    # Gather photos sorted by date
    photos = sorted(
        [p for p in photos_dir.glob("*.jpg") if not p.name.startswith(".")],
        key=lambda p: p.stem,
    )
    print(f"\nFound {len(photos)} photos in {photos_dir}\n")

    if not args.dry_run:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            print("ERROR: ANTHROPIC_API_KEY not set.", file=sys.stderr)
            sys.exit(1)
        client = anthropic.Anthropic(api_key=api_key)

    results = []
    for photo in photos:
        capture_date = date_from_filename(photo.name)
        photographer = photographer_from_filename(photo.name)
        planned_pct = planned_pct_on_date(capture_date)
        active_act = active_activity_on_date(capture_date)

        if photo.name in existing:
            print(f"  Skipping {photo.name} (already analyzed)")
            results.append(existing[photo.name])
            continue

        if args.dry_run:
            vision = _fallback_classification(capture_date)
        else:
            vision = classify_photo(client, photo, capture_date)
            time.sleep(0.5)  # be polite to the API

        results.append({
            "filename": photo.name,
            "capture_date": capture_date.isoformat(),
            "photographer": photographer,
            "planned_completion_pct": planned_pct,
            "active_activity": active_act["activity_id"],
            "active_activity_name": active_act["name"],
            "vision": vision,
        })

    output = build_output(photos_dir, results)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2, default=str)

    print(f"\n✅ Analysis complete → {output_path}")
    print(f"   {len(results)} photos | {output['summary']['final_actual_completion']}% actual vs {output['summary']['final_planned_completion']}% planned")
    print(f"   Overall: {output['summary']['deviation_label']}")


if __name__ == "__main__":
    main()
