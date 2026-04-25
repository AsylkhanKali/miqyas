/**
 * ProgressOverviewPage — Buildots-style activity progress tracker.
 *
 * Two views:
 *  • Table   — tree: Level → Activity rows with actual/planned %, status, trade
 *  • Gantt   — horizontal timeline bars (planned grey, actual coloured)
 *
 * Uses fake data seeded from the project id until the backend analytics
 * pipeline surfaces real per-activity progress.
 */

import { useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  LayoutList,
  GanttChartSquare,
  Filter,
  Download,
  ChevronsUpDown,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Minus,
} from "lucide-react";
import clsx from "clsx";

// ── Types ──────────────────────────────────────────────────────────────────

type ActivityStatus = "done" | "on_track" | "delayed" | "critical" | "not_started";
type Breakdown = "location" | "trade" | "contractor";
type ViewMode = "table" | "gantt";

interface Activity {
  id: string;
  name: string;
  level: string;
  trade: string;
  contractor: string;
  plannedPct: number;
  actualPct: number;
  status: ActivityStatus;
  plannedStart: string; // ISO date
  plannedEnd: string;
  actualStart: string | null;
  daysDelay: number;
}

interface LevelGroup {
  level: string;
  activities: Activity[];
}

// ── Fake data ──────────────────────────────────────────────────────────────

const TRADES = ["Structural", "MEP", "Façade", "Fitout", "Civil", "Electrical", "Plumbing"];
const CONTRACTORS = [
  "Al Futtaim Carillion",
  "Arabtec Construction",
  "Drake & Scull",
  "Khansaheb Civil",
  "ALEC Engineering",
  "Multiplex Gulf",
];

