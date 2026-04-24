/**
 * BIMModelPickerPage — select a BIM model before opening the 3D viewer.
 *
 * Route: /projects/:projectId/bim
 * Navigates to: /viewer/:projectId/:modelId on selection
 */

import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Box,
  Upload,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  ChevronRight,
  AlertCircle,
  FileBox,
} from "lucide-react";
import clsx from "clsx";
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
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

type ParseStatus = "pending" | "parsing" | "parsed" | "failed";

const STATUS_META: Record<ParseStatus, { label: string; color: string; icon: React.ElementType }> = {
  pending:  { label: "Queued",    color: "text-slate-400",  icon: Clock },
  parsing:  { label: "Parsing…",  color: "text-mq-400",     icon: Loader2 },
  parsed:   { label: "Ready",     color: "text-emerald-400", icon: CheckCircle2 },
  failed:   { label: "Failed",    color: "text-red-400",    icon: XCircle },
};

// ── component ──────────────────────────────────────────────────────────────

export default function BIMModelPickerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [models, setModels]   = useState<BIMModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

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
    const id = setInterval(() => {
      if (!projectId) return;
      bimApi.listModels(projectId).then((r) => setModels(r.data)).catch(() => {});
    }, 4000);
    return () => clearInterval(id);
  }, [models, projectId]);

  const handleOpen = (model: BIMModel) => {
    if (model.parse_status !== "parsed") return;
    navigate(`/viewer/${projectId}/${model.id}`);
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
          {models.map((model, i) => {
            const status = (model.parse_status ?? "pending") as ParseStatus;
            const meta   = STATUS_META[status] ?? STATUS_META.pending;
            const Icon   = meta.icon;
            const ready  = status === "parsed";

            return (
              <motion.div
                key={model.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                onClick={() => handleOpen(model)}
                className={clsx(
                  "group flex items-center gap-4 rounded-xl border px-5 py-4 transition-all",
                  ready
                    ? "cursor-pointer border-[#2d3d54] bg-[#16213a] hover:border-mq-500/50 hover:bg-[#1a2740]"
                    : "cursor-default border-[#1e293b] bg-[#13192b] opacity-80"
                )}
              >
                {/* Icon */}
                <div
                  className={clsx(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                    ready ? "bg-mq-500/15" : "bg-[#1e293b]"
                  )}
                >
                  <Box
                    size={20}
                    className={ready ? "text-mq-400" : "text-slate-600"}
                  />
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-white">
                    {model.filename}
                  </p>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
                    <span>{formatBytes(model.file_size_bytes)}</span>
                    <span>·</span>
                    <span>{formatDate(model.created_at)}</span>
                    {model.element_count != null && model.element_count > 0 && (
                      <>
                        <span>·</span>
                        <span>{model.element_count.toLocaleString()} elements</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Status badge */}
                <div className={clsx("flex items-center gap-1.5 text-xs font-medium", meta.color)}>
                  <Icon
                    size={13}
                    className={clsx(status === "parsing" && "animate-spin")}
                  />
                  <span>{meta.label}</span>
                </div>

                {/* Arrow for ready models */}
                {ready && (
                  <ChevronRight
                    size={16}
                    className="shrink-0 text-slate-600 transition-colors group-hover:text-mq-400"
                  />
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
