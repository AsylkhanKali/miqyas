import { useEffect, useState, useCallback } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Plug, CheckCircle2, XCircle, ExternalLink, RefreshCw,
  Loader2, AlertTriangle, Building2, FolderOpen, Settings2, ScrollText,
  Unplug, Key, Webhook, Copy, Trash2, Send, Plus, Eye, EyeOff,
} from "lucide-react";
import clsx from "clsx";
import { format } from "date-fns";
import toast from "react-hot-toast";
import { procoreApi, accApi, apiKeysApi, webhooksApi } from "@/services/api";
import type {
  ProcoreConfig, ProcoreCompany, ProcoreProject, ProcorePushLog,
  AccConfig, AccPushLog, ApiKey, ApiKeyCreated, Webhook as WebhookType, WebhookCreated,
} from "@/types";
import { SkeletonCard } from "@/components/ui/Skeleton";

type Tab = "procore" | "acc" | "apikeys" | "webhooks";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "procore",  label: "Procore",         icon: <Building2 size={14} /> },
  { id: "acc",      label: "Autodesk ACC",    icon: <Building2 size={14} /> },
  { id: "apikeys",  label: "API Keys",        icon: <Key size={14} /> },
  { id: "webhooks", label: "Webhooks",        icon: <Webhook size={14} /> },
];

const MIQYAS_FIELDS = [
  { key: "element_name" }, { key: "ifc_type" }, { key: "level" },
  { key: "deviation_type" }, { key: "deviation_days" }, { key: "observed_percent" },
  { key: "scheduled_percent" }, { key: "narrative" }, { key: "activity_name" },
];

const WEBHOOK_EVENTS = ["progress.updated", "report.ready", "capture.analyzed", "deviation.critical"];

