/**
 * Shared types, config and data loader for the Al Falah School Zone 2 diary.
 * Data is a static JSON served from /public/al-falah/analysis.json.
 */

import { useEffect, useState } from "react";

export const PHOTO_BASE = "/al-falah/";

// ── Types (mirror scripts/assemble.py output) ───────────────────────────────
export interface TradeStatus {
  visible: boolean;
  completion_pct: number;
  notes: string;
}
export interface Room {
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
export interface Analysis {
  project: {
    name: string; location: string; type: string; zone: string;
    capture_date: string; total_rooms: number; total_photos_available: number;
    note: string;
    planned_completion_pct?: number;
    schedule_note?: string;
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

// ── Fit-out phase config ────────────────────────────────────────────────────
export const PHASE_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  structure:      { label: "Structure",     color: "text-slate-400",   bg: "bg-slate-400/10",   dot: "bg-slate-400" },
  mep_first_fix:  { label: "MEP First Fix",  color: "text-orange-500",  bg: "bg-orange-500/10",  dot: "bg-orange-500" },
  mep_second_fix: { label: "MEP Second Fix", color: "text-yellow-500",  bg: "bg-yellow-500/10",  dot: "bg-yellow-500" },
  finishes:       { label: "Finishes",       color: "text-purple-400",  bg: "bg-purple-400/10",  dot: "bg-purple-400" },
  fit_out:        { label: "Fit-out",        color: "text-sky-400",     bg: "bg-sky-400/10",     dot: "bg-sky-400" },
  complete:       { label: "Complete",       color: "text-emerald-400", bg: "bg-emerald-400/10", dot: "bg-emerald-400" },
  unknown:        { label: "Unknown",        color: "text-slate-400",   bg: "bg-slate-400/10",   dot: "bg-slate-400" },
};

export function phaseCfg(phase: string) {
  return PHASE_CONFIG[phase] ?? PHASE_CONFIG.unknown;
}

/** Completion → tailwind bg class (green ≥90, blue ≥50, amber ≥20, else grey). */
export function barColor(pct: number): string {
  return pct >= 90 ? "bg-emerald-400" : pct >= 50 ? "bg-sky-400" : pct >= 20 ? "bg-yellow-400" : "bg-slate-500";
}

// ── Per-zone aggregate ──────────────────────────────────────────────────────
export interface ZoneSummary {
  zone: string;
  zone_label: string;
  rooms: Room[];
  overall_pct: number;
  defect_total: number;
  by_trade: Record<string, number>;
  phase_counts: Record<string, number>;
}

export function summariseZones(data: Analysis): ZoneSummary[] {
  const groups: Record<string, Room[]> = {};
  for (const r of data.rooms) (groups[r.zone] ??= []).push(r);

  return Object.entries(groups)
    .map(([zone, rooms]) => {
      const overall_pct = Math.round(rooms.reduce((s, r) => s + r.overall_completion_pct, 0) / rooms.length);
      const defect_total = rooms.reduce((s, r) => s + r.defects.length, 0);
      const by_trade: Record<string, number> = {};
      for (const t of data.trades) {
        const vals = rooms.filter((r) => r.trades[t]?.visible).map((r) => r.trades[t].completion_pct);
        by_trade[t] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
      }
      const phase_counts: Record<string, number> = {};
      for (const r of rooms) phase_counts[r.phase] = (phase_counts[r.phase] ?? 0) + 1;
      return {
        zone,
        zone_label: rooms[0].zone_label,
        rooms,
        overall_pct,
        defect_total,
        by_trade,
        phase_counts,
      };
    })
    .sort((a, b) => a.zone.localeCompare(b.zone));
}

// ── Chatbot grounding ───────────────────────────────────────────────────────
/** Build a system prompt that grounds the assistant in a single room's data. */
export function buildRoomSystemPrompt(room: Room, data: Analysis): string {
  const p = data.project;
  const trades = data.trades
    .map((t) => {
      const ts = room.trades[t];
      const label = data.trade_labels[t] ?? t;
      if (!ts?.visible) return `- ${label}: not visible in this view`;
      return `- ${label}: ${ts.completion_pct}% — ${ts.notes}`;
    })
    .join("\n");

  return [
    `You are MIQYAS AI, a construction progress assistant for ${p.name} (${p.type}, ${p.location}).`,
    `You are currently answering questions about ONE room from the ${p.zone} site walk on ${p.capture_date}.`,
    ``,
    `## Room: ${room.room_label} (${room.zone_label})`,
    `Construction phase: ${phaseCfg(room.phase).label}`,
    `Overall completion: ${room.overall_completion_pct}%`,
    `Key observation: ${room.key_observation}`,
    ``,
    `## Trade breakdown`,
    trades,
    ``,
    room.activities_in_progress.length ? `## Work in progress\n${room.activities_in_progress.map((a) => `- ${a}`).join("\n")}` : "",
    room.defects.length ? `## Defects / snags\n${room.defects.map((d) => `- ${d}`).join("\n")}` : "## Defects / snags\nNone recorded for this room.",
    ``,
    `## Zone 2 context`,
    `Zone 2 overall completion averages ${data.summary.overall_completion_pct}% across ${p.total_rooms} rooms with ${data.summary.defect_total} defects logged.`,
    ``,
    `Answer clearly and concisely, citing the numbers above. If asked about something not in this data, say "I don't have that information in the site-walk data for this room." Use short markdown lists when helpful.`,
  ].filter((l) => l !== "").join("\n");
}

// ── Data hook ───────────────────────────────────────────────────────────────
export function useAlFalahData() {
  const [data, setData] = useState<Analysis | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${PHOTO_BASE}analysis.json`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  return { data, error };
}
