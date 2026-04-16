/**
 * TaskCard — Buildots-style task item (incomplete / complete).
 *
 * Shows: activity name, level/zone, progress badge (orange = partial, green = done).
 */

import { Check, Camera } from "lucide-react";
import clsx from "clsx";

interface TaskCardProps {
  name: string;
  levelOrZone?: string;
  progressPercent: number;
  isComplete: boolean;
  /** Show camera icon for capture-linked tasks */
  hasCapture?: boolean;
  onClick?: () => void;
  className?: string;
}

export default function TaskCard({
  name,
  levelOrZone,
  progressPercent,
  isComplete,
  hasCapture,
  onClick,
  className,
}: TaskCardProps) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-xs transition-all",
        isComplete
          ? "border-emerald-500/20 bg-emerald-500/5"
          : "border-[#2d3d54] bg-[#1e293b]/60",
        onClick && "cursor-pointer hover:border-slate-600/60",
        className
      )}
    >
      {/* Progress badge or checkmark */}
      {isComplete ? (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-500 shadow-sm shadow-emerald-500/30">
          <Check size={13} className="text-white" strokeWidth={3} />
        </div>
      ) : (
        <div
          className={clsx(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white font-bold text-[11px] shadow-sm",
            progressPercent >= 80
              ? "bg-amber-500 shadow-amber-500/30"
              : progressPercent >= 40
              ? "bg-orange-500 shadow-orange-500/30"
              : "bg-slate-600"
          )}
        >
          {progressPercent.toFixed(0)}%
        </div>
      )}

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className={clsx(
          "truncate font-medium",
          isComplete ? "text-slate-400 line-through decoration-slate-600" : "text-white"
        )}>
          {name}
        </p>
        {levelOrZone && (
          <p className="text-[10px] text-slate-500 mt-0.5 truncate">{levelOrZone}</p>
        )}
      </div>

      {/* Icons */}
      <div className="flex items-center gap-1.5 shrink-0">
        {hasCapture && (
          <span title="Has capture"><Camera size={12} className="text-slate-600" /></span>
        )}
        {/* Clone / link icons (Buildots-style) */}
        <div className="flex gap-1">
          <button
            onClick={(e) => e.stopPropagation()}
            className="flex h-5 w-5 items-center justify-center rounded text-slate-600 hover:text-slate-400 transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" fill="none" strokeWidth="1.5"/>
              <rect x="2" y="2" width="8" height="8" rx="1.5" stroke="currentColor" fill="none" strokeWidth="1.5"/>
            </svg>
          </button>
          <button
            onClick={(e) => e.stopPropagation()}
            className="flex h-5 w-5 items-center justify-center rounded text-slate-600 hover:text-slate-400 transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="8" cy="8" r="2.5" fill="currentColor"/>
              <path d="M8 2v2M8 12v2M2 8h2M12 8h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
