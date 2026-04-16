/**
 * TradesPage — Buildots-style trades/categories overview.
 *
 * Layout:
 *  1. KPI bar: Progress %, Tasks completed, Open errors
 *  2. Trades list grouped by BIM category
 *  3. Detail panel for selected trade
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Users, AlertTriangle, CheckSquare, X, Activity,
  TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import { projectsApi, capturesApi, progressApi, bimApi } from "@/services/api";
import type { Project, VideoCapture, ProgressItem, BIMElement } from "@/types";
import TradeRow, { type TradeStatus } from "@/components/ui/TradeRow";
import { SkeletonCard, SkeletonTable } from "@/components/ui/Skeleton";
import clsx from "clsx";

// ── Category metadata ─────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; icon: string }> = {
  wall:         { label: "Wall Works",    icon: "🧱" },
  slab:         { label: "Slab Works",    icon: "🏗️" },
  column:       { label: "Columns",       icon: "🏛️" },
  beam:         { label: "Beams",         icon: "⬜" },
  door:         { label: "Doors",         icon: "🚪" },
  window:       { label: "Windows",       icon: "🪟" },
  stair:        { label: "Stairs",        icon: "🪜" },
  ceiling:      { label: "Ceilings",      icon: "⬜" },
  mep:          { label: "MEP Systems",   icon: "⚙️" },
  curtain_wall: { label: "Curtain Wall",  icon: "🏢" },
  railing:      { label: "Railings",      icon: "🚧" },
  furniture:    { label: "Furniture",     icon: "🪑" },
  other:        { label: "Other",         icon: "📦" },
};

function getCategoryLabel(cat: string) {
  return CATEGORY_META[cat]?.label ?? cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Types ──────────────────────────────────────────────────────────────────

interface TradeStat {
  category: string;
  label: string;
  icon: string;
  totalElements: number;
  analyzedElements: number;
  ahead: number;
  on_track: number;
  behind: number;
  not_started: number;
  avgObserved: number;
  avgScheduled: number;
  status: TradeStatus;
}

// ── Derive status from numbers ─────────────────────────────────────────────

function deriveStatus(stat: TradeStat): TradeStatus {
  const total = stat.ahead + stat.on_track + stat.behind + stat.not_started;
  if (total === 0) return "on_track";
  const behindRatio = stat.behind / total;
  if (behindRatio > 0.3) return "critical";
  if (behindRatio > 0.1) return "increasing_delays";
  const improvingRatio = (stat.ahead + stat.on_track) / total;
  if (improvingRatio > 0.8) return "on_track";
  if (improvingRatio > 0.6) return "improving";
  return "on_track";
}

// ── Main component ─────────────────────────────────────────────────────────

export default function TradesPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const [project,  setProject]  = useState<Project | null>(null);
  const [captures, setCaptures] = useState<VideoCapture[]>([]);
  const [progressItems, setProgressItems] = useState<ProgressItem[]>([]);
  const [elements,      setElements]      = useState<BIMElement[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrade, setSelectedTrade] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [projRes, captRes] = await Promise.all([
        projectsApi.get(projectId),
        capturesApi.list(projectId),
      ]);
      setProject(projRes.data);
      setCaptures(captRes.data);

      // Load progress for most recent analyzed capture
      const analyzed = captRes.data.filter(
        (c) => c.status === "compared" || c.status === "segmented"
      );
      if (analyzed.length > 0) {
        const latestCapture = analyzed[0];
        const progRes = await progressApi.list(projectId, latestCapture.id);
        setProgressItems(progRes.data);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Aggregate progress items by BIM category
  // Since ProgressItem doesn't carry category directly, we need a simple grouping
  // strategy. Here we group by element_id prefix patterns or use a heuristic from
  // existing data. For a full implementation, this would join with BIM elements.
  const tradeStats = useMemo((): TradeStat[] => {
    if (progressItems.length === 0) return [];

    // Group by deviation type for overall summary
    const overall: TradeStat = {
      category: "all",
      label: "All Elements",
      icon: "📊",
      totalElements: progressItems.length,
      analyzedElements: progressItems.length,
      ahead:       progressItems.filter((p) => p.deviation_type === "ahead").length,
      on_track:    progressItems.filter((p) => p.deviation_type === "on_track").length,
      behind:      progressItems.filter((p) => p.deviation_type === "behind").length,
      not_started: progressItems.filter((p) => p.deviation_type === "not_started").length,
      avgObserved:  progressItems.reduce((s, p) => s + p.observed_percent, 0) / progressItems.length,
      avgScheduled: progressItems.reduce((s, p) => s + p.scheduled_percent, 0) / progressItems.length,
      status: "on_track",
    };
    overall.status = deriveStatus(overall);

    return [overall];
  }, [progressItems]);

  // Overall KPI stats
  const kpiStats = useMemo(() => {
    const totalAnalyzed = tradeStats.reduce((s, t) => s + t.analyzedElements, 0);
    const totalAhead    = tradeStats.reduce((s, t) => s + t.ahead + t.on_track, 0);
    const totalBehind   = tradeStats.reduce((s, t) => s + t.behind + t.not_started, 0);
    const progressPct   = totalAnalyzed > 0 ? Math.round((totalAhead / totalAnalyzed) * 100) : 0;

    const analyzedCaptures = captures.filter((c) => c.status === "compared" || c.status === "segmented");
    const tasksCompleted   = analyzedCaptures.length;
    const tasksTotal       = captures.length;

    return { progressPct, totalBehind, tasksCompleted, tasksTotal };
  }, [tradeStats, captures]);

  const selectedStat = tradeStats.find((t) => t.category === selectedTrade);

  if (!projectId) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to={`/projects/${projectId}`}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            {project?.name ?? "Project"}
          </Link>
          <span className="text-slate-700">›</span>
          <div className="flex items-center gap-1.5">
            <Users size={16} className="text-mq-400" />
            <h1 className="text-sm font-semibold text-white">Trades</h1>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
          <SkeletonTable rows={5} />
        </div>
      ) : (
        <>
          {/* ── KPI bar ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Progress % */}
            <div className="card p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mq-600/15">
                  <div className="relative h-7 w-7">
                    <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
                      <circle cx="18" cy="18" r="14" fill="none" stroke="#263347" strokeWidth="3" />
                      <circle
                        cx="18" cy="18" r="14" fill="none"
                        stroke="#3b82f6" strokeWidth="3"
                        strokeDasharray={`${kpiStats.progressPct * 0.88} 88`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-mq-400">
                      {kpiStats.progressPct}
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-2xl font-bold font-display text-white">{kpiStats.progressPct}%</p>
                  <p className="text-xs text-slate-400">Progress of analysis</p>
                  <p className="text-[10px] text-slate-600 mt-0.5">
                    {kpiStats.tasksCompleted}/{kpiStats.tasksTotal} captures analyzed
                  </p>
                </div>
              </div>
            </div>

            {/* Tasks completed */}
            <div className="card p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/15">
                  <CheckSquare size={18} className="text-emerald-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold font-display text-white">
                    {kpiStats.tasksCompleted}{" "}
                    <span className="text-slate-500 text-lg">/ {kpiStats.tasksTotal}</span>
                  </p>
                  <p className="text-xs text-slate-400">Captures analyzed</p>
                  <p className="text-[10px] text-emerald-400 mt-0.5 flex items-center gap-1">
                    <TrendingUp size={10} />
                    {captures.filter((c) => c.frame_count > 0).length} with frames
                  </p>
                </div>
              </div>
            </div>

            {/* Open errors / at risk */}
            <div className="card p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/15">
                  <AlertTriangle size={18} className="text-red-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold font-display text-white">{kpiStats.totalBehind}</p>
                  <p className="text-xs text-slate-400">Elements at risk</p>
                  <p className="text-[10px] text-slate-600 mt-0.5">
                    Behind schedule or not started
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Trades list + Detail panel ────────────────────────── */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">

            {/* Trades list — 2/3 */}
            <div className="card p-4 lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-white">Trades Overview</h2>
                <span className="text-xs text-slate-500">
                  {tradeStats.length} categor{tradeStats.length !== 1 ? "ies" : "y"}
                </span>
              </div>

              {tradeStats.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Activity size={28} className="mb-3 text-slate-600" />
                  <p className="text-sm text-slate-400 font-medium">No analysis data yet</p>
                  <p className="mt-1 text-xs text-slate-600">
                    Run a full pipeline analysis to see trade breakdowns
                  </p>
                  <Link to={`/projects/${projectId}`} className="btn-primary mt-4 text-xs">
                    Go to Project
                  </Link>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {tradeStats.map((t) => (
                    <TradeRow
                      key={t.category}
                      name={`${t.icon} ${t.label}`}
                      actualPercent={t.avgObserved}
                      plannedPercent={t.avgScheduled}
                      tasksCompleted={t.ahead + t.on_track}
                      tasksTotal={t.totalElements}
                      errorsCount={t.behind + t.not_started}
                      status={t.status}
                      isSelected={selectedTrade === t.category}
                      onClick={() => setSelectedTrade(
                        selectedTrade === t.category ? null : t.category
                      )}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Detail panel — 1/3 */}
            <div className="card p-4">
              <AnimatePresence mode="wait">
                {selectedStat ? (
                  <motion.div
                    key={selectedStat.category}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="space-y-4"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-white">
                          {selectedStat.icon} {selectedStat.label}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {selectedStat.totalElements} elements
                        </p>
                      </div>
                      <button
                        onClick={() => setSelectedTrade(null)}
                        className="text-slate-600 hover:text-white transition-colors"
                      >
                        <X size={15} />
                      </button>
                    </div>

                    {/* Main stats */}
                    <div className="space-y-2">
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-400">Observed</span>
                          <span className="font-mono font-semibold text-white">
                            {selectedStat.avgObserved.toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all"
                            style={{ width: `${selectedStat.avgObserved}%` }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-400">Scheduled</span>
                          <span className="font-mono text-slate-400">
                            {selectedStat.avgScheduled.toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-slate-500 transition-all"
                            style={{ width: `${selectedStat.avgScheduled}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Deviation breakdown */}
                    <div className="space-y-2">
                      <h4 className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                        Breakdown
                      </h4>
                      {[
                        { key: "ahead",       label: "Ahead",       color: "bg-emerald-500", count: selectedStat.ahead },
                        { key: "on_track",    label: "On Track",    color: "bg-mq-500",      count: selectedStat.on_track },
                        { key: "behind",      label: "Behind",      color: "bg-red-500",     count: selectedStat.behind },
                        { key: "not_started", label: "Not Started", color: "bg-slate-600",   count: selectedStat.not_started },
                      ].map((row) => {
                        const total = selectedStat.totalElements || 1;
                        return (
                          <div key={row.key} className="flex items-center gap-2 text-xs">
                            <div className={clsx("h-2 w-2 rounded-full shrink-0", row.color)} />
                            <span className="text-slate-400 flex-1">{row.label}</span>
                            <span className="font-mono text-white">{row.count}</span>
                            <span className="text-slate-600 w-8 text-right">
                              {Math.round((row.count / total) * 100)}%
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Gap indicator */}
                    {selectedStat.avgScheduled > selectedStat.avgObserved && (
                      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                        <div className="flex items-center gap-2 text-xs text-red-400">
                          <TrendingDown size={13} />
                          <span className="font-medium">
                            {(selectedStat.avgScheduled - selectedStat.avgObserved).toFixed(1)}pp behind schedule
                          </span>
                        </div>
                      </div>
                    )}
                    {selectedStat.avgObserved >= selectedStat.avgScheduled && (
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                        <div className="flex items-center gap-2 text-xs text-emerald-400">
                          <TrendingUp size={13} />
                          <span className="font-medium">On or ahead of schedule</span>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex h-full flex-col items-center justify-center py-16 text-center text-slate-600"
                  >
                    <Users size={24} className="mb-2" />
                    <p className="text-xs">Select a trade to see details</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
