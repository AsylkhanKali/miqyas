/**
 * ElementInsightPanel — schedule status + video evidence + predicted-delay
 * chain for the currently selected BIM element.
 *
 * Designed to live at the top of the right-hand Properties drawer in the
 * viewer. Pulls from buildFakeSchedule() until the real progress + critical
 * path analytics surface this data.
 */

import { Camera, AlertTriangle, ArrowRight, Activity, Clock } from "lucide-react";
import clsx from "clsx";
import type { BIMElement } from "@/types";
import {
  STATUS_META,
  fakeEvidenceFor,
  type ElementSchedule,
} from "@/utils/fakeBimDelays";

interface Props {
  element: BIMElement;
  schedule: ElementSchedule | undefined;
  /** Predicted critical-delay path elements (top N), excluding this element. */
  delayChain: Array<{ element: BIMElement; sched: ElementSchedule }>;
  onSelectElement: (el: BIMElement) => void;
}

export default function ElementInsightPanel({
  element,
  schedule,
  delayChain,
  onSelectElement,
}: Props) {
  if (!schedule) return null;

  const meta = STATUS_META[schedule.status];
  const delta = schedule.actualPct - schedule.plannedPct;
  const evidence = fakeEvidenceFor(element);

  const otherChain = delayChain.filter((c) => c.element.id !== element.id);

  return (
    <div className="space-y-4">
      {/* ── Schedule status ──────────────────────────────────── */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Schedule status
          </h3>
          <span
            className={clsx(
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
              meta.bg, meta.border, meta.color,
            )}
          >
            {meta.label}
          </span>
        </div>

        <div className={clsx(
          "rounded-lg border p-3",
          schedule.status === "critical" || schedule.status === "behind"
            ? "border-red-500/20 bg-red-500/5"
            : "border-slate-700 bg-slate-800/40",
        )}>
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <Activity size={11} />
            <span className="truncate">{schedule.activity}</span>
          </div>

          {/* Planned vs actual bar */}
          <div className="mt-3 space-y-1.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Actual</span>
              <span className={clsx("text-base font-semibold", meta.color)}>
                {schedule.actualPct}%
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-slate-800 overflow-hidden">
              {/* Planned fill (background) */}
              <div
                className="absolute inset-y-0 left-0 bg-slate-600/50"
                style={{ width: `${schedule.plannedPct}%` }}
              />
              {/* Actual fill */}
              <div
                className={clsx("absolute inset-y-0 left-0", meta.dot)}
                style={{ width: `${schedule.actualPct}%` }}
              />
              {/* Planned marker */}
              <span
                className="absolute top-[-2px] bottom-[-2px] w-px bg-white/70"
                style={{ left: `${schedule.plannedPct}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-500">
              <span>Planned: {schedule.plannedPct}%</span>
              <span className={delta >= 0 ? "text-emerald-400" : "text-red-400"}>
                Δ {delta >= 0 ? "+" : ""}{delta} pts
              </span>
            </div>
          </div>

          {/* Delta + finish */}
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-700/60 pt-2.5">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Delay</div>
              <div className={clsx(
                "text-sm font-semibold",
                schedule.deltaDays > 0 ? "text-red-400"
                  : schedule.deltaDays < 0 ? "text-emerald-400"
                  : "text-slate-300",
              )}>
                {schedule.deltaDays > 0 ? `${schedule.deltaDays}d behind`
                  : schedule.deltaDays < 0 ? `${Math.abs(schedule.deltaDays)}d ahead`
                  : "On schedule"}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Planned finish</div>
              <div className="text-sm font-semibold text-slate-300">{schedule.plannedFinish}</div>
            </div>
          </div>

          {schedule.onCriticalPath && (
            <div className="mt-2.5 flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[10px] font-medium text-red-300">
              <AlertTriangle size={11} />
              On predicted critical-delay path
            </div>
          )}
        </div>
      </div>

      {/* ── Video evidence ───────────────────────────────────── */}
      {evidence.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wider text-slate-500">
            <span>Video evidence</span>
            <span className="text-[10px] normal-case tracking-normal text-slate-600">
              {evidence.length} {evidence.length === 1 ? "frame" : "frames"}
            </span>
          </h3>
          <div className="space-y-2">
            {evidence.map((e) => (
              <button
                key={e.captureId}
                className="group flex w-full items-center gap-2.5 rounded-lg border border-slate-700 bg-slate-800/40 p-2 text-left transition-colors hover:border-mq-500/40 hover:bg-slate-800"
              >
                {/* Fake thumbnail */}
                <div
                  className="relative flex h-12 w-16 shrink-0 items-center justify-center rounded-md overflow-hidden"
                  style={{
                    background: `linear-gradient(135deg, ${e.thumbnailColor}aa, #0f172a)`,
                  }}
                >
                  <Camera size={14} className="text-white/80" />
                  <span className="absolute bottom-0 right-0 rounded-tl bg-black/60 px-1 py-px text-[8px] font-medium text-white">
                    ▶ play
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 text-[10px] text-slate-500">
                    <Clock size={9} />
                    {e.capturedAt}
                  </div>
                  <p className="truncate text-xs text-slate-300">{e.note}</p>
                </div>
                <ArrowRight size={12} className="shrink-0 text-slate-600 transition-colors group-hover:text-mq-400" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Predicted delay chain ────────────────────────────── */}
      {otherChain.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wider text-slate-500">
            <span className="flex items-center gap-1.5">
              <AlertTriangle size={11} className="text-red-400" />
              Predicted delay path
            </span>
            <span className="text-[10px] normal-case tracking-normal text-slate-600">
              {otherChain.length} downstream
            </span>
          </h3>
          <div className="space-y-1.5">
            {otherChain.slice(0, 5).map(({ element: el, sched }) => {
              const m = STATUS_META[sched.status];
              return (
                <button
                  key={el.id}
                  onClick={() => onSelectElement(el)}
                  className="group flex w-full items-center gap-2 rounded-md border border-slate-700/60 bg-slate-800/30 px-2.5 py-1.5 text-left transition-colors hover:border-mq-500/40 hover:bg-slate-800"
                >
                  <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", m.dot)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-slate-300">
                      {el.name || el.ifc_type}
                    </p>
                    <p className="truncate text-[10px] text-slate-500">
                      {sched.activity} · {sched.deltaDays}d behind
                    </p>
                  </div>
                  <ArrowRight size={11} className="shrink-0 text-slate-600 transition-colors group-hover:text-mq-400" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
