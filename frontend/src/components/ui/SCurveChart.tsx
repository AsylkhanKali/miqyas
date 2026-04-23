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
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Bar,
  ReferenceLine,
} from "recharts";
import { format, parseISO } from "date-fns";
import clsx from "clsx";
import { Activity } from "lucide-react";
import { useTheme } from "@/store/themeContext";

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

function CustomTooltip({ active, payload, label, view, isLight }: any) {
  if (!active || !payload?.length) return null;

  const actual   = payload.find((p: any) => p.dataKey === "actual")?.value;
  const planned  = payload.find((p: any) => p.dataKey === "planned")?.value;
  const variance = payload.find((p: any) => p.dataKey === "variance")?.value;

  let dateStr = label;
  try { dateStr = format(parseISO(label), "MMM d, yyyy"); } catch {}

  return (
    <div
      className="rounded-lg px-3 py-2.5 shadow-xl text-xs"
      style={{
        background:   isLight ? "#FCFBF7" : "#1a2842",
        border:       `1px solid ${isLight ? "#E0DBCC" : "#263347"}`,
        color:        isLight ? "#26241F" : "#cbd5e1",
      }}
    >
      <p className="mb-1.5 font-medium">{dateStr}</p>
      {view === "progress" ? (
        <>
          {actual  != null && (
            <p className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
              Actual
              <span className="ml-auto font-mono font-bold">{actual.toFixed(1)}%</span>
            </p>
          )}
          {planned != null && (
            <p className="flex items-center gap-2 mt-0.5" style={{ color: isLight ? "#8A8577" : "#94a3b8" }}>
              <span className="h-2 w-2 rounded-full bg-slate-400 shrink-0" />
              Planned
              <span className="ml-auto font-mono">{planned.toFixed(1)}%</span>
            </p>
          )}
          {actual != null && planned != null && (
            <p className={clsx(
              "mt-1.5 border-t pt-1.5 font-mono font-medium",
              actual >= planned ? "text-emerald-500" : "text-red-500",
            )}
              style={{ borderColor: isLight ? "#E0DBCC" : "#334155" }}
            >
              {actual >= planned ? "+" : ""}{(actual - planned).toFixed(1)}pp
            </p>
          )}
        </>
      ) : (
        variance != null && (
          <p className={clsx("font-mono font-bold", variance >= 0 ? "text-emerald-500" : "text-red-500")}>
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
  const { theme } = useTheme();
  const isLight = theme === "light";

  // Theme-derived chart tokens
  const gridStroke   = isLight ? "#E0DBCC" : "#263347";
  const tickColor    = isLight ? "#8A8577" : "#64748b";
  const activeDotStroke = isLight ? "#FCFBF7" : "#1a2842";

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
          "flex flex-col items-center justify-center rounded-lg border border-dashed",
          className,
        )}
        style={{
          height,
          background: isLight ? "rgba(248,246,239,0.5)" : "rgba(26,40,66,0.40)",
          borderColor: isLight ? "#E0DBCC" : "#2d3d54",
          color: tickColor,
        }}
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
        <div
          className="flex rounded-lg p-0.5 gap-0.5"
          style={{
            border:     `1px solid ${isLight ? "#E0DBCC" : "#2d3d54"}`,
            background: isLight ? "#F4F3EF" : "#1e293b",
          }}
        >
          {(["progress", "variance"] as ChartView[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className="rounded-md px-3 py-1 text-xs font-medium capitalize transition-all"
              style={
                view === v
                  ? {
                      background: isLight ? "#FCFBF7" : "#263347",
                      color:      isLight ? "#26241F"  : "#f1f5f9",
                      boxShadow:  "0 1px 3px rgba(0,0,0,0.08)",
                    }
                  : { color: tickColor }
              }
            >
              {v}
            </button>
          ))}
        </div>

        {showLegend && view === "progress" && (
          <div className="flex items-center gap-4 text-xs" style={{ color: tickColor }}>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-5 rounded bg-emerald-500" />
              Actual
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-5 rounded" style={{ background: isLight ? "#CFC7B2" : "#475569" }} />
              Planned
            </span>
          </div>
        )}
        {showLegend && view === "variance" && (
          <div className="flex items-center gap-4 text-xs" style={{ color: tickColor }}>
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
        <ComposedChart data={enriched} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#10b981" stopOpacity={isLight ? 0.18 : 0.25} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="plannedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={isLight ? "#8A8577" : "#64748b"} stopOpacity={isLight ? 0.12 : 0.20} />
              <stop offset="95%" stopColor={isLight ? "#8A8577" : "#64748b"} stopOpacity={0.01} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={tickFormatter}
            tick={{ fill: tickColor, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={(v) => `${v}%`}
            tick={{ fill: tickColor, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            domain={view === "variance" ? ["auto", "auto"] : [0, 100]}
            width={42}
          />
          <Tooltip
            content={<CustomTooltip view={view} isLight={isLight} />}
            cursor={{ stroke: isLight ? "#CFC7B2" : "#3a506b", strokeWidth: 1 }}
          />

          {/* Today marker */}
          {enriched.some((d) => d.date <= todayStr) && (
            <ReferenceLine
              x={todayStr}
              stroke={isLight ? "#C2A23A" : "#475569"}
              strokeDasharray="4 3"
              strokeWidth={1.5}
              label={{ value: "Today", fill: tickColor, fontSize: 10, position: "insideTopRight" }}
            />
          )}

          {view === "progress" ? (
            <>
              <Area
                type="monotone"
                dataKey="planned"
                stroke={isLight ? "#CFC7B2" : "#64748b"}
                strokeWidth={1.5}
                strokeDasharray="5 3"
                fill="url(#plannedGrad)"
                dot={false}
                activeDot={false}
              />
              <Area
                type="monotone"
                dataKey="actual"
                stroke="#10b981"
                strokeWidth={2.5}
                fill="url(#actualGrad)"
                dot={{ fill: "#10b981", r: 3, strokeWidth: 0 }}
                activeDot={{ fill: "#10b981", r: 5, strokeWidth: 2, stroke: activeDotStroke }}
              />
            </>
          ) : (
            <Bar
              dataKey="variance"
              radius={[2, 2, 0, 0]}
              maxBarSize={32}
              isAnimationActive
              // Color bars by sign
              fill="#10b981"
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
