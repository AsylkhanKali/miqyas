import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart3,
  ChevronDown,
  Download,
  FileText,
  Loader2,
  Plus,
  Trash2,
  X,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import toast from "react-hot-toast";
import { format } from "date-fns";
import { projectsApi, reportsApi, capturesApi } from "@/services/api";
import type { Project, Report, VideoCapture, ReportType } from "@/types";
import { SkeletonTable, SkeletonCard } from "@/components/ui/Skeleton";

// ── Helpers ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  Report["status"],
  { label: string; class: string; icon: typeof Clock }
> = {
  pending: { label: "Pending", class: "badge-warning", icon: Clock },
  generating: { label: "Generating", class: "badge-ontrack", icon: Loader2 },
  ready: { label: "Ready", class: "badge-ahead", icon: CheckCircle2 },
  failed: { label: "Failed", class: "badge-behind", icon: XCircle },
};

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: "progress", label: "Progress Report" },
  { value: "deviation", label: "Deviation Report" },
  { value: "executive", label: "Executive Summary" },
];

function DeviationBar({ summary }: { summary: Report["summary"] }) {
  const { ahead, on_track, behind, not_started, total_elements } = summary;
  if (total_elements === 0) return null;

  const segments = [
    { count: ahead, color: "bg-emerald-500", label: "Ahead" },
    { count: on_track, color: "bg-blue-500", label: "On Track" },
    { count: behind, color: "bg-red-500", label: "Behind" },
    { count: not_started, color: "bg-slate-600", label: "Not Started" },
  ];

  return (
    <div className="space-y-2">
      {/* Stacked bar */}
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
        {segments.map(
          (seg) =>
            seg.count > 0 && (
              <div
                key={seg.label}
                className={`${seg.color} transition-all duration-500`}
                style={{
                  width: `${(seg.count / total_elements) * 100}%`,
                }}
              />
            ),
        )}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map(
          (seg) =>
            seg.count > 0 && (
              <span
                key={seg.label}
                className="flex items-center gap-1.5 text-2xs text-slate-400"
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${seg.color}`}
                />
                {seg.label}: {seg.count}
              </span>
            ),
        )}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export default function ReportsPage() {
  // Project selection
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [projectsLoading, setProjectsLoading] = useState(true);

  // Reports
  const [reports, setReports] = useState<Report[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);

  // Captures (for the generate form)
  const [captures, setCaptures] = useState<VideoCapture[]>([]);

  // Generate form
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [generateCaptureId, setGenerateCaptureId] = useState<string>("");
  const [generateReportType, setGenerateReportType] =
    useState<ReportType>("progress");
  const [generating, setGenerating] = useState(false);

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Fetch projects ──────────────────────────────────────────────────

  useEffect(() => {
    setProjectsLoading(true);
    projectsApi
      .list()
      .then((r) => {
        const items = r.data.items;
        setProjects(items);
        if (items.length > 0) {
          setSelectedProjectId(items[0].id);
        }
      })
      .catch(() => toast.error("Failed to load projects"))
      .finally(() => setProjectsLoading(false));
  }, []);

  // ── Fetch reports & captures when project changes ───────────────────

  const fetchReports = useCallback(() => {
    if (!selectedProjectId) return;
    setReportsLoading(true);
    reportsApi
      .list(selectedProjectId)
      .then((r) => setReports(r.data))
      .catch(() => toast.error("Failed to load reports"))
      .finally(() => setReportsLoading(false));
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) {
      setReports([]);
      setCaptures([]);
      return;
    }
    fetchReports();
    capturesApi
      .list(selectedProjectId)
      .then((r) => setCaptures(r.data))
      .catch(() => {
        /* captures are optional */
      });
  }, [selectedProjectId, fetchReports]);

  // ── Generate report ─────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!selectedProjectId) return;
    setGenerating(true);
    try {
      await reportsApi.generate(selectedProjectId, {
        capture_id: generateCaptureId || undefined,
        report_type: generateReportType,
      });
      toast.success("Report generation started");
      setShowGenerateForm(false);
      setGenerateCaptureId("");
      setGenerateReportType("progress");
      fetchReports();
    } catch {
      toast.error("Failed to generate report");
    } finally {
      setGenerating(false);
    }
  };

  // ── Delete report ───────────────────────────────────────────────────

  const handleDelete = async (reportId: string) => {
    if (!selectedProjectId) return;
    try {
      await reportsApi.delete(selectedProjectId, reportId);
      toast.success("Report deleted");
      setReports((prev) => prev.filter((r) => r.id !== reportId));
    } catch {
      toast.error("Failed to delete report");
    } finally {
      setDeletingId(null);
    }
  };

  // ── 5A: Poll for pending/generating reports ─────────────────────────

  useEffect(() => {
    if (!reports.some((r) => r.status === "generating" || r.status === "pending")) return;
    const timer = setInterval(() => fetchReports(), 3000);
    return () => clearInterval(timer);
  }, [reports, fetchReports]);

  // ── Sorted reports ──────────────────────────────────────────────────

  const sortedReports = useMemo(
    () =>
      [...reports].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [reports],
  );

  // ── Selected project name ───────────────────────────────────────────

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  // ── Render ──────────────────────────────────────────────────────────

  if (projectsLoading) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonTable rows={3} />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">Reports</h1>
        <div className="card border-dashed p-16 text-center">
          <BarChart3 size={48} className="mx-auto mb-4 text-slate-600" />
          <h3 className="text-lg font-medium text-slate-300">
            No projects yet
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            Create a project first to generate reports
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="mt-1 text-sm text-slate-400">
            Generate and download progress reports
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Project selector */}
          <div className="relative">
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="appearance-none rounded-lg border border-slate-700 bg-slate-800 py-2 pl-3 pr-9 text-sm text-white focus:border-mq-500 focus:outline-none focus:ring-1 focus:ring-mq-500"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500"
            />
          </div>

          {/* Generate button */}
          <button
            onClick={() => setShowGenerateForm(true)}
            className="btn-primary"
            disabled={!selectedProjectId}
          >
            <Plus size={16} />
            Generate Report
          </button>
        </div>
      </div>

      {/* Generate form modal */}
      <AnimatePresence>
        {showGenerateForm && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="card p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display font-semibold text-white">
                Generate New Report
              </h3>
              <button
                onClick={() => setShowGenerateForm(false)}
                className="btn-ghost p-1"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {/* Report type */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  Report Type
                </label>
                <div className="relative">
                  <select
                    value={generateReportType}
                    onChange={(e) =>
                      setGenerateReportType(e.target.value as ReportType)
                    }
                    className="w-full appearance-none rounded-lg border border-slate-700 bg-slate-800 py-2 pl-3 pr-9 text-sm text-white focus:border-mq-500 focus:outline-none focus:ring-1 focus:ring-mq-500"
                  >
                    {REPORT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500"
                  />
                </div>
              </div>

              {/* Capture selector (optional) */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">
                  Capture (optional)
                </label>
                <div className="relative">
                  <select
                    value={generateCaptureId}
                    onChange={(e) => setGenerateCaptureId(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-slate-700 bg-slate-800 py-2 pl-3 pr-9 text-sm text-white focus:border-mq-500 focus:outline-none focus:ring-1 focus:ring-mq-500"
                  >
                    <option value="">Latest / All</option>
                    {captures.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.filename}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500"
                  />
                </div>
              </div>

              {/* Submit */}
              <div className="flex items-end">
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="btn-primary w-full justify-center"
                >
                  {generating ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <BarChart3 size={16} />
                      Generate
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reports list */}
      {reportsLoading ? (
        <SkeletonTable rows={3} />
      ) : sortedReports.length === 0 ? (
        <div className="card border-dashed p-16 text-center">
          <FileText size={48} className="mx-auto mb-4 text-slate-600" />
          <h3 className="text-lg font-medium text-slate-300">No reports yet</h3>
          <p className="mt-1 text-sm text-slate-500">
            Generate your first report for{" "}
            <span className="text-mq-400">{selectedProject?.name}</span>
          </p>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-4"
        >
          {sortedReports.map((report, i) => (
            <ReportCard
              key={report.id}
              report={report}
              projectId={selectedProjectId}
              index={i}
              deletingId={deletingId}
              onDeleteClick={setDeletingId}
              onDeleteConfirm={handleDelete}
              onDeleteCancel={() => setDeletingId(null)}
            />
          ))}
        </motion.div>
      )}
    </div>
  );
}

// ── Report Card ────────────────────────────────────────────────────────

function ReportCard({
  report,
  projectId,
  index,
  deletingId,
  onDeleteClick,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  report: Report;
  projectId: string;
  index: number;
  deletingId: string | null;
  onDeleteClick: (id: string) => void;
  onDeleteConfirm: (id: string) => void;
  onDeleteCancel: () => void;
}) {
  const statusCfg = STATUS_CONFIG[report.status];
  const StatusIcon = statusCfg.icon;
  const isDeleting = deletingId === report.id;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="card p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {/* Left: info */}
        <div className="min-w-0 flex-1 space-y-3">
          {/* Title row */}
          <div className="flex flex-wrap items-center gap-2">
            <FileText size={18} className="shrink-0 text-mq-400" />
            <h3 className="font-display font-semibold text-white truncate">
              {report.title}
            </h3>
            <span className={`badge ${statusCfg.class}`}>
              <StatusIcon
                size={12}
                className={
                  report.status === "generating" ? "animate-spin" : ""
                }
              />
              {statusCfg.label}
            </span>
            <span className="badge bg-slate-800 text-slate-400 border border-slate-700 capitalize">
              {report.report_type}
            </span>
            {report.summary?.executive_summary &&
              (report.summary.executive_summary.includes("[SIMULATED]") ||
                report.summary.executive_summary.includes("Mock")) && (
              <span className="badge bg-amber-500/15 text-amber-400 border border-amber-500/30">
                <AlertCircle size={11} />
                Simulated
              </span>
            )}
          </div>

          {/* Date */}
          <p className="text-2xs text-slate-500">
            {report.generated_at
              ? `Generated ${format(new Date(report.generated_at), "MMM d, yyyy 'at' h:mm a")}`
              : `Created ${format(new Date(report.created_at), "MMM d, yyyy 'at' h:mm a")}`}
          </p>

          {/* Summary */}
          {report.status === "ready" && report.summary && (
            <div className="space-y-3">
              <DeviationBar summary={report.summary} />

              {/* Stats row */}
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-2xs text-slate-400">
                <span>
                  Total elements:{" "}
                  <span className="text-white">
                    {report.summary.total_elements}
                  </span>
                </span>
                <span>
                  Avg. observed:{" "}
                  <span className="text-white">
                    {Math.round(report.summary.avg_observed)}%
                  </span>
                </span>
                <span>
                  Avg. scheduled:{" "}
                  <span className="text-white">
                    {Math.round(report.summary.avg_scheduled)}%
                  </span>
                </span>
                <span>
                  Confidence:{" "}
                  <span className="text-white">
                    {Math.round(report.summary.avg_confidence * 100)}%
                  </span>
                </span>
              </div>

              {/* Executive summary excerpt */}
              {report.summary.executive_summary && (
                <p className="text-sm text-slate-400 line-clamp-2 leading-relaxed">
                  {report.summary.executive_summary}
                </p>
              )}
            </div>
          )}

          {/* Failed state */}
          {report.status === "failed" && (
            <div className="flex items-center gap-2 text-sm text-red-400">
              <AlertCircle size={14} />
              Report generation failed. Please try again.
            </div>
          )}

          {/* Generating state */}
          {report.status === "generating" && (
            <div className="flex items-center gap-2 text-sm text-blue-400">
              <Loader2 size={14} className="animate-spin" />
              Report is being generated...
            </div>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex shrink-0 items-center gap-2">
          {report.status === "ready" && report.pdf_path && (
            <a
              href={reportsApi.downloadUrl(projectId, report.id)}
              className="btn-secondary"
              download
            >
              <Download size={14} />
              PDF
            </a>
          )}

          {/* Delete */}
          {isDeleting ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Delete?</span>
              <button
                onClick={() => onDeleteConfirm(report.id)}
                className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-500 transition-colors"
              >
                Yes
              </button>
              <button onClick={onDeleteCancel} className="btn-ghost text-xs">
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => onDeleteClick(report.id)}
              className="btn-ghost text-slate-500 hover:text-red-400"
              title="Delete report"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
