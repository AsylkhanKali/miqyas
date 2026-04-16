/**
 * GanttBar — Buildots-style horizontal Gantt activity bar.
 *
 * Renders a coloured bar spanning from startCol to endCol (0-based week columns).
 * A crosshair (⊕) icon marks the current progress point.
 * Right side shows status label: "Done", "X days to go", "X weeks overdue".
 */

import { Crosshair, Check, Clock, AlertTriangle } from "lucide-react";
import clsx from "clsx";

export type GanttStatus = "complete" | "on_track" | "overdue" | "not_started" | "in_progress";

interface GanttBarProps {
  /** Activity name */
  name: string;
  /** Progress 0-100 */
  progressPercent: number;
  /** Status */
  status: GanttStatus;
  /** How many days/weeks ahead or behind */
  daysOverdue?: number;
  daysRemaining?: number;
  /** Total width of the bar in % (relative to parent container) */
  barWidthPercent?: number;
  /** Left offset of the bar in % */
  barLeftPercent?: number;
  /** Click handler */
  onClick?: () => void;
  className?: string;
}

const STATUS_COLORS: Record<GanttStatus, { bar: string; track: string; text: string }> = {
  complete:    { bar: "bg-[#3a506b]",                  track: "bg-[#263347]",    text: "text-slate-400" },
  on_track:    { bar: "bg-emerald-500/80",             track: "bg-emerald-900/30",text: "text-emerald-400" },
  in_progress: { bar: "bg-emerald-500/60",             track: "bg-emerald-900/20",text: "text-emerald-400" },
  overdue:     { bar: "bg-red-500/30 border border-red-500/30", track: "bg-red-900/20", text: "text-red-400" },
  not_started: { bar: "bg-[#263347]",                  track: "bg-[#1e293b]",    text: "text-slate-500" },
};

function StatusLabel({ status, daysOverdue, daysRemaining }: Pick<GanttBarProps, "status" | "daysOverdue" | "daysRemaining">) {
  if (status === "complete") {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-slate-400">
        <Check size={12} className="text-emerald-400" /> Done
      </span>
    );
  }
  if (status === "overdue" && daysOverdue != null) {
    const weeks = Math.ceil(daysOverdue / 7);
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-red-400">
        <AlertTriangle size={12} />
        {weeks >= 1 ? `${weeks} week${weeks !== 1 ? "s" : ""} overdue` : `${daysOverdue}d overdue`}
      </span>
    );
  }
  if (daysRemaining != null && daysRemaining > 0) {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-slate-400">
        <Clock size={12} />
        {daysRemaining} day{daysRemaining !== 1 ? "s" : ""} to go
      </span>
    );
  }
  if (status === "not_started") {
    return <span className="text-xs text-slate-600">Not started</span>;
  }
  return (
    <span className="text-xs text-slate-500">
      {status === "in_progress" ? "In progress" : "Planned"}
    </span>
  );
}

export default function GanttBar({
  name,
  progressPercent,
  status,
  daysOverdue,
  daysRemaining,
  barWidthPercent = 100,
  barLeftPercent = 0,
  onClick,
  className,
}: GanttBarProps) {
  const colors = STATUS_COLORS[status];
  const clampedProgress = Math.min(100, Math.max(0, progressPercent));

  return (
    <div
      onClick={onClick}
      className={clsx(
        "group grid items-center gap-4 py-2.5",
        onClick && "cursor-pointer hover:bg-[#1e293b] rounded-lg px-2 -mx-2 transition-colors",
        className
      )}
      style={{ gridTemplateColumns: "1fr 3fr auto" }}
    >
      {/* Activity name */}
      <span className="truncate text-xs font-medium text-slate-300 group-hover:text-white transition-colors pr-2">
        {name}
      </span>

      {/* Bar container */}
      <div className="relative h-5 w-full">
        {/* Track / background */}
        <div
          className={clsx("absolute top-1/2 -translate-y-1/2 h-4 rounded-md", colors.track)}
          style={{
            left: `${barLeftPercent}%`,
            width: `${barWidthPercent}%`,
          }}
        />

        {/* Filled portion (actual progress) */}
        {clampedProgress > 0 && (
          <div
            className={clsx(
              "absolute top-1/2 -translate-y-1/2 h-4 rounded-md transition-all",
              colors.bar
            )}
            style={{
              left: `${barLeftPercent}%`,
              width: `${barWidthPercent * clampedProgress / 100}%`,
            }}
          />
        )}

        {/* Progress crosshair marker */}
        {status !== "complete" && status !== "not_started" && (
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
            style={{
              left: `${barLeftPercent + barWidthPercent * clampedProgress / 100}%`,
            }}
          >
            <Crosshair
              size={14}
              className={clsx(
                status === "overdue" ? "text-red-400" : "text-emerald-400",
                "drop-shadow-sm"
              )}
            />
          </div>
        )}

        {/* Complete checkmark at end */}
        {status === "complete" && (
          <div
            className="absolute top-1/2 -translate-y-1/2 translate-x-2"
            style={{ left: `${barLeftPercent + barWidthPercent}%` }}
          >
            <Check size={12} className="text-emerald-400" />
          </div>
        )}
      </div>

      {/* Status label */}
      <div className="shrink-0 min-w-[100px] text-right">
        <StatusLabel status={status} daysOverdue={daysOverdue} daysRemaining={daysRemaining} />
      </div>
    </div>
  );
}
