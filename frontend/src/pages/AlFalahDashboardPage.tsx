/**
 * AlFalahDashboardPage — top-level overview for Al Falah School, Zone 2.
 *
 * 1. Project header: name, overall progress, schedule status, general info.
 * 2. Zone breakdown: one card per zone (2A / 2B) → click to drill into rooms.
 */

import { Link } from "react-router-dom";
import {
  ArrowLeft, MapPin, Calendar, LayoutGrid, AlertTriangle, Camera,
  TrendingUp, TrendingDown, CheckCircle2, ChevronRight, FlaskConical,
} from "lucide-react";
import clsx from "clsx";
import { useTheme } from "@/store/themeContext";
import {
  useAlFalahData, summariseZones, barColor, phaseCfg, PHOTO_BASE,
  type ZoneSummary, type Analysis,
} from "@/lib/alFalah";

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
      <div className={clsx("h-full rounded-full transition-all duration-500", barColor(pct))} style={{ width: `${Math.max(2, pct)}%` }} />
    </div>
  );
}

export default function AlFalahDashboardPage() {
  const { theme } = useTheme();
  const isLight = theme === "light";
  const { data, error } = useAlFalahData();

  const card = isLight ? "bg-[#FCFBF7] border border-[#E0DBCC] text-[#26241F]" : "bg-[#0f1c30] border border-[#1e3050] text-slate-200";
  const muted = isLight ? "text-[#8A8577]" : "text-slate-400";

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div className="space-y-2">
          <LayoutGrid size={36} className="mx-auto text-slate-500" />
          <p className={muted}>Could not load the Al Falah site-walk data.</p>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex-1 p-6 space-y-4 animate-pulse">
        <div className="h-8 w-64 rounded-lg bg-slate-700/30" />
        <div className="h-28 rounded-2xl bg-slate-700/20" />
        <div className="grid md:grid-cols-2 gap-4"><div className="h-56 rounded-2xl bg-slate-700/20" /><div className="h-56 rounded-2xl bg-slate-700/20" /></div>
      </div>
    );
  }

  const { project, summary } = data;
  const zones = summariseZones(data);
  const planned = project.planned_completion_pct ?? null;
  const deviation = planned != null ? summary.overall_completion_pct - planned : null;
  const schedule = deviation == null ? null : deviation >= 3 ? "ahead" : deviation <= -3 ? "behind" : "on_track";
  const schedCfg = {
    ahead:    { label: "Ahead of plan", icon: TrendingUp,   color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/30" },
    on_track: { label: "On track",      icon: CheckCircle2, color: "text-sky-400",     bg: "bg-sky-400/10",     border: "border-sky-400/30" },
    behind:   { label: "Behind plan",   icon: TrendingDown, color: "text-red-400",     bg: "bg-red-400/10",     border: "border-red-400/30" },
  }[schedule ?? "on_track"];
  const SchedIcon = schedCfg.icon;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        {/* Back */}
        <Link to="/" className={clsx("inline-flex items-center gap-1.5 text-xs transition-colors", muted, isLight ? "hover:text-[#26241F]" : "hover:text-slate-200")}>
          <ArrowLeft size={14} /> Dashboard
        </Link>

        {/* ── 1. Project header ─────────────────────────────────────────── */}
        <div className={clsx("rounded-2xl p-5 md:p-6", card)}>
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-display font-bold">{project.name}</h1>
              <p className={clsx("mt-1.5 flex items-center gap-3 text-sm flex-wrap", muted)}>
                <span className="inline-flex items-center gap-1.5"><MapPin size={14} /> {project.location}</span>
                <span className="inline-flex items-center gap-1.5"><LayoutGrid size={14} /> {project.zone}</span>
                <span className="inline-flex items-center gap-1.5"><Calendar size={14} /> Site walk {project.capture_date}</span>
              </p>
            </div>
            {/* Schedule status */}
            {schedule && (
              <span className={clsx("flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border font-medium", schedCfg.color, schedCfg.bg, schedCfg.border)}>
                <SchedIcon size={14} /> {schedCfg.label}
              </span>
            )}
          </div>

          {/* Overall progress vs plan */}
          <div className="mt-5 grid md:grid-cols-[1.4fr_1fr] gap-5">
            <div>
              <div className="flex items-end justify-between mb-1.5">
                <span className="text-sm font-medium">Overall completion</span>
                <span className="text-3xl font-bold font-mono" style={{ lineHeight: 1 }}>
                  <span className={barColor(summary.overall_completion_pct).replace("bg-", "text-")}>{summary.overall_completion_pct}%</span>
                </span>
              </div>
              <Bar pct={summary.overall_completion_pct} />
              {planned != null && (
                <div className={clsx("mt-2 flex items-center gap-2 text-xs", muted)}>
                  <FlaskConical size={11} className="text-amber-400" />
                  Indicative planned target {planned}% · actual {deviation! >= 0 ? "+" : ""}{deviation}pp
                </div>
              )}
            </div>

            {/* General info tiles */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Rooms", value: project.total_rooms, icon: LayoutGrid },
                { label: "Photos", value: project.total_photos_available, icon: Camera },
                { label: "Defects", value: summary.defect_total, icon: AlertTriangle },
              ].map((k) => (
                <div key={k.label} className={clsx("rounded-xl p-3", isLight ? "bg-[#F5F3EC]" : "bg-white/5")}>
                  <k.icon size={14} className={muted} />
                  <div className="text-xl font-bold tabular-nums mt-1">{k.value}</div>
                  <div className={clsx("text-2xs uppercase tracking-wide", muted)}>{k.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 2. Zone breakdown ─────────────────────────────────────────── */}
        <div>
          <h2 className="text-lg font-display font-bold mb-3">Progress by zone</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {zones.map((z) => (
              <ZoneCard key={z.zone} zone={z} data={data} card={card} muted={muted} />
            ))}
          </div>
        </div>

        <p className={clsx("text-2xs leading-relaxed border-t pt-4", muted, isLight ? "border-[#E0DBCC]" : "border-[#1e3050]")}>
          {project.note} {project.schedule_note}
        </p>
      </div>
    </div>
  );
}

function ZoneCard({ zone, data, card, muted }: {
  zone: ZoneSummary; data: Analysis; card: string; muted: string;
}) {
  const cover = zone.rooms[0]?.photo;
  return (
    <Link
      to={`/site-diary/al-falah/${zone.zone}`}
      className={clsx("group block rounded-2xl overflow-hidden transition-colors hover:border-mq-500/60", card)}
    >
      <div className="relative h-32 overflow-hidden bg-slate-900">
        {cover && <img src={PHOTO_BASE + cover} alt="" className="h-full w-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-[1.02] transition-all" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4 flex items-end justify-between">
          <div>
            <div className="text-white text-xl font-display font-bold">{zone.zone_label}</div>
            <div className="text-white/70 text-xs">{zone.rooms.length} rooms · {zone.defect_total} defects</div>
          </div>
          <span className="text-white text-2xl font-bold font-mono">{zone.overall_pct}%</span>
        </div>
      </div>
      <div className="p-4 space-y-3">
        <Bar pct={zone.overall_pct} />
        {/* mini trade bars */}
        <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
          {data.trades.map((t) => (
            <div key={t} className="flex items-center gap-2">
              <span className={clsx("w-20 shrink-0 text-2xs truncate", muted)}>{data.trade_labels[t]?.replace(" & Façade", "").replace(" & Fit-out", "")}</span>
              <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                <div className={clsx("h-full rounded-full", barColor(zone.by_trade[t]))} style={{ width: `${Math.max(2, zone.by_trade[t])}%` }} />
              </div>
              <span className={clsx("w-7 text-right text-2xs tabular-nums", muted)}>{zone.by_trade[t]}%</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between pt-1">
          <div className="flex gap-2 flex-wrap">
            {Object.entries(zone.phase_counts).map(([ph, n]) => {
              const c = phaseCfg(ph);
              return (
                <span key={ph} className={clsx("inline-flex items-center gap-1 text-2xs", c.color)}>
                  <span className={clsx("h-1.5 w-1.5 rounded-full", c.dot)} /> {c.label.split(" ")[0]} {n}
                </span>
              );
            })}
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-mq-400 group-hover:gap-1.5 transition-all">
            View rooms <ChevronRight size={14} />
          </span>
        </div>
      </div>
    </Link>
  );
}
