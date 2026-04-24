// ── Projects ────────────────────────────────────────────────────────────

export type ProjectStatus = "active" | "paused" | "completed" | "archived";

export interface Project {
  id: string;
  name: string;
  code: string;
  description: string;
  status: ProjectStatus;
  location: string;
  client_name: string;
  contract_value: number | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectCreate {
  name: string;
  code: string;
  description?: string;
  location?: string;
  client_name?: string;
  contract_value?: number | null;
  start_date?: string | null;
  end_date?: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
}

// ── BIM / IFC ───────────────────────────────────────────────────────────

export type ElementCategory =
  | "wall" | "slab" | "column" | "beam" | "door" | "window"
  | "stair" | "railing" | "ceiling" | "curtain_wall" | "mep"
  | "furniture" | "other";

export interface BIMModel {
  id: string;
  project_id: string;
  filename: string;
  ifc_schema_version: string;
  element_count: number;
  parse_status: string;
  parse_error: string | null;
  file_size_bytes: number | null;
  created_at: string;
  updated_at: string;
}

export interface BIMModelInfo {
  id: string;
  filename: string;
  file_size_bytes: number;
  file_size_mb: number;
  element_count: number;
  parse_status: string;
  ifc_schema_version: string;
}

export interface BIMElement {
  id: string;
  bim_model_id: string;
  ifc_guid: string;
  ifc_type: string;
  category: ElementCategory;
  name: string;
  level: string;
  zone: string;
  material: string;
  geometry_bbox: { min: number[]; max: number[] } | null;
  properties: Record<string, unknown>;
  quantity_data: Record<string, number>;
  created_at: string;
  updated_at: string;
}

// ── Schedules ───────────────────────────────────────────────────────────

export type ActivityStatus = "not_started" | "in_progress" | "completed" | "delayed";

export interface Schedule {
  id: string;
  project_id: string;
  filename: string;
  source_format: string;
  data_date: string | null;
  activity_count: number;
  parse_status: string;
  parse_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  schedule_id: string;
  activity_id: string;
  activity_code: string;
  name: string;
  planned_start: string | null;
  planned_finish: string | null;
  actual_start: string | null;
  actual_finish: string | null;
  planned_duration_days: number | null;
  percent_complete: number;
  status: ActivityStatus;
  is_critical: boolean;
  total_float_days: number | null;
  created_at: string;
  updated_at: string;
}

// ── Video / Capture ─────────────────────────────────────────────────────

export type VideoStatus =
  | "uploading" | "uploaded" | "processing" | "frames_extracted"
  | "aligned" | "segmented" | "compared" | "failed";

export interface VideoCapture {
  id: string;
  project_id: string;
  filename: string;
  duration_seconds: number | null;
  status: VideoStatus;
  frame_count: number;
  capture_date: string | null;
  created_at: string;
  updated_at: string;
}

// ── Progress ────────────────────────────────────────────────────────────

export type DeviationType = "ahead" | "on_track" | "behind" | "not_started" | "extra_work";

export interface ProgressItem {
  id: string;
  element_id: string;
  activity_id: string | null;
  capture_id: string;
  observed_percent: number;
  scheduled_percent: number;
  deviation_type: DeviationType;
  deviation_days: number | null;
  confidence_score: number;
  narrative: string;
  created_at: string;
  updated_at: string;
}

// ── Reports ────────────────────────────────────────────────────────────

export type ReportStatus = "pending" | "generating" | "ready" | "failed";
export type ReportType = "progress" | "deviation" | "executive";

export interface ReportSummary {
  total_elements: number;
  ahead: number;
  on_track: number;
  behind: number;
  not_started: number;
  extra_work?: number;
  avg_observed: number;
  avg_scheduled: number;
  avg_confidence: number;
  executive_summary: string;
}

export interface Report {
  id: string;
  project_id: string;
  capture_id: string | null;
  title: string;
  report_type: ReportType;
  status: ReportStatus;
  pdf_path: string | null;
  summary: ReportSummary;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Progress Summary ───────────────────────────────────────────────────

export interface ProgressSummary {
  total_elements: number;
  ahead: number;
  on_track: number;
  behind: number;
  not_started: number;
  avg_observed_percent: number;
  avg_confidence: number;
}

// ── Camera Pose (for trajectory overlay) ───────────────────────────────

export interface CameraPose {
  id: string;
  frame_id: string;
  position: [number, number, number];
  rotation: [number, number, number, number]; // quaternion
}

// ── Pipeline Task ──────────────────────────────────────────────────────

export interface TaskStatus {
  task_id: string;
  state: string;
  progress: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error: string | null;
}

// ── Procore Integration ───────────────────────────────────────────────

export interface ProcoreConfig {
  id: string;
  project_id: string;
  procore_project_id: string | null;
  procore_company_id: string | null;
  field_mapping: Record<string, Record<string, string | null>>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProcoreProject {
  id: string;
  name: string;
  company: { id: string; name: string } | null;
}

export interface ProcoreCompany {
  id: string;
  name: string;
}

export interface ProcorePushLog {
  id: string;
  entity_type: "rfi" | "issue" | "observation";
  procore_entity_id: string | null;
  payload: Record<string, unknown>;
  response_status: number | null;
  success: boolean;
  created_at: string;
}

export interface ProcorePushRequest {
  progress_item_id: string;
  entity_type: "rfi" | "issue";
}

export interface ProcorePushResponse {
  success: boolean;
  procore_entity_id: string | null;
  error: string | null;
}

// ── Dashboard Stats ────────────────────────────────────────────────────

export interface DashboardStats {
  projects: number;
  bim_models: number;
  schedules: number;
  captures: number;
  progress_items: number;
  reports: number;
}

// ── Investor Dashboard ───────────────────────────────────────────────────

export interface DeviationBreakdown {
  ahead: number;
  on_track: number;
  behind: number;
  not_started: number;
  extra_work: number;
  total: number;
}

export interface ProjectHealthCard {
  id: string;
  name: string;
  code: string;
  health_score: number;
  health_label: "Healthy" | "At Risk" | "Critical";
  behind_count: number;
  total_elements: number;
  last_capture_at: string | null;
}

export interface CriticalElement {
  element_name: string;
  ifc_type: string;
  project_name: string;
  project_id: string;
  deviation_days: number | null;
  observed_percent: number;
  scheduled_percent: number;
  activity_name: string | null;
  is_critical_path: boolean;
}

export interface InvestorDashboard {
  total_projects: number;
  total_elements_analyzed: number;
  avg_health_score: number;
  elements_at_risk: number;
  deviation_breakdown: DeviationBreakdown;
  projects: ProjectHealthCard[];
  critical_elements: CriticalElement[];
  generated_at: string;
}

// ── Progress Timeline (S-curve) ───────────────────────────────────────────

export interface ProgressTimePoint {
  date: string;      // "YYYY-MM-DD"
  actual: number;    // avg observed %
  planned: number;   // avg scheduled %
  elements: number;  // count of elements
}

// ── Trades / Category aggregation ─────────────────────────────────────────

export interface TradeCategory {
  category: string;
  actual_percent: number;
  planned_percent: number;
  elements_total: number;
  elements_behind: number;
  elements_ahead: number;
  elements_on_track: number;
}

// ── Weekly Plan ───────────────────────────────────────────────────────────

export interface WeeklyPlanActivity {
  id: string;
  name: string;
  activity_code: string;
  planned_start: string | null;
  planned_finish: string | null;
  actual_start: string | null;
  actual_finish: string | null;
  percent_complete: number;
  status: string;
  is_critical: boolean;
  total_float_days: number | null;
  level?: string;
}

// ── Wizard ──────────────────────────────────────────────────────────────

export interface WizardState {
  step: number;
  project: ProjectCreate;
  ifcFile: File | null;
  xerFile: File | null;
}
