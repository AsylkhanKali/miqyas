/**
 * PlanTrackerPage — Buildots-style weekly plan tracker.
 *
 * Layout:
 *  1. Week selector header + schedule picker
 *  2. Weekly plan headers (completion % per week)
 *  3. Gantt-style activity bars for the selected week's activities
 *  4. Task breakdown: Incomplete vs Completed split
 *  5. Targets table with due dates
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, CalendarCheck, Download, Filter,
  CheckCircle2, Clock, AlertTriangle, ChevronRight, ListTodo,
} from "lucide-react";
import {
  addWeeks, startOfWeek, endOfWeek, isWithinInterval,
  parseISO, format, differenceInDays,
} from "date-fns";
import { schedulesApi, projectsApi } from "@/services/api";
import type { Activity, Schedule, Project } from "@/types";
import WeekSelector from "@/components/ui/WeekSelector";
import GanttBar, { type GanttStatus } from "@/components/ui/GanttBar";
import TaskCard from "@/components/ui/TaskCard";
import { SkeletonTable, SkeletonCard } from "@/components/ui/Skeleton";
import clsx from "clsx";

// ── Helpers ────────────────────────────────────────────────────────────────

function activityToGanttStatus(a: Activity, today: Date): GanttStatus {
  if (a.status === "completed" || a.actual_finish) return "complete";
  if (a.status === "delayed") {
    const finish = a.planned_finish ? parseISO(a.planned_finish) : null;
    if (finish && finish < today) return "overdue";
    return "overdue";
  }
  if (a.status === "in_progress" || a.actual_start) return "in_progress";
  if (a.status === "not_started") return "not_started";
  return "not_started";
}

function daysOverdue(a: Activity, today: Date): number | undefined {
  if (!a.planned_finish) return undefined;
  const finish = parseISO(a.planned_finish);
  const overdue = differenceInDays(today, finish);
  return overdue > 0 ? overdue : undefined;
}

function daysRemaining(a: Activity, today: Date): number | undefined {
  if (!a.planned_finish) return undefined;
  const finish = parseISO(a.planned_finish);
  const remaining = differenceInDays(finish, today);
  return remaining > 0 ? remaining : undefined;
}

// ── Week plan header component ─────────────────────────────────────────────

function WeekPlanHeader({
  label, percent, isActive,
}: { label: string; percent: number; isActive?: boolean }) {
  return (
    <div className={clsx(
      "flex flex-col items-center gap-1.5 px-4 py-2.5 rounded-lg min-w-[100px]",
      isActive ? "bg-slate-800/80 border border-slate-700/60" : "bg-slate-800/30"
    )}>
      <span className="text-xs text-slate-400 font-medium">{label}</span>
      <div className="w-full h-1.5 rounded-full bg-slate-700 overflow-hidden">
        <div
          className={clsx(
            "h-full rounded-full",
            percent >= 90 ? "bg-emerald-500" :
            percent >= 60 ? "bg-mq-500" :
            percent >= 30 ? "bg-amber-500" : "bg-slate-600"
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-sm font-bold text-white tabular-nums">{percent.toFixed(0)}%</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function PlanTrackerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();

  const [project,    setProject]    = useState<Project | null>(null);
  const [schedules,  setSchedules]  = useState<Schedule[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>("");
  const [selectedActivity,   setSelectedActivity]   = useState<Activity | null>(null);
  const [view, setView] = useState<"gantt" | "tasks">("gantt");

  const today = useMemo(() => new Date(), []);

  // Load project + schedules
  const loadProject = useCallback(async () => {
    if (!projectId) return;
    try {
      const [projRes, schRes] = await Promise.all([
        projectsApi.get(projectId),
        schedulesApi.list(projectId),
      ]);
      setProject(projRes.data);
      setSchedules(schRes.data);
      if (schRes.data.length > 0) {
        const initial = searchParams.get("schedule_id") || schRes.data[0].id;
        setSelectedScheduleId(initial);
      }
    } catch {
      // silent
    }
  }, [projectId, searchParams]);

  useEffect(() => { loadProject(); }, [loadProject]);

  // Load activities for selected schedule
  const loadActivities = useCallback(async () => {
    if (!projectId || !selectedScheduleId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await schedulesApi.listActivities(projectId, selectedScheduleId, {
        limit: 200,
      });
      setActivities(res.data.items ?? (res.data as any));
    } catch {
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, selectedScheduleId]);

  useEffect(() => { loadActivities(); }, [loadActivities]);

  // Compute week boundaries
  const weekStart = useMemo(() =>
    startOfWeek(addWeeks(today, weekOffset), { weekStartsOn: 1 }), [today, weekOffset]);
  const weekEnd   = useMemo(() =>
    endOfWeek(addWeeks(today, weekOffset),   { weekStartsOn: 1 }), [today, weekOffset]);

  // Filter activities for current week
  const weekActivities = useMemo(() => {
    return activities.filter((a) => {
      if (!a.planned_start && !a.planned_finish) return false;
      const start  = a.planned_start  ? parseISO(a.planned_start)  : null;
      const finish = a.planned_finish ? parseISO(a.planned_finish) : null;
      // Activity overlaps with the week
      if (start && finish) {
        return start <= weekEnd && finish >= weekStart;
      }
      if (start)  return start  >= weekStart && start  <= weekEnd;
      if (finish) return finish >= weekStart && finish <= weekEnd;
      return false;
    });
  }, [activities, weekStart, weekEnd]);

  // Completed vs incomplete
  const completedActivities   = weekActivities.filter((a) => a.status === "completed" || a.percent_complete >= 100);
  const incompleteActivities  = weekActivities.filter((a) => a.status !== "completed" && a.percent_complete < 100);

  // Week plan header stats: compute for 5 weeks around current
  const weekHeaders = useMemo(() => {
    return [-1, 0, 1, 2, 3].map((offset) => {
      const wStart = startOfWeek(addWeeks(today, weekOffset + offset - 1), { weekStartsOn: 1 });
      const wEnd   = endOfWeek(addWeeks(today,   weekOffset + offset - 1), { weekStartsOn: 1 });
      const wActs  = activities.filter((a) => {
        const s = a.planned_start  ? parseISO(a.planned_start)  : null;
        const f = a.planned_finish ? parseISO(a.planned_finish) : null;
        if (!s && !f) return false;
        if (s && f) return s <= wEnd && f >= wStart;
        if (s) return s >= wStart && s <= wEnd;
        if (f) return f >= wStart && f <= wEnd;
        return false;
      });
      const total     = wActs.length;
      const completed = wActs.filter((a) => a.status === "completed").length;
      const pct       = total > 0 ? Math.round((completed / total) * 100) : 0;
      const label     = offset === 0 ? "This Week" :
                        offset === 1 ? "Week +1" : offset === -1 ? "Last Week" : `Week +${offset}`;
      return { label, percent: pct, offset, isActive: offset === 0 };
    });
  }, [activities, today, weekOffset]);

  if (!projectId) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to={`/projects/${projectId}`}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            {project?.name ?? "Project"}
          </Link>
          <span className="text-slate-700">›</span>
          <div className="flex items-center gap-1.5">
            <CalendarCheck size={16} className="text-mq-400" />
            <h1 className="text-sm font-semibold text-white">Plan Tracker</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Schedule picker */}
          {schedules.length > 1 && (
            <select
              value={selectedScheduleId}
              onChange={(e) => setSelectedScheduleId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs text-white focus:border-mq-500 focus:outline-none"
            >
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>{s.filename}</option>
              ))}
            </select>
          )}
          <button className="btn-ghost text-xs">
            <Download size={13} />
            Export
          </button>
        </div>
      </div>

      {/* ── Week selector ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <WeekSelector weekOffset={weekOffset} onChange={setWeekOffset} />

        <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/40 p-0.5">
          {(["gantt", "tasks"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={clsx(
                "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-all",
                view === v ? "bg-slate-700 text-white" : "text-slate-500 hover:text-slate-300"
              )}
            >
              {v === "gantt" ? "Timeline" : "Tasks"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Week plan headers ────────────────────────────────────────── */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {weekHeaders.map((wh) => (
          <button key={wh.offset} onClick={() => setWeekOffset(weekOffset + wh.offset - 0)}>
            <WeekPlanHeader label={wh.label} percent={wh.percent} isActive={wh.isActive} />
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonTable rows={6} />
        </div>
      ) : schedules.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <CalendarCheck size={32} className="mb-3 text-slate-600" />
          <p className="text-sm text-slate-400 font-medium">No schedules uploaded</p>
          <p className="mt-1 text-xs text-slate-600">Upload a P6 XER/XML schedule to see the plan tracker</p>
          <Link to={`/projects/${projectId}`} className="btn-primary mt-4 text-xs">
            <ArrowLeft size={13} /> Go to Project
          </Link>
        </div>
      ) : weekActivities.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-12 text-center">
          <CalendarCheck size={28} className="mb-2 text-slate-600" />
          <p className="text-sm text-slate-400">No activities in this week</p>
          <p className="mt-1 text-xs text-slate-600">
            {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">

          {/* ── Gantt / Timeline ─── (2/3) */}
          {view === "gantt" && (
            <div className="card p-5 lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-white">
                  Timeline · {format(weekStart, "d MMM")} – {format(weekEnd, "d MMM")}
                </h2>
                <span className="text-xs text-slate-500">
                  {weekActivities.length} activities
                </span>
              </div>

              <div className="space-y-1 divide-y divide-slate-800/40">
                {weekActivities.map((a) => {
                  const status    = activityToGanttStatus(a, today);
                  const overdue   = daysOverdue(a, today);
                  const remaining = daysRemaining(a, today);

                  return (
                    <GanttBar
                      key={a.id}
                      name={a.name}
                      progressPercent={a.percent_complete}
                      status={status}
                      daysOverdue={overdue}
                      daysRemaining={remaining}
                      onClick={() => setSelectedActivity(selectedActivity?.id === a.id ? null : a)}
                      className={selectedActivity?.id === a.id ? "bg-slate-800/50 rounded-lg px-2" : ""}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Task split: Incomplete + Completed ── */}
          {view === "tasks" && (
            <div className="lg:col-span-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Incomplete */}
              <div className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <AlertTriangle size={12} className="text-amber-400" />
                    Incomplete Tasks
                  </h3>
                  <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                    {incompleteActivities.length}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {incompleteActivities.length === 0 ? (
                    <p className="text-xs text-slate-600 py-4 text-center">
                      All tasks complete! 🎉
                    </p>
                  ) : (
                    incompleteActivities.map((a) => (
                      <TaskCard
                        key={a.id}
                        name={a.name}
                        levelOrZone={a.activity_code || undefined}
                        progressPercent={a.percent_complete}
                        isComplete={false}
                        onClick={() => setSelectedActivity(a)}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Completed */}
              <div className="card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                    <CheckCircle2 size={12} className="text-emerald-400" />
                    Completed Tasks
                  </h3>
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                    {completedActivities.length}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {completedActivities.length === 0 ? (
                    <p className="text-xs text-slate-600 py-4 text-center">
                      No completions yet this week
                    </p>
                  ) : (
                    completedActivities.map((a) => (
                      <TaskCard
                        key={a.id}
                        name={a.name}
                        levelOrZone={a.activity_code || undefined}
                        progressPercent={100}
                        isComplete={true}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Targets / Detail panel (1/3) */}
          <div className="flex flex-col gap-4">
            {/* Week KPIs */}
            <div className="card p-4">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Week Summary
              </h3>
              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  { value: weekActivities.length, label: "Total",     color: "text-white" },
                  { value: completedActivities.length, label: "Done", color: "text-emerald-400" },
                  { value: incompleteActivities.filter(a => activityToGanttStatus(a, today) === "overdue").length,
                    label: "Overdue", color: "text-red-400" },
                ].map((stat) => (
                  <div key={stat.label}>
                    <p className={clsx("text-xl font-bold font-display", stat.color)}>{stat.value}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{stat.label}</p>
                  </div>
                ))}
              </div>

              {weekActivities.length > 0 && (
                <div className="mt-3">
                  <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                    <span>Week completion</span>
                    <span>{Math.round((completedActivities.length / weekActivities.length) * 100)}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${(completedActivities.length / weekActivities.length) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Targets table */}
            <div className="card p-4 flex-1">
              <div className="flex items-center gap-2 mb-3">
                <ListTodo size={13} className="text-slate-400" />
                <h3 className="text-xs font-semibold text-slate-300">Targets</h3>
              </div>

              <div className="space-y-0.5">
                {/* Header */}
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 text-[10px] font-medium uppercase tracking-wider text-slate-500 px-2 pb-1 border-b border-slate-800">
                  <span>Activity</span>
                  <span>Progress</span>
                  <span>Due</span>
                </div>

                {weekActivities.map((a) => {
                  const isSelected  = selectedActivity?.id === a.id;
                  const status      = activityToGanttStatus(a, today);
                  const finishLabel = a.planned_finish
                    ? format(parseISO(a.planned_finish), "d MMM")
                    : "—";

                  return (
                    <div
                      key={a.id}
                      onClick={() => setSelectedActivity(isSelected ? null : a)}
                      className={clsx(
                        "grid grid-cols-[1fr_auto_auto] gap-3 items-center rounded-lg px-2 py-2 text-xs cursor-pointer transition-all",
                        isSelected ? "bg-emerald-500/10 border border-emerald-500/20" : "hover:bg-slate-800/40"
                      )}
                    >
                      <span className={clsx(
                        "truncate font-medium",
                        isSelected ? "text-white" : "text-slate-300"
                      )}>
                        {a.name}
                      </span>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {status === "complete" ? (
                          <CheckCircle2 size={12} className="text-emerald-400" />
                        ) : (
                          <div
                            className={clsx(
                              "h-4 w-4 rounded-full border-2",
                              status === "overdue" ? "border-red-400" : "border-slate-500"
                            )}
                            style={{
                              background: `conic-gradient(${status === "overdue" ? "#ef4444" : "#3b82f6"} ${a.percent_complete * 3.6}deg, transparent 0)`,
                            }}
                          />
                        )}
                        <span className="font-mono font-semibold tabular-nums text-white">
                          {a.percent_complete.toFixed(0)}%
                        </span>
                      </div>

                      <span className={clsx(
                        "shrink-0 text-[10px] font-mono",
                        status === "overdue" ? "text-red-400" : "text-slate-500"
                      )}>
                        {finishLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