export default function IntegrationsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>("procore");

  useEffect(() => {
    if (searchParams.get("connected") === "procore") toast.success("Procore connected!");
    if (searchParams.get("connected") === "acc") toast.success("Autodesk ACC connected!");
  }, [searchParams]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link to={projectId ? `/projects/${projectId}` : "/projects"} className="btn-ghost mb-3 -ml-3 text-xs">
          <ArrowLeft size={14} /> Back to Project
        </Link>
        <div className="flex items-center gap-3">
          <Plug size={22} className="text-mq-400" />
          <h1 className="page-title">Integrations</h1>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          Connect external services and manage API access for your construction workflows.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800 pb-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px",
              tab === t.id
                ? "border-mq-500 text-mq-400"
                : "border-transparent text-slate-500 hover:text-slate-300"
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {tab === "procore"  && <ProcoreTab projectId={projectId!} />}
          {tab === "acc"      && <AccTab projectId={projectId!} />}
          {tab === "apikeys"  && <ApiKeysTab />}
          {tab === "webhooks" && <WebhooksTab projectId={projectId} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ── Procore Tab ───────────────────────────────────────────────────────────

function ProcoreTab({ projectId }: { projectId: string }) {
  const [config, setConfig] = useState<ProcoreConfig | null>(null);
  const [companies, setCompanies] = useState<ProcoreCompany[]>([]);
  const [projects, setProjects] = useState<ProcoreProject[]>([]);
  const [logs, setLogs] = useState<ProcorePushLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const fetchConfig = useCallback(async () => {
    try { const { data } = await procoreApi.getConfig(projectId); setConfig(data); }
    catch { setConfig(null); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);
  useEffect(() => {
    if (config?.is_active) {
      procoreApi.listCompanies(projectId).then(({ data }) => setCompanies(data)).catch(() => {});
      procoreApi.getPushLogs(projectId).then(({ data }) => setLogs(data)).catch(() => {});
    }
  }, [projectId, config?.is_active]);
  useEffect(() => {
    if (config?.is_active && config.procore_company_id) {
      procoreApi.listProjects(projectId).then(({ data }) => setProjects(data)).catch(() => {});
    }
  }, [projectId, config?.is_active, config?.procore_company_id]);

  const handleConnect = async () => {
    setConnecting(true);
    try { const { data } = await procoreApi.getAuthUrl(projectId); window.location.href = data.auth_url; }
    catch { toast.error("Failed to get Procore auth URL"); setConnecting(false); }
  };

  const handleDisconnect = async () => {
    try { await procoreApi.disconnect(projectId); setConfig(null); toast.success("Procore disconnected"); }
    catch { toast.error("Failed to disconnect"); }
  };

  const handleSaveConfig = async (updates: Partial<ProcoreConfig>) => {
    try { const { data } = await procoreApi.updateConfig(projectId, updates); setConfig(data); toast.success("Saved"); }
    catch { toast.error("Failed to save"); }
  };

  if (loading) return <SkeletonCard />;

  return (
    <div className="space-y-4">
      <IntegrationCard
        name="Procore"
        description="Push RFIs and Issues from deviation analysis"
        color="orange"
        isConnected={!!config?.is_active}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        connecting={connecting}
      />

      <AnimatePresence>
        {config?.is_active && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <FolderOpen size={15} className="text-mq-400" /> Project Mapping
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">Company</label>
                  <select
                    value={config?.procore_company_id || ""}
                    onChange={(e) => handleSaveConfig({ procore_company_id: e.target.value || null })}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-mq-500 focus:outline-none"
                  >
                    <option value="">Select company…</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">Project</label>
                  <select
                    value={config?.procore_project_id || ""}
                    onChange={(e) => handleSaveConfig({ procore_project_id: e.target.value || null })}
                    disabled={!config?.procore_company_id}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-mq-500 focus:outline-none disabled:opacity-40"
                  >
                    <option value="">Select project…</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <FieldMappingEditor mapping={config.field_mapping} onSave={(m) => handleSaveConfig({ field_mapping: m })} />
            <PushLogTable logs={logs.map((l) => ({ id: l.id, label: l.entity_type?.toUpperCase() || "—", externalId: l.procore_entity_id, status: l.response_status, success: l.success, created_at: l.created_at }))} onRefresh={() => procoreApi.getPushLogs(projectId).then(({ data }) => setLogs(data))} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── ACC Tab ───────────────────────────────────────────────────────────────

function AccTab({ projectId }: { projectId: string }) {
  const [config, setConfig] = useState<AccConfig | null>(null);
  const [hubs, setHubs] = useState<{ id: string; name: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [logs, setLogs] = useState<AccPushLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const fetchConfig = useCallback(async () => {
    try { const { data } = await accApi.getConfig(projectId); setConfig(data); }
    catch { setConfig(null); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);
  useEffect(() => {
    if (config?.is_active) {
      accApi.listHubs(projectId).then(({ data }) => setHubs(data)).catch(() => {});
      accApi.getPushLogs(projectId).then(({ data }) => setLogs(data)).catch(() => {});
    }
  }, [projectId, config?.is_active]);
  useEffect(() => {
    if (config?.is_active && config.acc_hub_id) {
      accApi.listProjects(projectId, config.acc_hub_id).then(({ data }) => setProjects(data)).catch(() => {});
    }
  }, [projectId, config?.is_active, config?.acc_hub_id]);

  const handleConnect = async () => {
    setConnecting(true);
    try { const { data } = await accApi.getAuthUrl(projectId); window.location.href = data.url; }
    catch { toast.error("Failed to get ACC auth URL. Set ACC_CLIENT_ID in .env"); setConnecting(false); }
  };

  const handleDisconnect = async () => {
    try { await accApi.disconnect(projectId); setConfig(null); toast.success("ACC disconnected"); }
    catch { toast.error("Failed to disconnect"); }
  };

  const handleSaveConfig = async (updates: Partial<AccConfig>) => {
    try { await accApi.updateConfig(projectId, updates); setConfig((c) => c ? { ...c, ...updates } : c); toast.success("Saved"); }
    catch { toast.error("Failed to save"); }
  };

  if (loading) return <SkeletonCard />;

  return (
    <div className="space-y-4">
      <IntegrationCard
        name="Autodesk Construction Cloud"
        description="Push deviation Issues directly into ACC projects"
        color="blue"
        isConnected={!!config?.is_active}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        connecting={connecting}
      />

      <AnimatePresence>
        {config?.is_active && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <FolderOpen size={15} className="text-mq-400" /> Project Mapping
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">Hub (Account)</label>
                  <select
                    value={config?.acc_hub_id || ""}
                    onChange={(e) => handleSaveConfig({ acc_hub_id: e.target.value || null })}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-mq-500 focus:outline-none"
                  >
                    <option value="">Select hub…</option>
                    {hubs.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">ACC Project</label>
                  <select
                    value={config?.acc_project_id || ""}
                    onChange={(e) => handleSaveConfig({ acc_project_id: e.target.value || null })}
                    disabled={!config?.acc_hub_id}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:border-mq-500 focus:outline-none disabled:opacity-40"
                  >
                    <option value="">Select project…</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <PushLogTable logs={logs.map((l) => ({ id: l.id, label: "Issue", externalId: l.acc_issue_id, status: l.status, success: l.success, created_at: l.created_at }))} onRefresh={() => accApi.getPushLogs(projectId).then(({ data }) => setLogs(data))} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── API Keys Tab ──────────────────────────────────────────────────────────

function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<ApiKeyCreated | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    apiKeysApi.list().then(({ data }) => setKeys(data)).finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const { data } = await apiKeysApi.create({ name, scopes });
      setNewKey(data);
      setKeys((k) => [data, ...k]);
      setName(""); setShowForm(false);
      toast.success("API key created — copy it now, it won't be shown again");
    } catch { toast.error("Failed to create key"); }
    finally { setCreating(false); }
  };

  const handleRevoke = async (id: string) => {
    try {
      await apiKeysApi.revoke(id);
      setKeys((k) => k.filter((key) => key.id !== id));
      toast.success("Key revoked");
    } catch { toast.error("Failed to revoke"); }
  };

  if (loading) return <SkeletonCard />;

  return (
    <div className="space-y-4">
      {/* Created key banner */}
      <AnimatePresence>
        {newKey && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="card border-emerald-500/30 bg-emerald-500/5 p-4">
            <p className="mb-2 text-xs font-medium text-emerald-400">API key created — copy it now:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-slate-900 px-3 py-2 text-xs text-emerald-300 font-mono break-all">
                {newKey.key}
              </code>
              <button onClick={() => { navigator.clipboard.writeText(newKey.key); toast.success("Copied"); }}
                className="btn-ghost text-xs text-emerald-400">
                <Copy size={13} />
              </button>
            </div>
            <button onClick={() => setNewKey(null)} className="mt-2 text-[10px] text-slate-500 hover:text-slate-400">
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header + create */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Key size={15} className="text-mq-400" /> API Keys
          </div>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary text-xs">
            <Plus size={13} /> New Key
          </button>
        </div>

        <AnimatePresence>
          {showForm && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden mb-4">
              <div className="rounded border border-slate-700 bg-slate-900/50 p-4 space-y-3">
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">Name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. SAP EAM Production"
                    className="input text-sm w-full" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">Scopes</label>
                  <div className="flex gap-3">
                    {["read", "write", "webhooks"].map((s) => (
                      <label key={s} className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
                        <input type="checkbox" checked={scopes.includes(s)}
                          onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))}
                          className="rounded" />
                        {s}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleCreate} disabled={creating || !name.trim()} className="btn-primary text-xs">
                    {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    Create
                  </button>
                  <button onClick={() => setShowForm(false)} className="btn-ghost text-xs">Cancel</button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {keys.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-600">No API keys yet. Create one to allow external systems to access the API.</p>
        ) : (
          <div className="divide-y divide-slate-800/50">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{k.name}</span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
                      {k.key_prefix}…
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-500">
                    <span>{k.scopes.join(", ")}</span>
                    <span>·</span>
                    <span>Created {format(new Date(k.created_at), "MMM d, yyyy")}</span>
                    {k.last_used_at && <><span>·</span><span>Last used {format(new Date(k.last_used_at), "MMM d")}</span></>}
                  </div>
                </div>
                <button onClick={() => handleRevoke(k.id)}
                  className="btn-ghost text-xs text-red-400 hover:text-red-300">
                  <Trash2 size={13} /> Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-4 bg-slate-900/30">
        <p className="text-xs text-slate-500">
          Use the key in the <code className="text-mq-400">X-API-Key</code> header:{" "}
          <code className="text-slate-400">curl -H "X-API-Key: mq_…" {window.location.origin}/api/v1/projects</code>
        </p>
      </div>
    </div>
  );
}

// ── Webhooks Tab ──────────────────────────────────────────────────────────

function WebhooksTab({ projectId }: { projectId?: string }) {
  const [hooks, setHooks] = useState<WebhookType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<{ id: string; secret: string } | null>(null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["deviation.critical"]);

  useEffect(() => {
    webhooksApi.list().then(({ data }) => setHooks(data)).finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!url.trim() || events.length === 0) return;
    setCreating(true);
    try {
      const { data } = await webhooksApi.create({ url, events, project_id: projectId });
      setNewSecret({ id: data.id, secret: data.secret });
      setHooks((h) => [data, ...h]);
      setUrl(""); setShowForm(false);
      toast.success("Webhook registered — save the signing secret");
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed to register webhook");
    } finally { setCreating(false); }
  };

  const handleDelete = async (id: string) => {
    try { await webhooksApi.delete(id); setHooks((h) => h.filter((w) => w.id !== id)); toast.success("Webhook deleted"); }
    catch { toast.error("Failed to delete"); }
  };

  const handleTest = async (id: string) => {
    try { await webhooksApi.test(id); toast.success("Test ping sent"); }
    catch { toast.error("Failed to send test"); }
  };

  if (loading) return <SkeletonCard />;

  return (
    <div className="space-y-4">
      {/* Secret banner */}
      <AnimatePresence>
        {newSecret && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="card border-emerald-500/30 bg-emerald-500/5 p-4">
            <p className="mb-2 text-xs font-medium text-emerald-400">Signing secret — copy it now:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-slate-900 px-3 py-2 text-xs text-emerald-300 font-mono break-all">
                {newSecret.secret}
              </code>
              <button onClick={() => { navigator.clipboard.writeText(newSecret.secret); toast.success("Copied"); }}
                className="btn-ghost text-xs text-emerald-400">
                <Copy size={13} />
              </button>
            </div>
            <p className="mt-1 text-[10px] text-slate-500">
              Verify with: <code>HMAC-SHA256(secret, request_body)</code> == <code>X-Miqyas-Signature</code>
            </p>
            <button onClick={() => setNewSecret(null)} className="mt-2 text-[10px] text-slate-500 hover:text-slate-400">Dismiss</button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Webhook size={15} className="text-mq-400" /> Webhooks
          </div>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary text-xs">
            <Plus size={13} /> Register
          </button>
        </div>

        <AnimatePresence>
          {showForm && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden mb-4">
              <div className="rounded border border-slate-700 bg-slate-900/50 p-4 space-y-3">
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
                    HTTPS Endpoint URL
                  </label>
                  <input value={url} onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://your-system.com/miqyas-events"
                    className="input text-sm w-full" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">Events</label>
                  <div className="flex flex-wrap gap-3">
                    {WEBHOOK_EVENTS.map((ev) => (
                      <label key={ev} className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
                        <input type="checkbox" checked={events.includes(ev)}
                          onChange={(e) => setEvents(e.target.checked ? [...events, ev] : events.filter((x) => x !== ev))}
                          className="rounded" />
                        {ev}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleCreate} disabled={creating || !url.trim() || events.length === 0} className="btn-primary text-xs">
                    {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    Register
                  </button>
                  <button onClick={() => setShowForm(false)} className="btn-ghost text-xs">Cancel</button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {hooks.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-600">
            No webhooks yet. Register an endpoint to receive real-time events.
          </p>
        ) : (
          <div className="divide-y divide-slate-800/50">
            {hooks.map((h) => (
              <div key={h.id} className="py-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-mono text-slate-300 break-all">{h.url}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {h.events.map((ev) => (
                        <span key={ev} className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-mq-400 border border-mq-800">
                          {ev}
                        </span>
                      ))}
                    </div>
                    {h.last_triggered_at && (
                      <p className="mt-1 text-[10px] text-slate-600">
                        Last fired {format(new Date(h.last_triggered_at), "MMM d, HH:mm")}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 ml-3 shrink-0">
                    <button onClick={() => handleTest(h.id)} className="btn-ghost text-xs" title="Send test ping">
                      <Send size={13} />
                    </button>
                    <button onClick={() => handleDelete(h.id)} className="btn-ghost text-xs text-red-400 hover:text-red-300">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared Components ─────────────────────────────────────────────────────

function IntegrationCard({ name, description, color, isConnected, onConnect, onDisconnect, connecting }: {
  name: string; description: string; color: "orange" | "blue";
  isConnected: boolean; onConnect: () => void; onDisconnect: () => void; connecting: boolean;
}) {
  const colorMap = {
    orange: "bg-orange-500/10 border-orange-500/20 text-orange-400",
    blue: "bg-blue-500/10 border-blue-500/20 text-blue-400",
  };
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={clsx("flex h-10 w-10 items-center justify-center rounded-lg border", colorMap[color])}>
            <Building2 size={20} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">{name}</h2>
            <p className="text-xs text-slate-500">{description}</p>
          </div>
        </div>
        {isConnected ? (
          <div className="flex items-center gap-3">
            <span className="badge badge-ahead flex items-center gap-1.5">
              <CheckCircle2 size={12} /> Connected
            </span>
            <button onClick={onDisconnect} className="btn-ghost text-xs text-red-400 hover:text-red-300">
              <Unplug size={13} /> Disconnect
            </button>
          </div>
        ) : (
          <button onClick={onConnect} disabled={connecting} className="btn-primary text-xs">
            {connecting ? <><Loader2 size={13} className="animate-spin" /> Redirecting…</> : <><ExternalLink size={13} /> Connect</>}
          </button>
        )}
      </div>
    </div>
  );
}

function FieldMappingEditor({ mapping, onSave }: { mapping: Record<string, any>; onSave: (m: Record<string, any>) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="card p-5">
      <button onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Settings2 size={15} className="text-mq-400" /> Field Mapping
        </div>
        <span className="text-xs text-slate-500">{expanded ? "Collapse" : "Expand"}</span>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-4 space-y-3">
              <p className="text-xs text-slate-500">Use placeholders like <code className="text-mq-400">{"{element_name}"}</code></p>
              {Object.entries(mapping?.rfi || mapping || {}).filter(([k]) => typeof mapping?.rfi?.[k] === "string" || typeof mapping[k] === "string").map(([k, v]) => (
                <div key={k}>
                  <label className="mb-0.5 block text-[10px] text-slate-600 capitalize">{k.replace(/_/g, " ")}</label>
                  {String(v).length > 80
                    ? <textarea className="input text-xs min-h-[60px] w-full" defaultValue={String(v)} onBlur={(e) => onSave({ ...mapping, [k]: e.target.value })} />
                    : <input className="input text-xs w-full" defaultValue={String(v)} onBlur={(e) => onSave({ ...mapping, [k]: e.target.value })} />
                  }
                </div>
              ))}
              <div className="flex flex-wrap gap-1.5">
                {MIQYAS_FIELDS.map((f) => (
                  <span key={f.key} className="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400 border border-slate-700">{`{${f.key}}`}</span>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PushLogTable({ logs, onRefresh }: {
  logs: { id: string; label: string; externalId: string | null; status: number | null; success: boolean; created_at: string }[];
  onRefresh: () => void;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <ScrollText size={15} className="text-mq-400" /> Push Log
        </div>
        <button onClick={onRefresh} className="btn-ghost text-xs"><RefreshCw size={12} /> Refresh</button>
      </div>
      {logs.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-600">No pushes yet.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-left text-slate-500">
              <th className="pb-2 pr-4 font-medium">Time</th>
              <th className="pb-2 pr-4 font-medium">Type</th>
              <th className="pb-2 pr-4 font-medium">External ID</th>
              <th className="pb-2 pr-4 font-medium">HTTP</th>
              <th className="pb-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {logs.map((l) => (
              <tr key={l.id} className="text-slate-400">
                <td className="py-2 pr-4 whitespace-nowrap">{format(new Date(l.created_at), "MMM d, HH:mm")}</td>
                <td className="py-2 pr-4"><span className="badge badge-ontrack">{l.label}</span></td>
                <td className="py-2 pr-4 font-mono text-slate-500">{l.externalId || "—"}</td>
                <td className="py-2 pr-4 font-mono">{l.status || "—"}</td>
                <td className="py-2">
                  {l.success
                    ? <span className="flex items-center gap-1 text-green-400"><CheckCircle2 size={12} /> Success</span>
                    : <span className="flex items-center gap-1 text-red-400"><XCircle size={12} /> Failed</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
