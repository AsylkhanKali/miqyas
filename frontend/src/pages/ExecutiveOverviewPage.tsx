/**
 * ExecutiveOverviewPage — Buildots-style portfolio dashboard.
 *
 * Shows every active project at a glance: RAG status, planned vs actual
 * progress, week-over-week trend, milestone status, PM commentary, and
 * a cross-portfolio activity delay drill-down.
 *
 * Uses realistic fake data until the backend analytics pipeline is wired up.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Calendar,
  BarChart2,
  Activity,
  Building2,
  Flag,
  FlaskConical,
} from "lucide-react";
import clsx from "clsx";
import { useSettingsStore } from "@/store/settingsStore";

// ── Fake data ─────────────────────────────────────────────────────────────

interface Milestone {
  name: string;
  due: string;
  status: "done" | "on-track" | "at-risk" | "delayed";
}

interface DelayedActivity {
  project: string;
  activity: string;
  planned: number;
  actual: number;
  delayDays: number;
  critical: boolean;
}

interface Project {
  id: string;
  name: string;
  code: string;
  location: string;
  pm: string;
  planned: number;       // % overall planned complete
  actual: number;        // % overall actual complete
  lastWeekActual: number;
  status: "on-track" | "at-risk" | "delayed";
  milestones: Milestone[];
  pmComment: string;
  updatedDaysAgo: number;
  budget: string;
  type: string;
}

const PROJECTS: Project[] = [
  {
    id: "p1",
    name: "Reem Hills — Tower B",
    code: "RH-T02",
    location: "Al Reem Island, Abu Dhabi",
    pm: "Khalid Al-Mansoori",
    planned: 68,
    actual: 71,
    lastWeekActual: 67,
    status: "on-track",
    budget: "$42M",
    type: "Mixed-use high-rise",
    milestones: [
      { name: "Structural topping out", due: "Mar 15", status: "done" },
      { name: "MEP rough-in floors 1–20", due: "Apr 30", status: "on-track" },
      { name: "Façade complete", due: "Jul 10", status: "on-track" },
    ],
    pmComment:
      "Concrete works ahead of schedule — gained back 4 days vs last month. MEP procurement on track. No critical blockers this week.",
    updatedDaysAgo: 1,
  },
  {
    id: "p2",
    name: "Aldaar Square",
    code: "ALD-SQ03",
    location: "Khalifa City A, Abu Dhabi",
    pm: "Sara Al-Hameli",
    planned: 54,
    actual: 49,
    lastWeekActual: 48,
    status: "at-risk",
    budget: "$28M",
    type: "Commercial + offices",
    milestones: [
      { name: "Basement slab pour", due: "Feb 28", status: "done" },
      { name: "Level 5 structure", due: "Apr 15", status: "at-risk" },
      { name: "Retail fit-out start", due: "Jun 1", status: "at-risk" },
    ],
    pmComment:
      "Rebar delivery delays pushed Level 4 slab by 6 days. Recovery plan approved — adding a night shift next week. Targeting to close 3% gap by end of month.",
    updatedDaysAgo: 2,
  },
  {
    id: "p3",
    name: "Bloom Living — Phase 2",
    code: "BL-P2-07",
    location: "Zayed City, Abu Dhabi",
    pm: "Mohammed Al-Mazrouei",
    planned: 81,
    actual: 74,
    lastWeekActual: 73,
    status: "delayed",
    budget: "$19M",
    type: "Residential",
    milestones: [
      { name: "Shell & core", due: "Jan 20", status: "delayed" },
      { name: "Internal partitions", due: "Mar 5", status: "delayed" },
      { name: "Handover Block A", due: "May 30", status: "at-risk" },
    ],
    pmComment:
      "Subcontractor dispute on Block B interior works resolved last week. Backlog of ~180 partition walls outstanding. Escalation to client issued on revised handover date.",
    updatedDaysAgo: 3,
  },
  {
    id: "p4",
    name: "KIZAD Logistics Hub — Zone 4",
    code: "KZD-Z4-02",
    location: "KIZAD, Abu Dhabi",
    pm: "Faisal Al-Ketbi",
    planned: 33,
    actual: 35,
    lastWeekActual: 31,
    status: "on-track",
    budget: "$67M",
    type: "Industrial / logistics",
    milestones: [
      { name: "Piling complete", due: "Feb 10", status: "done" },
      { name: "Ground floor slab", due: "Apr 22", status: "on-track" },
      { name: "Steel erection start", due: "Jun 15", status: "on-track" },
    ],
    pmComment:
      "Best week so far — piling finished 8 days early. Ground floor formwork ahead of plan. Weather conditions ideal. No issues to report.",
    updatedDaysAgo: 1,
  },
  {
    id: "p5",
    name: "Aldaar HQ",
    code: "ALD-HQ11",
    location: "Al Maryah Island, Abu Dhabi",
    pm: "Noura Al-Bloushi",
    planned: 91,
    actual: 87,
    lastWeekActual: 85,
    status: "at-risk",
    budget: "$55M",
    type: "Office / headquarters",
    milestones: [
      { name: "M&E commissioning", due: "Mar 28", status: "at-risk" },
      { name: "Snagging complete", due: "Apr 18", status: "at-risk" },
      { name: "Client handover", due: "May 2", status: "at-risk" },
    ],
    pmComment:
      "HVAC commissioning taking longer than expected — 3 AHU units failed first test. Vendor re-testing scheduled for next week. Handover date under review with client.",
    updatedDaysAgo: 0,
  },
];

const DELAYED_ACTIVITIES: DelayedActivity[] = [
  { project: "BL-P2-07",  activity: "Block B internal partitions – Level 3", planned: 100, actual: 62, delayDays: 18, critical: true },
  { project: "ALD-HQ11",  activity: "AHU commissioning – Zone 4 & 5",        planned: 100, actual: 71, delayDays: 12, critical: true },
  { project: "ALD-SQ03",  activity: "Level 4 slab reinforcement",             planned: 85,  actual: 61, delayDays: 8,  critical: true },
  { project: "BL-P2-07",  activity: "Electrical rough-in Block B floors 4–6", planned: 70,  actual: 48, delayDays: 7,  critical: false },
  { project: "ALD-HQ11",  activity: "Snagging walkthrough – Towers A & B",    planned: 60,  actual: 40, delayDays: 6,  critical: false },
  { project: "ALD-SQ03",  activity: "Waterproofing – podium roof",             planned: 100, actual: 78, delayDays: 5,  critical: false },
];

// ── Helpers ───────────────────────────────────────────────────────────────

const STATUS = {
  "on-track": { label: "On Track", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25", bar: "bg-emerald-500", dot: "bg-emerald-400" },
  "at-risk":  { label: "At Risk",  color: "text-amber-400",   bg: "bg-amber-500/10  border-amber-500/25",   bar: "bg-amber-500",   dot: "bg-amber-400" },
  "delayed":  { label: "Delayed",  color: "text-red-400",     bg: "bg-red-500/10    border-red-500/25",     bar: "bg-red-500",     dot: "bg-red-400" },
};

const MILESTONE_STATUS = {
  "done":     { label: "Done",     color: "text-emerald-400", icon: CheckCircle2 },
  "on-track": { label: "On Track", color: "text-slate-400",   icon: Clock },
  "at-risk":  { label: "At Risk",  color: "text-amber-400",   icon: AlertTriangle },
  "delayed":  { label: "Delayed",  color: "text-red-400",     icon: AlertTriangle },
};

function delta(project: Project) {
  return project.actual - project.lastWeekActual;
}

function gap(project: Project) {
  return project.actual - project.planned;
}

// ── Portfolio KPIs ────────────────────────────────────────────────────────

function portfolioStats() {
  const onTrack = PROJECTS.filter(p => p.status === "on-track").length;
  const atRisk  = PROJECTS.filter(p => p.status === "at-risk").length;
  const delayed = PROJECTS.filter(p => p.status === "delayed").length;
  const avgPlanned = Math.round(PROJECTS.reduce((s, p) => s + p.planned, 0) / PROJECTS.length);
  const avgActual  = Math.round(PROJECTS.reduce((s, p) => s + p.actual,  0) / PROJECTS.length);
  return { onTrack, atRisk, delayed, avgPlanned, avgActual };
}

// ── Sub-components ────────────────────────────────────────────────────────

function ProgressBar({ planned, actual, thin = false }: { planned: number; actual: number; thin?: boolean }) {
  const h = thin ? "h-1.5" : "h-2";
  return (
    <div className="relative">
      {/* planned track */}
      <div className={clsx("w-full rounded-full bg-slate-700/60", h)} />
      {/* planned marker */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-slate-400/60 rounded-full"
        style={{ left: `${planned}%` }}
        title={`Planned: ${planned}%`}
      />
      {/* actual fill */}
      <div
        className={clsx("absolute top-0 bottom-0 rounded-full transition-all", h,
          actual >= planned ? "bg-emerald-500" : actual >= planned - 5 ? "bg-amber-500" : "bg-red-500"
        )}
        style={{ width: `${actual}%` }}
      />
    </div>
  );
}

