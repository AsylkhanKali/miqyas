/**
 * AlFalahDiaryPage — room-by-room site-walk diary for Al Falah School, Zone 2.
 *
 * Unlike the Welcome Center Site Diary (a time-lapse of one space), this is a
 * SPATIAL walk: 31 rooms captured in a single site visit, each analyzed by
 * trade (ceiling / flooring / walls / MEP / glazing / furnishings) via MIQYAS
 * AI vision. Data is a static JSON served from /public/al-falah/analysis.json.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, MapPin, Calendar, LayoutGrid, AlertTriangle, X,
  CheckCircle2, Camera, Layers,
} from "lucide-react";
import clsx from "clsx";

// ── Types (mirror scripts/… assemble.py output) ─────────────────────────────
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

const PHASE_LABELS: Record<string, string> = {
  structure: "Structure",
  mep_first_fix: "MEP First Fix",
  mep_second_fix: "MEP Second Fix",
  finishes: "Finishes",
  fit_out: "Fit-out",
  complete: "Complete",
  unknown: "Unknown",
};

const PHOTO_BASE = "/al-falah/";

// ── Completion → colour band ────────────────────────────────────────────────
function pctColor(pct: number): string {
  if (pct >= 90) return "#10b981"; // green — essentially done
  if (pct >= 60) return "#3b82f6"; // blue — progressing well
  if (pct >= 30) return "#f59e0b"; // amber — early
  return "#ef4444"; // red — barely started
}

function Bar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={clsx("h-1.5 rounded-full bg-white/10 overflow-hidden", className)}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.max(2, pct)}%`, backgroundColor: pctColor(pct) }}
      />
    </div>
  );
}

// ── Room card ───────────────────────────────────────────────────────────────
function RoomCard({ room, trades, onClick }: {
  room: Room; trades: string[]; onClick: () => void;
}) {
  return (
    <motion.button
      layout
      onClick={onClick}
      className="group text-left rounded-2xl border border-[#2d3d54] bg-[#16213a] overflow-hidden hover:border-mq-500/60 transition-colors"
    >
      <div className="relative aspect-[2/1] overflow-hidden bg-slate-900">
        <img
          src={PHOTO_BASE + room.photo}
          alt={room.room_label}
          loading="lazy"
          className="h-full w-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-[1.02] transition-all"
        />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 flex items-end justify-between">
          <div>
            <div className="text-sm font-semibold text-white leading-tight">{room.room_label}</div>
            <div className="text-2xs text-slate-300 mt-0.5">{PHASE_LABELS[room.phase] ?? room.phase}</div>
          </div>
          <div
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-white"
            style={{ backgroundColor: pctColor(room.overall_completion_pct) }}
          >
            {room.overall_completion_pct}%
          </div>
        </div>
        {room.defects.length > 0 && (
          <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-signal-behind/90 px-2 py-0.5 text-2xs font-medium text-white">
            <AlertTriangle size={11} /> {room.defects.length}
          </div>
        )}
      </div>
      <div className="p-3 space-y-2">
        {trades.map((t) => {
          const ts = room.trades[t];
          const visible = ts?.visible;
          return (
            <div key={t} className="flex items-center gap-2">
              <div className="w-24 shrink-0 text-2xs text-slate-400 truncate">
                {t.replace("_systems", "").replace("_facade", "").replace("_", " ")}
              </div>
              {visible ? (
                <>
                  <Bar pct={ts.completion_pct} className="flex-1" />
                  <div className="w-8 shrink-0 text-right text-2xs tabular-nums text-slate-300">
                    {ts.completion_pct}%
                  </div>
                </>
              ) : (
                <div className="flex-1 text-2xs text-slate-600">— not visible</div>
              )}
            </div>
          );
        })}
      </div>
    </motion.button>
  );
}

// ── Room detail modal ───────────────────────────────────────────────────────
function RoomDetail({ room, analysis, onClose }: {
  room: Room; analysis: Analysis; onClose: () => void;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[#2d3d54] bg-[#0d1526]"
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 rounded-lg bg-black/50 p-1.5 text-slate-300 hover:text-white hover:bg-black/70"
        >
          <X size={18} />
        </button>

        <img
          src={PHOTO_BASE + room.photo}
          alt={room.room_label}
          className="w-full aspect-[2/1] object-cover rounded-t-2xl"
        />

        <div className="p-5 space-y-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-2xs uppercase tracking-wide text-mq-400">{room.zone_label}</div>
              <h2 className="text-xl font-display font-bold text-white">{room.room_label}</h2>
              <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                <span className="inline-flex items-center gap-1"><Layers size={12} /> {PHASE_LABELS[room.phase] ?? room.phase}</span>
                <span className="inline-flex items-center gap-1"><Camera size={12} /> {room.photo_count_in_room} photo{room.photo_count_in_room !== 1 ? "s" : ""} on site walk</span>
              </div>
            </div>
            <div
              className="rounded-xl px-3 py-2 text-center text-white"
              style={{ backgroundColor: pctColor(room.overall_completion_pct) }}
            >
              <div className="text-2xl font-bold leading-none">{room.overall_completion_pct}%</div>
              <div className="text-2xs opacity-90 mt-0.5">complete</div>
            </div>
          </div>

          {room.key_observation && (
            <p className="text-sm text-slate-200 bg-[#16213a] border border-[#2d3d54] rounded-xl p-3">
              {room.key_observation}
            </p>
          )}

          {/* Trades */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Trade breakdown</h3>
            {analysis.trades.map((t) => {
              const ts = room.trades[t];
              return (
                <div key={t} className="rounded-xl border border-[#2d3d54] bg-[#16213a] p-3">
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <div className="text-sm font-medium text-white">{analysis.trade_labels[t] ?? t}</div>
                    {ts?.visible ? (
                      <div className="text-sm font-semibold tabular-nums" style={{ color: pctColor(ts.completion_pct) }}>
                        {ts.completion_pct}%
                      </div>
                    ) : (
                      <div className="text-2xs text-slate-500">not visible</div>
                    )}
                  </div>
                  {ts?.visible && <Bar pct={ts.completion_pct} className="mb-2" />}
                  <p className="text-xs text-slate-400 leading-relaxed">{ts?.notes}</p>
                </div>
              );
            })}
          </div>

          {/* Activities + defects */}
          <div className="grid md:grid-cols-2 gap-4">
            {room.activities_in_progress.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Active work</h3>
                <ul className="space-y-1.5">
                  {room.activities_in_progress.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                      <CheckCircle2 size={13} className="text-signal-ontrack mt-0.5 shrink-0" /> {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {room.defects.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Defects / snags</h3>
                <ul className="space-y-1.5">
                  {room.defects.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                      <AlertTriangle size={13} className="text-signal-behind mt-0.5 shrink-0" /> {d}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function AlFalahDiaryPage() {
  const [data, setData] = useState<Analysis | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<Room | null>(null);

  useEffect(() => {
    fetch(`${PHOTO_BASE}analysis.json`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const byZone = useMemo(() => {
    if (!data) return [];
    const groups: Record<string, Room[]> = {};
    for (const r of data.rooms) (groups[r.zone_label] ??= []).push(r);
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div className="space-y-2">
          <LayoutGrid size={36} className="mx-auto text-slate-500" />
          <p className="text-slate-300">Could not load the Al Falah site-walk data.</p>
          <p className="text-xs text-slate-500">Expected /public/al-falah/analysis.json</p>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex-1 p-6 space-y-4 animate-pulse">
        <div className="h-8 w-64 rounded-lg bg-slate-700/30" />
        <div className="h-24 rounded-2xl bg-slate-700/20" />
        <div className="grid md:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-64 rounded-2xl bg-slate-700/20" />)}
        </div>
      </div>
    );
  }

  const { project, summary } = data;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
        {/* Header */}
        <div>
          <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors mb-3">
            <ArrowLeft size={14} /> Dashboard
          </Link>
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-display font-bold text-white">{project.name}</h1>
              <div className="mt-1.5 flex items-center gap-4 text-sm text-slate-400 flex-wrap">
                <span className="inline-flex items-center gap-1.5"><MapPin size={14} /> {project.location}</span>
                <span className="inline-flex items-center gap-1.5"><LayoutGrid size={14} /> {project.zone}</span>
                <span className="inline-flex items-center gap-1.5"><Calendar size={14} /> Site walk {project.capture_date}</span>
              </div>
            </div>
            <div className="rounded-2xl border border-[#2d3d54] bg-[#16213a] px-5 py-3 text-center">
              <div className="text-3xl font-bold" style={{ color: pctColor(summary.overall_completion_pct) }}>
                {summary.overall_completion_pct}%
              </div>
              <div className="text-2xs uppercase tracking-wide text-slate-400 mt-0.5">Zone 2 avg</div>
            </div>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Rooms surveyed", value: project.total_rooms, icon: LayoutGrid },
            { label: "Photos on walk", value: project.total_photos_available, icon: Camera },
            { label: "Defects logged", value: summary.defect_total, icon: AlertTriangle },
            { label: "Trades tracked", value: data.trades.length, icon: Layers },
          ].map((k) => (
            <div key={k.label} className="rounded-2xl border border-[#2d3d54] bg-[#16213a] p-4">
              <k.icon size={16} className="text-mq-400 mb-2" />
              <div className="text-2xl font-bold text-white tabular-nums">{k.value}</div>
              <div className="text-2xs uppercase tracking-wide text-slate-400 mt-0.5">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Trade averages */}
        <div className="rounded-2xl border border-[#2d3d54] bg-[#16213a] p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Average completion by trade</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
            {data.trades.map((t) => {
              const bt = summary.by_trade[t];
              return (
                <div key={t}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-300">{bt.label}</span>
                    <span className="text-xs font-semibold tabular-nums" style={{ color: pctColor(bt.avg_pct) }}>{bt.avg_pct}%</span>
                  </div>
                  <Bar pct={bt.avg_pct} />
                  <div className="text-2xs text-slate-500 mt-1">visible in {bt.rooms_visible} of {project.total_rooms} rooms</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Rooms by zone */}
        {byZone.map(([zoneLabel, rooms]) => (
          <div key={zoneLabel} className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-display font-bold text-white">{zoneLabel}</h2>
              <span className="text-xs text-slate-500">{rooms.length} rooms</span>
              <div className="flex-1 h-px bg-[#2d3d54]" />
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {rooms.map((room) => (
                <RoomCard key={room.room_id} room={room} trades={data.trades} onClick={() => setSelected(room)} />
              ))}
            </div>
          </div>
        ))}

        {/* Disclaimer */}
        <p className="text-2xs text-slate-500 leading-relaxed border-t border-[#2d3d54] pt-4">
          {project.note}
        </p>
      </div>

      <AnimatePresence>
        {selected && <RoomDetail room={selected} analysis={data} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  );
}
