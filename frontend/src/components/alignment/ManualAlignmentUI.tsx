import { useState, useRef, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Plus,
  Trash2,
  Send,
  Target,
  RotateCcw,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MousePointer2,
} from "lucide-react";
import clsx from "clsx";
import toast from "react-hot-toast";
import axios from "axios";

interface ControlPoint {
  id: number;
  label: string;
  pixel_x: number | null;
  pixel_y: number | null;
  bim_x: number | null;
  bim_y: number | null;
  bim_z: number | null;
}

interface ManualAlignmentUIProps {
  projectId: string;
  captureId: string;
  frameUrl: string;  // URL of the equirectangular frame image
  imageWidth: number;
  imageHeight: number;
  onAlignmentComplete?: (alignment: any) => void;
}

export default function ManualAlignmentUI({
  projectId,
  captureId,
  frameUrl,
  imageWidth,
  imageHeight,
  onAlignmentComplete,
}: ManualAlignmentUIProps) {
  const [points, setPoints] = useState<ControlPoint[]>([
    { id: 1, label: "Point 1", pixel_x: null, pixel_y: null, bim_x: null, bim_y: null, bim_z: null },
    { id: 2, label: "Point 2", pixel_x: null, pixel_y: null, bim_x: null, bim_y: null, bim_z: null },
    { id: 3, label: "Point 3", pixel_x: null, pixel_y: null, bim_x: null, bim_y: null, bim_z: null },
    { id: 4, label: "Point 4", pixel_x: null, pixel_y: null, bim_x: null, bim_y: null, bim_z: null },
  ]);
  const [activePointId, setActivePointId] = useState<number | null>(null);
  const [pickMode, setPickMode] = useState<"pixel" | "bim">("pixel");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const imgRef = useRef<HTMLImageElement>(null);
  const nextId = useRef(5);

  const POINT_COLORS = [
    "#ef4444", "#f59e0b", "#10b981", "#3b82f6",
    "#8b5cf6", "#ec4899", "#06b6d4", "#f97316",
  ];

  const addPoint = () => {
    const id = nextId.current++;
    setPoints((prev) => [
      ...prev,
      { id, label: `Point ${id}`, pixel_x: null, pixel_y: null, bim_x: null, bim_y: null, bim_z: null },
    ]);
  };

  const removePoint = (id: number) => {
    if (points.length <= 4) {
      toast.error("Minimum 4 control points required");
      return;
    }
    setPoints((prev) => prev.filter((p) => p.id !== id));
    if (activePointId === id) setActivePointId(null);
  };

  const updatePoint = (id: number, field: keyof ControlPoint, value: number | string | null) => {
    setPoints((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  const handleImageClick = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      if (!activePointId || pickMode !== "pixel") return;

      const rect = imgRef.current?.getBoundingClientRect();
      if (!rect) return;

      const scaleX = imageWidth / rect.width;
      const scaleY = imageHeight / rect.height;
      const px = (e.clientX - rect.left) * scaleX;
      const py = (e.clientY - rect.top) * scaleY;

      updatePoint(activePointId, "pixel_x", Math.round(px));
      updatePoint(activePointId, "pixel_y", Math.round(py));

      // Auto-advance to next point
      const idx = points.findIndex((p) => p.id === activePointId);
      if (idx < points.length - 1) {
        setActivePointId(points[idx + 1].id);
      } else {
        setActivePointId(null);
      }
    },
    [activePointId, pickMode, points, imageWidth, imageHeight]
  );

  const isComplete = (p: ControlPoint) =>
    p.pixel_x !== null && p.pixel_y !== null &&
    p.bim_x !== null && p.bim_y !== null && p.bim_z !== null;

  const validPoints = points.filter(isComplete);
  const canSubmit = validPoints.length >= 4;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);

    try {
      const payload = {
        control_points: validPoints.map((p) => ({
          pixel_x: p.pixel_x,
          pixel_y: p.pixel_y,
          bim_x: p.bim_x,
          bim_y: p.bim_y,
          bim_z: p.bim_z,
          label: p.label,
        })),
        image_width: imageWidth,
        image_height: imageHeight,
        fov_degrees: 90,
      };

      const { data } = await axios.post(
        `/api/v1/projects/${projectId}/captures/${captureId}/align-manual`,
        payload
      );

      setResult(data);
      toast.success(`Alignment complete — reprojection error: ${data.reprojection_error?.toFixed(2)}px`);
      onAlignmentComplete?.(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Alignment failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="section-title flex items-center gap-2">
            <Target size={20} className="text-mq-400" />
            Manual Alignment
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Pick corresponding points in the frame (2D) and enter BIM coordinates (3D).
            Minimum 4 points required.
          </p>
        </div>
        {result && (
          <div className="badge badge-ahead flex items-center gap-1.5">
            <CheckCircle2 size={13} />
            Aligned — {result.reprojection_error?.toFixed(2)}px error
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ── Left: Frame with clickable overlay ──────────── */}
        <div className="card overflow-hidden">
          <div className="border-b border-slate-800 px-3 py-2 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">
              Frame — {activePointId ? `Click to place ${points.find(p => p.id === activePointId)?.label}` : "Select a point below, then click frame"}
            </span>
            <div className="flex items-center gap-1">
              {activePointId && (
                <span className="badge bg-mq-600/15 text-mq-400 border border-mq-600/30 animate-pulse-subtle">
                  <MousePointer2 size={11} className="mr-1" />
                  Picking
                </span>
              )}
            </div>
          </div>
          <div className="relative bg-slate-950">
            <img
              ref={imgRef}
              src={frameUrl}
              alt="Video frame"
              className={clsx(
                "w-full h-auto",
                activePointId && pickMode === "pixel" && "cursor-crosshair"
              )}
              onClick={handleImageClick}
              draggable={false}
            />
            {/* Render placed points on image */}
            {points.map((p, i) => {
              if (p.pixel_x === null || p.pixel_y === null || !imgRef.current) return null;
              const rect = imgRef.current.getBoundingClientRect();
              const displayX = (p.pixel_x / imageWidth) * 100;
              const displayY = (p.pixel_y / imageHeight) * 100;
              const color = POINT_COLORS[i % POINT_COLORS.length];

              return (
                <div
                  key={p.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                  style={{ left: `${displayX}%`, top: `${displayY}%` }}
                >
                  <div
                    className="h-4 w-4 rounded-full border-2 border-white shadow-lg"
                    style={{ backgroundColor: color }}
                  />
                  <span
                    className="absolute left-5 top-0 whitespace-nowrap rounded bg-slate-900/90 px-1.5 py-0.5 text-2xs font-medium"
                    style={{ color }}
                  >
                    {p.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right: Control points table ─────────────────── */}
        <div className="card flex flex-col">
          <div className="border-b border-slate-800 px-3 py-2 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">
              Control Points ({validPoints.length}/{points.length} complete)
            </span>
            <button onClick={addPoint} className="btn-ghost text-xs py-1 px-2">
              <Plus size={13} />
              Add Point
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {points.map((p, i) => {
              const color = POINT_COLORS[i % POINT_COLORS.length];
              const complete = isComplete(p);
              const isActive = activePointId === p.id;

              return (
                <div
                  key={p.id}
                  className={clsx(
                    "rounded-lg border p-3 transition-all text-xs",
                    isActive
                      ? "border-mq-500/50 bg-mq-600/5"
                      : complete
                      ? "border-signal-ahead/30 bg-signal-ahead/5"
                      : "border-slate-800 bg-slate-800/30"
                  )}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <input
                        className="bg-transparent text-sm font-medium text-white outline-none w-24"
                        value={p.label}
                        onChange={(e) => updatePoint(p.id, "label", e.target.value)}
                      />
                      {complete && <CheckCircle2 size={13} className="text-signal-ahead" />}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setActivePointId(isActive ? null : p.id);
                          setPickMode("pixel");
                        }}
                        className={clsx(
                          "rounded p-1 transition-colors",
                          isActive
                            ? "bg-mq-600/20 text-mq-400"
                            : "text-slate-500 hover:text-slate-300"
                        )}
                        title="Pick 2D point on frame"
                      >
                        <Target size={14} />
                      </button>
                      <button
                        onClick={() => removePoint(p.id)}
                        className="rounded p-1 text-slate-600 hover:text-signal-behind transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* 2D pixel coordinates */}
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <label className="text-2xs text-slate-500 mb-0.5 block">Pixel X</label>
                      <input
                        type="number"
                        className="input py-1 text-xs font-mono"
                        placeholder="px"
                        value={p.pixel_x ?? ""}
                        onChange={(e) => updatePoint(p.id, "pixel_x", e.target.value ? Number(e.target.value) : null)}
                      />
                    </div>
                    <div>
                      <label className="text-2xs text-slate-500 mb-0.5 block">Pixel Y</label>
                      <input
                        type="number"
                        className="input py-1 text-xs font-mono"
                        placeholder="px"
                        value={p.pixel_y ?? ""}
                        onChange={(e) => updatePoint(p.id, "pixel_y", e.target.value ? Number(e.target.value) : null)}
                      />
                    </div>
                  </div>

                  {/* 3D BIM coordinates */}
                  <div className="grid grid-cols-3 gap-2">
                    {(["bim_x", "bim_y", "bim_z"] as const).map((field) => (
                      <div key={field}>
                        <label className="text-2xs text-slate-500 mb-0.5 block">
                          BIM {field.split("_")[1].toUpperCase()}
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          className="input py-1 text-xs font-mono"
                          placeholder="m"
                          value={p[field] ?? ""}
                          onChange={(e) => updatePoint(p.id, field, e.target.value ? Number(e.target.value) : null)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="border-t border-slate-800 p-3 space-y-2">
            {!canSubmit && (
              <div className="flex items-center gap-2 text-xs text-signal-warning">
                <AlertTriangle size={13} />
                Need at least 4 complete points ({4 - validPoints.length} more)
              </div>
            )}
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="btn-primary w-full"
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  Computing alignment...
                </>
              ) : (
                <>
                  <Send size={15} />
                  Compute Alignment ({validPoints.length} points)
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
