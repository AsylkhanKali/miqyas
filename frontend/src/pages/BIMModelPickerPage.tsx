/**
 * BIMModelPickerPage — select a BIM model before opening the 3D viewer.
 *
 * Route: /projects/:projectId/bim
 * Navigates to: /viewer/:projectId/:modelId on selection
 */

import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Box,
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  AlertCircle,
  FileBox,
  RefreshCw,
  Trash2,
} from "lucide-react";
import clsx from "clsx";
import toast from "react-hot-toast";
import { bimApi } from "@/services/api";
import type { BIMModel } from "@/types";

// ── helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric",
  });
}

type ParseStatus = "pending" | "parsing" | "parsed" | "failed";

const STATUS_META: Record<ParseStatus, { label: string; color: string; icon: React.ElementType }> = {
  pending:  { label: "Not parsed", color: "text-slate-400",   icon: AlertCircle },
  parsing:  { label: "Parsing…",   color: "text-mq-400",      icon: Loader2 },
  parsed:   { label: "Ready",      color: "text-emerald-400", icon: CheckCircle2 },
  failed:   { label: "Failed",     color: "text-red-400",     icon: XCircle },
};

// ── component ──────────────────────────────────────────────────────────────

export default function BIMModelPickerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [models,    setModels]    = useState<BIMModel[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [reparsing, setReparsing] = useState<Set<string>>(new Set());
  const [deleting,  setDeleting]  = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const reload = () => {
    if (!projectId) return;
    bimApi.listModels(projectId).then((r) => setModels(r.data)).catch(() => {});
  };

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    bimApi
      .listModels(projectId)
      .then((r) => setModels(r.data))
      .catch(() => setError("Failed to load BIM models"))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Auto-poll while any model is still processing
  useEffect(() => {
    const hasLive = models.some(
      (m) => m.parse_status === "pending" || m.parse_status === "parsing"
    );
    if (!hasLive) return;
    const id = setInterval(reload, 4000);
    return () => clearInterval(id);
  }, [models, projectId]);

  const handleOpen = (model: BIMModel) => {
    if (model.parse_status !== "parsed") return;
    navigate(`/viewer/${projectId}/${model.id}`);
  };

  const handleReparse = async (e: React.MouseEvent, model: BIMModel) => {
    e.stopPropagation();
    if (!projectId) return;
    setReparsing((s) => new Set(s).add(model.id));
    try {
      // If the model is stuck in "parsing", force-reset it to "failed" first
      // so the reparse endpoint can clear elements and re-queue cleanly.
      if (model.parse_status === "parsing") {
        await bimApi.forceReset(projectId, model.id);
      }
      await bimApi.reparse(projectId, model.id);
      toast.success("Re-parse started");
      reload();
    } catch {
      toast.error("Failed to start re-parse");
    } finally {
      setReparsing((s) => { const n = new Set(s); n.delete(model.id); return n; });
    }
  };

  const handleDelete = async (modelId: string) => {
    if (!projectId) return;
    setDeleting((s) => new Set(s).add(modelId));
    setConfirmDelete(null);
    try {
      await bimApi.deleteModel(projectId, modelId);
      setModels((m) => m.filter((x) => x.id !== modelId));
      toast.success("Model deleted");
    } catch {
      toast.error("Failed to delete model");
    } finally {
      setDeleting((s) => { const n = new Set(s); n.delete(modelId); return n; });
    }
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">BIM Models</h1>
          <p className="mt-0.5 text-sm text-slate-400">
            Select a model to open in the 3D viewer
          </p>
        </div>
        <Link
          to={`/projects/${projectId}`}
          className="flex items-center gap-2 rounded-lg border border-[#2d3d54] bg-[#1e293b] px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-[#263347] hover:text-white"
        >
          <Upload size={13} />
          Upload new model
        </Link>
      </div>

      {/* States */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <Loader2 size={22} className="animate-spin" />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      {!loading && !error && models.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-[#2d3d54] py-24 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#1e293b]">
            <FileBox size={26} className="text-slate-500" />
          </div>
          <div>
            <p className="font-medium text-slate-300">No BIM models yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Upload an IFC file from the project page to get started.
            </p>
          </div>
          <Link
            to={`/projects/${projectId}`}
            className="flex items-center gap-2 rounded-lg bg-mq-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-mq-500"
          >
            <Upload size={14} />
            Go to project
          </Link>
        </div>
      )}

      {/* Model list */}
      {!loading && models.length > 0 && (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {models.map((model, i) => {
              const status  = (model.parse_status ?? "pending") as ParseStatus;
              const meta    = STATUS_META[status] ?? STATUS_META.pending;
              const Icon    = meta.icon;
              const ready      = status === "parsed";
              // Allow re-parse for failed + never-started; allow force-reparse
              // for "parsing" (worker may have crashed and left it stuck).
              const canReparse = status === "failed" || status === "pending" || status === "parsing";
              const parseLabel = status === "parsing" ? "Force re-parse" : "Parse";
              const isReparsing = reparsing.has(model.id);
              const isDeleting  = deleting.has(model.id);

              return (
                <motion.div
                  key={model.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <div
                    onClick={() => handleOpen(model)}
                    className={clsx(
                      "group flex items-center gap-4 rounded-xl border px-5 py-4 transition-all",
                      ready
                        ? "cursor-pointer border-[#2d3d54] bg-[#16213a] hover:border-mq-500/50 hover:bg-[#1a2740]"
                        : "cursor-default border-[#1e293b] bg-[#13192b]"
                    )}
                  >
                    {/* Icon */}
                    <div className={clsx(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                      ready ? "bg-mq-500/15" : "bg-[#1e293b]"
                    )}>
                      <Box size={20} className={ready ? "text-mq-400" : "text-slate-600"} />
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-white">{model.filename}</p>
                      <div className="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
                        <span>{formatBytes(model.file_size_bytes)}</span>
                        <span>·</span>
                        <span>{formatDate(model.created_at)}</span>
                        {model.element_count > 0 && (
                          <>
                            <span>·</span>
                            <span>{model.element_count.toLocaleString()} elements</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Status */}
                    <div
                      className={clsx("flex items-center gap-1.5 text-xs font-medium shrink-0", meta.color)}
                      title={status === "failed" && model.parse_error ? model.parse_error : undefined}
                    >
                      <Icon size={13} className={clsx(status === "parsing" && "animate-spin")} />
                      <span>{meta.label}</span>
                    </div>

                    {/* Re-parse button */}
                    {canReparse && (
                      <button
                        onClick={(e) => handleReparse(e, model)}
                        disabled={isReparsing}
                        title={status === "parsing"
                          ? "Worker may have crashed — force-reset and re-queue"
                          : "Queue this model for IFC parsing"}
                        className={clsx(
                          "shrink-0 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50",
                          status === "parsing"
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                            : "border-[#2d3d54] bg-[#1e293b] text-slate-400 hover:border-mq-500/40 hover:text-mq-400"
                        )}
                      >
                        <RefreshCw size={11} className={clsx(isReparsing && "animate-spin")} />
                        {isReparsing ? "Starting…" : parseLabel}
                      </button>
                    )}

                    {/* Delete button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDelete(model.id); }}
                      disabled={isDeleting}
                      className="shrink-0 flex items-center justify-center rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                    >
                      {isDeleting
                        ? <Loader2 size={14} className="animate-spin" />
                        : <Trash2 size={14} />
                      }
                    </button>

                    {/* Arrow */}
                    {ready && (
                      <ChevronRight size={16} className="shrink-0 text-slate-600 transition-colors group-hover:text-mq-400" />
                    )}
                  </div>

                  {/* Confirm delete */}
                  <AnimatePresence>
                    {confirmDelete === model.id && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mx-1 flex items-center justify-between rounded-b-xl border border-t-0 border-red-500/20 bg-red-500/5 px-5 py-3">
                          <p className="text-xs text-slate-400">
                            Delete <span className="font-medium text-white">{model.filename}</span>? This cannot be undone.
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleDelete(model.id)}
                              className="rounded-lg bg-red-500/20 border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/30 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