function WeekDelta({ value }: { value: number }) {
  if (value > 0) return (
    <span className="flex items-center gap-0.5 text-[10px] font-semibold text-emerald-400">
      <TrendingUp size={10} /> +{value}%
    </span>
  );
  if (value < 0) return (
    <span className="flex items-center gap-0.5 text-[10px] font-semibold text-red-400">
      <TrendingDown size={10} /> {value}%
    </span>
  );
  return (
    <span className="flex items-center gap-0.5 text-[10px] text-slate-500">
      <Minus size={10} /> 0%
    </span>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const [expanded, setExpanded] = useState(false);
  const st  = STATUS[project.status];
  const g   = gap(project);
  const d   = delta(project);

  return (
    <motion.div
      layout
      className="rounded-xl border border-[#2d3d54] bg-[#16213a] overflow-hidden"
    >
      {/* Status stripe */}
      <div className={clsx("h-1", {
        "bg-emerald-500": project.status === "on-track",
        "bg-amber-500":   project.status === "at-risk",
        "bg-red-500":     project.status === "delayed",
      })} />

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] font-mono font-medium text-slate-500">{project.code}</span>
              <span className="text-[10px] text-slate-600">·</span>
              <span className="text-[10px] text-slate-500">{project.location}</span>
            </div>
            <h3 className="text-sm font-semibold text-white leading-tight">{project.name}</h3>
            <p className="text-[10px] text-slate-500 mt-0.5">{project.type} · {project.budget}</p>
          </div>
          <div className={clsx(
            "shrink-0 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold",
            st.bg, st.color
          )}>
            <span className={clsx("h-1.5 w-1.5 rounded-full shrink-0", st.dot)} />
            {st.label}
          </div>
        </div>

        {/* Progress */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-slate-500">Overall progress</span>
            <div className="flex items-center gap-3">
              <span className="text-slate-500">Plan <span className="font-mono text-slate-300">{project.planned}%</span></span>
              <span className="font-mono font-bold text-white">{project.actual}%</span>
            </div>
          </div>
          <ProgressBar planned={project.planned} actual={project.actual} />
          <div className="flex items-center justify-between">
            <span className={clsx("text-[10px] font-semibold", g >= 0 ? "text-emerald-400" : "text-red-400")}>
              {g >= 0 ? `+${g}pp vs plan` : `${g}pp vs plan`}
            </span>
            <div className="flex items-center gap-1 text-[10px] text-slate-500">
              This week: <WeekDelta value={d} />
            </div>
          </div>
        </div>

        {/* Milestones */}
        <div className="space-y-1.5 mb-4">
          {project.milestones.map((m, i) => {
            const ms = MILESTONE_STATUS[m.status];
            const Icon = ms.icon;
            return (
              <div key={i} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Icon size={11} className={clsx("shrink-0", ms.color)} />
                  <span className="text-[10px] text-slate-400 truncate">{m.name}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-slate-500 font-mono">{m.due}</span>
                  <span className={clsx("text-[10px] font-medium", ms.color)}>{ms.label}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer: PM + expand */}
        <div className="border-t border-[#2d3d54] pt-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex w-full items-center justify-between text-left"
          >
            <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <MessageSquare size={10} />
              <span className="font-medium text-slate-400">{project.pm}</span>
              <span className="text-slate-600">·</span>
              <span>{project.updatedDaysAgo === 0 ? "Today" : project.updatedDaysAgo === 1 ? "Yesterday" : `${project.updatedDaysAgo}d ago`}</span>
            </div>
            {expanded
              ? <ChevronUp size={13} className="text-slate-500" />
              : <ChevronDown size={13} className="text-slate-500" />
            }
          </button>

          {expanded && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="mt-2 text-[11px] leading-relaxed text-slate-400 border-l-2 border-slate-700 pl-3"
            >
              {project.pmComment}
            </motion.p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

export default function ExecutiveOverviewPage() {
  const [filter, setFilter] = useState<"all" | "on-track" | "at-risk" | "delayed">("all");
  const { useFakeData } = useSettingsStore();
  const stats = portfolioStats();

  const filtered = filter === "all" ? PROJECTS : PROJECTS.filter(p => p.status === filter);

  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  if (!useFakeData) {
    return (
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Building2 size={15} className="text-mq-400" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Executive Overview</span>
            </div>
            <h1 className="text-2xl font-bold text-white">Portfolio Dashboard</h1>
            <p className="mt-0.5 text-sm text-slate-400">Week ending {today}</p>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-[#2d3d54] py-28 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#1e293b]">
            <FlaskConical size={24} className="text-slate-500" />
          </div>
          <div>
            <p className="font-medium text-slate-300">No portfolio data yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Run the analysis pipeline across your projects to see real data,<br />
              or enable <span className="font-medium text-slate-400">Demo mode</span> in Settings to preview sample data.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Building2 size={15} className="text-mq-400" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Executive Overview</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Portfolio Dashboard</h1>
          <p className="mt-0.5 text-sm text-slate-400">Week ending {today} · {PROJECTS.length} active projects</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-[#2d3d54] bg-[#1e293b] px-3 py-1.5 text-[10px] text-slate-400">
          <Calendar size={11} />
          Weekly report
        </div>
      </div>

      {/* ── Portfolio KPI strip ─────────────────────────────────────────── */}
      <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {/* Avg progress */}
        <div className="col-span-2 lg:col-span-2 rounded-xl border border-[#2d3d54] bg-[#16213a] p-5">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-3">Portfolio Progress</p>
          <div className="flex items-end gap-4 mb-3">
            <div>
              <p className="text-3xl font-bold font-mono text-white">{stats.avgActual}%</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Actual complete</p>
            </div>
            <div className="pb-1">
              <p className="text-lg font-mono text-slate-400">{stats.avgPlanned}%</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Planned</p>
            </div>
            <div className="pb-1 ml-auto">
              <WeekDelta value={Math.round(
                PROJECTS.reduce((s, p) => s + delta(p), 0) / PROJECTS.length * 10) / 10
              } />
              <p className="text-[10px] text-slate-500 mt-0.5">This week</p>
            </div>
          </div>
          <ProgressBar planned={stats.avgPlanned} actual={stats.avgActual} />
        </div>

        {/* On track */}
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 flex flex-col justify-between">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 mb-3">
            <CheckCircle2 size={16} className="text-emerald-400" />
          </div>
          <div>
            <p className="text-3xl font-bold text-emerald-400">{stats.onTrack}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">On Track</p>
          </div>
        </div>

        {/* At risk */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 flex flex-col justify-between">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 mb-3">
            <AlertTriangle size={16} className="text-amber-400" />
          </div>
          <div>
            <p className="text-3xl font-bold text-amber-400">{stats.atRisk}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">At Risk</p>
          </div>
        </div>

        {/* Delayed */}
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5 flex flex-col justify-between">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/15 mb-3">
            <BarChart2 size={16} className="text-red-400" />
          </div>
          <div>
            <p className="text-3xl font-bold text-red-400">{stats.delayed}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Delayed</p>
          </div>
        </div>
      </div>

      {/* ── Project tiles ───────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">Projects</h2>
          {/* Filter pills */}
          <div className="flex items-center gap-1">
            {(["all", "on-track", "at-risk", "delayed"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={clsx(
                  "rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors capitalize",
                  filter === f
                    ? "bg-mq-500/20 text-mq-400 border border-mq-500/30"
                    : "text-slate-500 hover:text-slate-300"
                )}
              >
                {f === "all" ? `All (${PROJECTS.length})` : f === "on-track" ? `On Track (${stats.onTrack})` : f === "at-risk" ? `At Risk (${stats.atRisk})` : `Delayed (${stats.delayed})`}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      </div>

      {/* ── Activity delay drill-down ───────────────────────────────────── */}
      <div className="rounded-xl border border-[#2d3d54] bg-[#16213a] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2d3d54]">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Activity size={14} className="text-red-400" />
              Top Delayed Activities
            </h2>
            <p className="text-[10px] text-slate-500 mt-0.5">Activities driving portfolio delays this week</p>
          </div>
          <span className="flex items-center gap-1 rounded-full bg-red-500/10 border border-red-500/20 px-2.5 py-1 text-[10px] font-semibold text-red-400">
            <AlertTriangle size={10} />
            {DELAYED_ACTIVITIES.filter(a => a.critical).length} critical
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#2d3d54]">
                {["Project", "Activity", "Planned", "Actual", "Delay", ""].map((h) => (
                  <th key={h} className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 first:pl-5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DELAYED_ACTIVITIES.map((a, i) => (
                <tr key={i} className="border-b border-[#1e293b] hover:bg-slate-800/20 transition-colors last:border-0">
                  <td className="px-5 py-3 text-[11px] font-mono font-semibold text-slate-400">{a.project}</td>
                  <td className="px-5 py-3 text-[11px] text-slate-300 max-w-[220px]">
                    <span className="line-clamp-1">{a.activity}</span>
                  </td>
                  <td className="px-5 py-3 text-[11px] font-mono text-slate-400">{a.planned}%</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-slate-700">
                        <div
                          className="h-1.5 rounded-full bg-red-500"
                          style={{ width: `${(a.actual / a.planned) * 100}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-mono text-slate-300">{a.actual}%</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                      <TrendingDown size={9} />
                      {a.delayDays}d
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {a.critical && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                        <Flag size={9} />
                        Critical path
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      </>
    </div>
  );
}
