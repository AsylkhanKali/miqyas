/**
 * TimelineSlider — bottom-of-viewport scrubber for the BIM viewer.
 *
 * Lets the user drag through capture history (or fake milestones if no
 * captures exist yet) and jump between time points. Selecting a tick fires
 * `onSelectCapture` with the capture id; the viewer can then re-fetch
 * progress data for that capture.
 */

import { useMemo } from "react";
import { Clock, Camera, AlertTriangle } from "lucide-react";
import clsx from "clsx";
import type { VideoCapture } from "@/types";

export interface TimelineMilestone {
  /** ISO date (yyyy-mm-dd) */
  date: string;
  label: string;
  type: "capture" | "milestone" | "delay";
}

interface TimelineSliderProps {
  captures: VideoCapture[];
  selectedCaptureId: string | null;
  onSelectCapture: (id: string) => void;
  /** Optional extra milestones (programme dates, delay flags). */
  milestones?: TimelineMilestone[];
  className?: string;
}

const FAKE_MILESTONES: TimelineMilestone[] = [
  { date: "2026-03-08", label: "Foundation pour complete", type: "milestone" },
  { date: "2026-03-22", label: "Tower B partitions delayed",  type: "delay"      },
  { date: "2026-04-05", label: "Façade kick-off",             type: "milestone" },
  { date: "2026-04-19", label: "AHU commissioning slipped",   type: "delay"     },
];

export default function TimelineSlider({
  captures,
  selectedCaptureId,
  onSelectCapture,
  milestones = FAKE_MILESTONES,
  className,
}: TimelineSliderProps) {
  // Build unified timeline of capture ticks + milestones, sorted by date.
  const items = useMemo(() => {
    const captureItems = captures
      .filter((c) => c.capture_date || c.created_at)
      .map((c) => ({
        kind: "capture" as const,
        date: (c.capture_date || c.created_at) as string,
        capture: c,
      }));
    const ms = milestones.map((m) => ({ kind: "milestone" as const, date: m.date, milestone: m }));
    return [...captureItems, ...ms].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
  }, [captures, milestones]);

  const range = useMemo(() => {
    if (items.length === 0) {
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - 60);
      return { start, end };
    }
    const dates = items.map((i) => new Date(i.date).getTime());
    const minTs = Math.min(...dates);
    const maxTs = Math.max(...dates, Date.now());
    const pad = (maxTs - minTs) * 0.05 || 86400000;
    return { start: new Date(minTs - pad), end: new Date(maxTs + pad) };
  }, [items]);

  const pctFor = (iso: string): number => {
    const t = new Date(iso).getTime();
    const span = range.end.getTime() - range.start.getTime();
    if (span <= 0) return 0;
    return Math.max(0, Math.min(100, ((t - range.start.getTime()) / span) * 100));
  };

  const todayPct = pctFor(new Date().toISOString());

  return (
    <div
      className={clsx(
        "pointer-events-auto absolute bottom-4 left-1/2 z-10 -translate-x-1/2",
        "w-[min(880px,calc(100%-2rem))] rounded-xl border border-slate-700/80 bg-slate-900/85 backdrop-blur-md",
        "shadow-[0_8px_24px_rgba(0,0,0,0.45)]",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-2.5 pb-1.5 text-[10px] uppercase tracking-wider">
        <div className="flex items-center gap-1.5 text-slate-400">
          <Clock size={11} />
          <span className="font-semibold">Timeline</span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-500 normal-case tracking-normal">
            {fmt(range.start)} → {fmt(range.end)}
          </span>
        </div>
        <div className="flex items-center gap-3 normal-case tracking-normal text-[10px] text-slate-500">
          <LegendDot color="bg-mq-400"     label="Capture" />
          <LegendDot color="bg-emerald-400" label="Milestone" />
          <LegendDot color="bg-red-400"    label="Delay" />
        </div>
      </div>

      {/* Track */}
      <div className="px-4 pb-3 pt-2">
        <div className="relative h-9">
          {/* Base line */}
          <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-slate-700" />

          {/* "Today" marker */}
          <div
            className="absolute top-0 bottom-0 w-px bg-slate-500"
            style={{ left: `${todayPct}%` }}
          >
            <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 rounded-sm bg-slate-700 px-1 py-px text-[9px] font-medium text-slate-300">
              Today
            </span>
          </div>

          {/* Items */}
          {items.map((it, i) => {
            const left = pctFor(it.date);
            if (it.kind === "capture") {
              const active = it.capture.id === selectedCaptureId;
              return (
                <button
                  key={`c-${it.capture.id}-${i}`}
                  onClick={() => onSelectCapture(it.capture.id)}
                  style={{ left: `${left}%` }}
                  className={clsx(
                    "group absolute top-1/2 -translate-x-1/2 -translate-y-1/2",
                    "flex h-6 w-6 items-center justify-center rounded-full border transition-all",
                    active
                      ? "border-mq-400 bg-mq-500 text-white scale-110 shadow-[0_0_0_3px_rgba(56,189,248,0.25)]"
                      : "border-mq-500/50 bg-slate-900 text-mq-400 hover:scale-110 hover:border-mq-400",
                  )}
                  title={`${fmt(new Date(it.date))} · capture`}
                >
                  <Camera size={11} />
                  {active && (
                    <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-mq-500/15 border border-mq-500/30 px-1.5 py-px text-[9px] font-medium text-mq-300">
                      {fmt(new Date(it.date))}
                    </span>
                  )}
                </button>
              );
            }
            const m = it.milestone;
            const isDelay = m.type === "delay";
            return (
              <div
                key={`m-${i}`}
                style={{ left: `${left}%` }}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 group"
                title={`${fmt(new Date(it.date))} · ${m.label}`}
              >
                <span
                  className={clsx(
                    "flex h-3 w-3 items-center justify-center rounded-full border",
                    isDelay
                      ? "border-red-500/60 bg-red-500/30"
                      : "border-emerald-500/60 bg-emerald-500/30",
                  )}
                >
                  {isDelay && <AlertTriangle size={7} className="text-red-300" />}
                </span>
                <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800/90 px-1.5 py-px text-[9px] font-medium text-slate-300 opacity-0 transition-opacity group-hover:opacity-100">
                  {m.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Empty state */}
        {captures.length === 0 && (
          <p className="mt-1 text-center text-[10px] text-slate-600">
            No captures yet — upload a video to populate the timeline.
          </p>
        )}
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={clsx("h-1.5 w-1.5 rounded-full", color)} />
      {label}
    </span>
  );
}

function fmt(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
