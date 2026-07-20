/**
 * AlFalahDiaryPage — Al Falah School, Zone 2 site-walk diary.
 *
 * Same visual language as the Welcome Center Site Diary (SiteDiaryPage), but
 * for a SPATIAL walk instead of a time-lapse: 31 rooms captured in one visit,
 * each analyzed by trade (ceiling / flooring / walls / MEP / glazing /
 * furnishings) via MIQYAS AI vision.
 *
 * Layout mirrors the Welcome Center:
 *  • Hero 360° panorama viewer with prev/next room navigation
 *  • Right-hand detail panel (phase, completion, trades, defects)
 *  • Bottom thumbnail strip — click any room to jump to it
 *  • "Grid" view toggle for a room overview
 *  • Fullscreen lightbox
 * Data is a static JSON served from /public/al-falah/analysis.json.
 */

import { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, ChevronLeft, ChevronRight, Camera, Layers, LayoutGrid,
  AlertTriangle, MapPin, Calendar, ZoomIn, X, Rows3,
} from "lucide-react";
import clsx from "clsx";
import { useTheme } from "@/store/themeContext";

// ── Types (mirror assemble.py output) ───────────────────────────────────────
interface TradeStatus {
  visible: boolean;
  completion_pct: number;
  notes: string;
}
interface Room {
  room_id: string;
  zone: string;
  zone_label: string;
  room_label: string;
  photo: string;
  photo_count_in_room: number;
  source_file: string;
  phase: string;
  overall_completion_pct: number;
  trades: Record<string, TradeStatus>;
  activities_in_progress: string[];
  defects: string[];
  key_observation: string;
}
interface Analysis {
  project: {
    name: string; location: string; type: string; zone: string;
    capture_date: string; total_rooms: number; total_photos_available: number;
    note: string;
  };
  trades: string[];
  trade_labels: Record<string, string>;
  rooms: Room[];
  summary: {
    overall_completion_pct: number;
    by_trade: Record<string, { label: string; avg_pct: number; rooms_visible: number }>;
    phase_counts: Record<string, number>;
    defect_total: number;
  };
  generated_at: string;
}

const PHOTO_BASE = "/al-falah/";

// ── Phase config (fit-out stages) ───────────────────────────────────────────
const PHASE_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  structure:      { label: "Structure",     color: "text-slate-400",   bg: "bg-slate-400/10",   dot: "bg-slate-400" },
  mep_first_fix:  { label: "MEP First Fix",  color: "text-orange-500",  bg: "bg-orange-500/10",  dot: "bg-orange-500" },
  mep_second_fix: { label: "MEP Second Fix", color: "text-yellow-500",  bg: "bg-yellow-500/10",  dot: "bg-yellow-500" },
  finishes:       { label: "Finishes",       color: "text-purple-400",  bg: "bg-purple-400/10",  dot: "bg-purple-400" },
  fit_out:        { label: "Fit-out",        color: "text-sky-400",     bg: "bg-sky-400/10",     dot: "bg-sky-400" },
  complete:       { label: "Complete",       color: "text-emerald-400", bg: "bg-emerald-400/10", dot: "bg-emerald-400" },
  unknown:        { label: "Unknown",        color: "text-slate-400",   bg: "bg-slate-400/10",   dot: "bg-slate-400" },
};

function barColor(pct: number): string {
  return pct >= 90 ? "bg-emerald-400" : pct >= 50 ? "bg-sky-400" : pct >= 20 ? "bg-yellow-400" : "bg-slate-500";
}

// ── Sub-components ───────────────────────────────────────────────────────────
function ProgressBar({ pct, color, showLabel = true, className }: {
  pct: number; color?: string; showLabel?: boolean; className?: string;
}) {
  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className={clsx("h-full rounded-full transition-all duration-500", color ?? barColor(pct))}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      {showLabel && <span className="text-xs font-mono text-slate-400 w-9 text-right">{pct}%</span>}
    </div>
  );
}

