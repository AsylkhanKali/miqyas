import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Building2,
  Box,
  CalendarRange,
  ClipboardCheck,
  Loader2,
} from "lucide-react";
import toast from "react-hot-toast";
import { useProjectStore } from "@/store/projectStore";
import { bimApi, schedulesApi } from "@/services/api";
import type { ProjectCreate } from "@/types";
import FileDropzone from "@/components/upload/FileDropzone";

const STEPS = [
  { icon: Building2, label: "Project Details" },
  { icon: Box, label: "BIM Model" },
  { icon: CalendarRange, label: "Schedule" },
  { icon: ClipboardCheck, label: "Review" },
];

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 80 : -80, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -80 : 80, opacity: 0 }),
};

export default function NewProjectPage() {
  const navigate = useNavigate();
  const { createProject } = useProjectStore();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState<ProjectCreate>({
    name: "",
    code: "",
    description: "",
    location: "",
    client_name: "",
    start_date: null,
    end_date: null,
  });

  const [ifcFile, setIfcFile] = useState<File | null>(null);
  const [xerFile, setXerFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});

  const goNext = () => {
    if (step === 0 && (!form.name.trim() || !form.code.trim())) {
      toast.error("Project name and code are required");
      return;
    }
    setDirection(1);
    setStep((s) => Math.min(s + 1, 3));
  };

  const goBack = () => {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 0));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const project = await createProject(form);

      // Upload IFC if provided
      if (ifcFile) {
        toast.loading("Uploading BIM model...", { id: "ifc" });
        await bimApi.uploadIFC(project.id, ifcFile, (pct) =>
          setUploadProgress((p) => ({ ...p, ifc: pct }))
        );
        toast.success("BIM model uploaded", { id: "ifc" });
      }

      // Upload XER if provided
      if (xerFile) {
        toast.loading("Uploading schedule...", { id: "xer" });
        await schedulesApi.upload(project.id, xerFile, (pct) =>
          setUploadProgress((p) => ({ ...p, xer: pct }))
        );
        toast.success("Schedule uploaded", { id: "xer" });
      }

      toast.success("Project created successfully!");
      navigate(`/projects/${project.id}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  };

  const updateForm = (key: keyof ProjectCreate, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Header */}
      <div>
        <button onClick={() => navigate("/projects")} className="btn-ghost mb-4 -ml-3 text-xs">
          <ArrowLeft size={14} />
          Back to Projects
        </button>
        <h1 className="page-title">New Project Setup</h1>
        <p className="mt-1 text-sm text-slate-400">
          Configure your project, upload BIM model, and import schedule
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div key={i} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300 ${
                i < step
                  ? "border-mq-500 bg-mq-600 text-white"
                  : i === step
                  ? "border-mq-500 bg-mq-600/20 text-mq-400"
                  : "border-slate-700 bg-slate-800/50 text-slate-500"
              }`}
            >
              {i < step ? <Check size={16} /> : <s.icon size={16} />}
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`h-px flex-1 transition-colors duration-300 ${
                  i < step ? "bg-mq-500/50" : "bg-slate-800"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="card overflow-hidden p-6">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.25, ease: "easeInOut" }}
          >
            {step === 0 && (
              <StepProjectDetails form={form} onChange={updateForm} />
            )}
            {step === 1 && (
              <StepBIMUpload file={ifcFile} onFileChange={setIfcFile} />
            )}
            {step === 2 && (
              <StepScheduleUpload file={xerFile} onFileChange={setXerFile} />
            )}
            {step === 3 && (
              <StepReview form={form} ifcFile={ifcFile} xerFile={xerFile} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <button onClick={goBack} disabled={step === 0} className="btn-secondary">
          <ArrowLeft size={16} />
          Back
        </button>
        {step < 3 ? (
          <button onClick={goNext} className="btn-primary">
            Next
            <ArrowRight size={16} />
          </button>
        ) : (
          <button onClick={handleSubmit} disabled={submitting} className="btn-primary">
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Check size={16} />
                Create Project
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Step Components ─────────────────────────────────────────────────────

function StepProjectDetails({
  form,
  onChange,
}: {
  form: ProjectCreate;
  onChange: (key: keyof ProjectCreate, val: string) => void;
}) {
  return (
    <div className="space-y-5">
      <h2 className="section-title">Project Details</h2>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Project Name *</label>
          <input
            className="input"
            placeholder="e.g., NEOM Tower A — Phase 1"
            value={form.name}
            onChange={(e) => onChange("name", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Project Code *</label>
          <input
            className="input font-mono"
            placeholder="e.g., NTA-001"
            value={form.code}
            onChange={(e) => onChange("code", e.target.value.toUpperCase())}
          />
        </div>
        <div>
          <label className="label">Client Name</label>
          <input
            className="input"
            placeholder="e.g., Saudi Giga Projects"
            value={form.client_name || ""}
            onChange={(e) => onChange("client_name", e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Location</label>
          <input
            className="input"
            placeholder="e.g., Riyadh, KSA"
            value={form.location || ""}
            onChange={(e) => onChange("location", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Start Date</label>
          <input
            type="date"
            className="input"
            value={form.start_date || ""}
            onChange={(e) => onChange("start_date", e.target.value)}
          />
        </div>
        <div>
          <label className="label">End Date</label>
          <input
            type="date"
            className="input"
            value={form.end_date || ""}
            onChange={(e) => onChange("end_date", e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Description</label>
          <textarea
            className="input min-h-[80px] resize-y"
            placeholder="Brief project description..."
            value={form.description || ""}
            onChange={(e) => onChange("description", e.target.value)}
            rows={3}
          />
        </div>
      </div>
    </div>
  );
}

function StepBIMUpload({
  file,
  onFileChange,
}: {
  file: File | null;
  onFileChange: (f: File | null) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="section-title">Upload BIM Model</h2>
        <p className="mt-1 text-sm text-slate-400">
          Upload your IFC file (.ifc). MIQYAS will extract all building elements, properties, and geometry.
        </p>
      </div>
      <FileDropzone
        accept={{ "application/x-ifc": [".ifc"] }}
        label="Drop your .ifc file here"
        sublabel="IFC2x3 and IFC4 supported"
        file={file}
        onFileChange={onFileChange}
        icon={<Box size={32} className="text-mq-400" />}
      />
      {!file && (
        <p className="text-xs text-slate-500 text-center">
          You can skip this step and upload later
        </p>
      )}
    </div>
  );
}

function StepScheduleUpload({
  file,
  onFileChange,
}: {
  file: File | null;
  onFileChange: (f: File | null) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="section-title">Import Schedule</h2>
        <p className="mt-1 text-sm text-slate-400">
          Upload your P6 schedule file (.xer or .xml). MIQYAS will parse activities, WBS, and relationships.
        </p>
      </div>
      <FileDropzone
        accept={{ "application/octet-stream": [".xer", ".xml"] }}
        label="Drop your .xer or .xml file here"
        sublabel="Primavera P6 XER or XML export"
        file={file}
        onFileChange={onFileChange}
        icon={<CalendarRange size={32} className="text-amber-400" />}
      />
      {!file && (
        <p className="text-xs text-slate-500 text-center">
          You can skip this step and upload later
        </p>
      )}
    </div>
  );
}

function StepReview({
  form,
  ifcFile,
  xerFile,
}: {
  form: ProjectCreate;
  ifcFile: File | null;
  xerFile: File | null;
}) {
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-5">
      <h2 className="section-title">Review & Create</h2>
      <div className="space-y-3">
        <div className="rounded-lg bg-slate-800/40 p-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-3">
            Project
          </h3>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-slate-400">Name</span>
            <span className="text-white font-medium">{form.name}</span>
            <span className="text-slate-400">Code</span>
            <span className="text-white font-mono">{form.code}</span>
            {form.location && (
              <>
                <span className="text-slate-400">Location</span>
                <span className="text-white">{form.location}</span>
              </>
            )}
            {form.client_name && (
              <>
                <span className="text-slate-400">Client</span>
                <span className="text-white">{form.client_name}</span>
              </>
            )}
          </div>
        </div>

        <div className="rounded-lg bg-slate-800/40 p-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-3">
            Files
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Box size={16} className="text-mq-400" />
                <span className="text-slate-300">BIM Model</span>
              </div>
              {ifcFile ? (
                <span className="text-white">
                  {ifcFile.name}{" "}
                  <span className="text-slate-500">({formatBytes(ifcFile.size)})</span>
                </span>
              ) : (
                <span className="text-slate-500 italic">Skipped</span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarRange size={16} className="text-amber-400" />
                <span className="text-slate-300">Schedule</span>
              </div>
              {xerFile ? (
                <span className="text-white">
                  {xerFile.name}{" "}
                  <span className="text-slate-500">({formatBytes(xerFile.size)})</span>
                </span>
              ) : (
                <span className="text-slate-500 italic">Skipped</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
