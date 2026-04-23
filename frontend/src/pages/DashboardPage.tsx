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
  ahead:       "#10b981",
  on_track:    "#3b82f6",
  behind:      "#ef4444",
  not_started: "#64748b",
  extra_work:  "#f59e0b",
};

const DEV_LABELS: Record<string, string> = {
  ahead:       "Ahead",
  on_track:    "On Track",
  behind:      "Behind",
  not_started: "Not Started",
  extra_work:  "Extra Work",
};

const HEALTH_COLORS: Record<string, string> = {
  Healthy:   "text-emerald-400",
  "At Risk": "text-amber-400",
  Critical:  "text-red-400",
};

const HEALTH_BG: Record<string, string> = {
  Healthy:   "bg-emerald-500/10 border-emerald-500/20",
  "At Risk": "bg-amber-500/10 border-amber-500/20",
  Critical:  "bg-red-500/10 border-red-500/20",
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
  const trackColor = isLight ? "#E0DBCC" : "#263347";
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

// ── Main component ────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { theme } = useTheme();
  const isLight = theme === "light";

  const [data,     setData]     = useState<InvestorDashboard | null>(null);
  const [timeline, setTimeline] = useState<ProgressTimePoint[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [dashRes, tlRes] = await Promise.allSettled([
        systemApi.investorDashboard(),
        systemApi.progressTimeline(),
      ]);
      if (dashRes.status === "fulfilled") setData(dashRes.value.data);
      if (tlRes.status  === "fulfilled") setTimeline(tlRes.value.data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

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
          <p className="mt-1 text-sm text-slate-400">
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
              ? `${onTrackCount} elements on or ahead of schedule`
              : "No analysis data yet"
          }
          trendDirection={
            actualPct == null ? "neutral"
            : actualPct >= 70 ? "positive"
            : actualPct >= 45 ? "neutral"
            : "negative"
          }
          dateRange={data ? `Updated ${format(new Date(data.generated_at), "MMM d · HH:mm")}` : undefined}
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
              ? `${breakdown?.behind ?? 0} behind schedule · ${breakdown?.not_started ?? 0} not started`
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
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-mq-600/15">
              <Shield size={17} className="text-mq-400" />
            </div>
            <Link to="/projects" className="text-slate-600 hover:text-slate-400 transition-colors">
              <ArrowRight size={15} />
            </Link>
          </div>

          <div className="mt-3">
            <p className="text-4xl font-bold font-display text-white leading-none">
              {data?.total_projects ?? 0}
            </p>
            <p className="text-xs font-medium text-slate-400 mt-1">Active Projects</p>
            <p className="text-[10px] text-slate-600 mt-0.5">
              {(data?.total_elements_analyzed ?? 0).toLocaleString()} elements analyzed
            </p>
          </div>

          <div className="mt-3 flex gap-2">
            {(data?.projects ?? []).slice(0, 3).map((p) => (
              <div
                key={p.id}
                className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-700 text-[9px] font-bold text-slate-300"
                title={p.name}
              >
                {p.code.slice(0, 2).toUpperCase()}
              </div>
            ))}
            {(data?.projects?.length ?? 0) > 3 && (
              <div className="flex h-6 items-center rounded-full bg-slate-700 px-2 text-[9px] font-medium text-slate-400">
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
              <h2 className="text-sm font-semibold text-white">Progress Over Time</h2>
              <p className="text-xs text-slate-500 mt-0.5">
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
            <h2 className="text-sm font-semibold text-white">Trades</h2>
            {latestProjectId && (
              <Link
                to={`/projects/${latestProjectId}/trades`}
                className="text-xs text-mq-400 hover:text-mq-300 flex items-center gap-1"
              >
                All <ArrowRight size={12} />
              </Link>
            )}
          </div>

          {trades.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center py-8 text-slate-600">
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
          <h2 className="mb-1 text-sm font-semibold text-white">Deviation Breakdown</h2>
          <p className="text-xs text-slate-500 mb-4">
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
                      background:   isLight ? "#FCFBF7" : "#1a2842",
                      border:       `1px solid ${isLight ? "#E0DBCC" : "#263347"}`,
                      borderRadius: 8,
                      fontSize:     12,
                      color:        isLight ? "#26241F" : "#cbd5e1",
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
                      <span className="text-slate-400">{d.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">{d.value}</span>
                      <span className="text-slate-600 w-10 text-right">
                        {total > 0 ? `${Math.round((d.value / total) * 100)}%` : "–"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-slate-600">
              <Activity size={32} className="mb-2" />
              <p className="text-xs">Run an analysis to see breakdown</p>
            </div>
          )}
        </div>

        {/* Project Health — 2/3 */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Project Health</h2>
            <Link to="/projects" className="btn-ghost text-xs">
              All projects <ArrowRight size={13} />
            </Link>
          </div>

          {(data?.projects ?? []).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-600">
              <Shield size={32} className="mb-2" />
              <p className="text-xs">No projects yet</p>
              <Link to="/projects/new" className="btn-primary mt-4 text-xs">
                <Plus size={13} /> Create Project
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {(data?.projects ?? []).map((proj) => (
                <ProjectHealthRow key={proj.id} proj={proj} />
              ))}
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Critical Elements ─────────────────────────────────────────── */}
      {(data?.critical_elements ?? []).length > 0 && (
        <motion.div variants={fadeUp} className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={15} className="text-red-400" />
            <h2 className="text-sm font-semibold text-white">Critical Elements</h2>
            <span className="ml-auto text-xs text-slate-500">
              Top {data!.critical_elements.length} most behind across all projects
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-left">
                  <th className="pb-2 pr-4 font-medium text-slate-500">Element</th>
                  <th className="pb-2 pr-4 font-medium text-slate-500">Project</th>
                  <th className="pb-2 pr-4 font-medium text-slate-500">Observed</th>
                  <th className="pb-2 pr-4 font-medium text-slate-500">Scheduled</th>
                  <th className="pb-2 font-medium text-slate-500">Gap</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
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
        <motion.p variants={fadeUp} className="text-center text-[10px] text-slate-700">
          Last updated {format(new Date(data.generated_at), "MMM d, yyyy · HH:mm")}
        </motion.p>
      )}
    </motion.div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function ProjectHealthRow({ proj }: { proj: ProjectHealthCard }) {
  return (
    <Link
      to={`/projects/${proj.id}`}
      className="flex items-center gap-4 rounded-lg p-3 transition-colors hover:bg-slate-800/50 group"
    >
      <div className="relative shrink-0">
        <HealthRing score={proj.health_score} isLight={isLight} />
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white">
          {proj.health_score.toFixed(0)}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-white group-hover:text-white">
            {proj.name}
          </span>
          <span className={clsx(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium border",
            HEALTH_BG[proj.health_label], HEALTH_COLORS[proj.health_label],
          )}>
            {proj.health_label}
          </span>
        </div>
        <p className="mt-0.5 text-[10px] text-slate-500 font-mono">{proj.code}</p>

        {/* Mini progress bar */}
        {proj.total_elements > 0 && (
          <div className="mt-1.5 h-1 w-full rounded-full bg-slate-700 overflow-hidden">
            <div
              className={clsx(
                "h-full rounded-full",
                proj.health_score >= 70 ? "bg-emerald-500" :
                proj.health_score >= 45 ? "bg-amber-500" : "bg-red-500"
              )}
              style={{ width: `${proj.health_score}%` }}
            />
          </div>
        )}
      </div>

      <div className="shrink-0 text-right">
        {proj.total_elements > 0 ? (
          <>
            <p className="text-sm font-medium text-white">{proj.total_elements}</p>
            <p className="text-[10px] text-slate-500">elements</p>
          </>
        ) : (
          <p className="text-[10px] text-slate-600">No analysis</p>
        )}
      </div>

      {proj.behind_count > 0 && (
        <div className="shrink-0 text-right">
          <p className="text-sm font-medium text-red-400">{proj.behind_count}</p>
          <p className="text-[10px] text-slate-500">at risk</p>
        </div>
      )}

      {proj.last_capture_at && (
        <div className="shrink-0 hidden xl:flex items-center gap-1 text-[10px] text-slate-600">
          <Clock size={10} />
          {format(new Date(proj.last_capture_at), "MMM d")}
        </div>
      )}

      <ArrowRight size={14} className="shrink-0 text-slate-700 group-hover:text-slate-500 transition-colors" />
    </Link>
  );
}

function CriticalElementRow({ el }: { el: CriticalElement }) {
  const gap = el.scheduled_percent - el.observed_percent;
  return (
    <tr className="text-slate-400">
      <td className="py-2.5 pr-4">
        <div>
          <span className="font-medium text-white">{el.element_name}</span>
          {el.is_critical_path && (
            <span className="ml-1.5 rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-medium text-red-400 border border-red-500/20">
              Critical Path
            </span>
          )}
          <p className="text-[10px] text-slate-600 mt-0.5">{el.ifc_type}</p>
        </div>
      </td>
      <td className="py-2.5 pr-4">
        <Link to={`/projects/${el.project_id}`} className="text-mq-400 hover:text-mq-300 transition-colors">
          {el.project_name}
        </Link>
        {el.activity_name && (
          <p className="text-[10px] text-slate-600 mt-0.5 truncate max-w-[160px]">{el.activity_name}</p>
        )}
      </td>
      <td className="py-2.5 pr-4 font-mono text-white">{el.observed_percent.toFixed(0)}%</td>
      <td className="py-2.5 pr-4 font-mono text-slate-400">{el.scheduled_percent.toFixed(0)}%</td>
      <td className="py-2.5">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 rounded-full bg-slate-800 overflow-hidden">
            <div className="h-full rounded-full bg-red-500" style={{ width: `${Math.min(gap, 100)}%` }} />
          </div>
          <span className="font-mono text-red-400 text-[11px]">
            −{gap.toFixed(0)}pp
            {el.deviation_days != null && ` / ~${Math.abs(el.deviation_days).toFixed(0)}d`}
          </span>
        </div>
      </td>
    </tr>
  );
}
