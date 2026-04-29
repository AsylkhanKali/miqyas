/**
 * DashboardPage — Buildots-style investor/executive dashboard.
 *
 * Layout:
 *  1. Header with refresh + new project
 *  2. Top KPI row: Progress card · Deviations card · Latest capture thumbnail
 *  3. S-curve chart (2/3) + Trades panel (1/3)
 *  4. Project Health cards (2/3) + Deviation donut (1/3)
 *  5. Critical Elements table
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "@/store/themeContext";
import { useSettingsStore } from "@/store/settingsStore";
import ActionsPanel, { FAKE_ACTIONS, FAKE_DELAY_CALLOUTS } from "@/components/ui/ActionsPanel";
import { motion } from "framer-motion";
import {
  Plus,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Activity,
  Shield,
  CheckCircle,
  Clock,
  Camera,
} from "lucide-react";
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { systemApi } from "@/services/api";
import type {
  InvestorDashboard,
  ProjectHealthCard,
  CriticalElement,
  ProgressTimePoint,
} from "@/types";
import { SkeletonCard, SkeletonTable } from "@/components/ui/Skeleton";
import SCurveChart from "@/components/ui/SCurveChart";
import ProgressCard from "@/components/ui/ProgressCard";
import TradeRow, { type TradeStatus } from "@/components/ui/TradeRow";
import clsx from "clsx";

// ── Палитра ──────────────────────────────────────────────────────────────

const DEV_COLORS = {
  ahead:       "#4a9d6f",   // safe green
  on_track:    "#f97316",   // construction orange
  behind:      "#d84141",   // critical red
  not_started: "#8f7f70",   // warm muted
  extra_work:  "#e8a932",   // safety amber
};

const DEV_LABELS: Record<string, string> = {
  ahead:       "Ahead",
  on_track:    "On Track",
  behind:      "Behind",
  not_started: "Not Started",
  extra_work:  "Extra Work",
};

const HEALTH_COLORS: Record<string, string> = {
  Healthy:   "text-[var(--color-safe)]",
  "At Risk": "text-[var(--color-warning)]",
  Critical:  "text-[var(--color-critical)]",
};

const HEALTH_BG: Record<string, string> = {
  Healthy:   "bg-[var(--color-safe-bg)] border-[var(--color-safe)]",
  "At Risk": "bg-[var(--color-warning-bg)] border-[var(--color-warning)]",
  Critical:  "bg-[var(--color-critical-bg)] border-[var(--color-critical)]",
};

// ── Анимации ─────────────────────────────────────────────────────────────

const stagger = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { staggerChildren: 0.06 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

// ── HealthRing (SVG circular progress) ───────────────────────────────────

function HealthRing({ score, size = 52, isLight }: { score: number; size?: number; isLight?: boolean }) {
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 70 ? "#10b981" : score >= 45 ? "#f59e0b" : "#ef4444";
  const trackColor = isLight ? "#E0DBCC" : "#4a3f35";
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={trackColor} strokeWidth={5} />
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={5}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
      />
    </svg>
  );
}

// ── Derive "trades" from critical elements + breakdown ───────────────────

interface TradeSummary {
  name: string;
  displayName: string;
  actual: number;
  planned: number;
  behind: number;
  total: number;
  status: TradeStatus;
}

const CATEGORY_LABELS: Record<string, string> = {
  wall: "Wall Works", slab: "Slab Works", column: "Columns",
  beam: "Beams", door: "Doors & Frames", window: "Windows",
  stair: "Stairs", ceiling: "Ceilings", mep: "MEP Systems",
  curtain_wall: "Curtain Wall", railing: "Railings", furniture: "Furniture", other: "Other",
};

function deriveTrades(data: InvestorDashboard): TradeSummary[] {
  // Group critical elements by ifc_type / category
  const groups: Record<string, { behind: number; total: number; obs: number[]; sch: number[] }> = {};

  for (const el of data.critical_elements) {
    const key = el.ifc_type?.toLowerCase().replace("ifc", "") || "other";
    if (!groups[key]) groups[key] = { behind: 0, total: 0, obs: [], sch: [] };
    groups[key].behind++;
    groups[key].total++;
    groups[key].obs.push(el.observed_percent);
    groups[key].sch.push(el.scheduled_percent);
  }

  // Add global ahead/on_track group if no critical elements but data exists
  if (Object.keys(groups).length === 0 && data.deviation_breakdown.total > 0) {
    const bd = data.deviation_breakdown;
    const totalElements = bd.total;
    const onTrackPct = totalElements > 0 ? ((bd.ahead + bd.on_track) / totalElements) * 100 : 0;
    const behindPct  = totalElements > 0 ? (bd.behind / totalElements) * 100 : 0;
    return [
      {
        name: "all", displayName: "All Elements",
        actual: onTrackPct, planned: 100,
        behind: bd.behind, total: totalElements,
        status: onTrackPct >= 70 ? "on_track" : onTrackPct >= 45 ? "increasing_delays" : "critical",
      },
    ];
  }

  return Object.entries(groups).map(([key, g]) => {
    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const actual  = avg(g.obs);
    const planned = avg(g.sch);
    const behind  = planned - actual;
    let status: TradeStatus = "on_track";
    if (behind > 20) status = "critical";
    else if (behind > 5) status = "increasing_delays";
    return {
      name: key,
      displayName: CATEGORY_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      actual, planned, behind: g.behind, total: g.total, status,
    };
  });
}

// ── Fake data ─────────────────────────────────────────────────────────────

const FAKE_DASHBOARD: InvestorDashboard = {
  total_projects: 5,
  total_elements_analyzed: 8420,
  avg_health_score: 71,
  elements_at_risk: 312,
  generated_at: new Date().toISOString(),
  deviation_breakdown: {
    total: 8420,
    ahead: 610,
    on_track: 6320,
    behind: 890,
    not_started: 480,
    extra_work: 120,
  },
  projects: [
    { id: "p1", name: "Reem Hills — Tower B",       code: "RH-T02",    health_score: 82, health_label: "Healthy",  behind_count: 42,  total_elements: 2100, last_capture_at: new Date(Date.now() - 86400000).toISOString() },
    { id: "p2", name: "Aldaar Square",              code: "ALD-SQ03",  health_score: 61, health_label: "At Risk",  behind_count: 118, total_elements: 1840, last_capture_at: new Date(Date.now() - 2 * 86400000).toISOString() },
    { id: "p3", name: "Bloom Living — Phase 2",     code: "BL-P2-07",  health_score: 44, health_label: "Critical", behind_count: 203, total_elements: 1560, last_capture_at: new Date(Date.now() - 3 * 86400000).toISOString() },
    { id: "p4", name: "KIZAD Logistics Hub — Z4",   code: "KZD-Z4-02", health_score: 91, health_label: "Healthy",  behind_count: 14,  total_elements: 1920, last_capture_at: new Date().toISOString() },
    { id: "p5", name: "Aldaar HQ",                  code: "ALD-HQ11",  health_score: 58, health_label: "At Risk",  behind_count: 88,  total_elements: 1000, last_capture_at: new Date().toISOString() },
  ],
  critical_elements: [
    { element_name: "Block B partitions L3",    ifc_type: "IfcWall",        project_name: "Bloom Living — Phase 2", project_id: "p3", observed_percent: 62, scheduled_percent: 100, deviation_days: -18, activity_name: "Internal partition works", is_critical_path: true },
    { element_name: "AHU Zone 4 commissioning", ifc_type: "IfcFlowTerminal",project_name: "Aldaar HQ",              project_id: "p5", observed_percent: 71, scheduled_percent: 100, deviation_days: -12, activity_name: "MEP commissioning",       is_critical_path: true },
    { element_name: "Level 4 slab rebar",       ifc_type: "IfcSlab",        project_name: "Aldaar Square",          project_id: "p2", observed_percent: 61, scheduled_percent: 85,  deviation_days: -8,  activity_name: "Level 4 structural works",  is_critical_path: true },
    { element_name: "Podium roof waterproof",   ifc_type: "IfcCovering",    project_name: "Aldaar Square",          project_id: "p2", observed_percent: 78, scheduled_percent: 100, deviation_days: -5,  activity_name: "Waterproofing works",       is_critical_path: false },
  ],
};

const FAKE_TIMELINE: ProgressTimePoint[] = [
  { date: "2024-10-01", actual: 12, planned: 14, elements: 1200 },
  { date: "2024-11-01", actual: 22, planned: 24, elements: 2100 },
  { date: "2024-12-01", actual: 33, planned: 35, elements: 3400 },
  { date: "2025-01-01", actual: 44, planned: 46, elements: 5100 },
  { date: "2025-02-01", actual: 56, planned: 57, elements: 6800 },
  { date: "2025-03-01", actual: 67, planned: 68, elements: 7900 },
  { date: "2025-04-01", actual: 71, planned: 72, elements: 8420 },
];

// ── Main component ────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const { useFakeData } = useSettingsStore();

  const [data,     setData]     = useState<InvestorDashboard | null>(null);
  const [timeline, setTimeline] = useState<ProgressTimePoint[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (showRefresh = false) => {
    if (useFakeData) {
      setData(FAKE_DASHBOARD);
      setTimeline(FAKE_TIMELINE);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [dashRes, tlRes] = await Promise.allSettled([
        systemApi.investorDashboard(),
        systemApi.progressTimeline(),
      ]);
      if (dashRes.status === "fulfilled") {
        setData(dashRes.value.data);
      } else if (showRefresh) {
        toast.error("Could not reach the server — check your connection");
      }
      if (tlRes.status === "fulfilled") setTimeline(tlRes.value.data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, [useFakeData]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <SkeletonCard />
        <SkeletonTable rows={4} />
      </div>
    );
  }

  const breakdown = data?.deviation_breakdown;
  const total     = breakdown?.total ?? 0;

  // Derived metrics
  const onTrackCount = (breakdown?.ahead ?? 0) + (breakdown?.on_track ?? 0);
  const actualPct    = total > 0 ? Math.round((onTrackCount / total) * 100) : null;
  const plannedPct   = total > 0
    ? Math.round(((onTrackCount + (breakdown?.behind ?? 0)) / total) * 100)
    : null;

  const donutData = breakdown
    ? Object.entries(DEV_LABELS)
        .map(([key, label]) => ({
          name: label,
          value: (breakdown as unknown as Record<string, number>)[key] ?? 0,
          color: DEV_COLORS[key as keyof typeof DEV_COLORS],
        }))
        .filter((d) => d.value > 0)
    : [];

  const hasData = total > 0;
  const trades  = data ? deriveTrades(data) : [];

  const latestProjectId = data?.projects?.[0]?.id;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <motion.div variants={fadeUp} className="flex items-end justify-between">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Construction progress · AI-powered deviation detection
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="btn-ghost text-xs"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
          <Link to="/projects/new" className="btn-primary text-xs">
            <Plus size={14} />
            New Project
          </Link>
        </div>
      </motion.div>

      {/* ── Actions Required ─────────────────────────────────────────── */}
      <motion.div variants={fadeUp}>
        <ActionsPanel items={FAKE_ACTIONS} delays={FAKE_DELAY_CALLOUTS} />
      </motion.div>

      {/* ── Top KPI row ──────────────────────────────────────────────── */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 gap-4 sm:grid-cols-3">

        {/* Progress card */}
        <ProgressCard
          leftLabel="On Track"
          leftValue={actualPct}
          rightLabel="Scheduled"
          rightValue={plannedPct}
          trendText={
            hasData
              ? `${onTrackCount} elements on or ahead of schedule across ${data?.total_projects ?? 0} active projects`
              : "No analysis data yet"
          }
          trendDirection={
            actualPct == null ? "neutral"
            : actualPct >= 70 ? "positive"
            : actualPct >= 45 ? "neutral"
            : "negative"
          }
          dateRange={data ? `Based on latest capture ${format(new Date(data.generated_at), "MMM d · HH:mm")}` : undefined}
          icon={<Activity size={17} />}
          accent={actualPct == null ? "neutral" : actualPct >= 70 ? "green" : actualPct >= 45 ? "amber" : "red"}
          linkTo={latestProjectId ? `/projects/${latestProjectId}` : "/projects"}
        />

        {/* Deviations / Errors card */}
        <ProgressCard
          leftLabel="Elements at Risk"
          leftValue={data?.elements_at_risk ?? null}
          noPercent
          subLabel="Behind + Not Started"
          trendText={
            (data?.elements_at_risk ?? 0) > 0
              ? `${breakdown?.behind ?? 0} elements behind across ${data?.total_projects ?? 0} active zones · ${breakdown?.not_started ?? 0} not started`
              : "All elements on track"
          }
          trendDirection={(data?.elements_at_risk ?? 0) > 0 ? "negative" : "positive"}
          icon={<AlertTriangle size={17} />}
          accent={(data?.elements_at_risk ?? 0) > 0 ? "red" : "green"}
          linkTo="/reports"
        />

        {/* Projects overview card */}
        <div className="card p-5 flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ backgroundColor: "var(--color-accent-soft)" }}
            >
              <Shield size={17} style={{ color: "var(--color-accent)" }} />
            </div>
            <Link
              to="/projects"
              className="transition-colors"
              style={{ color: "var(--color-text-muted)" }}
            >
              <ArrowRight size={15} />
            </Link>
          </div>

          <div className="mt-3">
            <p
              className="text-4xl font-bold font-display leading-none"
              style={{ color: "var(--color-text-primary)" }}
            >
              {data?.total_projects ?? 0}
            </p>
            <p className="text-xs font-medium mt-1" style={{ color: "var(--color-text-secondary)" }}>
              Active Projects
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>
              {(data?.total_elements_analyzed ?? 0).toLocaleString()} elements analyzed
            </p>
          </div>

          <div className="mt-3 flex gap-1.5">
            {(data?.projects ?? []).slice(0, 3).map((p) => (
              <div
                key={p.id}
                className="flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold"
                style={{
                  backgroundColor: "var(--color-bg-elevated)",
                  color: "var(--color-text-secondary)",
                  border: "1px solid var(--color-border)",
                }}
                title={p.name}
              >
                {p.code.slice(0, 2).toUpperCase()}
              </div>
            ))}
            {(data?.projects?.length ?? 0) > 3 && (
              <div
                className="flex h-6 items-center rounded-full px-2 text-[9px] font-medium"
                style={{
                  backgroundColor: "var(--color-bg-elevated)",
                  color: "var(--color-text-muted)",
                  border: "1px solid var(--color-border)",
                }}
              >
                +{(data?.projects?.length ?? 0) - 3}
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* ── S-Curve + Trades ─────────────────────────────────────────── */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* S-Curve chart — 2/3 width */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                Progress Over Time
              </h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
                {timeline.length > 0
                  ? `${timeline.length} capture${timeline.length !== 1 ? "s" : ""} · actual vs planned`
                  : "S-curve will appear after your first analysis"}
              </p>
            </div>
          </div>
          <SCurveChart data={timeline} height={220} />
        </div>

        {/* Trades panel — 1/3 width */}
        <div className="card p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
              Trades
            </h2>
            {latestProjectId && (
              <Link
                to={`/projects/${latestProjectId}/trades`}
                className="text-xs flex items-center gap-1 transition-colors"
                style={{ color: "var(--color-accent)" }}
              >
                All <ArrowRight size={12} />
              </Link>
            )}
          </div>

          {trades.length === 0 ? (
            <div
              className="flex flex-1 flex-col items-center justify-center py-8"
              style={{ color: "var(--color-text-muted)" }}
            >
              <Activity size={24} className="mb-2" />
              <p className="text-xs text-center">Run an analysis to see trade breakdown</p>
            </div>
          ) : (
            <div className="flex-1 space-y-1 overflow-y-auto">
              {trades.map((t) => (
                <TradeRow
                  key={t.name}
                  name={t.displayName}
                  actualPercent={t.actual}
                  plannedPercent={t.planned}
                  errorsCount={t.behind > 0 ? t.behind : undefined}
                  status={t.status}
                />
              ))}
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Project Health + Deviation donut ─────────────────────────── */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* Deviation donut */}
        <div className="card p-5">
          <h2 className="mb-1 text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Deviation Breakdown
          </h2>
          <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
            {hasData ? `${total} elements total` : "No analysis data yet"}
          </p>

          {hasData ? (
            <>
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie
                    data={donutData}
                    cx="50%" cy="50%"
                    innerRadius={50} outerRadius={74}
                    paddingAngle={2} dataKey="value" strokeWidth={0}
                  >
                    {donutData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background:   isLight ? "#FCFBF7" : "#332d26",
                      border:       `1px solid ${isLight ? "#E0DBCC" : "rgba(255,255,255,0.10)"}`,
                      borderRadius: 8,
                      fontSize:     12,
                      color:        isLight ? "#26241F" : "#f5f3f0",
                    }}
                    formatter={(v) => [v, ""]}
                  />
                </PieChart>
              </ResponsiveContainer>

              <div className="mt-2 space-y-1.5">
                {donutData.map((d) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: d.color }} />
                      <span style={{ color: "var(--color-text-secondary)" }}>{d.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium" style={{ color: "var(--color-text-primary)" }}>
                        {d.value}
                      </span>
                      <span className="w-10 text-right" style={{ color: "var(--color-text-muted)" }}>
                        {total > 0 ? `${Math.round((d.value / total) * 100)}%` : "–"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div
              className="flex flex-col items-center justify-center py-10"
              style={{ color: "var(--color-text-muted)" }}
            >
              <Activity size={32} className="mb-2" />
              <p className="text-xs">Run an analysis to see breakdown</p>
            </div>
          )}
        </div>

        {/* Project Health — 2/3 */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
              Project Health
            </h2>
            <Link to="/projects" className="btn-ghost text-xs">
              All projects <ArrowRight size={13} />
            </Link>
          </div>

          {(data?.projects ?? []).length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-10"
              style={{ color: "var(--color-text-muted)" }}
            >
              <Shield size={32} className="mb-2" />
              <p className="text-xs">No projects yet</p>
              <Link to="/projects/new" className="btn-primary mt-4 text-xs">
                <Plus size={13} /> Create Project
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {(data?.projects ?? []).map((proj) => (
                <ProjectHealthRow key={proj.id} proj={proj} isLight={isLight} />
              ))}
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Critical Elements ─────────────────────────────────────────── */}
      {(data?.critical_elements ?? []).length > 0 && (
        <motion.div variants={fadeUp} className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={15} style={{ color: "var(--color-critical)" }} />
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
              Critical Elements
            </h2>
            <span className="ml-auto text-xs" style={{ color: "var(--color-text-muted)" }}>
              Top {data!.critical_elements.length} most behind across all projects
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left" style={{ borderBottom: "1px solid var(--color-border)" }}>
                  {["Element", "Project", "Observed", "Scheduled", "Gap"].map((h) => (
                    <th key={h} className="pb-2 pr-4 font-medium" style={{ color: "var(--color-text-muted)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(data?.critical_elements ?? []).map((el, i) => (
                  <CriticalElementRow key={i} el={el} />
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Footer */}
      {data && (
        <motion.p variants={fadeUp} className="text-center text-[10px]" style={{ color: "var(--color-text-muted)" }}>
          Last updated {format(new Date(data.generated_at), "MMM d, yyyy · HH:mm")}
        </motion.p>
      )}
    </motion.div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function ProjectHealthRow({ proj, isLight }: { proj: ProjectHealthCard; isLight?: boolean }) {
  return (
    <Link
      to={`/projects/${proj.id}`}
      className="flex items-center gap-4 rounded-lg p-3 transition-colors group"
      onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "var(--color-bg-hover)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = "transparent"; }}
    >
      <div className="relative shrink-0">
        <HealthRing score={proj.health_score} isLight={isLight} />
        <span
          className="absolute inset-0 flex items-center justify-center text-[10px] font-bold"
          style={{ color: "var(--color-text-primary)" }}
        >
          {proj.health_score.toFixed(0)}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="truncate text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            {proj.name}
          </span>
          <span className={clsx(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium border",
            HEALTH_BG[proj.health_label], HEALTH_COLORS[proj.health_label],
          )}>
            {proj.health_label}
          </span>
        </div>
        <p className="mt-0.5 text-[10px] font-mono" style={{ color: "var(--color-text-muted)" }}>{proj.code}</p>

        {/* Mini progress bar */}
        {proj.total_elements > 0 && (
          <div
            className="mt-1.5 h-1 w-full rounded-full overflow-hidden"
            style={{ backgroundColor: "var(--color-bg-elevated)" }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${proj.health_score}%`,
                backgroundColor:
                  proj.health_score >= 70 ? "var(--color-safe)" :
                  proj.health_score >= 45 ? "var(--color-warning)" :
                  "var(--color-critical)",
              }}
            />
          </div>
        )}
      </div>

      <div className="shrink-0 text-right">
        {proj.total_elements > 0 ? (
          <>
            <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>{proj.total_elements}</p>
            <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>elements</p>
          </>
        ) : (
          <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>No analysis</p>
        )}
      </div>

      {proj.behind_count > 0 && (
        <div className="shrink-0 text-right">
          <p className="text-sm font-medium" style={{ color: "var(--color-critical)" }}>{proj.behind_count}</p>
          <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>at risk</p>
        </div>
      )}

      {proj.last_capture_at && (
        <div
          className="shrink-0 hidden xl:flex items-center gap-1 text-[10px]"
          style={{ color: "var(--color-text-muted)" }}
        >
          <Clock size={10} />
          {format(new Date(proj.last_capture_at), "MMM d")}
        </div>
      )}

      <ArrowRight
        size={14}
        className="shrink-0 transition-colors"
        style={{ color: "var(--color-text-disabled)" }}
      />
    </Link>
  );
}

function CriticalElementRow({ el }: { el: CriticalElement }) {
  const gap = el.scheduled_percent - el.observed_percent;
  return (
    <tr style={{ borderTop: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
      <td className="py-2.5 pr-4">
        <div>
          <span className="font-medium" style={{ color: "var(--color-text-primary)" }}>{el.element_name}</span>
          {el.is_critical_path && (
            <span
              className="ml-1.5 rounded px-1.5 py-0.5 text-[9px] font-medium border"
              style={{
                backgroundColor: "var(--color-critical-bg)",
                borderColor:     "var(--color-critical)",
                color:           "var(--color-critical)",
              }}
            >
              Critical Path
            </span>
          )}
          <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-muted)" }}>{el.ifc_type}</p>
        </div>
      </td>
      <td className="py-2.5 pr-4">
        <Link
          to={`/projects/${el.project_id}`}
          className="transition-colors hover:opacity-80"
          style={{ color: "var(--color-accent-link)" }}
        >
          {el.project_name}
        </Link>
        {el.activity_name && (
          <p className="text-[10px] mt-0.5 truncate max-w-[160px]" style={{ color: "var(--color-text-muted)" }}>
            {el.activity_name}
          </p>
        )}
      </td>
      <td className="py-2.5 pr-4 font-mono" style={{ color: "var(--color-text-primary)" }}>
        {el.observed_percent.toFixed(0)}%
      </td>
      <td className="py-2.5 pr-4 font-mono" style={{ color: "var(--color-text-secondary)" }}>
        {el.scheduled_percent.toFixed(0)}%
      </td>
      <td className="py-2.5">
        <div className="flex items-center gap-2">
          <div
            className="h-1.5 w-20 rounded-full overflow-hidden"
            style={{ backgroundColor: "var(--color-bg-elevated)" }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(gap, 100)}%`, backgroundColor: "var(--color-critical)" }}
            />
          </div>
          <span className="font-mono text-[11px]" style={{ color: "var(--color-critical)" }}>
            −{gap.toFixed(0)}pp
            {el.deviation_days != null && ` / ~${Math.abs(el.deviation_days).toFixed(0)}d`}
          </span>
        </div>
      </td>
    </tr>
  );
}
