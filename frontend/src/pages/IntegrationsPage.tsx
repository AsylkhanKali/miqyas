import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Plug,
  CheckCircle2,
  XCircle,
  ExternalLink,
  RefreshCw,
  Loader2,
  Send,
  AlertTriangle,
  Building2,
  FolderOpen,
  Settings2,
  ScrollText,
  Unplug,
} from "lucide-react";
import clsx from "clsx";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { procoreApi } from "@/services/api";
import type {
  ProcoreConfig,
  ProcoreCompany,
  ProcoreProject,
  ProcorePushLog,
} from "@/types";
import { SkeletonCard, SkeletonTable } from "@/components/ui/Skeleton";

// ── Default field mapping keys (for the mapping editor) ──────────────

const MIQYAS_FIELDS = [
  { key: "element_name", label: "Element Name" },
  { key: "ifc_type", label: "IFC Type" },
  { key: "level", label: "Level / Floor" },
  { key: "zone", label: "Zone" },
  { key: "deviation_type", label: "Deviation Type" },
  { key: "deviation_days", label: "Deviation (days)" },
  { key: "observed_percent", label: "Observed %" },
  { key: "scheduled_percent", label: "Scheduled %" },
  { key: "confidence_score", label: "Confidence Score" },
  { key: "narrative", label: "Narrative" },
  { key: "activity_name", label: "Activity Name" },
  { key: "activity_id", label: "Activity ID" },
];

