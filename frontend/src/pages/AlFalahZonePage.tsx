/**
 * AlFalahZonePage — all rooms of one Zone 2 sub-zone as cards.
 *
 * Clicking a room opens a detail modal with:
 *  • a drag-to-pan / zoom viewer of the 4K capture,
 *  • the trade breakdown, activities and defects,
 *  • a grounded MIQYAS AI chatbot for that room.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, AlertTriangle, LayoutGrid, X, ChevronLeft, ChevronRight,
  Layers, Camera, CheckCircle2,
} from "lucide-react";
import clsx from "clsx";
import { useTheme } from "@/store/themeContext";
import PannableImage from "@/components/ui/PannableImage";
import RoomChat from "@/components/ui/RoomChat";
import {
  useAlFalahData, barColor, phaseCfg, buildRoomSystemPrompt, PHOTO_BASE,
  type Room, type Analysis,
} from "@/lib/alFalah";

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
      <div className={clsx("h-full rounded-full transition-all duration-500", barColor(pct))} style={{ width: `${Math.max(2, pct)}%` }} />
    </div>
  );
}

function PhaseBadge({ phase }: { phase: string }) {
  const c = phaseCfg(phase);
  return (
    <span className={clsx("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium", c.color, c.bg)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full shrink-0", c.dot)} /> {c.label}
    </span>
  );
}

export default function AlFalahZonePage() {
  const { zone } = useParams<{ zone: string }>();
  const { theme } = useTheme();
  const isLight = theme === "light";
  const { data, error } = useAlFalahData();
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const card = isLight ? "bg-[#FCFBF7] border border-[#E0DBCC] text-[#26241F]" : "bg-[#0f1c30] border border-[#1e3050] text-slate-200";
  const muted = isLight ? "text-[#8A8577]" : "text-slate-400";

  const rooms = useMemo(() => (data ? data.rooms.filter((r) => r.zone === zone) : []), [data, zone]);
  const zoneLabel = rooms[0]?.zone_label ?? zone;

  // Keyboard nav within the modal
  useEffect(() => {
    if (selectedIdx == null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedIdx(null);
      if (e.key === "ArrowLeft") setSelectedIdx((i) => (i == null ? i : Math.max(0, i - 1)));
      if (e.key === "ArrowRight") setSelectedIdx((i) => (i == null ? i : Math.min(rooms.length - 1, i + 1)));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIdx, rooms.length]);

  if (error || (data && rooms.length === 0)) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div className="space-y-3">
          <LayoutGrid size={36} className="mx-auto text-slate-500" />
          <p className={muted}>{error ? "Could not load site-walk data." : `No rooms found for zone "${zone}".`}</p>
          <Link to="/site-diary/al-falah" className="text-sm text-mq-400 hover:underline">← Back to overview</Link>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex-1 p-6 space-y-4 animate-pulse">
        <div className="h-7 w-52 rounded-lg bg-slate-700/30" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-56 rounded-2xl bg-slate-700/20" />)}
        </div>
      </div>
    );
  }

  const zoneOverall = Math.round(rooms.reduce((s, r) => s + r.overall_completion_pct, 0) / rooms.length);
  const zoneDefects = rooms.reduce((s, r) => s + r.defects.length, 0);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-5">
        {/* Header */}
        <div>
          <Link to="/site-diary/al-falah" className={clsx("inline-flex items-center gap-1.5 text-xs transition-colors mb-3", muted, isLight ? "hover:text-[#26241F]" : "hover:text-slate-200")}>
            <ArrowLeft size={14} /> Al Falah overview
          </Link>
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-display font-bold">{zoneLabel}</h1>
              <p className={clsx("text-sm mt-0.5", muted)}>{rooms.length} rooms · {zoneDefects} defects logged</p>
            </div>
            <div className={clsx("rounded-2xl px-5 py-3 text-center", card)}>
              <div className={clsx("text-3xl font-bold font-mono", barColor(zoneOverall).replace("bg-", "text-"))}>{zoneOverall}%</div>
              <div className={clsx("text-2xs uppercase tracking-wide", muted)}>zone avg</div>
            </div>
          </div>
        </div>

        {/* Room cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {rooms.map((room, idx) => (
            <button
              key={room.room_id}
              onClick={() => setSelectedIdx(idx)}
              className={clsx("group text-left rounded-2xl overflow-hidden transition-colors hover:border-mq-500/60", card)}
            >
              <div className="relative aspect-[16/10] overflow-hidden bg-slate-900">
                <img src={PHOTO_BASE + room.photo} alt={room.room_label} loading="lazy"
                  className="h-full w-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-[1.02] transition-all" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3 flex items-end justify-between">
                  <div className="text-sm font-semibold text-white leading-tight">{room.room_label}</div>
                  <span className="text-white text-sm font-bold font-mono">{room.overall_completion_pct}%</span>
                </div>
                {room.defects.length > 0 && (
                  <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-red-500/90 px-1.5 py-0.5 text-2xs font-medium text-white">
                    <AlertTriangle size={10} /> {room.defects.length}
                  </div>
                )}
              </div>
              <div className="p-3 flex items-center justify-between">
                <PhaseBadge phase={room.phase} />
                <Bar pct={room.overall_completion_pct} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Room detail modal */}
      <AnimatePresence>
        {selectedIdx != null && rooms[selectedIdx] && (
          <RoomModal
            room={rooms[selectedIdx]}
            data={data}
            index={selectedIdx}
            total={rooms.length}
            isLight={isLight}
            onClose={() => setSelectedIdx(null)}
            onPrev={() => setSelectedIdx((i) => (i == null ? i : Math.max(0, i - 1)))}
            onNext={() => setSelectedIdx((i) => (i == null ? i : Math.min(rooms.length - 1, i + 1)))}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Room detail modal ─────────────────────────────────────────────────────────
function RoomModal({ room, data, index, total, isLight, onClose, onPrev, onNext }: {
  room: Room; data: Analysis; index: number; total: number; isLight: boolean;
  onClose: () => void; onPrev: () => void; onNext: () => void;
}) {
  const card = isLight ? "bg-[#FCFBF7] text-[#26241F]" : "bg-[#0f1c30] text-slate-200";
  const muted = isLight ? "text-[#8A8577]" : "text-slate-400";
  const panelBorder = isLight ? "border-[#E0DBCC]" : "border-[#1e3050]";

  const systemPrompt = useMemo(() => buildRoomSystemPrompt(room, data), [room, data]);
  const suggested = [
    "What's the state of this room?",
    "What defects are here?",
    "Which trade is furthest behind?",
  ];

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/70"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.97, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.97, y: 10 }}
        onClick={(e) => e.stopPropagation()}
        className={clsx("relative w-full max-w-6xl h-[90vh] rounded-2xl overflow-hidden border flex flex-col md:flex-row", card, panelBorder)}
      >
        {/* Close + nav */}
        <button onClick={onClose} className="absolute top-3 right-3 z-20 rounded-lg bg-black/50 p-1.5 text-white hover:bg-black/70">
          <X size={18} />
        </button>

        {/* Left: viewer + details */}
        <div className={clsx("flex flex-col min-h-0 md:w-[58%] border-b md:border-b-0 md:border-r", panelBorder)}>
          {/* Viewer */}
          <div className="relative shrink-0 h-[38%] min-h-[220px] bg-slate-900">
            <PannableImage src={PHOTO_BASE + room.photo} alt={room.room_label} className="w-full h-full" />
            {/* prev/next */}
            <button onClick={onPrev} disabled={index === 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-10 bg-black/50 text-white p-2 rounded-full disabled:opacity-20 hover:bg-black/70">
              <ChevronLeft size={16} />
            </button>
            <button onClick={onNext} disabled={index === total - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 bg-black/50 text-white p-2 rounded-full disabled:opacity-20 hover:bg-black/70">
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Details (scroll) */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-2xs uppercase tracking-wide text-mq-400">{room.zone_label} · {index + 1}/{total}</div>
                <h2 className="text-xl font-display font-bold">{room.room_label}</h2>
                <div className={clsx("mt-1 flex items-center gap-3 text-xs", muted)}>
                  <span className="inline-flex items-center gap-1"><Layers size={12} /> {phaseCfg(room.phase).label}</span>
                  <span className="inline-flex items-center gap-1"><Camera size={12} /> {room.photo_count_in_room} photos</span>
                </div>
              </div>
              <div className={clsx("rounded-xl px-3 py-2 text-center text-white shrink-0", barColor(room.overall_completion_pct))}>
                <div className="text-2xl font-bold leading-none">{room.overall_completion_pct}%</div>
                <div className="text-2xs opacity-90 mt-0.5">complete</div>
              </div>
            </div>

            {room.key_observation && (
              <p className={clsx("rounded-lg p-3 text-xs italic leading-relaxed border", isLight ? "bg-[#F5F3EC] border-[#E0DBCC] text-[#4A4740]" : "bg-white/5 border-white/10 text-slate-300")}>
                "{room.key_observation}"
              </p>
            )}

            {room.activities_in_progress.length > 0 && (
              <div>
                <p className={clsx("text-xs font-semibold mb-1.5", muted)}>Activities in progress</p>
                <ul className="space-y-1">
                  {room.activities_in_progress.map((a, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs"><CheckCircle2 size={13} className="text-emerald-400 mt-0.5 shrink-0" /> {a}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className={clsx("text-xs font-semibold mb-2", muted)}>Trade breakdown</p>
              <div className="space-y-2.5">
                {data.trades.map((t) => {
                  const ts = room.trades[t];
                  return (
                    <div key={t}>
                      <div className="flex items-center justify-between text-xs mb-0.5">
                        <span className={isLight ? "text-[#26241F]" : "text-slate-300"}>{data.trade_labels[t] ?? t}</span>
                        <span className={clsx("font-mono", muted)}>{ts?.visible ? `${ts.completion_pct}%` : "—"}</span>
                      </div>
                      {ts?.visible ? <Bar pct={ts.completion_pct} /> : <div className="h-1.5 rounded-full bg-white/5" />}
                      {ts?.visible && ts.notes && <p className={clsx("text-[10px] mt-0.5 line-clamp-2", muted)}>{ts.notes}</p>}
                    </div>
                  );
                })}
              </div>
            </div>

            {room.defects.length > 0 && (
              <div>
                <p className={clsx("text-xs font-semibold mb-1.5", muted)}>Defects / snags</p>
                <ul className="space-y-1">
                  {room.defects.map((d, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs"><AlertTriangle size={12} className="text-red-400 mt-0.5 shrink-0" /> {d}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Right: chatbot */}
        <div className="flex-1 min-h-0 md:w-[42%]">
          <RoomChat
            conversationKey={room.room_id}
            systemPrompt={systemPrompt}
            welcome={`Hi! Ask me anything about **${room.room_label}** — progress, trades, or defects from the site walk.`}
            suggested={suggested}
            isLight={isLight}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
