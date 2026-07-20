/**
 * SiteDiaryPage — Welcome Center 360° Site Diary
 *
 * MIQYAS first validation dataset: 37 hand-classified 360° equirectangular
 * panoramas from a 9-week interior fit-out (Welcome Center lobby refurbishment).
 *
 * Features:
 *  • Chronological timeline strip — click any capture to jump to it
 *  • 360° panorama viewer (equirectangular format, full-width)
 *  • Phase badge + actual/planned progress bars
 *  • Per-element completion breakdown (ceiling, flooring, walls, MEP, etc.)
 *  • S-Curve: actual vs planned over the full project duration
 *  • Weekly summary table
 *  • First ↔ last photo comparison (side-by-side)
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  Camera,
  ChevronLeft,
  ChevronRight,
  User,
  Layers,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  FlaskConical,
  SplitSquareHorizontal,
  BarChart3,
  TableProperties,
  ZoomIn,
  ZoomOut,
  X,
} from "lucide-react";
import clsx from "clsx";
import { format, parseISO } from "date-fns";
import { useTheme } from "@/store/themeContext";
import SCurveChart, { SCurveDataPoint } from "@/components/ui/SCurveChart";
import { siteDiaryApi } from "@/services/api";
import toast from "react-hot-toast";

// ── Types ──────────────────────────────────────────────────────────────────

interface ElementStatus {
  visible: boolean;
  completion_pct: number;
  notes: string;
}

interface VisionResult {
  phase: string;
  overall_completion_pct: number;
  element_status: {
    ceiling: ElementStatus;
    flooring: ElementStatus;
    walls: ElementStatus;
    mep_systems: ElementStatus;
    glazing_facade: ElementStatus;
    furnishings: ElementStatus;
  };
  activities_in_progress: string[];
  crew_present: boolean;
  scaffolding_present: boolean;
  key_observation: string;
  schedule_assessment: "ahead_of_plan" | "on_track" | "behind_plan";
  schedule_assessment_reason: string;
}

interface Capture {
  filename: string;
  capture_date: string;
  photographer: string;
  planned_completion_pct: number;
  active_activity: string;
  active_activity_name: string;
  vision: VisionResult;
}

interface ScheduleActivity {
  activity_id: string;
  name: string;
  description: string;
  planned_start: string;
  planned_finish: string;
  zone: string;
}

interface WeekSummary {
  week: string;
  captures: number;
  avg_actual_completion: number;
  avg_planned_completion: number;
  deviation: number;
  phase: string;
  key_observation: string;
}

interface SiteDiaryData {
  project: {
    name: string;
    location: string;
    type: string;
    start_date: string;
    end_date: string;
    total_photos: number;
    total_days_covered: number;
    note: string;
  };
  schedule: ScheduleActivity[];
  captures: Capture[];
  summary: {
    final_actual_completion: number;
    final_planned_completion: number;
    overall_deviation_pct: number;
    deviation_label: string;
    phases_observed: string[];
    total_crew_days: number;
    weeks: WeekSummary[];
  };
  generated_at: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const PHASE_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  strip_out_mep_roughin: {
    label: "Strip-out & MEP Rough-in",
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    dot: "bg-orange-500",
  },
  mep_installation: {
    label: "Intensive MEP Installation",
    color: "text-yellow-500",
    bg: "bg-yellow-500/10",
    dot: "bg-yellow-500",
  },
  mep_completion: {
    label: "MEP Completion & First Fix",
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    dot: "bg-blue-400",
  },
  finishes: {
    label: "Finishes",
    color: "text-purple-400",
    bg: "bg-purple-400/10",
    dot: "bg-purple-400",
  },
  final_fitout: {
    label: "Final Fit-out & Commissioning",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    dot: "bg-emerald-400",
  },
};

const ELEMENT_LABELS: Record<string, string> = {
  ceiling: "Ceiling",
  flooring: "Flooring",
  walls: "Walls",
  mep_systems: "MEP Systems",
  glazing_facade: "Glazing / Facade",
  furnishings: "Furnishings",
};

const ASSESSMENT_CONFIG = {
  ahead_of_plan: {
    label: "Ahead of plan",
    icon: TrendingUp,
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/30",
  },
  on_track: {
    label: "On track",
    icon: CheckCircle2,
    color: "text-sky-400",
    bg: "bg-sky-400/10",
    border: "border-sky-400/30",
  },
  behind_plan: {
    label: "Behind plan",
    icon: AlertTriangle,
    color: "text-red-400",
    bg: "bg-red-400/10",
    border: "border-red-400/30",
  },
};

// ── Sub-components ─────────────────────────────────────────────────────────

function ProgressBar({
  pct,
  color = "bg-emerald-400",
  showLabel = true,
  className,
}: {
  pct: number;
  color?: string;
  showLabel?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className={clsx("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-mono text-slate-400 w-9 text-right">{pct}%</span>
      )}
    </div>
  );
}

function PhaseBadge({ phase }: { phase: string }) {
  const cfg = PHASE_CONFIG[phase] ?? {
    label: phase,
    color: "text-slate-400",
    bg: "bg-slate-400/10",
    dot: "bg-slate-400",
  };
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
        cfg.color,
        cfg.bg,
      )}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full shrink-0", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function SiteDiaryPage() {
  const { theme } = useTheme();
  const isLight = theme === "light";

  const [data, setData] = useState<SiteDiaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [view, setView] = useState<"diary" | "compare" | "table">("diary");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Load analysis data
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await siteDiaryApi.getWelcomeCenter();
        setData(res.data as SiteDiaryData);
      } catch {
        toast.error("Failed to load site diary data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!data) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") setSelectedIdx((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight")
        setSelectedIdx((i) => Math.min(data!.captures.length - 1, i + 1));
      if (e.key === "Escape") setLightboxOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data]);

  // Scroll selected thumb into view
  useEffect(() => {
    const el = timelineRef.current?.querySelector(`[data-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedIdx]);

  const selected = data?.captures[selectedIdx];

  // S-curve data
  const sCurveData = useMemo<SCurveDataPoint[]>(() => {
    if (!data) return [];
    return data.captures.map((c) => ({
      date: c.capture_date,
      actual: c.vision.overall_completion_pct,
      planned: c.planned_completion_pct,
    }));
  }, [data]);

  // Phase spans for the timeline
  const phaseSpans = useMemo(() => {
    if (!data) return [];
    const spans: { phase: string; start: number; end: number }[] = [];
    data.captures.forEach((c, i) => {
      const last = spans[spans.length - 1];
      if (!last || last.phase !== c.vision.phase) {
        spans.push({ phase: c.vision.phase, start: i, end: i });
      } else {
        last.end = i;
      }
    });
    return spans;
  }, [data]);

  // ── Card style token ──────────────────────────────────────────────────
  const card = isLight
    ? "bg-[#FCFBF7] border border-[#E0DBCC] text-[#26241F]"
    : "bg-[#0f1c30] border border-[#1e3050] text-slate-200";
  const muted = isLight ? "text-[#8A8577]" : "text-slate-400";

  // ── Loading / Error ───────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex-1 p-6 space-y-4 animate-pulse">
        <div className="h-7 w-56 rounded-lg bg-slate-700/30" />
        <div className="h-96 rounded-2xl bg-slate-700/20" />
        <div className="h-20 rounded-xl bg-slate-700/20" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <FlaskConical size={40} className="mx-auto text-slate-500" />
          <p className="text-lg font-semibold text-slate-300">Site diary not available</p>
          <p className="text-sm text-slate-500">
            Run the analyzer script to generate analysis.json
          </p>
          <code className="text-xs bg-slate-800 px-3 py-2 rounded block">
            python3 scripts/analyze_site_diary.py --dry-run
          </code>
        </div>
      </div>
    );
  }

  const { project, summary, schedule } = data;
  const deviation = summary.overall_deviation_pct;
  const deviationLabel =
    deviation > 5 ? "ahead_of_plan" : deviation < -5 ? "behind_plan" : "on_track";
  const AssIcon = ASSESSMENT_CONFIG[deviationLabel].icon;

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 md:p-6 gap-4">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/projects"
            className={clsx(
              "flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors",
              isLight
                ? "text-[#8A8577] hover:text-[#26241F] hover:bg-[#F0EDE5]"
                : "text-slate-400 hover:text-white hover:bg-white/5",
            )}
          >
            <ArrowLeft size={15} />
            Projects
          </Link>

          <span className={muted}>·</span>

          <div>
            <h1 className="text-xl font-bold leading-tight">{project.name}</h1>
            <p className={clsx("text-xs", muted)}>
              {project.type} · {project.total_photos} captures ·{" "}
              {project.total_days_covered} days
            </p>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Reconstruction note */}
          <span
            className={clsx(
              "flex items-center gap-1.5 text-xs px-2 py-1 rounded-full",
              isLight ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-amber-500/10 text-amber-400 border border-amber-500/20",
            )}
          >
            <FlaskConical size={11} />
            Reconstructed schedule
          </span>

          {/* Overall deviation */}
          <span
            className={clsx(
              "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium",
              ASSESSMENT_CONFIG[deviationLabel].color,
              ASSESSMENT_CONFIG[deviationLabel].bg,
              ASSESSMENT_CONFIG[deviationLabel].border,
            )}
          >
            <AssIcon size={11} />
            {summary.final_actual_completion}% actual vs {summary.final_planned_completion}% planned
          </span>

          {/* View toggle */}
          <div
            className={clsx(
              "flex rounded-lg p-0.5 gap-0.5",
              isLight ? "bg-[#F0EDE5] border border-[#E0DBCC]" : "bg-slate-800 border border-slate-700",
            )}
          >
            {(
              [
                { key: "diary", icon: Camera, label: "Diary" },
                { key: "compare", icon: SplitSquareHorizontal, label: "Compare" },
                { key: "table", icon: TableProperties, label: "Weekly" },
              ] as const
            ).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={clsx(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all",
                  view === key
                    ? isLight
                      ? "bg-white text-[#26241F] shadow-sm"
                      : "bg-slate-700 text-white shadow"
                    : muted,
                )}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Diary view ─────────────────────────────────────────────────── */}
      {view === "diary" && selected && (
        <div className="flex-1 grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4 min-h-0">
          {/* Left: Photo + S-curve */}
          <div className="flex flex-col gap-4 min-h-0">
            {/* Panorama viewer */}
            <div
              className={clsx("relative rounded-2xl overflow-hidden group", card)}
              style={{ aspectRatio: "2/1", minHeight: 220 }}
            >
              <img
                src={siteDiaryApi.photoUrl(selected.filename)}
                alt={`360° panorama — ${selected.capture_date}`}
                className="w-full h-full object-cover cursor-zoom-in"
                onClick={() => setLightboxOpen(true)}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              {/* 360° badge */}
              <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-1 rounded-full">
                <span className="inline-block h-2 w-2 rounded-full bg-orange-400 animate-pulse" />
                360°
              </div>
              {/* Zoom hint */}
              <button
                onClick={() => setLightboxOpen(true)}
                className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 backdrop-blur-sm text-white p-1.5 rounded-lg"
                title="Open fullscreen"
              >
                <ZoomIn size={14} />
              </button>
              {/* Nav arrows */}
              <button
                onClick={() => setSelectedIdx((i) => Math.max(0, i - 1))}
                disabled={selectedIdx === 0}
                className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 backdrop-blur-sm text-white p-2 rounded-full disabled:opacity-20 hover:bg-black/70 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setSelectedIdx((i) => Math.min(data.captures.length - 1, i + 1))}
                disabled={selectedIdx === data.captures.length - 1}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 backdrop-blur-sm text-white p-2 rounded-full disabled:opacity-20 hover:bg-black/70 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* S-Curve */}
            <div className={clsx("rounded-2xl p-4", card)}>
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 size={14} className="text-emerald-400" />
                <span className="text-sm font-semibold">Progress S-Curve</span>
                <span className={clsx("text-xs ml-auto", muted)}>Actual vs Planned</span>
              </div>
              <SCurveChart data={sCurveData} height={200} />
            </div>
          </div>

          {/* Right: Capture details */}
          <div className={clsx("rounded-2xl p-4 space-y-4 overflow-y-auto", card)}>
            {/* Date + photographer */}
            <div>
              <div className="flex items-center gap-2 text-xs mb-1">
                <Calendar size={12} className={muted} />
                <span className={muted}>
                  {format(parseISO(selected.capture_date), "EEEE, d MMMM yyyy")}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <User size={12} className={muted} />
                <span className={muted}>{selected.photographer}</span>
                <span className={clsx("ml-auto", muted)}>
                  {selectedIdx + 1} / {data.captures.length}
                </span>
              </div>
            </div>

            {/* Phase */}
            <div>
              <PhaseBadge phase={selected.vision.phase} />
              <p className={clsx("text-xs mt-1", muted)}>
                Activity: {selected.active_activity_name}
              </p>
            </div>

            {/* Progress bars */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium">Actual completion</span>
                <span className="font-mono font-bold text-emerald-400">
                  {selected.vision.overall_completion_pct}%
                </span>
              </div>
              <ProgressBar
                pct={selected.vision.overall_completion_pct}
                color="bg-emerald-400"
              />
              <div className="flex items-center justify-between text-xs">
                <span className={muted}>Planned completion</span>
                <span className={clsx("font-mono", muted)}>
                  {selected.planned_completion_pct}%
                </span>
              </div>
              <ProgressBar
                pct={selected.planned_completion_pct}
                color={isLight ? "bg-slate-400" : "bg-slate-500"}
              />
              {/* Deviation */}
              {(() => {
                const dev = selected.vision.overall_completion_pct - selected.planned_completion_pct;
                return (
                  <p
                    className={clsx(
                      "text-xs font-mono font-semibold",
                      dev > 0 ? "text-emerald-400" : dev < 0 ? "text-red-400" : muted,
                    )}
                  >
                    {dev > 0 ? "+" : ""}{dev.toFixed(1)}pp{" "}
                    <span className={clsx("font-normal", muted)}>
                      {selected.vision.schedule_assessment.replace(/_/g, " ")}
                    </span>
                  </p>
                );
              })()}
            </div>

            {/* Key observation */}
            <div
              className={clsx(
                "rounded-lg p-3 text-xs italic leading-relaxed border",
                isLight
                  ? "bg-[#F5F3EC] border-[#E0DBCC] text-[#4A4740]"
                  : "bg-white/5 border-white/10 text-slate-300",
              )}
            >
              "{selected.vision.key_observation}"
            </div>

            {/* Activities in progress */}
            {selected.vision.activities_in_progress.length > 0 && (
              <div>
                <p className={clsx("text-xs font-semibold mb-1.5", muted)}>
                  Activities in progress
                </p>
                <ul className="space-y-1">
                  {selected.vision.activities_in_progress.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 mt-1 shrink-0" />
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Element status */}
            <div>
              <p className={clsx("text-xs font-semibold mb-2", muted)}>Element status</p>
              <div className="space-y-2.5">
                {Object.entries(selected.vision.element_status).map(([key, el]) => (
                  <div key={key}>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="text-slate-300">{ELEMENT_LABELS[key] ?? key}</span>
                      <span className="font-mono text-slate-400">{el.completion_pct}%</span>
                    </div>
                    <ProgressBar
                      pct={el.completion_pct}
                      color={
                        el.completion_pct >= 90
                          ? "bg-emerald-400"
                          : el.completion_pct >= 50
                          ? "bg-sky-400"
                          : el.completion_pct >= 20
                          ? "bg-yellow-400"
                          : "bg-slate-500"
                      }
                      showLabel={false}
                    />
                    {el.notes && el.notes !== "Not classified" && (
                      <p className={clsx("text-[10px] mt-0.5 line-clamp-2", muted)}>
                        {el.notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Flags */}
            <div className="flex gap-2 flex-wrap">
              {selected.vision.crew_present && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  👷 Crew present
                </span>
              )}
              {selected.vision.scaffolding_present && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">
                  🏗 Scaffolding
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Compare view ───────────────────────────────────────────────── */}
      {view === "compare" && data && (
        <div className="flex-1 flex flex-col gap-4">
          <p className={clsx("text-sm", muted)}>
            First capture (Day 1) vs Final capture (Handover day)
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[0, data.captures.length - 1].map((idx) => {
              const cap = data.captures[idx];
              return (
                <div key={idx} className={clsx("rounded-2xl overflow-hidden", card)}>
                  <div
                    className="relative"
                    style={{ aspectRatio: "2/1" }}
                  >
                    <img
                      src={siteDiaryApi.photoUrl(cap.filename)}
                      alt={`360° — ${cap.capture_date}`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-0 left-0 right-0 px-3 py-2 bg-gradient-to-t from-black/70 to-transparent">
                      <p className="text-white text-sm font-semibold">
                        {idx === 0 ? "Day 1 — " : "Handover — "}
                        {format(parseISO(cap.capture_date), "d MMM yyyy")}
                      </p>
                    </div>
                  </div>
                  <div className="p-4 space-y-3">
                    <PhaseBadge phase={cap.vision.phase} />
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span>Actual</span>
                        <span className="font-mono text-emerald-400 font-bold">
                          {cap.vision.overall_completion_pct}%
                        </span>
                      </div>
                      <ProgressBar pct={cap.vision.overall_completion_pct} />
                      <div className="flex items-center justify-between text-xs">
                        <span className={muted}>Planned</span>
                        <span className={clsx("font-mono", muted)}>
                          {cap.planned_completion_pct}%
                        </span>
                      </div>
                      <ProgressBar
                        pct={cap.planned_completion_pct}
                        color="bg-slate-500"
                      />
                    </div>
                    <p className={clsx("text-xs italic line-clamp-3", muted)}>
                      "{cap.vision.key_observation}"
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* S-curve in compare view */}
          <div className={clsx("rounded-2xl p-4", card)}>
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={14} className="text-emerald-400" />
              <span className="text-sm font-semibold">Full project S-Curve</span>
            </div>
            <SCurveChart data={sCurveData} height={220} />
          </div>
        </div>
      )}

      {/* ── Weekly table view ──────────────────────────────────────────── */}
      {view === "table" && data && (
        <div className="flex-1 overflow-auto">
          <div className={clsx("rounded-2xl overflow-hidden", card)}>
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="text-xs uppercase tracking-wide"
                  style={{
                    background: isLight ? "#F0EDE5" : "#0d1826",
                    borderBottom: `1px solid ${isLight ? "#E0DBCC" : "#1e3050"}`,
                  }}
                >
                  <th className="px-4 py-3 text-left font-semibold">Week</th>
                  <th className="px-4 py-3 text-right font-semibold">Captures</th>
                  <th className="px-4 py-3 text-right font-semibold">Actual %</th>
                  <th className="px-4 py-3 text-right font-semibold">Planned %</th>
                  <th className="px-4 py-3 text-right font-semibold">Deviation</th>
                  <th className="px-4 py-3 text-left font-semibold">Phase</th>
                  <th className="px-4 py-3 text-left font-semibold hidden xl:table-cell">
                    Key Observation
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {summary.weeks.map((w, i) => {
                  const dev = w.deviation;
                  return (
                    <tr
                      key={i}
                      className={clsx(
                        "transition-colors text-xs",
                        isLight ? "hover:bg-[#F5F3EC]" : "hover:bg-white/3",
                      )}
                    >
                      <td className="px-4 py-3 font-mono font-medium">{w.week}</td>
                      <td className="px-4 py-3 text-right">{w.captures}</td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-400 font-bold">
                        {w.avg_actual_completion}%
                      </td>
                      <td className={clsx("px-4 py-3 text-right font-mono", muted)}>
                        {w.avg_planned_completion}%
                      </td>
                      <td
                        className={clsx(
                          "px-4 py-3 text-right font-mono font-semibold",
                          dev > 0 ? "text-emerald-400" : dev < 0 ? "text-red-400" : muted,
                        )}
                      >
                        {dev > 0 ? "+" : ""}{dev}pp
                      </td>
                      <td className="px-4 py-3">
                        <PhaseBadge phase={w.phase} />
                      </td>
                      <td className={clsx("px-4 py-3 hidden xl:table-cell max-w-xs truncate", muted)}>
                        {w.key_observation}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Timeline strip (diary view) ────────────────────────────────── */}
      {view === "diary" && (
        <div className={clsx("rounded-2xl p-3", card)}>
          <div className="flex items-center gap-2 mb-2">
            <Layers size={12} className={muted} />
            <span className={clsx("text-xs font-medium", muted)}>
              Timeline — {data.captures.length} captures · click to jump
            </span>
            {/* Phase legend */}
            <div className="ml-auto flex gap-3 flex-wrap">
              {Object.entries(PHASE_CONFIG).map(([key, cfg]) => (
                <span key={key} className={clsx("flex items-center gap-1 text-[10px]", cfg.color)}>
                  <span className={clsx("h-2 w-2 rounded-full", cfg.dot)} />
                  {cfg.label.split(" ")[0]}
                </span>
              ))}
            </div>
          </div>

          <div
            ref={timelineRef}
            className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin"
            style={{ scrollbarWidth: "none" }}
          >
            {data.captures.map((cap, idx) => {
              const phaseCfg = PHASE_CONFIG[cap.vision.phase] ?? {
                dot: "bg-slate-500",
                color: "text-slate-400",
                bg: "bg-slate-400/10",
                label: cap.vision.phase,
              };
              const isSelected = idx === selectedIdx;
              return (
                <button
                  key={idx}
                  data-idx={idx}
                  onClick={() => setSelectedIdx(idx)}
                  className={clsx(
                    "relative flex-shrink-0 rounded-lg overflow-hidden transition-all",
                    isSelected
                      ? "ring-2 ring-emerald-400 ring-offset-1 ring-offset-transparent scale-105"
                      : "opacity-60 hover:opacity-90",
                  )}
                  style={{ width: 60, height: 40 }}
                  title={`${cap.capture_date} — ${cap.vision.overall_completion_pct}%`}
                >
                  <img
                    src={siteDiaryApi.photoUrl(cap.filename)}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const el = e.target as HTMLImageElement;
                      el.style.display = "none";
                      // Show phase color block as fallback
                    }}
                  />
                  {/* Phase color strip at bottom */}
                  <div
                    className={clsx("absolute bottom-0 left-0 right-0 h-1", phaseCfg.dot)}
                  />
                </button>
              );
            })}
          </div>

          {/* Phase labels under timeline */}
          <div className="mt-2 flex gap-1.5 overflow-x-hidden">
            {phaseSpans.map((span, i) => {
              const cfg = PHASE_CONFIG[span.phase] ?? { color: "text-slate-400", label: span.phase };
              const width = ((span.end - span.start + 1) / data.captures.length) * 100;
              return (
                <div
                  key={i}
                  className={clsx("text-[9px] font-medium truncate", cfg.color)}
                  style={{ width: `${width}%` }}
                  title={cfg.label}
                >
                  {cfg.label.split(" ").slice(0, 2).join(" ")}…
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Lightbox ──────────────────────────────────────────────────── */}
      {lightboxOpen && selected && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white"
            onClick={() => setLightboxOpen(false)}
          >
            <X size={24} />
          </button>
          <img
            src={siteDiaryApi.photoUrl(selected.filename)}
            alt="360° panorama fullscreen"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur px-4 py-2 rounded-full text-white text-sm">
            {format(parseISO(selected.capture_date), "d MMMM yyyy")} ·{" "}
            {selected.vision.overall_completion_pct}% complete
          </div>
        </div>
      )}
    </div>
  );
}
