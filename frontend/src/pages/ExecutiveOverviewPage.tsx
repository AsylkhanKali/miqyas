/**
 * ExecutiveOverviewPage — Buildots-style portfolio dashboard.
 *
 * Designed for leadership: one glance shows which projects need attention.
 * Layout:
 *   1. Header + portfolio KPI strip
 *   2. Project tiles grid (health ring, progress bar, status)
 *   3. S-curve (actual vs planned, all projects combined)
 *   4. Critical elements table (top issues across portfolio)
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
  Building2,
  Activity,
  ShieldAlert,
} from "lucide-react";
import { format } from "date-fns";
import clsx from "clsx";
import { systemApi } from "@/services/api";
import type { InvestorDashboard, ProjectHealthCard, CriticalElement, ProgressTimePoint } from "@/types";
import { useTheme } from "@/store/themeContext";
import SCurveChart from "@/components/ui/SCurveChart";
import toast from "react-hot-toast";

// ── Animations ────────────────────────────────────────────────────────────

const stagger = {
  hidden: { opacity: 0 },
  show:   { opacity: 1, transition: { staggerChildren: 0.05 } },
};
const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
};

// ── Health ring ───────────────────────────────────────────────────────────

function HealthRing({ score, size = 64, isLight }: { score: number; size?: number; isLight: boolean }) {
  const r     = size / 2 - 6;
  const circ  = 2 * Math.PI * r;
  const dash  = (score / 100) * circ;
  const color = score >= 70 ? "#10b981" : score >= 45 ? "#f59e0b" : "#ef4444";
  const track = isLight ? "#E0DBCC" : "#263347";
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={track} strokeWidth={6} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
    </svg>
  );
}

// ── Project tile ──────────────────────────────────────────────────────────

const STATUS_META = {
  Healthy:   { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", dot: "bg-emerald-400" },
  "At Risk": { icon: AlertTriangle, color: "text-amber-400",  bg: "bg-amber-500/10  border-amber-500/20",  dot: "bg-amber-400" },
  Critical:  { icon: ShieldAlert,  color: "text-red-400",     bg: "bg-red-500/10    border-red-500/20",    dot: "bg-red-400" },
};

function ProjectTile({ proj, isLight }: { proj: ProjectHealthCard; isLight: boolean }) {
  const meta    = STATUS_META[proj.health_label] ?? STATUS_META["At Risk"];
  const Icon    = meta.icon;
  const pct     = proj.total_elements > 0
    ? Math.round(((proj.total_elements - proj.behind_count) / proj.total_elements) * 100)
    : null;
  const daysAgo = proj.last_capture_at
    ? Math.round((Date.now() - new Date(proj.last_capture_at).getTime()) / 86_400_000)
    : null;

  return (
    <motion.div variants={fadeUp}>
      <Link
        to={`/projects/${proj.id}`}
        className="card group block overflow-hidden transition-all duration-200 hover:-translate-y-0.5"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        {/* Colour bar at top */}
        <div className={clsx("h-1 w-full", {
          "bg-emerald-500": proj.health_label === "Healthy",
          "bg-amber-500":   proj.health_label === "At Risk",
          "bg-red-500":     proj.health_label === "Critical",
        })} />

        <div className="p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              <p className="text-xs font-mono font-medium text-slate-500 mb-0.5">{proj.code}</p>
              <h3 className="text-sm font-semibold text-white leading-tight truncate group-hover:text-mq-400 transition-colors">
                {proj.name}
              </h3>
            </div>
            <span className={clsx(
              "shrink-0 flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
              meta.bg, meta.color,
            )}>
              <span className={clsx("h-1.5 w-1.5 rounded-full", meta.dot)} />
              {proj.health_label}
            </span>
          </div>

          {/* Health ring + score */}
          <div className="flex items-center gap-4 mb-4">
            <div className="relative shrink-0">
              <HealthRing score={proj.health_score} size={64} isLight={isLight} />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-sm font-bold text-white leading-none">{proj.health_score.toFixed(0)}</span>
                <span className="text-[8px] text-slate-500 uppercase tracking-wide">health</span>
              </div>
            </div>

            <div className="flex-1 space-y-2">
              {/* Progress bar */}
              <div>
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-slate-500">On Track</span>
                  <span className="font-mono font-semibold text-white">{pct != null ? `${pct}%` : "—"}</span>
                </div>
                <div className="h-1.5 w-full rounded-full" style={{ backgroundColor: "var(--color-bg-elevated)" }}>
                  <div
                    className={clsx("h-1.5 rounded-full transition-all", {
                      "bg-emerald-500": (pct ?? 0) >= 70,
                      "bg-amber-500":   (pct ?? 0) >= 45 && (pct ?? 0) < 70,
                      "bg-red-500":     (pct ?? 0) < 45,
                    })}
                    style={{ width: `${pct ?? 0}%` }}
                  />
                </div>
              </div>

              {/* Behind count */}
              <div className="flex items-center gap-1.5">
                {proj.behind_count > 0 ? (
                  <>
                    <TrendingDown size={11} className="text-red-400 shrink-0" />
                    <span className="text-[10px] text-red-400 font-medium">{proj.behind_count} behind</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />
                    <span className="text-[10px] text-emerald-400">All on track</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t pt-3" style={{ borderColor: "var(--color-border)" }}>
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <Clock size={10} />
              {daysAgo === 0 ? "Today" : daysAgo === 1 ? "Yesterday" : daysAgo != null ? `${daysAgo}d ago` : "No captures"}
            </div>
            <div className="flex items-center gap-1 text-[10px] text-slate-600 group-hover:text-mq-400 transition-colors">
              View <ArrowRight size={10} />
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

// ── KPI chip ──────────────────────────────────────────────────────────────

function KPIChip({
  label,
  value,
  sub,
  icon: Icon,
  trend,
  accent = "neutral",
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  trend?: "up" | "down" | "flat";
  accent?: "green" | "red" | "amber" | "blue" | "neutral";
}) {
  const colors = {
    green:   { bg: "bg-emerald-500/10 border-emerald-500/20", icon: "text-emerald-400", value: "text-emerald-400" },
    red:     { bg: "bg-red-500/10     border-red-500/20",     icon: "text-red-400",     value: "text-red-400" },
    amber:   { bg: "bg-amber-500/10   border-amber-500/20",   icon: "text-amber-400",   value: "text-amber-400" },
    blue:    { bg: "bg-mq-600/10      border-mq-600/20",      icon: "text-mq-400",      value: "text-mq-400" },
    neutral: { bg: "border-slate-800",                         icon: "text-slate-400",   value: "text-white" },
  }[accent];

  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor = trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : "text-slate-500";

  return (
    <div className={clsx("card border p-5", colors.bg)}>
      <div className="flex items-start justify-between mb-3">
        <div className={clsx("flex h-9 w-9 items-center justify-center rounded-lg", colors.bg)}>
          <Icon size={17} className={colors.icon} />
        </div>
        {trend && <TrendIcon size={14} className={trendColor} />}
      </div>
      <p className={clsx("text-3xl font-bold font-display leading-none", colors.value)}>{value}</p>
      <p className="text-xs font-medium text-slate-400 mt-1">{label}</p>
      {sub && <p className="text-[10px] text-slate-600 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Critical element row ──────────────────────────────────────────────────

function CriticalRow({ el }: { el: CriticalElement }) {
  const gap = el.scheduled_percent - el.observed_percent;
  return (
    <tr className="border-b transition-colors hover:bg-slate-800/30" style={{ borderColor: "var(--color-border)" }}>
      <td className="py-3 pr-4">
        <p className="text-sm font-medium text-white truncate max-w-[180px]">{el.element_name}</p>
        <p className="text-[10px] text-slate-500 font-mono">{el.ifc_type}</p>
      </td>
      <td className="py-3 pr-4 hidden sm:table-cell">
        <Link to={`/projects/${el.project_id}`} className="text-xs text-slate-400 hover:text-mq-400 transition-colors">
          {el.project_name}
        </Link>
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <div className="w-20 h-1.5 rounded-full bg-slate-700">
            <div className="h-1.5 rounded-full bg-red-500" style={{ width: `${Math.min(el.observed_percent, 100)}%` }} />
          </div>
          <span className="text-xs font-mono text-slate-300">{el.observed_percent.toFixed(0)}%</span>
        </div>
        <p className="text-[10px] text-slate-600 mt-0.5">of {el.scheduled_percent.toFixed(0)}% planned</p>
      </td>
      <td className="py-3 pr-4 hidden md:table-cell">
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 border border-red-500/30 px-2 py-0.5 text-[10px] font-semibold text-red-400">
          <TrendingDown size={9} />
          -{gap.toFixed(0)}pp
        </span>
      </td>
      <td className="py-3">
        {el.is_critical_path && (
          <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium text-amber-400">
            Critical Path
          </span>
        )}
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function ExecutiveOverviewPage() {
  const { theme } = useTheme();
  const isLight = theme === "light";

  const [data,      setData]      = useState<InvestorDashboard | null>(null);
  const [timeline,  setTimeline]  = useState<ProgressTimePoint[]>([]);
  const [loading,   setLoading]   = useState(true);
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
      else if (showRefresh) toast.error("Could not reach the server");
      if (tlRes.status === "fulfilled") setTimeline(tlRes.value.data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-end justify-between">
          <div className="space-y-2">
            <div className="skeleton-pulse h-7 w-52 rounded-lg" />
            <div className="skeleton-pulse h-4 w-72 rounded" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <div key={i} className="skeleton-pulse h-32 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <div key={i} className="skeleton-pulse h-52 rounded-xl" />)}
        </div>
      </div>
    );
  }

  // ── Derived metrics ─────────────────────────────────────────────────────
  const bd       = data?.deviation_breakdown;
  const total    = bd?.total ?? 0;
  const onTrack  = (bd?.ahead ?? 0) + (bd?.on_track ?? 0);
  const onTrackPct = total > 0 ? Math.round((onTrack / total) * 100) : null;
  const healthLabel =
    (data?.avg_health_score ?? 0) >= 70 ? "Healthy"
    : (data?.avg_health_score ?? 0) >= 45 ? "At Risk"
    : "Critical";

  const criticals = (data?.critical_elements ?? []).slice(0, 8);
  const projectsSorted = [...(data?.projects ?? [])].sort((a, b) => a.health_score - b.health_score);

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <motion.div variants={fadeUp} className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Building2 size={18} className="text-mq-400" />
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Executive Overview</span>
          </div>
          <h1 className="page-title">Portfolio Dashboard</h1>
          <p className="mt-1 text-sm text-slate-400">
            {data
              ? `${data.total_projects} project${data.total_projects !== 1 ? "s" : ""} · Updated ${format(new Date(data.generated_at), "MMM d · HH:mm")}`
              : "Construction progress across all projects"}
          </p>
        </div>
        <button onClick={() => load(true)} disabled={refreshing} className="btn-ghost text-xs">
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </motion.div>

      {/* ── KPI strip ──────────────────────────────────────────────────── */}
      <motion.div variants={fadeUp} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPIChip
          label="Active Projects"
          value={data?.total_projects ?? 0}
          sub={`${(data?.total_elements_analyzed ?? 0).toLocaleString()} elements`}
          icon={Building2}
          accent="blue"
        />
        <KPIChip
          label="Portfolio Health"
          value={data ? `${data.avg_health_score.toFixed(0)}` : "—"}
          sub={healthLabel}
          icon={Activity}
          accent={data?.avg_health_score != null ? data.avg_health_score >= 70 ? "green" : data.avg_health_score >= 45 ? "amber" : "red" : "neutral"}
          trend={data?.avg_health_score != null ? data.avg_health_score >= 70 ? "up" : data.avg_health_score >= 45 ? "flat" : "down" : undefined}
        />
        <KPIChip
          label="On Track"
          value={onTrackPct != null ? `${onTrackPct}%` : "—"}
          sub={`${onTrack} of ${total} elements`}
          icon={CheckCircle2}
          accent={onTrackPct != null ? onTrackPct >= 70 ? "green" : onTrackPct >= 45 ? "amber" : "red" : "neutral"}
          trend={onTrackPct != null ? onTrackPct >= 70 ? "up" : "down" : undefined}
        />
        <KPIChip
          label="At Risk"
          value={data?.elements_at_risk ?? 0}
          sub={`${bd?.behind ?? 0} behind · ${bd?.not_started ?? 0} not started`}
          icon={AlertTriangle}
          accent={(data?.elements_at_risk ?? 0) > 0 ? "red" : "green"}
          trend={(data?.elements_at_risk ?? 0) > 0 ? "down" : "up"}
        />
      </motion.div>

      {/* ── Project tiles ──────────────────────────────────────────────── */}
      <motion.div variants={fadeUp}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-title">Projects</h2>
          <Link to="/projects" className="flex items-center gap-1 text-xs text-mq-400 hover:text-mq-300 transition-colors">
            All projects <ArrowRight size={12} />
          </Link>
        </div>

        {projectsSorted.length === 0 ? (
          <div className="card flex flex-col items-center justify-center py-16 text-slate-500">
            <Building2 size={32} className="mb-3 opacity-40" />
            <p className="text-sm font-medium">No projects yet</p>
            <p className="text-xs mt-1">Create a project to see it here</p>
            <Link to="/projects/new" className="btn-primary mt-4 text-xs">
              New Project
            </Link>
          </div>
        ) : (
          <motion.div
            variants={stagger}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {projectsSorted.map((proj) => (
              <ProjectTile key={proj.id} proj={proj} isLight={isLight} />
            ))}
          </motion.div>
        )}
      </motion.div>

      {/* ── S-curve ────────────────────────────────────────────────────── */}
      <motion.div variants={fadeUp}>
        <div className="card p-5">
          <div className="mb-4">
            <h2 className="section-title">Portfolio Progress Over Time</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {timeline.length > 0
                ? `${timeline.length} data point${timeline.length !== 1 ? "s" : ""} · actual vs planned across all projects`
                : "S-curve appears after your first analysis"}
            </p>
          </div>
          <SCurveChart data={timeline} height={220} />
        </div>
      </motion.div>

      {/* ── Critical elements table ─────────────────────────────────────── */}
      {criticals.length > 0 && (
        <motion.div variants={fadeUp}>
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--color-border)" }}>
              <div>
                <h2 className="section-title">Critical Elements</h2>
                <p className="text-xs text-slate-500 mt-0.5">Elements most behind schedule across portfolio</p>
              </div>
              <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 border border-red-500/30 px-2.5 py-1 text-xs font-semibold text-red-400">
                <AlertTriangle size={11} />
                {criticals.length} issues
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--color-border)" }}>
                    {["Element", "Project", "Progress", "Gap", ""].map((h) => (
                      <th key={h} className="px-0 pb-2.5 pt-3 pr-4 first:pl-5 text-left text-[10px] font-medium uppercase tracking-wider text-slate-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="px-5">
                  {criticals.map((el, i) => (
                    <CriticalRow key={i} el={el} />
                  ))}
                </tbody>
              </table>
            </div>
            {(data?.critical_elements?.length ?? 0) > 8 && (
              <div className="border-t px-5 py-3" style={{ borderColor: "var(--color-border)" }}>
                <p className="text-xs text-slate-500">
                  Showing 8 of {data!.critical_elements.length} critical elements
                </p>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Footer timestamp ────────────────────────────────────────────── */}
      {data && (
        <motion.p variants={fadeUp} className="text-center text-[10px] text-slate-700">
          Data as of {format(new Date(data.generated_at), "MMMM d, yyyy · HH:mm")}
        </motion.p>
      )}
    </motion.div>
  );
}
