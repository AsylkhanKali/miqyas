import axios from "axios";
import type {
  Activity,
  BIMElement,
  BIMModel,
  BIMModelInfo,
  DashboardStats,
  InvestorDashboard,
  PaginatedResponse,
  ProcoreCompany,
  ProcoreConfig,
  ProcoreProject,
  ProcorePushLog,
  ProcorePushRequest,
  ProcorePushResponse,
  ProgressItem,
  ProgressSummary,
  ProgressTimePoint,
  Project,
  ProjectCreate,
  Report,
  Schedule,
  TaskStatus,
  VideoCapture,
} from "@/types";

const api = axios.create({
  baseURL: "/api/v1",
  headers: { "Content-Type": "application/json" },
});

// ── Projects ────────────────────────────────────────────────────────────

export const projectsApi = {
  list: (skip = 0, limit = 50) =>
    api.get<PaginatedResponse<Project>>("/projects/", { params: { skip, limit } }),

  get: (id: string) =>
    api.get<Project>(`/projects/${id}`),

  create: (data: ProjectCreate) =>
    api.post<Project>("/projects/", data),

  update: (id: string, data: Partial<ProjectCreate>) =>
    api.patch<Project>(`/projects/${id}`, data),

  delete: (id: string) =>
    api.delete(`/projects/${id}`),
};

// ── BIM ─────────────────────────────────────────────────────────────────

export const bimApi = {
  uploadIFC: (projectId: string, file: File, onProgress?: (pct: number) => void) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<BIMModel>(`/projects/${projectId}/bim/upload`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
  },

  listModels: (projectId: string) =>
    api.get<BIMModel[]>(`/projects/${projectId}/bim/models`),

  listElements: (projectId: string, modelId: string, params?: {
    skip?: number; limit?: number; category?: string; level?: string;
  }) =>
    api.get<PaginatedResponse<BIMElement>>(
      `/projects/${projectId}/bim/models/${modelId}/elements`,
      { params },
    ),

  getElement: (projectId: string, elementId: string) =>
    api.get<BIMElement>(`/projects/${projectId}/bim/elements/${elementId}`),

  getModelInfo: (projectId: string, modelId: string) =>
    api.get<BIMModelInfo>(`/projects/${projectId}/bim/models/${modelId}/info`),

  getFileUrl: (projectId: string, modelId: string) =>
    `/api/v1/projects/${projectId}/bim/models/${modelId}/file`,
};

// ── Schedules ───────────────────────────────────────────────────────────

export const schedulesApi = {
  upload: (projectId: string, file: File, onProgress?: (pct: number) => void) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<Schedule>(`/projects/${projectId}/schedules/upload`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
  },

  list: (projectId: string) =>
    api.get<Schedule[]>(`/projects/${projectId}/schedules/`),

  get: (projectId: string, scheduleId: string) =>
    api.get<Schedule>(`/projects/${projectId}/schedules/${scheduleId}`),

  listActivities: (projectId: string, scheduleId: string, params?: {
    skip?: number; limit?: number; status_filter?: string; critical_only?: boolean;
  }) =>
    api.get<PaginatedResponse<Activity>>(
      `/projects/${projectId}/schedules/${scheduleId}/activities`,
      { params },
    ),
};

// ── Captures ────────────────────────────────────────────────────────────