function makeActivities(): Activity[] {
  const levels = ["Basement 2", "Basement 1", "Ground Floor", "Level 1", "Level 2", "Level 3", "Level 4", "Level 5", "Level 6", "Level 7", "Level 8", "Roof"];
  const activities: Activity[] = [];
  let id = 0;

  const activityNames: Record<string, string[]> = {
    Structural:  ["Rebar installation", "Formwork", "Concrete pour", "Slab curing", "Column pour"],
    MEP:         ["MEP rough-in", "Duct installation", "Pipe runs", "AHU installation", "Commissioning"],
    Façade:      ["Curtain wall frame", "Glazing panels", "Waterproofing", "Cladding fix", "Sealant"],
    Fitout:      ["Drywall partitions", "Ceiling grid", "Flooring", "Painting", "Door installation"],
    Civil:       ["Excavation", "Piling", "Ground slab", "Retaining wall", "Backfill"],
    Electrical:  ["Conduit install", "Cable tray", "Cable pull", "DB installation", "Testing & commissioning"],
    Plumbing:    ["Drainage runs", "Water supply", "Fixtures", "Hot water system", "Leak testing"],
  };

  for (const level of levels) {
    // 3-6 activities per level
    const count = 3 + (id % 4);
    for (let i = 0; i < count; i++) {
      const trade = TRADES[(id + i) % TRADES.length];
      const contractor = CONTRACTORS[(id + i * 3) % CONTRACTORS.length];
      const tradeActs = activityNames[trade] || ["Activity"];
      const actName = tradeActs[(id + i) % tradeActs.length];

      // Deterministic percentages from seed
      const seed = (id * 17 + i * 7 + level.length) % 100;
      const planned = 30 + (seed % 60);
      const delta = ((seed * 13) % 30) - 10; // -10 to +20
      const actual = Math.max(0, Math.min(100, planned + delta));

      let status: ActivityStatus;
      if (planned === 0 && actual === 0) status = "not_started";
      else if (actual >= 95) status = "done";
      else if (delta < -15) status = "critical";
      else if (delta < -5) status = "delayed";
      else status = "on_track";

      // Dates: planned spans 8-16 weeks in the project window
      const base = new Date("2026-01-01");
      const startOffset = (seed * 3) % 60;
      const duration = 8 + (seed % 8);
      const pStart = new Date(base);
      pStart.setDate(pStart.getDate() + startOffset);
      const pEnd = new Date(pStart);
      pEnd.setDate(pEnd.getDate() + duration * 7);

      const aStart = status !== "not_started" ? new Date(pStart) : null;
      if (aStart) aStart.setDate(aStart.getDate() + Math.round(delta / 2));

      activities.push({
        id: `act-${id}-${i}`,
        name: actName,
        level,
        trade,
        contractor,
        plannedPct: planned,
        actualPct: actual,
        status,
        plannedStart: fmt(pStart),
        plannedEnd: fmt(pEnd),
        actualStart: aStart ? fmt(aStart) : null,
        daysDelay: Math.max(0, -delta),
      });
    }
    id++;
  }
  return activities;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const ALL_ACTIVITIES = makeActivities();

// ── Status meta ────────────────────────────────────────────────────────────

const STATUS_META: Record<ActivityStatus, {
  label: string;
  color: string;
  bg: string;
  border: string;
  bar: string;
  icon: React.ElementType;
}> = {
  done:        { label: "Done",        color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30", bar: "bg-emerald-500", icon: CheckCircle2 },
  on_track:    { label: "On Track",    color: "text-mq-400",      bg: "bg-mq-500/10",      border: "border-mq-500/30",      bar: "bg-mq-500",     icon: CheckCircle2 },
  delayed:     { label: "Delayed",     color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/30",   bar: "bg-amber-500",  icon: Clock },
  critical:    { label: "Critical",    color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/30",     bar: "bg-red-500",    icon: AlertTriangle },
  not_started: { label: "Not Started", color: "text-slate-400",   bg: "bg-slate-500/10",   border: "border-slate-500/30",   bar: "bg-slate-600",  icon: Minus },
};

// ── Progress donut ─────────────────────────────────────────────────────────

function MiniDonut({ pct, status }: { pct: number; status: ActivityStatus }) {
  const r = 8;
  const circ = 2 * Math.PI * r;
  const filled = (pct / 100) * circ;
  const meta = STATUS_META[status];
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" className="shrink-0">
      <circle cx="11" cy="11" r={r} fill="none" stroke="#1e293b" strokeWidth="3" />
      <circle
        cx="11" cy="11" r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="round"
        transform="rotate(-90 11 11)"
        className={meta.color}
      />
    </svg>
  );
}

// ── Gantt bar ──────────────────────────────────────────────────────────────

const GANTT_START = new Date("2026-01-01");
const GANTT_END   = new Date("2026-12-31");
const GANTT_SPAN  = GANTT_END.getTime() - GANTT_START.getTime();

function pct(iso: string): number {
  const t = new Date(iso).getTime() - GANTT_START.getTime();
  return Math.max(0, Math.min(100, (t / GANTT_SPAN) * 100));
}

function width(from: string, to: string): number {
  const a = pct(from);
  const b = pct(to);
  return Math.max(0.5, b - a);
}

// ── Month ruler ────────────────────────────────────────────────────────────

const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(2026, i, 1);
  return {
    label: d.toLocaleDateString(undefined, { month: "short" }),
    left: pct(d.toISOString().slice(0, 10)),
  };
});

// ── Main page ──────────────────────────────────────────────────────────────

export default function ProgressOverviewPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const [view,       setView]       = useState<ViewMode>("table");
  const [breakdown,  setBreakdown]  = useState<Breakdown>("location");
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set(["Level 1", "Level 2", "Ground Floor"]));
  const [statusFilter, setStatusFilter] = useState<ActivityStatus | "all">("all");

  const activities = useMemo(() => {
    if (statusFilter === "all") return ALL_ACTIVITIES;
    return ALL_ACTIVITIES.filter((a) => a.status === statusFilter);
  }, [statusFilter]);

  const groups: LevelGroup[] = useMemo(() => {
    const map = new Map<string, Activity[]>();
    for (const a of activities) {
      const key = breakdown === "location" ? a.level
                : breakdown === "trade"    ? a.trade
                :                           a.contractor;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    return Array.from(map.entries()).map(([level, acts]) => ({ level, activities: acts }));
  }, [activities, breakdown]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const expandAll  = () => setExpanded(new Set(groups.map((g) => g.level)));
  const collapseAll = () => setExpanded(new Set());

  const stats = useMemo(() => ({
    total:       ALL_ACTIVITIES.length,
    done:        ALL_ACTIVITIES.filter((a) => a.status === "done").length,
    on_track:    ALL_ACTIVITIES.filter((a) => a.status === "on_track").length,
    delayed:     ALL_ACTIVITIES.filter((a) => a.status === "delayed").length,
    critical:    ALL_ACTIVITIES.filter((a) => a.status === "critical").length,
    not_started: ALL_ACTIVITIES.filter((a) => a.status === "not_started").length,
  }), []);

  return (
    <div className="flex flex-col gap-5 py-4">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Progress Overview</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            {stats.total} activities · {stats.critical} critical · {stats.delayed} delayed
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-lg border border-[#2d3d54] bg-[#111827] p-0.5">
            {(["table", "gantt"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={clsx(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  view === v
                    ? "bg-[#1e293b] text-white"
                    : "text-slate-500 hover:text-slate-300"
                )}
              >
                {v === "table" ? <LayoutList size={13} /> : <GanttChartSquare size={13} />}
                {v === "table" ? "Table" : "Gantt"}
              </button>
            ))}
          </div>

          {/* Export */}
          <button className="flex items-center gap-1.5 rounded-lg border border-[#2d3d54] bg-[#1e293b] px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-white">
            <Download size={13} />
            Export
          </button>
        </div>
      </div>

      {/* ── KPI strip ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-3">
        {(["done", "on_track", "delayed", "critical", "not_started"] as ActivityStatus[]).map((s) => {
          const m = STATUS_META[s];
          const Icon = m.icon;
          const count = stats[s];
          const active = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(active ? "all" : s)}
              className={clsx(
                "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all",
                active
                  ? `${m.bg} ${m.border}`
                  : "border-[#2d3d54] bg-[#111827] hover:bg-[#16213a]"
              )}
            >
              <Icon size={16} className={clsx(m.color, "shrink-0")} />
              <div>
                <div className="text-lg font-semibold text-white">{count}</div>
                <div className={clsx("text-[10px] font-medium", m.color)}>{m.label}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Controls bar ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Breakdown */}
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Filter size={12} />
          <span>Breakdown by</span>
        </div>
        <div className="flex items-center rounded-lg border border-[#2d3d54] bg-[#111827] p-0.5">
          {(["location", "trade", "contractor"] as Breakdown[]).map((b) => (
            <button
              key={b}
              onClick={() => setBreakdown(b)}
              className={clsx(
                "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
                breakdown === b
                  ? "bg-[#1e293b] text-white"
                  : "text-slate-500 hover:text-slate-300"
              )}
            >
              {b}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Expand/collapse */}
        <button
          onClick={expandAll}
          className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ChevronsUpDown size={12} />
          Expand all
        </button>
        <span className="text-slate-700">·</span>
        <button
          onClick={collapseAll}
          className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          Collapse all
        </button>
      </div>

      {/* ── Views ──────────────────────────────────────────────────────── */}
      {view === "table"
        ? <TableView groups={groups} expanded={expanded} onToggle={toggle} />
        : <GanttView  groups={groups} expanded={expanded} onToggle={toggle} />
      }
    </div>
  );
}

// ── Table view ─────────────────────────────────────────────────────────────

function TableView({ groups, expanded, onToggle }: {
  groups: LevelGroup[];
  expanded: Set<string>;
  onToggle: (k: string) => void;
}) {
  return (
    <div className="rounded-xl border border-[#2d3d54] overflow-hidden">
      {/* Header row */}
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1.5fr] border-b border-[#2d3d54] bg-[#0d1829] px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        <span>Activity</span>
        <span>Trade</span>
        <span>Contractor</span>
        <span>Planned</span>
        <span>Actual</span>
        <span>Status</span>
      </div>

      {groups.map((group) => {
        const isOpen = expanded.has(group.level);
        const groupStats = {
          avgActual: Math.round(group.activities.reduce((s, a) => s + a.actualPct, 0) / group.activities.length),
          critical: group.activities.filter((a) => a.status === "critical").length,
          delayed:  group.activities.filter((a) => a.status === "delayed").length,
        };

        return (
          <div key={group.level} className="border-b border-[#1a2535] last:border-0">
            {/* Group header */}
            <button
              onClick={() => onToggle(group.level)}
              className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1.5fr] w-full items-center px-4 py-3 hover:bg-[#111827] transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                {isOpen
                  ? <ChevronDown size={14} className="text-slate-400 shrink-0" />
                  : <ChevronRight size={14} className="text-slate-400 shrink-0" />
                }
                <span className="text-sm font-semibold text-white">{group.level}</span>
                <span className="text-[10px] text-slate-500 ml-1">
                  {group.activities.length} activities
                </span>
                {groupStats.critical > 0 && (
                  <span className="rounded-full bg-red-500/15 border border-red-500/20 px-1.5 py-px text-[9px] font-bold text-red-400">
                    {groupStats.critical} critical
                  </span>
                )}
              </div>
              <span />
              <span />
              <span />
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-20 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-mq-500"
                    style={{ width: `${groupStats.avgActual}%` }}
                  />
                </div>
                <span className="text-xs text-slate-400">{groupStats.avgActual}%</span>
              </div>
              <span />
            </button>

            {/* Activity rows */}
            {isOpen && group.activities.map((act) => {
              const m = STATUS_META[act.status];
              const Icon = m.icon;
              return (
                <div
                  key={act.id}
                  className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1.5fr] items-center border-t border-[#111827] bg-[#080e1a] px-4 py-3 hover:bg-[#0d1829] transition-colors"
                >
                  {/* Name */}
                  <div className="flex items-center gap-3 pl-5">
                    <MiniDonut pct={act.actualPct} status={act.status} />
                    <div>
                      <div className="text-sm text-slate-200">{act.name}</div>
                      {act.daysDelay > 0 && (
                        <div className="text-[10px] text-red-400 mt-0.5">
                          {act.daysDelay}d behind
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Trade */}
                  <span className="text-xs text-slate-400">{act.trade}</span>

                  {/* Contractor */}
                  <span className="text-[11px] text-slate-500 truncate pr-2">{act.contractor}</span>

                  {/* Planned */}
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-slate-500"
                        style={{ width: `${act.plannedPct}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-500">{act.plannedPct}%</span>
                  </div>

                  {/* Actual */}
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className={clsx("h-full rounded-full", m.bar)}
                        style={{ width: `${act.actualPct}%` }}
                      />
                    </div>
                    <span className={clsx("text-xs font-medium", m.color)}>{act.actualPct}%</span>
                  </div>

                  {/* Status pill */}
                  <div className={clsx(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium w-fit",
                    m.bg, m.border, m.color,
                  )}>
                    <Icon size={11} />
                    {m.label}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ── Gantt view ─────────────────────────────────────────────────────────────

function GanttView({ groups, expanded, onToggle }: {
  groups: LevelGroup[];
  expanded: Set<string>;
  onToggle: (k: string) => void;
}) {
  const today = pct(new Date().toISOString().slice(0, 10));

  return (
    <div className="rounded-xl border border-[#2d3d54] overflow-hidden">
      {/* Month ruler */}
      <div className="flex border-b border-[#2d3d54] bg-[#0d1829]">
        <div className="w-64 shrink-0 border-r border-[#2d3d54] px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Activity
        </div>
        <div className="relative flex-1 h-8">
          {MONTHS.map((m) => (
            <div
              key={m.label}
              className="absolute top-0 h-full flex items-center"
              style={{ left: `${m.left}%` }}
            >
              <div className="h-full w-px bg-[#1a2535]" />
              <span className="ml-1.5 text-[10px] font-medium text-slate-500">{m.label}</span>
            </div>
          ))}
          {/* Today line */}
          <div
            className="absolute top-0 h-full w-px bg-mq-500/60 z-10"
            style={{ left: `${today}%` }}
          >
            <span className="absolute -top-px left-1 text-[9px] font-bold text-mq-400">Today</span>
          </div>
        </div>
      </div>

      {groups.map((group) => {
        const isOpen = expanded.has(group.level);
        return (
          <div key={group.level} className="border-b border-[#1a2535] last:border-0">
            {/* Group header */}
            <button
              onClick={() => onToggle(group.level)}
              className="flex w-full items-center hover:bg-[#111827] transition-colors text-left"
            >
              <div className="flex w-64 shrink-0 items-center gap-2 border-r border-[#1a2535] px-4 py-3">
                {isOpen
                  ? <ChevronDown size={13} className="text-slate-400 shrink-0" />
                  : <ChevronRight size={13} className="text-slate-400 shrink-0" />
                }
                <span className="text-sm font-semibold text-white truncate">{group.level}</span>
                <span className="text-[10px] text-slate-600 ml-auto shrink-0">
                  {group.activities.length}
                </span>
              </div>
              <div className="relative flex-1 h-10 bg-[#0a1120]">
                {/* Today line */}
                <div
                  className="absolute top-0 h-full w-px bg-mq-500/20"
                  style={{ left: `${today}%` }}
                />
                {/* Month grid lines */}
                {MONTHS.map((m) => (
                  <div
                    key={m.label}
                    className="absolute top-0 h-full w-px bg-[#1a2535]"
                    style={{ left: `${m.left}%` }}
                  />
                ))}
                {/* Summary bar: planned */}
                {group.activities[0] && (
                  <div
                    className="absolute top-3 h-1 rounded-full bg-slate-700"
                    style={{
                      left: `${pct(group.activities[0].plannedStart)}%`,
                      width: `${width(group.activities[0].plannedStart, group.activities[group.activities.length - 1].plannedEnd)}%`,
                    }}
                  />
                )}
              </div>
            </button>

            {/* Activity Gantt rows */}
            {isOpen && group.activities.map((act) => {
              const m = STATUS_META[act.status];
              const pStart = pct(act.plannedStart);
              const pW     = width(act.plannedStart, act.plannedEnd);
              const aStart = act.actualStart ? pct(act.actualStart) : null;
              const aW     = aStart !== null
                ? Math.max(0.5, (act.actualPct / 100) * pW)
                : 0;

              return (
                <div
                  key={act.id}
                  className="flex items-center border-t border-[#0d1829] hover:bg-[#0a1120] transition-colors"
                >
                  {/* Name col */}
                  <div className="flex w-64 shrink-0 items-center gap-2 border-r border-[#1a2535] px-4 py-2 pl-9">
                    <span className="text-xs text-slate-300 truncate">{act.name}</span>
                    <span className={clsx("ml-auto shrink-0 text-[10px] font-medium", m.color)}>
                      {act.actualPct}%
                    </span>
                  </div>

                  {/* Timeline col */}
                  <div className="relative flex-1 h-9 bg-[#080e1a]">
                    {/* Today line */}
                    <div
                      className="absolute top-0 h-full w-px bg-mq-500/15"
                      style={{ left: `${today}%` }}
                    />
                    {/* Month grid lines */}
                    {MONTHS.map((mo) => (
                      <div
                        key={mo.label}
                        className="absolute top-0 h-full w-px bg-[#111827]"
                        style={{ left: `${mo.left}%` }}
                      />
                    ))}

                    {/* Planned bar (grey) */}
                    <div
                      className="absolute top-2.5 h-3.5 rounded-sm bg-slate-700/60 border border-slate-600/30"
                      style={{ left: `${pStart}%`, width: `${pW}%` }}
                      title={`Planned: ${fmtShort(act.plannedStart)} → ${fmtShort(act.plannedEnd)}`}
                    />

                    {/* Actual bar (coloured fill over planned) */}
                    {aStart !== null && (
                      <div
                        className={clsx("absolute top-2.5 h-3.5 rounded-sm", m.bar)}
                        style={{
                          left: `${aStart}%`,
                          width: `${aW}%`,
                          opacity: 0.85,
                        }}
                        title={`Actual: ${act.actualPct}%`}
                      />
                    )}

                    {/* Delay chevron — shown when behind */}
                    {act.daysDelay > 0 && (
                      <div
                        className="absolute top-1.5 flex items-center gap-0.5"
                        style={{ left: `${pStart + pW}%` }}
                      >
                        <div className="h-5 w-px bg-red-500/50" />
                        <span className="text-[8px] text-red-400 font-bold">
                          +{act.daysDelay}d
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex items-center gap-5 border-t border-[#1a2535] bg-[#0a1120] px-5 py-2.5 text-[10px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-5 rounded-sm bg-slate-700/60 border border-slate-600/30" />
          Planned
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-5 rounded-sm bg-mq-500" />
          Actual progress
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-5 rounded-sm bg-red-500" />
          Critical
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-5 rounded-sm bg-amber-500" />
          Delayed
        </span>
        <div className="ml-auto flex items-center gap-1">
          <span className="inline-block h-3 w-px bg-mq-500/60" />
          Today
        </div>
      </div>
    </div>
  );
}