function PhaseBadge({ phase }: { phase: string }) {
  const cfg = PHASE_CONFIG[phase] ?? PHASE_CONFIG.unknown;
  return (
    <span className={clsx("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium", cfg.color, cfg.bg)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full shrink-0", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function AlFalahDiaryPage() {
  const { theme } = useTheme();
  const isLight = theme === "light";

  const [data, setData] = useState<Analysis | null>(null);
  const [error, setError] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [view, setView] = useState<"walk" | "grid">("walk");
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${PHOTO_BASE}analysis.json`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const rooms = data?.rooms ?? [];
  const selected = rooms[selectedIdx];

  // Keyboard nav
  useEffect(() => {
    if (!data) return;
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft") setSelectedIdx((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setSelectedIdx((i) => Math.min(rooms.length - 1, i + 1));
      if (e.key === "Escape") setLightboxOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data, rooms.length]);

  // Scroll selected thumb into view
  useEffect(() => {
    const el = stripRef.current?.querySelector(`[data-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedIdx]);

  // ── Theme tokens (mirror SiteDiaryPage) ───────────────────────────────
  const card = isLight
    ? "bg-[#FCFBF7] border border-[#E0DBCC] text-[#26241F]"
    : "bg-[#0f1c30] border border-[#1e3050] text-slate-200";
  const muted = isLight ? "text-[#8A8577]" : "text-slate-400";

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div className="space-y-2">
          <LayoutGrid size={36} className="mx-auto text-slate-500" />
          <p className="text-slate-400">Could not load the Al Falah site-walk data.</p>
          <p className="text-xs text-slate-500">Expected /public/al-falah/analysis.json</p>
        </div>
      </div>
    );
  }
  if (!data || !selected) {
    return (
      <div className="flex-1 p-6 space-y-4 animate-pulse">
        <div className="h-7 w-56 rounded-lg bg-slate-700/30" />
        <div className="h-96 rounded-2xl bg-slate-700/20" />
        <div className="h-20 rounded-xl bg-slate-700/20" />
      </div>
    );
  }

  const { project, summary } = data;

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 md:p-6 gap-4 overflow-y-auto">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className={clsx(
              "flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors",
              isLight ? "text-[#8A8577] hover:text-[#26241F] hover:bg-[#F0EDE5]" : "text-slate-400 hover:text-white hover:bg-white/5",
            )}
          >
            <ArrowLeft size={15} />
            Dashboard
          </Link>
          <span className={muted}>·</span>
          <div>
            <h1 className="text-xl font-bold leading-tight">{project.name}</h1>
            <p className={clsx("text-xs flex items-center gap-2 flex-wrap", muted)}>
              <span className="inline-flex items-center gap-1"><MapPin size={11} /> {project.location}</span>
              <span>·</span>
              <span>{project.zone}</span>
              <span>·</span>
              <span>{project.total_rooms} rooms</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1"><Calendar size={11} /> {project.capture_date}</span>
            </p>
          </div>
        </div>

        {/* Stats + view toggle */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium text-emerald-400 bg-emerald-400/10 border-emerald-400/30">
            {summary.overall_completion_pct}% avg completion
          </span>
          <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium text-red-400 bg-red-400/10 border-red-400/30">
            <AlertTriangle size={11} /> {summary.defect_total} defects
          </span>

          <div className={clsx(
            "flex rounded-lg p-0.5 gap-0.5",
            isLight ? "bg-[#F0EDE5] border border-[#E0DBCC]" : "bg-slate-800 border border-slate-700",
          )}>
            {([
              { key: "walk", icon: Camera, label: "Walk" },
              { key: "grid", icon: Rows3, label: "Grid" },
            ] as const).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setView(key)}
                className={clsx(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all",
                  view === key
                    ? isLight ? "bg-white text-[#26241F] shadow-sm" : "bg-slate-700 text-white shadow"
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

      {/* ── Walk view (hero + detail) ──────────────────────────────────── */}
      {view === "walk" && (
        <div className="flex-1 grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-4 min-h-0">
          {/* Left: panorama + trade averages */}
          <div className="flex flex-col gap-4 min-h-0">
            <div className={clsx("relative rounded-2xl overflow-hidden group", card)} style={{ aspectRatio: "2/1", minHeight: 220 }}>
              <img
                src={PHOTO_BASE + selected.photo}
                alt={selected.room_label}
                className="w-full h-full object-cover cursor-zoom-in"
                onClick={() => setLightboxOpen(true)}
              />
              {/* 360 badge */}
              <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-1 rounded-full">
                <span className="inline-block h-2 w-2 rounded-full bg-orange-400 animate-pulse" />
                360°
              </div>
              <button
                onClick={() => setLightboxOpen(true)}
                className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 backdrop-blur-sm text-white p-1.5 rounded-lg"
                title="Open fullscreen"
              >
                <ZoomIn size={14} />
              </button>
              {/* Room label overlay */}
              <div className="absolute bottom-0 left-0 right-0 px-4 py-3 bg-gradient-to-t from-black/75 to-transparent flex items-end justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-white/70">{selected.zone_label}</p>
                  <p className="text-white text-lg font-bold leading-tight">{selected.room_label}</p>
                </div>
                <span className="text-white text-xl font-bold font-mono">{selected.overall_completion_pct}%</span>
              </div>
              {/* Nav arrows */}
              <button
                onClick={() => setSelectedIdx((i) => Math.max(0, i - 1))}
                disabled={selectedIdx === 0}
                className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 backdrop-blur-sm text-white p-2 rounded-full disabled:opacity-20 hover:bg-black/70 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setSelectedIdx((i) => Math.min(rooms.length - 1, i + 1))}
                disabled={selectedIdx === rooms.length - 1}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 backdrop-blur-sm text-white p-2 rounded-full disabled:opacity-20 hover:bg-black/70 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            {/* Average completion by trade (project-wide) */}
            <div className={clsx("rounded-2xl p-4", card)}>
              <div className="flex items-center gap-2 mb-3">
                <Layers size={14} className="text-emerald-400" />
                <span className="text-sm font-semibold">Average completion by trade</span>
                <span className={clsx("text-xs ml-auto", muted)}>Zone 2 · {project.total_rooms} rooms</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
                {data.trades.map((t) => {
                  const bt = summary.by_trade[t];
                  return (
                    <div key={t}>
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="text-slate-300">{bt.label}</span>
                        <span className="font-mono text-slate-400">{bt.avg_pct}%</span>
                      </div>
                      <ProgressBar pct={bt.avg_pct} showLabel={false} />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: room detail */}
          <div className={clsx("rounded-2xl p-4 space-y-4 overflow-y-auto", card)}>
            <div className="flex items-center gap-2 text-xs">
              <Camera size={12} className={muted} />
              <span className={muted}>{selected.photo_count_in_room} photo{selected.photo_count_in_room !== 1 ? "s" : ""} on site walk</span>
              <span className={clsx("ml-auto", muted)}>{selectedIdx + 1} / {rooms.length}</span>
            </div>

            <PhaseBadge phase={selected.phase} />

            {/* Overall completion */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium">Overall completion</span>
                <span className="font-mono font-bold text-emerald-400">{selected.overall_completion_pct}%</span>
              </div>
              <ProgressBar pct={selected.overall_completion_pct} showLabel={false} />
            </div>

            {/* Key observation */}
            {selected.key_observation && (
              <div className={clsx(
                "rounded-lg p-3 text-xs italic leading-relaxed border",
                isLight ? "bg-[#F5F3EC] border-[#E0DBCC] text-[#4A4740]" : "bg-white/5 border-white/10 text-slate-300",
              )}>
                "{selected.key_observation}"
              </div>
            )}

            {/* Activities */}
            {selected.activities_in_progress.length > 0 && (
              <div>
                <p className={clsx("text-xs font-semibold mb-1.5", muted)}>Activities in progress</p>
                <ul className="space-y-1">
                  {selected.activities_in_progress.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 mt-1 shrink-0" />
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Trade breakdown */}
            <div>
              <p className={clsx("text-xs font-semibold mb-2", muted)}>Trade breakdown</p>
              <div className="space-y-2.5">
                {data.trades.map((t) => {
                  const ts = selected.trades[t];
                  const label = data.trade_labels[t] ?? t;
                  return (
                    <div key={t}>
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className="text-slate-300">{label}</span>
                        <span className="font-mono text-slate-400">{ts?.visible ? `${ts.completion_pct}%` : "—"}</span>
                      </div>
                      {ts?.visible ? (
                        <ProgressBar pct={ts.completion_pct} showLabel={false} />
                      ) : (
                        <div className="h-1.5 rounded-full bg-white/5" />
                      )}
                      {ts?.notes && ts.visible && (
                        <p className={clsx("text-[10px] mt-0.5 line-clamp-2", muted)}>{ts.notes}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Defects */}
            {selected.defects.length > 0 && (
              <div>
                <p className={clsx("text-xs font-semibold mb-1.5", muted)}>Defects / snags</p>
                <ul className="space-y-1">
                  {selected.defects.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <AlertTriangle size={12} className="text-red-400 mt-0.5 shrink-0" />
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Grid view (room overview) ──────────────────────────────────── */}
      {view === "grid" && (
        <div className="flex-1 overflow-y-auto">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {rooms.map((room, idx) => (
              <button
                key={room.room_id}
                onClick={() => { setSelectedIdx(idx); setView("walk"); }}
                className={clsx("group text-left rounded-2xl overflow-hidden transition-colors hover:border-emerald-400/50", card)}
              >
                <div className="relative aspect-[2/1] overflow-hidden bg-slate-900">
                  <img src={PHOTO_BASE + room.photo} alt={room.room_label} loading="lazy"
                    className="h-full w-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-[1.02] transition-all" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2.5 flex items-end justify-between">
                    <div>
                      <div className="text-[9px] uppercase tracking-wide text-white/60">{room.zone_label}</div>
                      <div className="text-xs font-semibold text-white leading-tight">{room.room_label}</div>
                    </div>
                    <span className="text-white text-sm font-bold font-mono">{room.overall_completion_pct}%</span>
                  </div>
                  {room.defects.length > 0 && (
                    <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-red-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      <AlertTriangle size={10} /> {room.defects.length}
                    </div>
                  )}
                </div>
                <div className="p-2.5">
                  <PhaseBadge phase={room.phase} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Thumbnail strip (walk view) ────────────────────────────────── */}
      {view === "walk" && (
        <div className={clsx("rounded-2xl p-3", card)}>
          <div className="flex items-center gap-2 mb-2">
            <Layers size={12} className={muted} />
            <span className={clsx("text-xs font-medium", muted)}>
              Site walk — {rooms.length} rooms · click to jump
            </span>
            <div className="ml-auto flex gap-3 flex-wrap">
              {Object.entries(PHASE_CONFIG).filter(([k]) => k !== "unknown" && summary.phase_counts[k]).map(([key, cfg]) => (
                <span key={key} className={clsx("flex items-center gap-1 text-[10px]", cfg.color)}>
                  <span className={clsx("h-2 w-2 rounded-full", cfg.dot)} />
                  {cfg.label.split(" ")[0]}
                </span>
              ))}
            </div>
          </div>
          <div ref={stripRef} className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
            {rooms.map((room, idx) => {
              const cfg = PHASE_CONFIG[room.phase] ?? PHASE_CONFIG.unknown;
              const isSelected = idx === selectedIdx;
              return (
                <button
                  key={room.room_id}
                  data-idx={idx}
                  onClick={() => setSelectedIdx(idx)}
                  className={clsx(
                    "relative flex-shrink-0 rounded-lg overflow-hidden transition-all",
                    isSelected ? "ring-2 ring-emerald-400 ring-offset-1 ring-offset-transparent scale-105" : "opacity-60 hover:opacity-90",
                  )}
                  style={{ width: 64, height: 40 }}
                  title={`${room.room_label} — ${room.overall_completion_pct}%`}
                >
                  <img src={PHOTO_BASE + room.photo} alt="" className="w-full h-full object-cover" />
                  <div className={clsx("absolute bottom-0 left-0 right-0 h-1", cfg.dot)} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Lightbox ───────────────────────────────────────────────────── */}
      {lightboxOpen && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center" onClick={() => setLightboxOpen(false)}>
          <button className="absolute top-4 right-4 text-white/70 hover:text-white" onClick={() => setLightboxOpen(false)}>
            <X size={24} />
          </button>
          <img src={PHOTO_BASE + selected.photo} alt={selected.room_label} className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur px-4 py-2 rounded-full text-white text-sm">
            {selected.zone_label} · {selected.room_label} · {selected.overall_completion_pct}% complete
          </div>
        </div>
      )}
    </div>
  );
}
