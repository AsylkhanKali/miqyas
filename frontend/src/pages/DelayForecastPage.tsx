/**
 * DelayForecastPage — per-activity delay risk with pace analysis.
 *
 * Shows every at-risk activity with a progress ring, risk badge, and
 * estimated delay. Clicking an activity opens a drawer with:
 *  - Pace Analysis table (Average / Recent / Required / Planned pace)
 *  - Activity Over Time chart (Actual / Planned / Forecast lines)
 *  - Per-Week production bar chart
 *  - Custom Pace slider that recomputes the forecast live
 */

import { useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import {
  AlertTriangle,
  Clock,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  X,
  Info,
  Sliders,
  Calendar,
  Activity,
  ArrowRight,
  FlaskConical,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import clsx from "clsx";
import { useSettingsStore } from "@/store/settingsStore";

// ── Types ──────────────────────────────────────────────────────────────────

type RiskLevel = "on-track" | "at-risk" | "delayed";

interface WeeklyProduction {
  week: string;  // "W14", "W15" …
  actual: number;
  planned: number;
}

interface ActivityForecast {
  id: string;
  name: string;
  trade: string;
  contractor: string;
  level: string;
  done: number;
  total: number;
  risk: RiskLevel;
  scheduledEnd: string;       // "May 12"
  estimatedEnd: string;       // "Jun 3"
  delayWeeks: number;         // positive = late, 0 = on-track
  avgPace: number;            // pcs / week
  recentPace: number;
  requiredPace: number;
  plannedPace: number;
  weeklyData: WeeklyProduction[];
}

// ── Fake data ──────────────────────────────────────────────────────────────

function genWeekly(
  weeks: number,
  planned: number,
  actualMult: number,
): WeeklyProduction[] {
  return Array.from({ length: weeks }, (_, i) => ({
    week: `W${14 + i}`,
    actual: Math.round(planned * actualMult * (0.8 + Math.random() * 0.4)),
    planned,
  }));
}

const FAKE_ACTIVITIES: ActivityForecast[] = [
  {
    id: "a1",
    name: "Block B — Internal Partitions L3",
    trade: "Drylining",
    contractor: "Al Maskan Interiors",
    level: "Level 3",
    done: 62, total: 302,
    risk: "delayed",
    scheduledEnd: "Apr 30",
    estimatedEnd: "Jun 18",
    delayWeeks: 7,
    avgPace: 12, recentPace: 8, requiredPace: 31, plannedPace: 18,
    weeklyData: genWeekly(8, 18, 0.65),
  },
  {
    id: "a2",
    name: "AHU Commissioning — Zone 4 & 5",
    trade: "MEP",
    contractor: "Gulf Mech & Elec",
    level: "Roof",
    done: 71, total: 100,
    risk: "delayed",
    scheduledEnd: "Apr 18",
    estimatedEnd: "May 30",
    delayWeeks: 6,
    avgPace: 9, recentPace: 7, requiredPace: 29, plannedPace: 14,
    weeklyData: genWeekly(8, 14, 0.6),
  },
  {
    id: "a3",
    name: "Level 4 Slab Reinforcement",
    trade: "Structural",
    contractor: "Al Benna Contracting",
    level: "Level 4",
    done: 61, total: 200,
    risk: "at-risk",
    scheduledEnd: "May 5",
    estimatedEnd: "May 26",
    delayWeeks: 3,
    avgPace: 14, recentPace: 12, requiredPace: 22, plannedPace: 18,
    weeklyData: genWeekly(8, 18, 0.75),
  },
  {
    id: "a4",
    name: "Electrical Rough-in Block B (Floors 4–6)",
    trade: "Electrical",
    contractor: "Nour Electric",
    level: "Levels 4–6",
    done: 48, total: 160,
    risk: "at-risk",
    scheduledEnd: "May 14",
    estimatedEnd: "Jun 4",
    delayWeeks: 3,
    avgPace: 10, recentPace: 9, requiredPace: 16, plannedPace: 13,
    weeklyData: genWeekly(8, 13, 0.78),
  },
  {
    id: "a5",
    name: "Waterproofing — Podium Roof",
    trade: "Waterproofing",
    contractor: "Delta Seal LLC",
    level: "Podium",
    done: 78, total: 120,
    risk: "at-risk",
    scheduledEnd: "May 1",
    estimatedEnd: "May 15",
    delayWeeks: 2,
    avgPace: 9, recentPace: 11, requiredPace: 14, plannedPace: 12,
    weeklyData: genWeekly(8, 12, 0.82),
  },
  {
    id: "a6",
    name: "Ground Floor Slab — KIZAD Z4",
    trade: "Structural",
    contractor: "Al Benna Contracting",
    level: "Ground",
    done: 91, total: 420,
    risk: "on-track",
    scheduledEnd: "Apr 22",
    estimatedEnd: "Apr 22",
    delayWeeks: 0,
    avgPace: 38, recentPace: 42, requiredPace: 35, plannedPace: 36,
    weeklyData: genWeekly(8, 36, 1.08),
  },
  {
    id: "a7",
    name: "MEP Rough-in Floors 1–20",
    trade: "MEP",
    contractor: "Gulf Mech & Elec",
    level: "Levels 1–20",
    done: 44, total: 380,
    risk: "on-track",
    scheduledEnd: "Apr 30",
    estimatedEnd: "Apr 28",
    delayWeeks: -1,
    avgPace: 28, recentPace: 31, requiredPace: 26, plannedPace: 27,
    weeklyData: genWeekly(8, 27, 1.05),
  },
];

const TRADES = ["All Trades", "Structural", "MEP", "Drylining", "Electrical", "Waterproofing"];
const STATUSES: { key: RiskLevel | "all"; label: string }[] = [
  { key: "all",      label: "All" },
  { key: "delayed",  label: "Delayed" },
  { key: "at-risk",  label: "At Risk" },
  { key: "on-track", label: "On Track" },
];

// ── Risk config ────────────────────────────────────────────────────────────

const RISK = {
  delayed: {
    label: "Passed Due Date",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
    ring: "#ef4444",
    dot: "bg-red-500",
    icon: AlertTriangle,
  },
  "at-risk": {
    label: "Risk of Delay",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
    ring: "#f59e0b",
    dot: "bg-amber-500",
    icon: Clock,
  },
  "on-track": {
    label: "On Track",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/20",
    ring: "#10b981",
    dot: "bg-emerald-500",
    icon: CheckCircle2,
  },
};

// ── Progress ring ──────────────────────────────────────────────────────────

function ProgressRing({
  done, total, risk, size = 64,
}: { done: number; total: number; risk: RiskLevel; size?: number }) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e293b" strokeWidth={5} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={RISK[risk].ring} strokeWidth={5}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
      />
    </svg>
  );
}

