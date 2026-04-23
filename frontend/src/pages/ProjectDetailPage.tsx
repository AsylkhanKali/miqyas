import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Box,
  CalendarRange,
  Video,
  Upload,
  BarChart3,
  Layers,
  Clock,
  MapPin,
  User,
  Play,
  Clapperboard,
  ScanSearch,
  Workflow,
  RefreshCw,
  Film,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plug,
  Crosshair,
} from "lucide-react";
import clsx from "clsx";
import { format } from "date-fns";
import { useProjectStore } from "@/store/projectStore";
import { bimApi, schedulesApi, capturesApi, pipelineApi, systemApi } from "@/services/api";
import type { BIMModel, Schedule, VideoCapture, TaskStatus, VideoStatus } from "@/types";
import type { SystemCapabilities } from "@/services/api";
import toast from "react-hot-toast";
import FileDropzone from "@/components/upload/FileDropzone";
import { SkeletonTable, SkeletonCard } from "@/components/ui/Skeleton";

type TabKey = "overview" | "bim" | "schedule" | "captures";

const TABS: { key: TabKey; label: string; icon: typeof Box }[] = [
  { key: "overview", label: "Overview", icon: BarChart3 },
  { key: "bim", label: "BIM Models", icon: Box },
  { key: "schedule", label: "Schedule", icon: CalendarRange },
  { key: "captures", label: "Captures", icon: Video },
];

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { currentProject, fetchProject, loading } = useProjectStore();
  const [tab, setTab] = useState<TabKey>("overview");
  const [bimModels, setBimModels] = useState<BIMModel[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  useEffect(() => {
    if (projectId) {
      fetchProject(projectId);
      bimApi.listModels(projectId).then((r) => setBimModels(r.data));
      schedulesApi.list(projectId).then((r) => setSchedules(r.data));
    }
  }, [projectId, fetchProject]);

  if (loading || !currentProject) {
    return (
      <div className="space-y-6 p-6">
        <SkeletonCard />
        <SkeletonTable rows={4} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb + header */}
      <div>
        <Link to="/projects" className="btn-ghost mb-3 -ml-3 text-xs">
          <ArrowLeft size={14} />
          Projects
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="page-title">{currentProject.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-400">
              <span className="flex items-center gap-1.5 font-mono text-xs bg-slate-800/60 rounded px-2 py-0.5">
                {currentProject.code}
              </span>
              {currentProject.location && (
                <span className="flex items-center gap-1.5">
                  <MapPin size={13} /> {currentProject.location}
                </span>
              )}
              {currentProject.client_name && (
                <span className="flex items-center gap-1.5">
                  <User size={13} /> {currentProject.client_name}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={`/projects/${projectId}/integrations`}
              className="btn-ghost text-xs"
            >
              <Plug size={13} />
              Integrations
            </Link>
            <span className={`badge ${currentProject.status === "active" ? "badge-ontrack" : "bg-slate-800 text-slate-400 border border-slate-700"}`}>
              {currentProject.status}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              "relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
              tab === t.key ? "text-mq-400" : "text-slate-500 hover:text-slate-300"
            )}
          >
            <t.icon size={16} />
            {t.label}
            {tab === t.key && (
              <motion.div
                layoutId="project-tab"
                className="absolute inset-x-0 bottom-0 h-0.5 bg-mq-500"
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        {tab === "overview" && <OverviewTab project={currentProject} bimCount={bimModels.length} scheduleCount={schedules.length} />}
        {tab === "bim" && <BIMTab projectId={currentProject.id} models={bimModels} onRefresh={() => bimApi.listModels(currentProject.id).then(r => setBimModels(r.data))} />}
        {tab === "schedule" && <ScheduleTab projectId={currentProject.id} schedules={schedules} onRefresh={() => schedulesApi.list(currentProject.id).then(r => setSchedules(r.data))} />}
        {tab === "captures" && <CapturesTab projectId={currentProject.id} bimModels={bimModels} schedules={schedules} />}
      </motion.div>
    </div>
  );
}

// ── Tab components ──────────────────────────────────────────────────────

function OverviewTab({ project, bimCount, scheduleCount }: { project: any; bimCount: number; scheduleCount: number }) {
  const stats = [
    { label: "BIM Models", value: bimCount, icon: Box, color: "text-mq-400" },
    { label: "Schedules", value: scheduleCount, icon: CalendarRange, color: "text-amber-400" },
    { label: "Captures", value: 0, icon: Video, color: "text-purple-400" },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {stats.map((s) => (
        <div key={s.label} className="card p-5">
          <div className="flex items-center gap-3">
            <s.icon size={20} className={s.color} />
            <span className="text-sm text-slate-400">{s.label}</span>
          </div>
          <p className="mt-2 text-3xl font-bold font-display text-white">{s.value}</p>
        </div>
      ))}
    </div>
  );
}

function BIMTab({ projectId, models, onRefresh }: { projectId: string; models: BIMModel[]; onRefresh: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [reparsing, setReparsing] = useState<string | null>(null);

  const handleReparse = async (modelId: string) => {
    setReparsing(modelId);
    try {
      await bimApi.reparse(projectId, modelId);
      toast.success("Re-parse scheduled — refresh in a minute");
      setTimeout(() => onRefresh(), 3000);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail ?? "Re-parse failed");
    } finally {
      setReparsing(null);
    }
  };

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      await bimApi.uploadIFC(projectId, file, (pct) => setUploadProgress(pct));
      toast.success("IFC file uploaded — parsing started");
      onRefresh();
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="space-y-4">
      <FileDropzone
        accept={{ "application/x-ifc": [".ifc"] }}
        label={uploading ? `Uploading… ${uploadProgress}%` : "Upload another IFC model"}
        sublabel="IFC2x3 or IFC4"
        file={null}
        onFileChange={uploading ? () => {} : handleUpload}
        icon={<Upload size={24} className={uploading ? "text-slate-500 animate-pulse" : "text-mq-400"} />}
      />
      {uploading && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-slate-400">
            <span>Uploading IFC file…</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-700">
            <div
              className="h-1.5 rounded-full bg-mq-400 transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}
      {models.length > 0 && (
        <div className="space-y-2">
          {models.map((m) => (
            <div key={m.id} className="card flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Box size={18} className="text-mq-400" />
                <div>
                  <p className="text-sm font-medium text-white">{m.filename}</p>
                  <p className="text-xs text-slate-500">
                    {m.ifc_schema_version} · {m.element_count} elements
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleReparse(m.id)}
                  disabled={reparsing === m.id}
                  title="Re-parse IFC geometry"
                  className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-600 hover:text-white disabled:opacity-50 transition-colors"
                >
                  <RefreshCw size={12} className={reparsing === m.id ? "animate-spin" : ""} />
                  {reparsing === m.id ? "Re-parsing…" : "Re-parse"}
                </button>
                {m.parse_status === "parsed" ? (
                  <Link
                    to={`/viewer/${projectId}/${m.id}`}
                    className="flex items-center gap-1.5 rounded-md border border-mq-600 bg-mq-600/10 px-2.5 py-1 text-xs text-mq-400 hover:bg-mq-600/20 transition-colors"
                  >
                    Open Viewer
                  </Link>
                ) : (
                  <span className={`badge ${m.parse_status === "failed" ? "badge-behind" : "badge-warning"}`}>
                    {m.parse_status}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScheduleTab({ projectId, schedules, onRefresh }: { projectId: string; schedules: Schedule[]; onRefresh: () => void }) {
  const handleUpload = async (file: File | null) => {
    if (!file) return;
    try {
      await schedulesApi.upload(projectId, file);
      toast.success("Schedule uploaded — parsing started");
      onRefresh();
    } catch {
      toast.error("Upload failed");
    }
  };

  return (
    <div className="space-y-4">
      <FileDropzone
        accept={{ "application/octet-stream": [".xer", ".xml"] }}
        label="Upload schedule file"
        sublabel="P6 XER or XML"
        file={null}
        onFileChange={handleUpload}
        icon={<Upload size={24} className="text-amber-400" />}
      />
      {schedules.length > 0 && (
        <div className="space-y-2">
          {schedules.map((s) => (
            <Link
              key={s.id}
              to={`/projects/${projectId}/schedules/${s.id}`}
              className="card-hover flex items-center justify-between p-4"
            >
              <div className="flex items-center gap-3">
                <CalendarRange size={18} className="text-amber-400" />
                <div>
                  <p className="text-sm font-medium text-white">{s.filename}</p>
                  <p className="text-xs text-slate-500">
                    {s.source_format.toUpperCase()} · {s.activity_count} activities
                    {s.data_date && ` · Data date: ${s.data_date}`}
                  </p>
                </div>
              </div>
              <span className={`badge ${s.parse_status === "parsed" ? "badge-ahead" : s.parse_status === "failed" ? "badge-behind" : "badge-warning"}`}>
                {s.parse_status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Status helpers ──────────────────────────────────────────────────────

const STATUS_CONFIG: Record<VideoStatus, { color: string; badge: string; label: string }> = {
  uploading:        { color: "text-amber-400",  badge: "badge-warning",  label: "Uploading" },
  uploaded:         { color: "text-blue-400",   badge: "badge-ontrack",  label: "Uploaded" },
  processing:       { color: "text-amber-400",  badge: "badge-warning",  label: "Processing" },
  frames_extracted: { color: "text-blue-400",   badge: "badge-ontrack",  label: "Frames Extracted" },
  aligned:          { color: "text-green-400",  badge: "badge-ahead",    label: "Aligned" },
  segmented:        { color: "text-green-400",  badge: "badge-ahead",    label: "Segmented" },
  compared:         { color: "text-green-400",  badge: "badge-ahead",    label: "Compared" },
  failed:           { color: "text-red-400",    badge: "badge-behind",   label: "Failed" },
};

const PIPELINE_STEPS: VideoStatus[] = [
  "uploaded",
  "frames_extracted",
  "aligned",
  "segmented",
  "compared",
];

function stepIndex(status: VideoStatus): number {
  const idx = PIPELINE_STEPS.indexOf(status);
  return idx === -1 ? -1 : idx;
}

// ── CapturesTab ────────────────────────────────────────────────────────

function CapturesTab({
  projectId,
  bimModels,
  schedules,
}: {
  projectId: string;
  bimModels: BIMModel[];
  schedules: Schedule[];
}) {
  const [captures, setCaptures] = useState<VideoCapture[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [capabilities, setCapabilities] = useState<SystemCapabilities | null>(null);

  useEffect(() => {
    systemApi.capabilities().then((r) => setCapabilities(r.data)).catch(() => {});
  }, []);

  // Track running tasks per capture: captureId -> { taskId, status }
  const [runningTasks, setRunningTasks] = useState<
    Record<string, { taskId: string; state: string; progress: Record<string, unknown> | null }>
  >({});
  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // Analysis form state
  const [analysisCapture, setAnalysisCapture] = useState<string | null>(null);
  const [selectedBim, setSelectedBim] = useState<string>("");
  const [selectedSchedule, setSelectedSchedule] = useState<string>("");

  // Reprojection view — pick BIM model then open fullscreen
  const [reprojCapture, setReprojCapture] = useState<string | null>(null);
  const [reprojBim, setReprojBim] = useState<string>("");

  const fetchCaptures = useCallback(async () => {
    try {
      const res = await capturesApi.list(projectId);
      setCaptures(res.data);
    } catch {
      toast.error("Failed to load captures");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchCaptures();
  }, [fetchCaptures]);

  // Cleanup poll timers on unmount
  useEffect(() => {
    const timers = pollTimers.current;
    return () => {
      Object.values(timers).forEach(clearInterval);
    };
  }, []);

  // ── Poll a task ────────────────────────────────────────────────────

  const startPolling = useCallback(
    (captureId: string, taskId: string) => {
      // Set initial state
      setRunningTasks((prev) => ({
        ...prev,
        [captureId]: { taskId, state: "PENDING", progress: null },
      }));

      // Clear any existing timer for this capture
      if (pollTimers.current[captureId]) {
        clearInterval(pollTimers.current[captureId]);
      }

      pollTimers.current[captureId] = setInterval(async () => {
        try {
          const res = await pipelineApi.taskStatus(projectId, taskId);
          const task: TaskStatus = res.data;

          setRunningTasks((prev) => ({
            ...prev,
            [captureId]: { taskId, state: task.state, progress: task.progress },
          }));

          if (task.state === "SUCCESS") {
            clearInterval(pollTimers.current[captureId]);
            delete pollTimers.current[captureId];
            setRunningTasks((prev) => {
              const next = { ...prev };
              delete next[captureId];
              return next;
            });
            toast.success("Pipeline step completed");
            fetchCaptures();
          } else if (task.state === "FAILURE") {
            clearInterval(pollTimers.current[captureId]);
            delete pollTimers.current[captureId];
            setRunningTasks((prev) => {
              const next = { ...prev };
              delete next[captureId];
              return next;
            });
            toast.error(task.error || "Pipeline step failed");
            fetchCaptures();
          }
        } catch {
          // Silently continue polling on transient errors
        }
      }, 2000);
    },
    [projectId, fetchCaptures],
  );

  // ── Upload handler ────────────────────────────────────────────────

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setUploadProgress(0);
    try {
      await capturesApi.upload(projectId, file, (pct) => setUploadProgress(pct));
      toast.success("Video uploaded successfully");
      fetchCaptures();
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploadProgress(null);
    }
  };

  // ── Pipeline action handlers ──────────────────────────────────────

  const handleExtractFrames = async (captureId: string) => {
    try {
      const res = await capturesApi.process(projectId, captureId, {
        frame_interval_seconds: 1,
        generate_cubemaps: false,
      });
      startPolling(captureId, res.data.task_id);
      toast.success("Frame extraction started");
    } catch {
      toast.error("Failed to start frame extraction");
    }
  };

  const handleRunColmap = async (captureId: string) => {
    try {
      const res = await capturesApi.runColmap(projectId, captureId);
      startPolling(captureId, res.data.task_id);
      toast.success("COLMAP alignment started");
    } catch {
      toast.error(
        "COLMAP failed to start. Is the COLMAP binary installed? Try manual alignment instead.",
        { duration: 6000 }
      );
    }
  };

  const handleRunSegmentation = async (captureId: string) => {
    try {
      const res = await pipelineApi.segment(projectId, captureId);
      startPolling(captureId, res.data.task_id);
      toast.success("Segmentation started");
    } catch {
      toast.error("Failed to start segmentation");
    }
  };

  const handleRunComparison = async (captureId: string) => {
    if (!selectedBim) {
      toast.error("Please select a BIM model");
      return;
    }
    try {
      const res = await pipelineApi.compare(projectId, captureId, {
        bim_model_id: selectedBim,
        schedule_id: selectedSchedule || undefined,
      });
      startPolling(captureId, res.data.task_id);
      setAnalysisCapture(null);
      setSelectedBim("");
      setSelectedSchedule("");
      toast.success("BIM comparison started");
    } catch {
      toast.error("Failed to start comparison");
    }
  };

  const handleRunFullAnalysis = async (captureId: string) => {
    if (!selectedBim) {
      toast.error("Please select a BIM model");
      return;
    }
    try {
      const res = await pipelineApi.analyze(projectId, {
        capture_id: captureId,
        bim_model_id: selectedBim,
        schedule_id: selectedSchedule || undefined,
      });
      startPolling(captureId, res.data.task_id);
      setAnalysisCapture(null);
      setSelectedBim("");
      setSelectedSchedule("");
      toast.success("Full analysis pipeline started");
    } catch {
      toast.error("Failed to start analysis");
    }
  };

  // ── Render ────────────────────────────────────────────────────────

  if (loading) {
    return <SkeletonTable rows={3} />;
  }

  return (
    <div className="space-y-4">
      {/* Pipeline mode banner */}
      {capabilities && (
        <AnimatePresence>
          {capabilities.pipeline_mode === "mock_required" ? (
            <motion.div
              key="mock-banner"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-3"
            >
              <div className="flex items-start gap-3">
                <AlertCircle size={16} className="text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-300">
                    Demo mode — ML dependencies not installed
                  </p>
                  <p className="mt-0.5 text-xs text-amber-400/70">
                    Analysis will use simulated data. To enable real CV pipeline:
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {!capabilities.torch.available && (
                      <code className="rounded bg-slate-900 px-2 py-0.5 text-[10px] text-amber-300 border border-amber-500/20">
                        pip install torch torchvision transformers
                      </code>
                    )}
                    {!capabilities.ffmpeg.available && (
                      <code className="rounded bg-slate-900 px-2 py-0.5 text-[10px] text-amber-300 border border-amber-500/20">
                        brew install ffmpeg
                      </code>
                    )}
                    {!capabilities.colmap.available && (
                      <code className="rounded bg-slate-900 px-2 py-0.5 text-[10px] text-slate-400 border border-slate-700">
                        brew install colmap  {/* optional — manual alignment works too */}
                      </code>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="real-banner"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/8 p-3"
            >
              <div className="flex items-center gap-3">
                <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0 flex items-center gap-3">
                  <p className="text-sm font-medium text-emerald-300">
                    Real CV pipeline active
                  </p>
                  <span className="text-xs text-emerald-400/60">
                    {capabilities.torch.device} · {capabilities.alignment_mode === "colmap_or_manual" ? "COLMAP + manual alignment" : "Manual alignment only"}
                  </span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Upload zone */}
      <div className="relative">
        <FileDropzone
          accept={{ "video/*": [".mp4", ".mov", ".avi", ".mkv"] }}
          label="Upload 360° video capture"
          sublabel="MP4, MOV, AVI, or MKV — up to 2 GB"
          file={null}
          onFileChange={handleUpload}
          icon={<Upload size={24} className="text-purple-400" />}
          maxSize={2 * 1024 * 1024 * 1024}
        />
        {uploadProgress !== null && (
          <div className="mt-2">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Uploading...</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-800">
              <motion.div
                className="h-full rounded-full bg-purple-500"
                initial={{ width: 0 }}
                animate={{ width: `${uploadProgress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Capture list */}
      {captures.length === 0 ? (
        <div className="card border-dashed p-12 text-center">
          <Video size={40} className="mx-auto mb-4 text-slate-600" />
          <h3 className="text-lg font-medium text-slate-300">No captures yet</h3>
          <p className="mt-1 text-sm text-slate-500">
            Upload a 360° video to begin the analysis pipeline
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {captures.map((capture) => {
              const cfg = STATUS_CONFIG[capture.status];
              const task = runningTasks[capture.id];
              const isRunning = !!task;
              const si = stepIndex(capture.status);

              return (
                <motion.div
                  key={capture.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="card p-4"
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Film size={18} className="shrink-0 text-purple-400" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">
                          {capture.filename}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                          {capture.frame_count > 0 && (
                            <span className="flex items-center gap-1">
                              <Layers size={11} />
                              {capture.frame_count} frames
                            </span>
                          )}
                          {capture.duration_seconds != null && (
                            <span className="flex items-center gap-1">
                              <Clock size={11} />
                              {Math.round(capture.duration_seconds)}s
                            </span>
                          )}
                          {capture.capture_date && (
                            <span className="flex items-center gap-1">
                              <CalendarRange size={11} />
                              {format(new Date(capture.capture_date), "MMM d, yyyy")}
                            </span>
                          )}
                          <span className="text-slate-600">
                            Uploaded {format(new Date(capture.created_at), "MMM d, yyyy HH:mm")}
                          </span>
                        </div>
                      </div>
                    </div>
                    <span className={`badge ${cfg.badge} shrink-0`}>{cfg.label}</span>
                  </div>

                  {/* Pipeline progress indicators */}
                  <div className="mt-3 flex items-center gap-1">
                    {PIPELINE_STEPS.map((step, idx) => (
                      <div key={step} className="flex-1 flex flex-col items-center gap-1">
                        <div
                          className={clsx(
                            "h-1 w-full rounded-full transition-colors",
                            idx <= si
                              ? capture.status === "failed"
                                ? "bg-red-500/60"
                                : "bg-green-500/60"
                              : "bg-slate-800",
                          )}
                        />
                        <span className="text-[10px] text-slate-600 hidden sm:inline">
                          {step.replace("_", " ")}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Running task indicator — enhanced with step-level detail */}
                  {isRunning && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="mt-3 rounded border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
                    >
                      <div className="flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin shrink-0" />
                        <span className="font-medium">
                          {task.progress?.current_step
                            ? `Running: ${String(task.progress.current_step).replace(/_/g, " ")}`
                            : `Task ${task.state.toLowerCase()}`}
                        </span>
                      </div>
                      {task.progress && (
                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-amber-400/70">
                          {Object.entries(task.progress)
                            .filter(([k]) => k !== "current_step")
                            .map(([k, v]) => (
                              <span key={k}>
                                {k.replace(/_/g, " ")}: {String(v)}
                              </span>
                            ))}
                        </div>
                      )}
                    </motion.div>
                  )}

                  {/* Action buttons */}
                  {!isRunning && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {capture.status === "uploaded" && (
                        <button
                          onClick={() => handleExtractFrames(capture.id)}
                          className="btn-ghost text-xs"
                        >
                          <Clapperboard size={13} />
                          Extract Frames
                        </button>
                      )}
                      {capture.status === "frames_extracted" && (
                        <button
                          onClick={() => handleRunColmap(capture.id)}
                          className="btn-ghost text-xs"
                        >
                          <ScanSearch size={13} />
                          Run COLMAP
                        </button>
                      )}
                      {(capture.status === "aligned" ||
                        capture.status === "frames_extracted") && (
                        <button
                          onClick={() => handleRunSegmentation(capture.id)}
                          className="btn-ghost text-xs"
                        >
                          <Layers size={13} />
                          Run Segmentation
                        </button>
                      )}
                      {(capture.status === "uploaded" ||
                        capture.status === "frames_extracted" ||
                        capture.status === "aligned") && (
                        <>
                          {analysisCapture === capture.id ? (
                            <div className="flex flex-wrap items-end gap-2 w-full mt-1 p-3 rounded bg-slate-800/60 border border-slate-700">
                              <div className="flex-1 min-w-[140px]">
                                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
                                  BIM Model *
                                </label>
                                <select
                                  value={selectedBim}
                                  onChange={(e) => setSelectedBim(e.target.value)}
                                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white focus:border-mq-500 focus:outline-none"
                                >
                                  <option value="">Select model...</option>
                                  {bimModels
                                    .filter((m) => m.parse_status === "parsed")
                                    .map((m) => (
                                      <option key={m.id} value={m.id}>
                                        {m.filename}
                                      </option>
                                    ))}
                                </select>
                              </div>
                              <div className="flex-1 min-w-[140px]">
                                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
                                  Schedule (optional)
                                </label>
                                <select
                                  value={selectedSchedule}
                                  onChange={(e) => setSelectedSchedule(e.target.value)}
                                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white focus:border-mq-500 focus:outline-none"
                                >
                                  <option value="">None</option>
                                  {schedules
                                    .filter((s) => s.parse_status === "parsed")
                                    .map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.filename}
                                      </option>
                                    ))}
                                </select>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleRunFullAnalysis(capture.id)}
                                  className="btn-primary text-xs"
                                >
                                  <Play size={13} />
                                  Start
                                </button>
                                <button
                                  onClick={() => setAnalysisCapture(null)}
                                  className="btn-ghost text-xs"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => setAnalysisCapture(capture.id)}
                              className="btn-ghost text-xs"
                            >
                              <Workflow size={13} />
                              Run Full Analysis
                            </button>
                          )}
                        </>
                      )}
                      {capture.status === "segmented" && (
                        <>
                          {analysisCapture === capture.id ? (
                            <div className="flex flex-wrap items-end gap-2 w-full mt-1 p-3 rounded bg-slate-800/60 border border-slate-700">
                              <div className="flex-1 min-w-[140px]">
                                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
                                  BIM Model *
                                </label>
                                <select
                                  value={selectedBim}
                                  onChange={(e) => setSelectedBim(e.target.value)}
                                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white focus:border-mq-500 focus:outline-none"
                                >
                                  <option value="">Select model...</option>
                                  {bimModels
                                    .filter((m) => m.parse_status === "parsed")
                                    .map((m) => (
                                      <option key={m.id} value={m.id}>
                                        {m.filename}
                                      </option>
                                    ))}
                                </select>
                              </div>
                              <div className="flex-1 min-w-[140px]">
                                <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
                                  Schedule (optional)
                                </label>
                                <select
                                  value={selectedSchedule}
                                  onChange={(e) => setSelectedSchedule(e.target.value)}
                                  className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-white focus:border-mq-500 focus:outline-none"
                                >
                                  <option value="">None</option>
                                  {schedules
                                    .filter((s) => s.parse_status === "parsed")
                                    .map((s) => (
                                      <option key={s.id} value={s.id}>
                                        {s.filename}
                                      </option>
                                    ))}
                                </select>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleRunComparison(capture.id)}
                                  className="btn-primary text-xs"
                                >
                                  <Play size={13} />
                                  Compare
                                </button>
                                <button
                                  onClick={() => setAnalysisCapture(null)}
                                  className="btn-ghost text-xs"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => setAnalysisCapture(capture.id)}
                              className="btn-primary text-xs"
                            >
                              <ScanSearch size={13} />
                              Run BIM Comparison
                            </button>
                          )}
                        </>
                      )}
                      {capture.status === "failed" && (
                        <div className="w-full rounded border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300 space-y-1.5">
                          <div className="flex items-center gap-1.5 font-medium">
                            <AlertCircle size={13} className="shrink-0" />
                            Pipeline failed
                          </div>
                          <p className="text-red-400/80">
                            Check the step that failed: Was it frame extraction, COLMAP alignment, segmentation, or comparison?
                          </p>
                          <div className="flex flex-wrap gap-2 pt-0.5">
                            <button
                              onClick={() => handleExtractFrames(capture.id)}
                              className="btn-ghost text-xs text-red-300 border-red-500/30 hover:bg-red-500/10"
                            >
                              Retry extraction
                            </button>
                            <Link
                              to={`/projects/${projectId}/captures/${capture.id}/align`}
                              className="btn-ghost text-xs text-red-300 border-red-500/30 hover:bg-red-500/10 inline-flex items-center gap-1"
                            >
                              <MapPin size={12} />
                              Try manual alignment
                            </Link>
                          </div>
                        </div>
                      )}
                      {capture.status === "compared" && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex items-center gap-1 text-xs text-green-400">
                            <CheckCircle2 size={13} />
                            Analysis complete
                          </span>
                          {/* Reprojection view button */}
                          {reprojCapture === capture.id ? (
                            <div className="flex items-center gap-2 rounded bg-slate-800/60 border border-slate-700 px-3 py-2">
                              <select
                                value={reprojBim}
                                onChange={(e) => setReprojBim(e.target.value)}
                                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white focus:border-mq-500 focus:outline-none"
                              >
                                <option value="">Select BIM model…</option>
                                {bimModels
                                  .filter((m) => m.parse_status === "parsed")
                                  .map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.filename}
                                    </option>
                                  ))}
                              </select>
                              <Link
                                to={
                                  reprojBim
                                    ? `/projects/${projectId}/captures/${capture.id}/reprojection?bim_model_id=${reprojBim}`
                                    : "#"
                                }
                                className={clsx(
                                  "btn-primary text-xs inline-flex items-center gap-1",
                                  !reprojBim && "pointer-events-none opacity-50"
                                )}
                              >
                                <Crosshair size={13} />
                                Open View
                              </Link>
                              <button
                                onClick={() => setReprojCapture(null)}
                                className="btn-ghost text-xs"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setReprojCapture(capture.id); setReprojBim(""); }}
                              className="btn-ghost text-xs"
                            >
                              <Crosshair size={13} />
                              BIM Overlay
                            </button>
                          )}
                        </div>
                      )}
                      {capture.status === "compared" && capture.filename?.includes("mock") && (
                        <span className="badge bg-amber-500/15 text-amber-400 border border-amber-500/30 text-xs">
                          <AlertCircle size={11} />
                          Simulated
                        </span>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Refresh button */}
      {captures.length > 0 && (
        <div className="flex justify-end">
          <button onClick={fetchCaptures} className="btn-ghost text-xs">
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      )}
    </div>
  );
}