export const capturesApi = {
  upload: (projectId: string, file: File, onProgress?: (pct: number) => void) => {
    const formData = new FormData();
    formData.append("file", file);
    return api.post<VideoCapture>(`/projects/${projectId}/captures/upload`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 600_000, // 10 min for large videos
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
  },

  list: (projectId: string) =>
    api.get<VideoCapture[]>(`/projects/${projectId}/captures/`),

  get: (projectId: string, captureId: string) =>
    api.get<VideoCapture>(`/projects/${projectId}/captures/${captureId}`),

  process: (projectId: string, captureId: string, params?: {
    frame_interval_seconds?: number; generate_cubemaps?: boolean;
  }) =>
    api.post(`/projects/${projectId}/captures/${captureId}/process`, params),

  listFrames: (projectId: string, captureId: string, keyframesOnly = false) =>
    api.get(`/projects/${projectId}/captures/${captureId}/frames`, {
      params: { keyframes_only: keyframesOnly },
    }),

  runColmap: (projectId: string, captureId: string) =>
    api.post(`/projects/${projectId}/captures/${captureId}/colmap`),

  getAlignment: (projectId: string, captureId: string) =>
    api.get(`/projects/${projectId}/captures/${captureId}/alignment`),

  getReprojection: (projectId: string, captureId: string, bimModelId: string) =>
    api.get(`/projects/${projectId}/captures/${captureId}/reprojection`, {
      params: { bim_model_id: bimModelId },
    }),
};

// ── Reports ────────────────────────────────────────────────────────────

export const reportsApi = {
  list: (projectId: string) =>
    api.get<Report[]>(`/projects/${projectId}/reports/`),

  get: (projectId: string, reportId: string) =>
    api.get<Report>(`/projects/${projectId}/reports/${reportId}`),

  generate: (projectId: string, params?: { capture_id?: string; report_type?: string }) =>
    api.post<Report>(`/projects/${projectId}/reports/generate`, params),

  downloadUrl: (projectId: string, reportId: string) =>
    `/api/v1/projects/${projectId}/reports/${reportId}/download`,

  delete: (projectId: string, reportId: string) =>
    api.delete(`/projects/${projectId}/reports/${reportId}`),
};

// ── Progress ───────────────────────────────────────────────────────────

export const progressApi = {
  list: (projectId: string, captureId: string, deviationType?: string) =>
    api.get<ProgressItem[]>(
      `/projects/${projectId}/captures/${captureId}/progress`,
      { params: { deviation_type: deviationType } },
    ),

  summary: (projectId: string, captureId: string) =>
    api.get<ProgressSummary>(
      `/projects/${projectId}/captures/${captureId}/progress/summary`,
    ),
};

// ── Pipeline ───────────────────────────────────────────────────────────

export const pipelineApi = {
  analyze: (projectId: string, params: {
    capture_id: string;
    bim_model_id: string;
    schedule_id?: string;
    frame_interval_seconds?: number;
    device?: string;
  }) =>
    api.post(`/projects/${projectId}/analyze`, params),

  taskStatus: (projectId: string, taskId: string) =>
    api.get<TaskStatus>(`/projects/${projectId}/tasks/${taskId}`),

  segment: (projectId: string, captureId: string) =>
    api.post(`/projects/${projectId}/captures/${captureId}/segment`),

  compare: (projectId: string, captureId: string, params: {
    bim_model_id: string;
    schedule_id?: string;
  }) =>
    api.post(`/projects/${projectId}/captures/${captureId}/compare`, params),
};

// ── Procore Integration ───────────────────────────────────────────────

export const procoreApi = {
  getAuthUrl: (projectId: string) =>
    api.get<{ auth_url: string }>(`/projects/${projectId}/procore/auth-url`),

  getConfig: (projectId: string) =>
    api.get<ProcoreConfig | null>(`/projects/${projectId}/procore/config`),

  updateConfig: (projectId: string, data: Partial<ProcoreConfig>) =>
    api.put<ProcoreConfig>(`/projects/${projectId}/procore/config`, data),

  disconnect: (projectId: string) =>
    api.delete(`/projects/${projectId}/procore/config`),

  listCompanies: (projectId: string) =>
    api.get<ProcoreCompany[]>(`/projects/${projectId}/procore/companies`),

  listProjects: (projectId: string) =>
    api.get<ProcoreProject[]>(`/projects/${projectId}/procore/projects`),

  push: (projectId: string, data: ProcorePushRequest) =>
    api.post<ProcorePushResponse>(`/projects/${projectId}/procore/push`, data),

  getPushLogs: (projectId: string) =>
    api.get<ProcorePushLog[]>(`/projects/${projectId}/procore/push-logs`),

  bulkPush: (projectId: string, data: { progress_item_ids: string[]; entity_type: "rfi" | "issue" }) =>
    api.post<{ task_id: string; queued: number; message: string }>(
      `/projects/${projectId}/procore/bulk-push`,
      data,
    ),

  getTaskStatus: (projectId: string, taskId: string) =>
    api.get<{ task_id: string; state: string; result?: object; error?: string }>(
      `/projects/${projectId}/procore/tasks/${taskId}`,
    ),
};

// ── System ────────────────────────────────────────────────────────────

export interface SystemCapabilities {
  torch: { available: boolean; version?: string; device?: string; install?: string };
  transformers: { available: boolean; version?: string; install?: string };
  colmap: { available: boolean; path?: string | null; install?: string | null };
  ffmpeg: { available: boolean; path?: string | null; install?: string | null };
  bim_mesh_renderer: { available: boolean; install?: string };
  pipeline_mode: "real" | "mock_required";
  alignment_mode: "colmap_or_manual" | "manual_only";
}

export const systemApi = {
  stats: () =>
    api.get<DashboardStats>("/stats"),

  health: () =>
    api.get("/health"),

  capabilities: () =>
    api.get<SystemCapabilities>("/system/capabilities"),

  investorDashboard: () =>
    api.get<InvestorDashboard>("/stats/dashboard"),

  progressTimeline: (projectId?: string) =>
    api.get<ProgressTimePoint[]>("/stats/progress-timeline", {
      params: projectId ? { project_id: projectId } : undefined,
    }),
};

export default api;
