/**
 * WeekSelector — ← Week N (DD MMM – DD MMM) →
 *
 * Controlled component. Parent manages weekOffset (0 = current week).
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { addWeeks, startOfWeek, endOfWeek, format } from "date-fns";
import clsx from "clsx";

interface WeekSelectorProps {
  /** 0 = current ISO week. Negative = past, positive = future. */
  weekOffset: number;
  onChange: (offset: number) => void;
  /** Reference date (defaults to today) */
  referenceDate?: Date;
  className?: string;
  /** Disable going forward past today */
  disableFuture?: boolean;
}

export default function WeekSelector({
  weekOffset,
  onChange,
  referenceDate,
  className,
  disableFuture = false,
}: WeekSelectorProps) {
  const ref = referenceDate ?? new Date();
  const weekStart = startOfWeek(addWeeks(ref, weekOffset), { weekStartsOn: 1 });
  const weekEnd   = endOfWeek(addWeeks(ref, weekOffset), { weekStartsOn: 1 });

  // Compute ISO week number
  const startOfYear  = new Date(weekStart.getFullYear(), 0, 1);
  const daysFromStart = Math.floor((weekStart.getTime() - startOfYear.getTime()) / 86_400_000);
  const weekNumber   = Math.ceil((daysFromStart + startOfYear.getDay() + 1) / 7);

  const dateRange = `${format(weekStart, "d MMM")} – ${format(weekEnd, "d MMM")}`;
  const isCurrentWeek = weekOffset === 0;
  const isFutureWeek  = weekOffset > 0;

  return (
    <div className={clsx("flex items-center gap-1", className)}>
      <button
        onClick={() => onChange(weekOffset - 1)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-[#1e293b] hover:text-white transition-colors"
      >
        <ChevronLeft size={16} />
      </button>

      <div className="flex items-center gap-2 rounded-lg border border-[#2d3d54] bg-[#1e293b] px-3 py-1.5">
        {/* Calendar icon */}
        <svg
          className="text-slate-500 shrink-0"
          width="13" height="13" viewBox="0 0 16 16" fill="none"
        >
          <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M2 7h12" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>

        <span className="text-xs font-semibold text-white whitespace-nowrap">
          Week {weekNumber}
        </span>
        <span className="text-xs text-slate-400 whitespace-nowrap">
          ({dateRange})
        </span>
        {isCurrentWeek && (
          <span className="rounded-full bg-mq-600/20 px-1.5 py-0.5 text-[9px] font-medium text-mq-400">
            Current
          </span>
        )}
      </div>

      <button
        onClick={() => onChange(weekOffset + 1)}
        disabled={disableFuture && isFutureWeek}
        className={clsx(
          "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
          disableFuture && isFutureWeek
            ? "text-slate-700 cursor-not-allowed"
            : "text-slate-400 hover:bg-[#1e293b] hover:text-white"
        )}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
