import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  CalendarRange,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Play,
  Filter,
} from "lucide-react";
import clsx from "clsx";
import { schedulesApi } from "@/services/api";
import type { Activity, Schedule } from "@/types";
import { format } from "date-fns";
import { SkeletonTable } from "@/components/ui/Skeleton";

const STATUS_CONFIG = {
  not_started: { icon: Clock, color: "text-slate-400", bg: "bg-slate-800", label: "Not Started" },
  in_progress: { icon: Play, color: "text-mq-400", bg: "bg-mq-600/15", label: "In Progress" },
  completed: { icon: CheckCircle2, color: "text-signal-ahead", bg: "bg-signal-ahead/10", label: "Complete" },
  delayed: { icon: AlertTriangle, color: "text-signal-behind", bg: "bg-signal-behind/10", label: "Delayed" },
};

export default function ScheduleDetailPage() {
  const { projectId, scheduleId } = useParams<{ projectId: string; scheduleId: string }>();
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [criticalOnly, setCriticalOnly] = useState(false);

  useEffect(() => {
    if (!projectId || !scheduleId) return;
    const load = async () => {
      setLoading(true);
      try {
        const [sRes, aRes] = await Promise.all([
          schedulesApi.get(projectId, scheduleId),
          schedulesApi.listActivities(projectId, scheduleId, { limit: 500 }),
        ]);
        setSchedule(sRes.data);
        setActivities(aRes.data.items);
      } catch {
        // handle
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [projectId, scheduleId]);

  const filtered = activities.filter((a) => {
    if (filter !== "all" && a.status !== filter) return false;
    if (criticalOnly && !a.is_critical) return false;
    return true;
  });

  const statusCounts = activities.reduce(
    (acc, a) => {
      acc[a.status] = (acc[a.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonTable rows={5} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to={`/projects/${projectId}`} className="btn-ghost mb-3 -ml-3 text-xs">
          <ArrowLeft size={14} />
          Back to Project
        </Link>
        <h1 className="page-title flex items-center gap-3">
          <CalendarRange size={24} className="text-amber-400" />
          {schedule?.filename}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {schedule?.source_format.toUpperCase()} · {schedule?.activity_count} activities
          {schedule?.data_date && ` · Data date: ${schedule.data_date}`}
        </p>
      </div>

      {/* Status summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(Object.entries(STATUS_CONFIG) as [string, typeof STATUS_CONFIG.not_started][]).map(
          ([key, cfg]) => (
            <button
              key={key}
              onClick={() => setFilter(filter === key ? "all" : key)}
              className={clsx(
                "card p-4 text-left transition-all",
                filter === key && "ring-1 ring-mq-500/50"
              )}
            >
              <cfg.icon size={18} className={cfg.color} />
              <p className="mt-2 text-2xl font-bold font-display text-white">
                {statusCounts[key] || 0}
              </p>
              <p className="text-xs text-slate-500">{cfg.label}</p>
            </button>
          )
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setCriticalOnly(!criticalOnly)}
          className={clsx(
            "btn-secondary text-xs",
            criticalOnly && "border-signal-behind/50 bg-signal-behind/10 text-signal-behind"
          )}
        >
          <AlertTriangle size={13} />
          Critical Path
        </button>
        <span className="text-xs text-slate-500">
          Showing {filtered.length} of {activities.length} activities
        </span>
      </div>

      {/* Activity list */}
      <div className="space-y-1.5">
        {filtered.map((activity, i) => {
          const cfg = STATUS_CONFIG[activity.status] || STATUS_CONFIG.not_started;
          return (
            <motion.div
              key={activity.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.02, 0.5) }}
              className="card flex items-center gap-4 p-3"
            >
              {/* Status icon */}
              <div className={clsx("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", cfg.bg)}>
                <cfg.icon size={14} className={cfg.color} />
              </div>

              {/* Activity info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-white">{activity.name}</span>
                  {activity.is_critical && (
                    <span className="badge badge-behind text-2xs">Critical</span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
                  <span className="font-mono">{activity.activity_code}</span>
                  {activity.planned_start && (
                    <span>
                      {format(new Date(activity.planned_start), "MMM d")} →{" "}
                      {activity.planned_finish
                        ? format(new Date(activity.planned_finish), "MMM d, yyyy")
                        : "—"}
                    </span>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-28 shrink-0">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-500">Progress</span>
                  <span className="font-medium text-white">{activity.percent_complete}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-800">
                  <div
                    className={clsx(
                      "h-full rounded-full transition-all",
                      activity.percent_complete >= 100
                        ? "bg-signal-ahead"
                        : activity.percent_complete > 0
                        ? "bg-mq-500"
                        : "bg-slate-700"
                    )}
                    style={{ width: `${Math.min(activity.percent_complete, 100)}%` }}
                  />
                </div>
              </div>

              {/* Float */}
              {activity.total_float_days !== null && (
                <div className="w-16 shrink-0 text-right">
                  <p
                    className={clsx(
                      "text-xs font-mono font-medium",
                      activity.total_float_days < 0
                        ? "text-signal-behind"
                        : activity.total_float_days === 0
                        ? "text-signal-warning"
                        : "text-slate-400"
                    )}
                  >
                    {activity.total_float_days > 0 ? "+" : ""}
                    {activity.total_float_days.toFixed(0)}d
                  </p>
                  <p className="text-2xs text-slate-600">float</p>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