export default function IntegrationsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();

  const [config, setConfig] = useState<ProcoreConfig | null>(null);
  const [companies, setCompanies] = useState<ProcoreCompany[]>([]);
  const [projects, setProjects] = useState<ProcoreProject[]>([]);
  const [pushLogs, setPushLogs] = useState<ProcorePushLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // ── Load data ──────────────────────────────────────────────────────

  const fetchConfig = useCallback(async () => {
    if (!projectId) return;
    try {
      const { data } = await procoreApi.getConfig(projectId);
      setConfig(data);
    } catch {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const fetchPushLogs = useCallback(async () => {
    if (!projectId) return;
    try {
      const { data } = await procoreApi.getPushLogs(projectId);
      setPushLogs(data);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  useEffect(() => {
    fetchConfig();
    fetchPushLogs();
  }, [fetchConfig, fetchPushLogs]);

  // Show success toast if redirected from OAuth callback
  useEffect(() => {
    if (searchParams.get("connected") === "true") {
      toast.success("Procore connected successfully!");
    }
  }, [searchParams]);

  // Load companies when connected
  useEffect(() => {
    if (!projectId || !config?.is_active) return;
    procoreApi.listCompanies(projectId).then(({ data }) => setCompanies(data)).catch(() => {});
  }, [projectId, config?.is_active]);

  // Load projects when company is selected
  useEffect(() => {
    if (!projectId || !config?.is_active || !config?.procore_company_id) return;
    procoreApi.listProjects(projectId).then(({ data }) => setProjects(data)).catch(() => {});
  }, [projectId, config?.is_active, config?.procore_company_id]);

  // ── Actions ────────────────────────────────────────────────────────

  const handleConnect = async () => {
    if (!projectId) return;
    setConnecting(true);
    try {
      const { data } = await procoreApi.getAuthUrl(projectId);
      window.location.href = data.auth_url;
    } catch {
      toast.error("Failed to generate Procore authorization URL");
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!projectId) return;
    try {
      await procoreApi.disconnect(projectId);
      setConfig(null);
      setCompanies([]);
      setProjects([]);
      toast.success("Procore disconnected");
    } catch {
      toast.error("Failed to disconnect");
    }
  };

  const handleSaveConfig = async (updates: Partial<ProcoreConfig>) => {
    if (!projectId) return;
    setSavingConfig(true);
    try {
      const { data } = await procoreApi.updateConfig(projectId, updates);
      setConfig(data);
      toast.success("Configuration saved");
    } catch {
      toast.error("Failed to save configuration");
    } finally {
      setSavingConfig(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonCard />
        <SkeletonTable rows={3} />
      </div>
    );
  }

  const isConnected = config?.is_active === true;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link to={projectId ? `/projects/${projectId}` : "/projects"} className="btn-ghost mb-3 -ml-3 text-xs">
          <ArrowLeft size={14} />
          Back to Project
        </Link>
        <div className="flex items-center gap-3">
          <Plug size={22} className="text-mq-400" />
          <h1 className="page-title">Integrations</h1>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          Connect external services to push deviation data and streamline project workflows.
        </p>
      </div>

      {/* ── Connection Card ──────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10 border border-orange-500/20">
              <Building2 size={20} className="text-orange-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Procore</h2>
              <p className="text-xs text-slate-500">Push RFIs and Issues from deviation analysis</p>
            </div>
          </div>

          {isConnected ? (
            <div className="flex items-center gap-3">
              <span className="badge badge-ahead flex items-center gap-1.5">
                <CheckCircle2 size={12} />
                Connected
              </span>
              <button onClick={handleDisconnect} className="btn-ghost text-xs text-red-400 hover:text-red-300">
                <Unplug size={13} />
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="btn-primary text-xs"
            >
              {connecting ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Redirecting…
                </>
              ) : (
                <>
                  <ExternalLink size={13} />
                  Connect to Procore
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── Config Section (only when connected) ─────────────────── */}
      <AnimatePresence>
        {isConnected && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="space-y-4"
          >
            {/* Company + Project Picker */}
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <FolderOpen size={15} className="text-mq-400" />
                Project Mapping
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Company */}
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
                    Procore Company
                  </label>
                  <select
                    value={config?.procore_company_id || ""}
                    onChange={(e) =>
                      handleSaveConfig({ procore_company_id: e.target.value || null })
                    }
                    className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-mq-500 focus:outline-none"
                  >
                    <option value="">Select company…</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Project */}
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
                    Procore Project
                  </label>
                  <select
                    value={config?.procore_project_id || ""}
                    onChange={(e) =>
                      handleSaveConfig({ procore_project_id: e.target.value || null })
                    }
                    disabled={!config?.procore_company_id}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-mq-500 focus:outline-none disabled:opacity-40"
                  >
                    <option value="">Select project…</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {!config?.procore_company_id && (
                <p className="text-xs text-slate-500 flex items-center gap-1.5">
                  <AlertTriangle size={12} className="text-amber-400" />
                  Select a company to load available projects
                </p>
              )}
            </div>

            {/* Field Mapping Editor */}
            <FieldMappingEditor config={config!} onSave={handleSaveConfig} saving={savingConfig} />

            {/* Push Logs */}
            <PushLogViewer logs={pushLogs} onRefresh={fetchPushLogs} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Field Mapping Editor ──────────────────────────────────────────────

function FieldMappingEditor({
  config,
  onSave,
  saving,
}: {
  config: ProcoreConfig;
  onSave: (u: Partial<ProcoreConfig>) => Promise<void>;
  saving: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const rfiMapping = config.field_mapping?.rfi || {};
  const issueMapping = config.field_mapping?.issue || {};

  return (
    <div className="card p-5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Settings2 size={15} className="text-mq-400" />
          Field Mapping
        </div>
        <span className="text-xs text-slate-500">{expanded ? "Collapse" : "Expand"}</span>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-4">
              <p className="text-xs text-slate-500">
                Templates use placeholders like{" "}
                <code className="text-mq-400">{"{element_name}"}</code>,{" "}
                <code className="text-mq-400">{"{deviation_type}"}</code>, etc.
                These are replaced with actual values when pushing to Procore.
              </p>

              {/* RFI Templates */}
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                  RFI Template
                </h4>
                <div className="space-y-2">
                  <div>
                    <label className="mb-0.5 block text-[10px] text-slate-600">Subject</label>
                    <input
                      className="input text-xs"
                      defaultValue={String(rfiMapping.subject || "")}
                      onBlur={(e) => {
                        const updated = {
                          ...config.field_mapping,
                          rfi: { ...rfiMapping, subject: e.target.value },
                        };
                        onSave({ field_mapping: updated });
                      }}
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] text-slate-600">Question</label>
                    <textarea
                      className="input text-xs min-h-[80px]"
                      defaultValue={String(rfiMapping.question || "")}
                      onBlur={(e) => {
                        const updated = {
                          ...config.field_mapping,
                          rfi: { ...rfiMapping, question: e.target.value },
                        };
                        onSave({ field_mapping: updated });
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Issue Templates */}
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                  Issue Template
                </h4>
                <div className="space-y-2">
                  <div>
                    <label className="mb-0.5 block text-[10px] text-slate-600">Title</label>
                    <input
                      className="input text-xs"
                      defaultValue={String(issueMapping.title || "")}
                      onBlur={(e) => {
                        const updated = {
                          ...config.field_mapping,
                          issue: { ...issueMapping, title: e.target.value },
                        };
                        onSave({ field_mapping: updated });
                      }}
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] text-slate-600">Description</label>
                    <textarea
                      className="input text-xs min-h-[80px]"
                      defaultValue={String(issueMapping.description || "")}
                      onBlur={(e) => {
                        const updated = {
                          ...config.field_mapping,
                          issue: { ...issueMapping, description: e.target.value },
                        };
                        onSave({ field_mapping: updated });
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Available Placeholders */}
              <div>
                <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">
                  Available Placeholders
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {MIQYAS_FIELDS.map((f) => (
                    <span
                      key={f.key}
                      className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400 border border-slate-700"
                      title={f.label}
                    >
                      {`{${f.key}}`}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Push Log Viewer ───────────────────────────────────────────────────

function PushLogViewer({
  logs,
  onRefresh,
}: {
  logs: ProcorePushLog[];
  onRefresh: () => void;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <ScrollText size={15} className="text-mq-400" />
          Push Log
        </div>
        <button onClick={onRefresh} className="btn-ghost text-xs">
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {logs.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-600">
          No pushes yet. Deviations will appear here after pushing RFIs or Issues.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-left text-slate-500">
                <th className="pb-2 pr-4 font-medium">Time</th>
                <th className="pb-2 pr-4 font-medium">Type</th>
                <th className="pb-2 pr-4 font-medium">Procore ID</th>
                <th className="pb-2 pr-4 font-medium">HTTP Status</th>
                <th className="pb-2 font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {logs.map((log) => (
                <tr key={log.id} className="text-slate-400">
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {format(new Date(log.created_at), "MMM d, HH:mm:ss")}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={clsx(
                      "badge",
                      log.entity_type === "rfi" ? "badge-ontrack" : "badge-warning"
                    )}>
                      {log.entity_type.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-2 pr-4 font-mono text-slate-500">
                    {log.procore_entity_id || "—"}
                  </td>
                  <td className="py-2 pr-4 font-mono">
                    {log.response_status || "—"}
                  </td>
                  <td className="py-2">
                    {log.success ? (
                      <span className="flex items-center gap-1 text-green-400">
                        <CheckCircle2 size={12} />
                        Success
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-red-400">
                        <XCircle size={12} />
                        Failed
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
