/**
 * ProgressCard — Buildots-style large KPI card.
 *
 * Shows: "XX% Actual / YY% Planned" with trend indicator,
 * date range, and optional capture-frame thumbnail.
 */

import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import clsx from "clsx";

interface ProgressCardProps {
  /** Left metric label (e.g. "Actual") */
  leftLabel: string;
  /** Left metric value (e.g. 72) — number shown as XX% */
  leftValue: number | null;

  /** Right metric label (e.g. "Planned") */
  rightLabel?: string;
  /** Right metric value — if undefined, shows only leftValue */
  rightValue?: number | null;

  /** Trend line: "+2% on last 2 captures" */
  trendText?: string;
  /** Positive = green, negative = red, neutral = gray */
  trendDirection?: "positive" | "negative" | "neutral";

  /** Date range subtitle: "01 Jun - 07 Jun (7 days)" */
  dateRange?: string;

  /** Optional icon element shown at top-left */
  icon?: React.ReactNode;

  /** Optional link for arrow at bottom-right */
  linkTo?: string;

  /** Additional class names */
  className?: string;

  /** Sub-label under the main value (e.g. "High-Priority") */
  subLabel?: string;

  /** Colour accent: "green" | "red" | "blue" | "amber" */
  accent?: "green" | "red" | "blue" | "amber" | "neutral";

  /**
   * When true, leftValue is displayed as a raw number (no % sign).
   * Use for count-based metrics like "Elements at Risk".
   */
  noPercent?: boolean;
}

const ACCENT_COLORS: Record<string, { ring: string; value: string; icon: string }> = {
  green:   { ring: "border-emerald-500/20 bg-emerald-500/5",  value: "text-emerald-400", icon: "bg-emerald-500/15 text-emerald-400" },
  red:     { ring: "border-red-500/20 bg-red-500/5",          value: "text-red-400",     icon: "bg-red-500/15 text-red-400" },
  blue:    { ring: "border-mq-600/20 bg-mq-600/5",            value: "text-mq-400",      icon: "bg-mq-600/15 text-mq-400" },
  amber:   { ring: "border-amber-500/20 bg-amber-500/5",      value: "text-amber-400",   icon: "bg-amber-500/15 text-amber-400" },
  // neutral uses CSS vars so it adapts to both themes without overrides
  neutral: { ring: "border-slate-700",                        value: "text-slate-100",   icon: "bg-slate-700/60 text-slate-300" },
};

export default function ProgressCard({
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  trendText,
  trendDirection = "neutral",
  dateRange,
  icon,
  linkTo,
  className,
  subLabel,
  accent = "neutral",
  noPercent = false,
}: ProgressCardProps) {
  const colors = ACCENT_COLORS[accent];

  const trendColor =
    trendDirection === "positive" ? "text-emerald-400" :
    trendDirection === "negative" ? "text-red-400" :
    "text-slate-500";

  const content = (
    <div
      className={clsx(
        "card flex flex-col justify-between p-5 transition-all",
        colors.ring,
        linkTo && "cursor-pointer hover:border-opacity-40",
        className
      )}
    >
      {/* Top row: icon + optional arrow */}
      <div className="flex items-start justify-between mb-3">
        {icon ? (
          <div className={clsx("flex h-9 w-9 items-center justify-center rounded-lg", colors.icon)}>
            {icon}
          </div>
        ) : <div />}
        {linkTo && <ArrowRight size={15} className="text-slate-600 shrink-0" />}
      </div>

      {/* Main value display */}
      <div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={clsx("text-4xl font-bold font-display leading-none", colors.value)}>
            {leftValue != null
              ? noPercent
                ? leftValue.toLocaleString()
                : `${leftValue.toFixed(0)}%`
              : "—"}
          </span>
          {rightValue != null && rightLabel && (
            <>
              <span className="text-xl font-light text-slate-600">/</span>
              <span className="text-2xl font-semibold font-display text-slate-400 leading-none">
                {rightValue.toFixed(0)}%
              </span>
            </>
          )}
        </div>

        {/* Labels below values */}
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className="text-slate-400 font-medium">{leftLabel}</span>
          {rightLabel && rightValue != null && (
            <>
              <span className="text-slate-700">/</span>
              <span className="text-slate-500">{rightLabel}</span>
            </>
          )}
        </div>

        {subLabel && (
          <p className="mt-0.5 text-[10px] text-slate-500 uppercase tracking-wide">{subLabel}</p>
        )}
      </div>

      {/* Trend + date range */}
      <div className="mt-3 space-y-0.5">
        {trendText && (
          <p className={clsx("text-xs font-medium", trendColor)}>
            {trendText}
          </p>
        )}
        {dateRange && (
          <p className="text-[10px] text-slate-600">{dateRange}</p>
        )}
      </div>
    </div>
  );

  if (linkTo) {
    return <Link to={linkTo}>{content}</Link>;
  }
  return content;
}
