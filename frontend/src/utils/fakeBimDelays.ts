/**
 * Deterministic fake schedule/delay data for the BIM viewer.
 *
 * Until backend progress + schedule analytics surfaces real per-element
 * planned vs. actual % and predicted-delay paths, we synthesise this from
 * the element's ifc_guid so:
 *   - the same element always shows the same numbers (no flicker)
 *   - we get a believable mix of behind / on-track / ahead status
 *   - downstream components can render schedule UI without waiting for the
 *     real analytics pipeline.
 */

import type { BIMElement } from "@/types";

export type ScheduleStatus = "ahead" | "on_track" | "behind" | "critical" | "not_started";

export interface ElementSchedule {
  elementId: string;
  status: ScheduleStatus;
  plannedPct: number;
  actualPct: number;
  /** Days behind the planned curve (negative = ahead). */
  deltaDays: number;
  /** Date the work was planned to finish. ISO-ish "DD MMM" string. */
  plannedFinish: string;
  /** Activity name from the (fake) schedule. */
  activity: string;
  /** True if this element is on the predicted critical-delay path. */
  onCriticalPath: boolean;
}

export interface VideoEvidence {
  captureId: string;
  capturedAt: string;     // "2 days ago", "Apr 22 · 14:08"
  thumbnailColor: string; // gradient seed, no real frame yet
  note: string;           // "Rebar visible, formwork incomplete"
}

// ── deterministic hash ─────────────────────────────────────────────────────

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rand01(seed: number): number {
  // mulberry32-ish
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const ACTIVITY_POOL: Record<string, string[]> = {
  wall:        ["Block partitions", "Wall plastering", "Drywall framing"],
  slab:        ["Slab rebar", "Slab pour", "Topping slab"],
  column:      ["Column rebar", "Column formwork", "Column pour"],
  beam:        ["Beam rebar", "Beam pour"],
  door:        ["Door installation", "Frame fitting"],
  window:      ["Window installation", "Glazing"],
  curtain_wall:["Curtain wall panels", "Façade fixing"],
  mep:         ["MEP rough-in", "MEP commissioning"],
  ceiling:     ["Ceiling grid", "Ceiling tiles"],
  default:     ["Site activity"],
};

// ── public API ─────────────────────────────────────────────────────────────

export function buildFakeSchedule(elements: BIMElement[]): Map<string, ElementSchedule> {
  const out = new Map<string, ElementSchedule>();

  for (const el of elements) {
    const seed = hash32(el.ifc_guid || el.id);
    const r = rand01(seed);
    const r2 = rand01(seed ^ 0x9e3779b9);
    const r3 = rand01(seed ^ 0x85ebca6b);

    // Distribution: 12% critical, 18% behind, 40% on-track, 12% ahead, 18% not-started
    let status: ScheduleStatus;
    if      (r < 0.12) status = "critical";
    else if (r < 0.30) status = "behind";
    else if (r < 0.70) status = "on_track";
    else if (r < 0.82) status = "ahead";
    else               status = "not_started";

    const plannedPct =
      status === "not_started" ? Math.round(r2 * 8)
                               : Math.round(35 + r2 * 60);

    let actualPct: number;
    let deltaDays: number;
    switch (status) {
      case "critical":    actualPct = Math.max(0, plannedPct - Math.round(20 + r3 * 25)); deltaDays = 12 + Math.round(r3 * 14); break;
      case "behind":      actualPct = Math.max(0, plannedPct - Math.round(8 + r3 * 12));  deltaDays = 4 + Math.round(r3 * 6);   break;
      case "on_track":    actualPct = Math.max(0, plannedPct - Math.round(r3 * 4));        deltaDays = Math.round(r3 * 2);       break;
      case "ahead":       actualPct = Math.min(100, plannedPct + Math.round(3 + r3 * 8));  deltaDays = -1 - Math.round(r3 * 4);  break;
      default:            actualPct = 0;                                                   deltaDays = 0;
    }

    const cat = el.category as string;
    const pool = ACTIVITY_POOL[cat] || ACTIVITY_POOL.default;
    const activity = `${pool[Math.floor(r2 * pool.length)]}${el.level ? ` · ${el.level}` : ""}`;

    // Plain "DD MMM" with planned finish 0–35 days from now (earlier for delayed)
    const offsetDays = status === "critical" || status === "behind"
      ? -Math.round(deltaDays + r3 * 4)
      : Math.round(r3 * 30);
    const plannedFinish = formatShortDate(addDays(new Date(), offsetDays));

    out.set(el.id, {
      elementId: el.id,
      status,
      plannedPct,
      actualPct,
      deltaDays,
      plannedFinish,
      activity,
      onCriticalPath: status === "critical" || (status === "behind" && r3 < 0.4),
    });
  }

  return out;
}

/** Stable set of ids that should pulse red in the 3D viewport. */
export function delayedElementIds(schedule: Map<string, ElementSchedule>): Set<string> {
  const out = new Set<string>();
  schedule.forEach((s, id) => {
    if (s.status === "critical" || s.status === "behind") out.add(id);
  });
  return out;
}

/** Top-N elements on the predicted critical-delay path, ordered by deltaDays. */
export function predictedDelayChain(
  elements: BIMElement[],
  schedule: Map<string, ElementSchedule>,
  limit = 6,
): Array<{ element: BIMElement; sched: ElementSchedule }> {
  return elements
    .map((el) => ({ element: el, sched: schedule.get(el.id) }))
    .filter((x): x is { element: BIMElement; sched: ElementSchedule } =>
      !!x.sched && x.sched.onCriticalPath,
    )
    .sort((a, b) => b.sched.deltaDays - a.sched.deltaDays)
    .slice(0, limit);
}

/** 1–3 fake video-evidence frames for an element. Deterministic by guid. */
export function fakeEvidenceFor(el: BIMElement): VideoEvidence[] {
  const seed = hash32(el.ifc_guid || el.id);
  const count = 1 + (seed % 3);
  const palette = ["#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#ec4899"];
  const notes = [
    "Rebar visible, formwork incomplete",
    "Surface finish in progress",
    "Captured during weekly walk-through",
    "Defect flagged for re-inspection",
    "Crew on site, partial completion",
    "Material delivery awaiting",
  ];
  const out: VideoEvidence[] = [];
  for (let i = 0; i < count; i++) {
    const r = rand01(seed ^ (i * 0x12345));
    const daysAgo = 1 + Math.floor(r * 8);
    out.push({
      captureId: `cap-${(seed + i).toString(16).slice(0, 8)}`,
      capturedAt: daysAgo === 1 ? "1 day ago" : `${daysAgo} days ago`,
      thumbnailColor: palette[(seed + i) % palette.length],
      note: notes[(seed + i * 7) % notes.length],
    });
  }
  return out;
}

// ── helpers ────────────────────────────────────────────────────────────────

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export const STATUS_META: Record<ScheduleStatus, { label: string; color: string; bg: string; border: string; dot: string }> = {
  ahead:       { label: "Ahead",       color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", dot: "bg-emerald-500" },
  on_track:    { label: "On track",    color: "text-mq-400",      bg: "bg-mq-500/10",      border: "border-mq-500/30",      dot: "bg-mq-500"      },
  behind:      { label: "Behind",      color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/30",   dot: "bg-amber-500"   },
  critical:    { label: "Critical",    color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/30",     dot: "bg-red-500"     },
  not_started: { label: "Not started", color: "text-slate-400",   bg: "bg-slate-500/10",   border: "border-slate-500/30",   dot: "bg-slate-500"   },
};