// ── Pace row ───────────────────────────────────────────────────────────────

function PaceRow({
  label, value, unit = "pcs/wk", highlight,
}: { label: string; value: number; unit?: string; highlight?: "green" | "red" | "amber" }) {
  const color = highlight === "green" ? "text-emerald-400"
    : highlight === "red" ? "text-red-400"
    : highlight === "amber" ? "text-amber-400"
    : "text-white";
  return (
    <div className="flex items-center justify-between py-2 border-b border-[#1e293b] last:border-0">
      <span className="text-[11px] text-slate-400">{label}</span>
      <span className={clsx("text-sm font-bold font-mono", color)}>
        {value} <span className="text-[10px] font-normal text-slate-500">{unit}</span>
      </span>
    </div>
  );
}

// ── Drawer ─────────────────────────────────────────────────────────────────

function PaceDrawer({
  activity, onClose,
}: { activity: ActivityForecast; onClose: () => void }) {
  const [customPace, setCustomPace] = useState(activity.requiredPace);
  const r = RISK[activity.risk];
  const pct = Math.round((activity.done / activity.total) * 100);

  // Build "Activity Over Time" data: cumulative actual + planned + forecast
  const overtimeData = useMemo(() => {
    let cumActual = 0;
    let cumPlanned = 0;
    return activity.weeklyData.map((w, i) => {
      cumActual  += w.actual;
      cumPlanned += w.planned;
      return { week: w.week, actual: cumActual, planned: cumPlanned };
    }).concat(
      // 4 forecast weeks at custom pace
      Array.from({ length: 4 }, (_, i) => {
        const base = activity.weeklyData.reduce((s, w) => s + w.actual, 0);
        const baseP = activity.weeklyData.reduce((s, w) => s + w.planned, 0);
        return {
          week: `W${14 + activity.weeklyData.length + i}`,
          actual: undefined as number | undefined,
          planned: baseP + (i + 1) * activity.plannedPace,
          forecast: base + (i + 1) * customPace,
        };
      })
    );
  }, [activity, customPace]);

  // Estimated delay weeks at custom pace
  const remaining = activity.total - activity.done;
  const weeksToFinish = customPace > 0 ? Math.ceil(remaining / customPace) : 99;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-[#0f1929] border-l border-[#2d3d54] shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-[#2d3d54]">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={clsx(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold",
              r.bg, r.color
            )}>
              <r.icon size={10} />
              {r.label}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">{activity.level}</span>
          </div>
          <h2 className="text-sm font-semibold text-white leading-snug">{activity.name}</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">{activity.trade} · {activity.contractor}</p>
        </div>
        <button onClick={onClose} className="shrink-0 p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-5 space-y-6">

          {/* Done / Total + schedule */}
          <div className="flex items-center gap-6">
            <div className="relative">
              <ProgressRing done={activity.done} total={activity.total} risk={activity.risk} size={72} />
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white" style={{ transform: "rotate(90deg)" }}>
                {pct}%
              </span>
            </div>
            <div className="space-y-1">
              <p className="text-2xl font-bold font-mono text-white">
                {activity.done} <span className="text-sm font-normal text-slate-400">/ {activity.total} pcs</span>
              </p>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <Calendar size={11} />
                Due: <span className="text-slate-300 font-medium">{activity.scheduledEnd}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                {activity.delayWeeks > 0 ? (
                  <>
                    <TrendingDown size={11} className="text-red-400" />
                    <span className="text-red-400 font-semibold">{activity.delayWeeks} weeks delay</span>
                    <span className="text-slate-500">· est. {activity.estimatedEnd}</span>
                  </>
                ) : activity.delayWeeks < 0 ? (
                  <>
                    <TrendingUp size={11} className="text-emerald-400" />
                    <span className="text-emerald-400 font-semibold">{Math.abs(activity.delayWeeks)}w ahead</span>
                  </>
                ) : (
                  <span className="text-emerald-400 font-semibold">On schedule</span>
                )}
              </div>
            </div>
          </div>

          {/* Pace Analysis */}
          <div className="rounded-xl border border-[#2d3d54] bg-[#16213a] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity size={13} className="text-mq-400" />
              <h3 className="text-xs font-semibold text-white">Pace Analysis</h3>
              <span className="ml-auto flex items-center gap-1 text-[10px] text-slate-600">
                <Info size={10} /> pcs / week
              </span>
            </div>
            <PaceRow label="Average Pace (all time)" value={activity.avgPace} />
            <PaceRow
              label="Recent Pace (last 4 weeks)"
              value={activity.recentPace}
              highlight={activity.recentPace >= activity.avgPace ? "green" : "red"}
            />
            <PaceRow
              label="Required Pace (to hit due date)"
              value={activity.requiredPace}
              highlight={activity.recentPace >= activity.requiredPace ? "green" : "red"}
            />
            <PaceRow label="Planned Pace" value={activity.plannedPace} />
          </div>

          {/* Activity Over Time chart */}
          <div>
            <h3 className="text-xs font-semibold text-white mb-3 flex items-center gap-2">
              <ArrowRight size={12} className="text-slate-500" />
              Activity Over Time
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={overtimeData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 10, fill: "#64748b" }} width={32} />
                <Tooltip
                  contentStyle={{ background: "#1a2842", border: "1px solid #263347", borderRadius: 8, fontSize: 11 }}
                />
                <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8" }} />
                <ReferenceLine x={`W${13 + activity.weeklyData.length}`} stroke="#475569" strokeDasharray="4 2" label={{ value: "Today", fill: "#64748b", fontSize: 10 }} />
                <Line type="monotone" dataKey="planned" stroke="#3b82f6" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="Planned" />
                <Line type="monotone" dataKey="actual" stroke="#10b981" strokeWidth={2} dot={false} name="Actual" connectNulls={false} />
                <Line type="monotone" dataKey="forecast" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="6 3" name={`Forecast (${customPace} pcs/wk)`} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Per-Week production bar chart */}
          <div>
            <h3 className="text-xs font-semibold text-white mb-3 flex items-center gap-2">
              <ArrowRight size={12} className="text-slate-500" />
              Weekly Production
            </h3>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={activity.weeklyData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 10, fill: "#64748b" }} width={32} />
                <Tooltip
                  contentStyle={{ background: "#1a2842", border: "1px solid #263347", borderRadius: 8, fontSize: 11 }}
                />
                <ReferenceLine y={customPace} stroke="#f59e0b" strokeDasharray="4 2" label={{ value: "Custom", fill: "#f59e0b", fontSize: 10, position: "right" }} />
                <ReferenceLine y={activity.requiredPace} stroke="#ef4444" strokeDasharray="4 2" label={{ value: "Required", fill: "#ef4444", fontSize: 10, position: "right" }} />
                <Bar dataKey="planned" fill="#1e3a5f" name="Planned" radius={[2, 2, 0, 0]} />
                <Bar dataKey="actual" fill="#10b981" name="Actual" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Custom Pace slider */}
          <div className="rounded-xl border border-[#2d3d54] bg-[#16213a] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Sliders size={13} className="text-amber-400" />
              <h3 className="text-xs font-semibold text-white">Custom Pace Simulator</h3>
            </div>
            <div className="flex items-center gap-3 mb-3">
              <input
                type="range"
                min={1}
                max={Math.max(activity.requiredPace * 2, 50)}
                value={customPace}
                onChange={(e) => setCustomPace(Number(e.target.value))}
                className="flex-1 accent-amber-400"
              />
              <span className="w-20 text-right font-mono font-bold text-white text-sm">{customPace} pcs/wk</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="rounded-lg bg-[#0f1929] p-3">
                <p className="text-[10px] text-slate-500 mb-1">Weeks to finish</p>
                <p className="text-xl font-bold font-mono text-white">{weeksToFinish}</p>
              </div>
              <div className="rounded-lg bg-[#0f1929] p-3">
                <p className="text-[10px] text-slate-500 mb-1">Delay vs due date</p>
                <p className={clsx("text-xl font-bold font-mono", weeksToFinish <= activity.delayWeeks + 6 ? "text-emerald-400" : "text-red-400")}>
                  {weeksToFinish <= 6 ? "0w" : `${weeksToFinish - 6}w`}
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Activity card ──────────────────────────────────────────────────────────

