/**
 * TradeRow — Buildots-style trade/category progress row.
 *
 * Shows: name, dual progress bar (actual vs planned),
 * task count, error count, and status badge.
 * Hoverable + clickable.
 */

import { AlertTriangle, ChevronRight } from "lucide-react";
import clsx from "clsx";

export type TradeStatus = "on_track" | "increasing_delays" | "improving" | "critical" | "complete";

const STATUS_CONFIG: Record<TradeStatus, { label: string; dot: string; badge: string }> = {
  on_track:          { label: "On Track",          dot: "bg-emerald-400", badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" },
  increasing_delays: { label: "Increasing Delays", dot: "bg-red-400",     badge: "bg-red-500/15 text-red-400 border-red-500/25" },
  improving:         { label: "Improving",          dot: "bg-mq-400",      badge: "bg-mq-600/15 text-mq-400 border-mq-600/25" },
  critical:          { label: "Critical",           dot: "bg-red-500",     badge: "bg-red-500/20 text-red-400 border-red-500/30" },
  complete:          { label: "Complete",           dot: "bg-emerald-500", badge: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" },
};

export interface TradeRowProps {
  name: string;
  /** Observed / actual progress % (0-100) */
  actualPercent: number;
  /** Planned / scheduled progress % (0-100) */
  plannedPercent?: number;
  /** Counts */
  tasksCompleted?: number;
  tasksTotal?: number;
  errorsCount?: number;
  status?: TradeStatus;
  /** Click handler */
  onClick?: () => void;
  /** Whether this row is currently selected/highlighted */
  isSelected?: boolean;
  className?: string;
}

export default function TradeRow({
  name,
  actualPercent,
  plannedPercent,
  tasksCompleted,
  tasksTotal,
  errorsCount,
  status,
  onClick,
  isSelected,
  className,
}: TradeRowProps) {
  const planned = plannedPercent ?? 0;
  const behind = plannedPercent != null ? Math.max(0, plannedPercent - actualPercent) : 0;
  const behindLabel = behind > 0 ? `${behind.toFixed(0)}% behind schedule` : null;
  const statusMeta = status ? STATUS_CONFIG[status] : null;

  return (
    <div
      onClick={onClick}
      className={clsx(
        "group flex items-center gap-4 rounded-lg px-4 py-3.5 transition-all",
        onClick && "cursor-pointer",
        isSelected
          ? "bg-emerald-500/10 border border-emerald-500/20"
          : "border border-transparent hover:bg-[#1e293b] hover:border-[#2d3d54]",
        className
      )}
    >
      {/* Name column */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1.5">
          {/* Icon placeholder */}
          <div className="flex h-6 w-6 items-center justify-center rounded bg-[#263347] shrink-0">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-slate-400">
              <path d="M8 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM3 14s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3z" fill="currentColor"/>
            </svg>
          </div>
          <span className={clsx(
            "truncate text-sm font-semibold",
            isSelected ? "text-white" : "text-slate-200 group-hover:text-white"
          )}>
            {name}
          </span>
          {statusMeta && (
            <span className={clsx(
              "hidden sm:flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
              statusMeta.badge
            )}>
              <span className={clsx("h-1.5 w-1.5 rounded-full", statusMeta.dot)} />
              {statusMeta.label}
            </span>
          )}
        </div>

        {/* Dual progress bar */}
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-[#263347]">
          {/* Planned bar (background track) */}
          {plannedPercent != null && (
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[#3a506b]/80"
              style={{ width: `${Math.min(planned, 100)}%` }}
            />
          )}
          {/* Actual bar (foreground) */}
          <div
            className={clsx(
              "absolute inset-y-0 left-0 rounded-full transition-all",
              isSelected ? "bg-emerald-400" : "bg-emerald-500"
            )}
            style={{ width: `${Math.min(actualPercent, 100)}%` }}
          />
        </div>

        {/* Percent labels */}
        <div className="mt-1 flex items-center gap-2 text-[10px]">
          <span className="font-mono font-semibold text-white">{actualPercent.toFixed(0)}%</span>
          {plannedPercent != null && (
            <span className="text-slate-500 font-mono">/ {plannedPercent.toFixed(0)}%</span>
          )}
          {behindLabel && (
            <span className="text-red-400 ml-auto hidden sm:block">{behindLabel}</span>
          )}
        </div>
      </div>

      {/* Stats column */}
      <div className="hidden sm:flex items-center gap-4 shrink-0 text-xs">
        {tasksCompleted != null && tasksTotal != null && (
          <div className="text-center">
            <p className="font-semibold text-white tabular-nums">{tasksCompleted} / {tasksTotal}</p>
            <p className="text-slate-500 text-[10px]">Tasks</p>
          </div>
        )}
        {errorsCount != null && errorsCount > 0 && (
          <div className="flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-1 text-red-400">
            <AlertTriangle size={10} />
            <span className="font-semibold">{errorsCount}</span>
          </div>
        )}
      </div>

      {onClick && (
        <ChevronRight
          size={15}
          className={clsx(
            "shrink-0 transition-colors",
            isSelected ? "text-emerald-400" : "text-slate-600 group-hover:text-slate-400"
          )}
        />
      )}
    </div>
  );
}
