/**
 * SCurveChart — Buildots-style Actual vs Planned progress over time.
 *
 * Shows two overlapping areas:
 *  - Planned (gray, area fill) — what was scheduled
 *  - Actual  (green, line + area) — what was observed
 *
 * A vertical ReferenceLine marks "today".
 * Toggle between "Progress" (absolute %) and "Variance" (gap = planned − actual).
 */

import { useState } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Bar,
} from "recharts";
import { format, parseISO } from "date-fns";
import clsx from "clsx";
import { Activity } from "lucide-react";

export interface SCurveDataPoint {
  date: string;         // ISO date string "YYYY-MM-DD"
  actual: number;       // observed %
  planned: number;      // scheduled %
  elements?: number;    // count of elements analyzed
}

interface SCurveChartProps {
  data: SCurveDataPoint[];
  height?: number;
  showLegend?: boolean;
  className?: string;
}

type ChartView = "progress" | "variance";

// ── Custom tooltip ─────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label, view }: any) {
  if (!active || !payload?.length) return null;

  const actual  = payload.find((p: any) => p.dataKey === "actual")?.value;
  const planned = payload.find((p: any) => p.dataKey === "planned")?.value;
  const variance = payload.find((p: any) => p.dataKey === "variance")?.value;

  let dateStr = label;
  try { dateStr = format(parseISO(label), "MMM d, yyyy"); } catch {}

  return (
    <div className="rounded-lg border border-[#2d3d54] bg-[#1a2842] px-3 py-2.5 shadow-xl text-xs">
      <p className="mb-1.5 font-medium text-slate-300">{dateStr}</p>
      {view === "progress" ? (
        <>
          {actual  != null && <p className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400" />Actual <span className="ml-auto font-mono font-bold text-white">{actual.toFixed(1)}%</span></p>}
          {planned != null && <p className="flex items-center gap-2 mt-0.5"><span className="h-2 w-2 rounded-full bg-slate-400" />Planned <span className="ml-auto font-mono text-slate-300">{planned.toFixed(1)}%</span></p>}
          {actual != null && planned != null && (
            <p className={clsx(
              "mt-1.5 border-t border-slate-700 pt-1.5 font-mono font-medium",
              actual >= planned ? "text-emerald-400" : "text-red-400"
            )}>
              {actual >= planned ? "+" : ""}{(actual - planned).toFixed(1)}pp
            </p>
          )}
        </>
      ) : (
        variance != null && (
          <p className={clsx(
            "font-mono font-bold",
            variance >= 0 ? "text-emerald-400" : "text-red-400"
          )}>
            {variance >= 0 ? "+" : ""}{variance.toFixed(1)}pp variance
          </p>
        )
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SCurveChart({
  data,
  height = 240,
  showLegend = true,
  className,
}: SCurveChartProps) {
  const [view, setView] = useState<ChartView>("progress");

  // Enrich data with variance
  const enriched = data.map((d) => ({
    ...d,
    variance: parseFloat((d.actual - d.planned).toFixed(1)),
  }));

  const todayStr = format(new Date(), "yyyy-MM-dd");

  // Empty state
  if (data.length === 0) {
    return (
      <div
        className={clsx(
          "flex flex-col items-center justify-center rounded-lg border border-dashed border-[#2d3d54] bg-[#1a2842]/40 text-slate-500",
          className,
        )}
        style={{ height }}
      >
        <Activity size={28} className="mb-2" />
        <p className="text-xs font-medium">No capture data yet</p>
        <p className="mt-0.5 text-[10px]">Run an analysis to see the S-curve</p>
      </div>
    );
  }

  const tickFormatter = (val: string) => {
    try { return format(parseISO(val), "MMM d"); } catch { return val; }
  };

  return (
    <div className={clsx("space-y-3", className)}>
      {/* View toggle + legend */}
      <div className="flex items-center justify-between">
        <div className="flex rounded-lg border border-[#2d3d54] bg-[#1e293b] p-0.5 gap-0.5">
          {(["progress", "variance"] as ChartView[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={clsx(
                "rounded-md px-3 py-1 text-xs font-medium capitalize transition-all",
                view === v
                  ? "bg-[#263347] text-white shadow-sm"
                  : "text-slate-400 hover:text-white"
              )}
            >
              {v}
            </button>
          ))}
        </div>

        {showLegend && view === "progress" && (
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-5 rounded bg-emerald-500" />
              Actual
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-5 rounded bg-slate-600" />
              Planned
            </span>
          </div>
        )}
        {showLegend && view === "variance" && (
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              Ahead
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
              Behind
            </span>
          </div>
        )}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={enriched}
          margin={{ top: 4, right: 4, left: -16, bottom: 0 }}
        >
          <defs>
            <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="plannedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#64748b" stopOpacity={0.20} />
              <stop offset="95%" stopColor="#64748b" stopOpacity={0.01} />
            </linearGradient>
            <linearGradient id="positiveGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#10b981" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="negativeGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#263347" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={tickFormatter}
            tick={{ fill: "#64748b", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={(v) => `${v}%`}
            tick={{ fill: "#64748b", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            domain={view === "variance" ? ["auto", "auto"] : [0, 100]}
            width={42}
          />
          <Tooltip
            content={<CustomTooltip view={view} />}
            cursor={{ stroke: "#3a506b", strokeWidth: 1 }}
          />

          {/* Today marker */}
          {enriched.some((d) => d.date <= todayStr) && (
            <ReferenceLine
              x={todayStr}
              stroke="#475569"
              strokeDasharray="4 3"
              strokeWidth={1.5}
              label={{ value: "Today", fill: "#64748b", fontSize: 10, position: "insideTopRight" }}
            />
          )}

          {view === "progress" ? (
            <>
              {/* Planned area (background) */}
              <Area
                type="monotone"
                dataKey="planned"
                stroke="#64748b"
                strokeWidth={1.5}
                strokeDasharray="5 3"
                fill="url(#plannedGrad)"
                dot={false}
                activeDot={false}
              />
              {/* Actual area (foreground) */}
              <Area
                type="monotone"
                dataKey="actual"
                stroke="#10b981"
                strokeWidth={2.5}
                fill="url(#actualGrad)"
                dot={{ fill: "#10b981", r: 3, strokeWidth: 0 }}
                activeDot={{ fill: "#10b981", r: 5, strokeWidth: 2, stroke: "#1a2842" }}
              />
            </>
          ) : (
            /* Variance view — bar chart */
            <Bar
              dataKey="variance"
              fill="#10b981"
              radius={[2, 2, 0, 0]}
              maxBarSize={32}
              label={false}
              // Color bars individually based on sign
              isAnimationActive={true}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