function ActivityCard({
  activity, onClick,
}: { activity: ActivityForecast; onClick: () => void }) {
  const r = RISK[activity.risk];
  const pct = Math.round((activity.done / activity.total) * 100);

  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-4 rounded-xl border border-[#2d3d54] bg-[#16213a] px-5 py-4 hover:bg-[#1a2740] hover:border-[#3d5475] transition-all"
    >
      {/* Ring */}
      <div className="relative shrink-0">
        <ProgressRing done={activity.done} total={activity.total} risk={activity.risk} size={56} />
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white" style={{ transform: "rotate(90deg)" }}>
          {pct}%
        </span>
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={clsx(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold shrink-0",
            r.bg, r.color
          )}>
            <r.icon size={9} />
            {r.label}
          </span>
          <span className="text-[10px] text-slate-500 truncate">{activity.level} · {activity.trade}</span>
        </div>
        <p className="text-[13px] font-medium text-white truncate leading-snug">{activity.name}</p>
        <p className="text-[10px] text-slate-500 mt-0.5 truncate">{activity.contractor}</p>
      </div>

      {/* Metrics */}
      <div className="shrink-0 text-right space-y-1">
        <p className="text-[10px] text-slate-500">
          <span className="font-mono font-semibold text-white">{activity.done}</span> / {activity.total} pcs
        </p>
        {activity.delayWeeks > 0 ? (
          <p className="flex items-center gap-1 justify-end text-[11px] font-semibold text-red-400">
            <TrendingDown size={11} />
            {activity.delayWeeks}w delay
          </p>
        ) : activity.delayWeeks < 0 ? (
          <p className="flex items-center gap-1 justify-end text-[11px] font-semibold text-emerald-400">
            <TrendingUp size={11} />
            {Math.abs(activity.delayWeeks)}w ahead
          </p>
        ) : (
          <p className="text-[11px] font-semibold text-emerald-400">On track</p>
        )}
        <p className="text-[10px] text-slate-600">Est. {activity.estimatedEnd}</p>
      </div>

      <ArrowRight size={14} className="shrink-0 text-slate-600" />
    </button>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function DelayForecastPage() {
  const { projectId } = useParams();
  const { useFakeData } = useSettingsStore();
  const [tradeFilter, setTradeFilter] = useState("All Trades");
  const [statusFilter, setStatusFilter] = useState<"all" | RiskLevel>("all");
  const [selected, setSelected] = useState<ActivityForecast | null>(null);

  const activities = useMemo(() => {
    if (!useFakeData) return [];
    return FAKE_ACTIVITIES.filter((a) => {
      if (tradeFilter !== "All Trades" && a.trade !== tradeFilter) return false;
      if (statusFilter !== "all" && a.risk !== statusFilter) return false;
      return true;
    });
  }, [useFakeData, tradeFilter, statusFilter]);

  const counts = useMemo(() => ({
    delayed:  FAKE_ACTIVITIES.filter((a) => a.risk === "delayed").length,
    atRisk:   FAKE_ACTIVITIES.filter((a) => a.risk === "at-risk").length,
    onTrack:  FAKE_ACTIVITIES.filter((a) => a.risk === "on-track").length,
  }), []);

  if (!useFakeData) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="page-title">Delay Forecast</h1>
          <p className="mt-1 text-sm text-slate-400">Pace analysis and risk projection per activity</p>
        </div>
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-[#2d3d54] py-28 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#1e293b]">
            <FlaskConical size={24} className="text-slate-500" />
          </div>
          <div>
            <p className="font-medium text-slate-300">No forecast data yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Run the analysis pipeline to generate pace data,<br />
              or enable <span className="font-medium text-slate-400">Demo mode</span> in Settings.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Delay Forecast</h1>
          <p className="mt-1 text-sm text-slate-400">
            Pace analysis and risk projection · {FAKE_ACTIVITIES.length} activities
          </p>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-4 flex items-center gap-3">
          <AlertTriangle size={20} className="text-red-400 shrink-0" />
          <div>
            <p className="text-2xl font-bold text-red-400">{counts.delayed}</p>
            <p className="text-[11px] text-slate-400">Passed Due Date</p>
          </div>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-5 py-4 flex items-center gap-3">
          <Clock size={20} className="text-amber-400 shrink-0" />
          <div>
            <p className="text-2xl font-bold text-amber-400">{counts.atRisk}</p>
            <p className="text-[11px] text-slate-400">Risk of Delay</p>
          </div>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4 flex items-center gap-3">
          <CheckCircle2 size={20} className="text-emerald-400 shrink-0" />
          <div>
            <p className="text-2xl font-bold text-emerald-400">{counts.onTrack}</p>
            <p className="text-[11px] text-slate-400">On Track</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Status pills */}
        <div className="flex items-center gap-1 rounded-lg border border-[#2d3d54] bg-[#16213a] p-1">
          {STATUSES.map((s) => (
            <button
              key={s.key}
              onClick={() => setStatusFilter(s.key as typeof statusFilter)}
              className={clsx(
                "rounded-md px-3 py-1 text-[11px] font-medium transition-colors capitalize",
                statusFilter === s.key
                  ? "bg-mq-500/20 text-mq-400 border border-mq-500/30"
                  : "text-slate-500 hover:text-slate-300"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Trade select */}
        <select
          value={tradeFilter}
          onChange={(e) => setTradeFilter(e.target.value)}
          className="rounded-lg border border-[#2d3d54] bg-[#16213a] px-3 py-1.5 text-[11px] text-slate-300 outline-none cursor-pointer"
        >
          {TRADES.map((t) => <option key={t}>{t}</option>)}
        </select>

        <span className="text-[11px] text-slate-500 ml-auto">{activities.length} activities</span>
      </div>

      {/* Activity list */}
      <div className="space-y-2">
        {activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[#2d3d54] py-20 text-slate-500">
            <Activity size={24} />
            <p className="text-sm">No activities match the current filters</p>
          </div>
        ) : (
          activities.map((a) => (
            <ActivityCard key={a.id} activity={a} onClick={() => setSelected(a)} />
          ))
        )}
      </div>

      {/* Drawer overlay */}
      {selected && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => setSelected(null)}
          />
          <PaceDrawer activity={selected} onClose={() => setSelected(null)} />
        </>
      )}
    </div>
  );
}
