/**
 * CaptureDetailPage — pipeline status view for a single video capture.
 *
 * Route: /projects/:projectId/captures/:captureId
 *
 * Shows a vertical pipeline stepper with live Celery task polling,
 * contextual action buttons, and a progress summary once analysis completes.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Upload,
  Film,
  Layers,
  ScanSearch,
  BarChart3,
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  Play,
  RefreshCw,
  Crosshair,
  CalendarRange,
  Clock,
  AlertCircle,
  ChevronRight,
  Clapperboard,
  Workflow,
  FileText,
} from "lucide-react";
import clsx from "clsx";
import { format } from "date-fns";
import toast from "react-hot-toast";
import {
  capturesApi,
  bimApi,
  schedulesApi,
  pipelineApi,
} from "@/services/api";
import type { VideoCapture, BIMModel, Schedule, TaskStatus } from "@/types";

// ── Pipeline step definitions ─────────────────────────────────────────────

interface StepDef {
  key: string;
  taskKey: string | null;   // matches PipelineStatus step name from Celery
  label: string;
  sublabel: string;
  icon: React.ElementType;
  doneStatuses: string[];   // VideoCapture.status values that mean this step is done
  resultLabel?: (r: Record<string, unknown>) => string | null;
}

const STEP_DEFS: StepDef[] = [
  {
    key: "upload",
    taskKey: null,
    label: "Video Upload",
    sublabel: "Raw video stored on server",
    icon: Upload,
    doneStatuses: ["uploaded", "processing", "frames_extracted", "aligned", "segmented", "compared"],
  },
  {
    key: "frame_extraction",
    taskKey: "frame_extraction",
    label: "Frame Extraction",
    sublabel: "FFmpeg splits video into keyframes",
    icon: Film,
    doneStatuses: ["frames_extracted", "aligned", "segmented", "compared"],
    resultLabel: (r) => r?.frames != null ? `${r.frames} frames extracted` : null,
  },
  {
    key: "segmentation",
    taskKey: "segmentation",
    label: "AI Segmentation",
    sublabel: "Mask2Former detects construction elements per frame",
    icon: Layers,
    doneStatuses: ["segmented", "compared"],
    resultLabel: (r) => r?.segmented_frames != null ? `${r.segmented_frames} frames segmented` : null,
  },
  {
    key: "iou_comparison",
    taskKey: "iou_comparison",
    label: "BIM Comparison",
    sublabel: "IoU between segmentation masks and BIM expectations",
    icon: ScanSearch,
    doneStatuses: ["compared"],
    resultLabel: (r) => r?.comparisons != null ? `${r.comparisons} element comparisons` : null,
  },
  {
    key: "progress_generation",
    taskKey: "progress_generation",
    label: "Progress Items",
    sublabel: "Deviation analysis and narrative generation",
    icon: BarChart3,
    doneStatuses: ["compared"],
    resultLabel: (r) => r?.progress_items != null ? `${r.progress_items} progress items` : null,
  },
];

type StepStatus = "done" | "running" | "failed" | "pending";

interface ResolvedStep {
  def: StepDef;
  status: StepStatus;
  resultText: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function resolveSteps(
  capture: VideoCapture,
  taskProgress: Record<string, unknown> | null,
): ResolvedStep[] {
  // If we have live task step data, prefer it for dynamic steps
  const taskSteps: { name: string; status: string; result: Record<string, unknown> | null }[] =
    Array.isArray(taskProgress?.steps) ? (taskProgress!.steps as never[]) : [];

  return STEP_DEFS.map((def) => {
    // Task step takes precedence when pipeline is running
    const taskStep = taskSteps.find((s) => s.name === def.taskKey);
    if (taskStep) {
      const status: StepStatus =
        taskStep.status === "done"    ? "done"    :
        taskStep.status === "running" ? "running" :
        taskStep.status === "failed"  ? "failed"  : "pending";
      const resultText = taskStep.result && def.resultLabel
        ? def.resultLabel(taskStep.result as Record<string, unknown>)
        : null;
      return { def, status, resultText };
    }

    // Fall back to capture.status for static view
    const isDone = def.doneStatuses.includes(capture.status);
    const isFailed = capture.status === "failed";

    // "upload" is always done (capture exists)
    if (def.key === "upload") return { def, status: "done", resultText: null };

    if (isFailed) {
      // Mark the first not-done step as failed
      return {
        def,
        status: isDone ? "done" : "failed",
        resultText: null,
      };
    }

    return { def, status: isDone ? "done" : "pending", resultText: null };
  });
}

// ── Step icon component ───────────────────────────────────────────────────

function StepIcon({ status, icon: Icon }: { status: StepStatus; icon: React.ElementType }) {
  if (status === "done")    return <CheckCircle2 size={20} className="text-emerald-400" />;
  if (status === "failed")  return <XCircle      size={20} className="text-red-400" />;
  if (status === "running") return <Loader2      size={20} className="text-mq-400 animate-spin" />;
  return <Icon size={20} className="text-slate-600" />;
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function CaptureDetailPage() {
  const { projectId, captureId } = useParams<{ projectId: string; captureId: string }>();
  const navigate = useNavigate();

  const [capture,   setCapture]   = useState<VideoCapture | null>(null);
  const [bimModels, setBimModels] = useState<BIMModel[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading,   setLoading]   = useState(true);

  // Live task tracking
  const [taskId,    setTaskId]    = useState<string | null>(null);
  const [taskState, setTaskState] = useState<string>("IDLE");
  const [taskProg,  setTaskProg]  = useState<Record<string, unknown> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Action form
  const [selectedBim,      setSelectedBim]      = useState("");
  const [selectedSchedule, setSelectedSchedule] = useState("");
  const [showForm,         setShowForm]         = useState(false);
  const [reprojBim,        setReprojBim]        = useState("");
  const [showReprojForm,   setShowReprojForm]   = useState(false);

  // Load initial data
  const reload = useCallback(async () => {
    if (!projectId || !captureId) return;
    try {
      const [capRes, bimRes, schedRes] = await Promise.all([
        capturesApi.get(projectId, captureId),
        bimApi.listModels(projectId),
        schedulesApi.list(projectId),
      ]);
      setCapture(capRes.data);
      setBimModels(bimRes.data);
      setSchedules(schedRes.data);
    } catch {
      toast.error("Failed to load capture");
    } finally {
      setLoading(false);
    }
  }, [projectId, captureId]);

  useEffect(() => { reload(); }, [reload]);

  // Poll task status
  const stopPolling = useCallback(() => {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
  }, []);

  const startPolling = useCallback((tid: string) => {
    if (!projectId) return;
    setTaskId(tid);
    setTaskState("PENDING");
    stopPolling();

    pollTimer.current = setInterval(async () => {
      try {
        const res = await pipelineApi.taskStatus(projectId, tid);
        const task: TaskStatus = res.data;
        setTaskState(task.state);
        setTaskProg(task.progress as Record<string, unknown> | null);

        if (task.state === "SUCCESS") {
          stopPolling();
          setTaskId(null);
          toast.success("Pipeline complete!");
          reload();
        } else if (task.state === "FAILURE") {
          stopPolling();
          setTaskId(null);
          toast.error(task.error ?? "Pipeline failed");
          reload();
        }
      } catch { /* transient — keep polling */ }
    }, 2000);
  }, [projectId, stopPolling, reload]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // ── Action handlers ───────────────────────────────────────────────────

  const handleExtractFrames = async () => {
    if (!projectId || !captureId) return;
    try {
      const res = await capturesApi.process(projectId, captureId, { frame_interval_seconds: 1 });
      startPolling(res.data.task_id);
      toast.success("Frame extraction started");
    } catch { toast.error("Failed to start extraction"); }
  };

  const handleFullAnalysis = async () => {
    if (!projectId || !captureId || !selectedBim) { toast.error("Select a BIM model"); return; }
    try {
      const res = await pipelineApi.analyze(projectId, {
        capture_id: captureId,
        bim_model_id: selectedBim,
        schedule_id: selectedSchedule || undefined,
      });
      startPolling(res.data.task_id);
      setShowForm(false);
      toast.success("Full analysis pipeline started");
    } catch { toast.error("Failed to start analysis"); }
  };

  // ── Render ────────────────────────────────────────────────────────────

  if (loading || !capture) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={22} className="animate-spin text-slate-500" />
      </div>
    );
  }

  const isRunning = taskId !== null && taskState !== "SUCCESS" && taskState !== "FAILURE";
  const steps = resolveSteps(capture, isRunning ? taskProg : null);
  const parsedBimModels = bimModels.filter((m) => m.parse_status === "parsed");
  const parsedSchedules = schedules.filter((s) => s.parse_status === "parsed");

  const canExtract    = capture.status === "uploaded" && !isRunning;
  const canAnalyze    = ["uploaded", "frames_extracted", "aligned", "segmented"].includes(capture.status) && !isRunning;
  const isComplete    = capture.status === "compared";

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-4">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div>
        <Link
          to={`/projects/${projectId}`}
          className="mb-4 flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ArrowLeft size={13} />
          Back to project
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-white">{capture.filename}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              {capture.duration_seconds != null && (
                <span className="flex items-center gap-1">
                  <Clock size={11} />
                  {Math.floor(capture.duration_seconds / 60)}m {Math.round(capture.duration_seconds % 60)}s
                </span>
              )}
              {capture.frame_count > 0 && (
                <span className="flex items-center gap-1">
                  <Film size={11} />
                  {capture.frame_count.toLocaleString()} frames
                </span>
              )}
              {capture.capture_date && (
                <span className="flex items-center gap-1">
                  <CalendarRange size={11} />
                  {format(new Date(capture.capture_date), "MMM d, yyyy")}
                </span>
              )}
              <span className="text-slate-600">
                Uploaded {format(new Date(capture.created_at), "MMM d, yyyy · HH:mm")}
              </span>
            </div>
          </div>

          <StatusBadge status={capture.status} isRunning={isRunning} />
        </div>
      </div>

      {/* ── Main layout ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">

        {/* ── Pipeline stepper ──────────────────────────────────────── */}
        <div className="rounded-xl border border-[#2d3d54] bg-[#16213a] p-6">
          <h2 className="mb-6 text-sm font-semibold text-white">Analysis Pipeline</h2>

          <div className="relative space-y-0">
            {steps.map((step, idx) => {
              const isLast = idx === steps.length - 1;
              const Icon   = step.def.icon;
              const isCurrentRunning = step.status === "running";

              return (
                <div key={step.def.key} className="flex gap-4">
                  {/* Left: icon + connector line */}
                  <div className="flex flex-col items-center">
                    <div className={clsx(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      step.status === "done"    ? "border-emerald-500/50 bg-emerald-500/10" :
                      step.status === "running" ? "border-mq-500/60 bg-mq-500/10" :
                      step.status === "failed"  ? "border-red-500/50 bg-red-500/10" :
                                                  "border-[#2d3d54] bg-[#0d1526]"
                    )}>
                      <StepIcon status={step.status} icon={Icon} />
                    </div>
                    {!isLast && (
                      <div className={clsx(
                        "mt-1 w-0.5 flex-1 min-h-[32px] transition-colors",
                        step.status === "done" ? "bg-emerald-500/30" : "bg-[#2d3d54]"
                      )} />
                    )}
                  </div>

                  {/* Right: content */}
                  <div className={clsx("pb-8 min-w-0 flex-1", isLast && "pb-0")}>
                    <div className="flex items-start justify-between gap-3 pt-1.5">
                      <div className="min-w-0">
                        <p className={clsx(
                          "text-sm font-medium",
                          step.status === "done"    ? "text-white" :
                          step.status === "running" ? "text-mq-300" :
                          step.status === "failed"  ? "text-red-300" :
                                                      "text-slate-500"
                        )}>
                          {step.def.label}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-600">{step.def.sublabel}</p>
                      </div>

                      {step.status === "done" && step.resultText && (
                        <span className="shrink-0 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                          {step.resultText}
                        </span>
                      )}
                    </div>

                    {/* Running progress from Celery */}
                    {isCurrentRunning && taskProg && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        className="mt-2 rounded-lg border border-mq-500/20 bg-mq-500/5 px-3 py-2"
                      >
                        <div className="flex items-center gap-2 text-xs text-mq-400">
                          <Loader2 size={11} className="animate-spin shrink-0" />
                          <span>
                            {String(taskProg.current_step ?? "processing").replace(/_/g, " ")}…
                          </span>
                        </div>
                        {/* Show result counts from already-done steps */}
                        {Array.isArray(taskProg.steps) && (taskProg.steps as {name: string; status: string; result: Record<string, unknown> | null}[])
                          .filter((s) => s.status === "done" && s.result)
                          .map((s) => {
                            const def = STEP_DEFS.find((d) => d.taskKey === s.name);
                            const text = def?.resultLabel?.(s.result!);
                            return text ? (
                              <p key={s.name} className="mt-1 text-[10px] text-slate-500">
                                ✓ {text}
                              </p>
                            ) : null;
                          })}
                      </motion.div>
                    )}

                    {/* Failed step error */}
                    {step.status === "failed" && (
                      <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
                        <AlertCircle size={11} className="inline mr-1.5" />
                        Step failed — check worker logs or retry the pipeline
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Action panel ──────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Status card */}
          <div className="rounded-xl border border-[#2d3d54] bg-[#16213a] p-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Next Steps
            </p>

            <div className="space-y-2">
              {/* Running — show spinner */}
              {isRunning && (
                <div className="flex items-center gap-2 rounded-lg border border-mq-500/20 bg-mq-500/5 px-3 py-2.5 text-xs text-mq-400">
                  <Loader2 size={13} className="animate-spin shrink-0" />
                  Pipeline running…
                </div>
              )}

              {/* Extract frames */}
              {canExtract && (
                <button
                  onClick={handleExtractFrames}
                  className="flex w-full items-center justify-between rounded-lg border border-[#2d3d54] bg-[#1e293b] px-3 py-2.5 text-left text-xs font-medium text-slate-300 transition-colors hover:border-mq-500/40 hover:text-white"
                >
                  <span className="flex items-center gap-2">
                    <Clapperboard size={13} />
                    Extract Frames
                  </span>
                  <ChevronRight size={13} className="text-slate-600" />
                </button>
              )}

              {/* Full analysis */}
              {canAnalyze && !showForm && (
                <button
                  onClick={() => setShowForm(true)}
                  className="flex w-full items-center justify-between rounded-lg border border-mq-600/50 bg-mq-600/10 px-3 py-2.5 text-left text-xs font-medium text-mq-400 transition-colors hover:bg-mq-600/20"
                >
                  <span className="flex items-center gap-2">
                    <Workflow size={13} />
                    Run Full Analysis
                  </span>
                  <ChevronRight size={13} className="text-mq-600" />
                </button>
              )}

              {/* Analysis form */}
              <AnimatePresence>
                {showForm && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-3 rounded-lg border border-[#2d3d54] bg-[#0d1526] p-3">
                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          BIM Model *
                        </label>
                        <select
                          value={selectedBim}
                          onChange={(e) => setSelectedBim(e.target.value)}
                          className="w-full rounded-lg border border-[#2d3d54] bg-[#1e293b] px-2.5 py-2 text-xs text-white focus:border-mq-500 focus:outline-none"
                        >
                          <option value="">Select model…</option>
                          {parsedBimModels.map((m) => (
                            <option key={m.id} value={m.id}>{m.filename}</option>
                          ))}
                        </select>
                        {parsedBimModels.length === 0 && (
                          <p className="mt-1 text-[10px] text-amber-400">
                            No parsed BIM models — upload an IFC first
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          Schedule (optional)
                        </label>
                        <select
                          value={selectedSchedule}
                          onChange={(e) => setSelectedSchedule(e.target.value)}
                          className="w-full rounded-lg border border-[#2d3d54] bg-[#1e293b] px-2.5 py-2 text-xs text-white focus:border-mq-500 focus:outline-none"
                        >
                          <option value="">None</option>
                          {parsedSchedules.map((s) => (
                            <option key={s.id} value={s.id}>{s.filename}</option>
                          ))}
                        </select>
                      </div>

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={handleFullAnalysis}
                          disabled={!selectedBim}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-mq-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-mq-500 disabled:opacity-40"
                        >
                          <Play size={12} />
                          Start Pipeline
                        </button>
                        <button
                          onClick={() => setShowForm(false)}
                          className="rounded-lg border border-[#2d3d54] px-3 py-2 text-xs text-slate-400 hover:text-white transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Completed actions */}
              {isComplete && !isRunning && (
                <>
                  {/* BIM Overlay */}
                  {!showReprojForm ? (
                    <button
                      onClick={() => setShowReprojForm(true)}
                      className="flex w-full items-center justify-between rounded-lg border border-[#2d3d54] bg-[#1e293b] px-3 py-2.5 text-left text-xs font-medium text-slate-300 transition-colors hover:border-mq-500/40 hover:text-white"
                    >
                      <span className="flex items-center gap-2">
                        <Crosshair size={13} />
                        View BIM Overlay
                      </span>
                      <ChevronRight size={13} className="text-slate-600" />
                    </button>
                  ) : (
                    <div className="rounded-lg border border-[#2d3d54] bg-[#0d1526] p-3 space-y-2">
                      <select
                        value={reprojBim}
                        onChange={(e) => setReprojBim(e.target.value)}
                        className="w-full rounded-lg border border-[#2d3d54] bg-[#1e293b] px-2.5 py-2 text-xs text-white focus:border-mq-500 focus:outline-none"
                      >
                        <option value="">Select BIM model…</option>
                        {parsedBimModels.map((m) => (
                          <option key={m.id} value={m.id}>{m.filename}</option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <Link
                          to={reprojBim
                            ? `/projects/${projectId}/captures/${captureId}/reprojection?bim_model_id=${reprojBim}`
                            : "#"}
                          className={clsx(
                            "flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-mq-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-mq-500",
                            !reprojBim && "pointer-events-none opacity-40"
                          )}
                        >
                          <Crosshair size={12} />
                          Open
                        </Link>
                        <button
                          onClick={() => setShowReprojForm(false)}
                          className="rounded-lg border border-[#2d3d54] px-3 py-2 text-xs text-slate-400 hover:text-white transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Progress Overview */}
                  <Link
                    to={`/projects/${projectId}/progress`}
                    className="flex w-full items-center justify-between rounded-lg border border-[#2d3d54] bg-[#1e293b] px-3 py-2.5 text-left text-xs font-medium text-slate-300 transition-colors hover:border-mq-500/40 hover:text-white"
                  >
                    <span className="flex items-center gap-2">
                      <BarChart3 size={13} />
                      View Progress Overview
                    </span>
                    <ChevronRight size={13} className="text-slate-600" />
                  </Link>

                  {/* Reports */}
                  <Link
                    to="/reports"
                    className="flex w-full items-center justify-between rounded-lg border border-[#2d3d54] bg-[#1e293b] px-3 py-2.5 text-left text-xs font-medium text-slate-300 transition-colors hover:border-mq-500/40 hover:text-white"
                  >
                    <span className="flex items-center gap-2">
                      <FileText size={13} />
                      Generate Report
                    </span>
                    <ChevronRight size={13} className="text-slate-600" />
                  </Link>
                </>
              )}

              {/* Failed — retry */}
              {capture.status === "failed" && !isRunning && (
                <div className="space-y-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                  <p className="text-xs font-medium text-red-300">Pipeline failed</p>
                  <p className="text-[11px] text-red-400/70">
                    Check which step failed in the stepper, then retry.
                  </p>
                  <button
                    onClick={() => setShowForm(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10 transition-colors"
                  >
                    <RefreshCw size={12} />
                    Retry Analysis
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Quick links */}
          <div className="rounded-xl border border-[#2d3d54] bg-[#16213a] p-4">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Quick Links
            </p>
            <div className="space-y-1">
              <Link
                to={`/projects/${projectId}`}
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-400 transition-colors hover:bg-[#1e293b] hover:text-white"
              >
                <ArrowLeft size={12} />
                Project Overview
              </Link>
              <Link
                to={`/projects/${projectId}/bim`}
                className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-400 transition-colors hover:bg-[#1e293b] hover:text-white"
              >
                <ScanSearch size={12} />
                BIM Models
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── StatusBadge ───────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  uploading:        { label: "Uploading",         cls: "text-amber-400  border-amber-500/30  bg-amber-500/10"  },
  uploaded:         { label: "Ready to process",  cls: "text-blue-400   border-blue-500/30   bg-blue-500/10"   },
  processing:       { label: "Processing",        cls: "text-amber-400  border-amber-500/30  bg-amber-500/10"  },
  frames_extracted: { label: "Frames extracted",  cls: "text-sky-400    border-sky-500/30    bg-sky-500/10"    },
  aligned:          { label: "Aligned",           cls: "text-indigo-400 border-indigo-500/30 bg-indigo-500/10" },
  segmented:        { label: "Segmented",         cls: "text-violet-400 border-violet-500/30 bg-violet-500/10" },
  compared:         { label: "Analysis complete", cls: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
  failed:           { label: "Failed",            cls: "text-red-400    border-red-500/30    bg-red-500/10"    },
};

function StatusBadge({ status, isRunning }: { status: string; isRunning: boolean }) {
  if (isRunning) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-mq-500/30 bg-mq-500/10 px-3 py-1 text-xs font-semibold text-mq-400">
        <Loader2 size={11} className="animate-spin" />
        Running
      </span>
    );
  }
  const cfg = STATUS_LABEL[status] ?? { label: status, cls: "text-slate-400 border-slate-600 bg-slate-800" };
  return (
    <span className={clsx("shrink-0 rounded-full border px-3 py-1 text-xs font-semibold", cfg.cls)}>
      {cfg.label}
    </span>
  );
}
