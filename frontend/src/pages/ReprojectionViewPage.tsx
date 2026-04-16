/**
 * ReprojectionViewPage — BIM elements projected onto a video frame.
 *
 * Shows coloured polygon overlays on top of the actual site video frame,
 * colour-coded by deviation type (ahead/on_track/behind/not_started).
 * Click an element to see details. Toggle layers by category.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Layers,
  Eye,
  EyeOff,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Info,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import clsx from "clsx";
import { capturesApi, bimApi } from "@/services/api";

// ── Types ─────────────────────────────────────────────────────────────────

interface ProjectedElement {
  element_id: string;
  element_name: string;
  ifc_type: string;
  category: string;
  level: string;
  polygon_2d: [number, number][];
  deviation_type: string | null;
  observed_percent: number | null;
  scheduled_percent: number | null;
  confidence_score: number | null;
  narrative: string | null;
}

interface ReprojectionData {
  capture_id: string;
  alignment_method: string;
  reprojection_error: number | null;
  quality_grade: string | null;
  image_width: number;
  image_height: number;
  elements_total: number;
  elements_projected: number;
  projected_elements: ProjectedElement[];
}

// ── Colour helpers ────────────────────────────────────────────────────────

const DEVIATION_COLOURS: Record<string, { fill: string; stroke: string; label: string }> = {
  ahead:       { fill: "rgba(16,185,129,0.18)",  stroke: "#10b981", label: "Ahead" },
  on_track:    { fill: "rgba(59,130,246,0.18)",  stroke: "#3b82f6", label: "On Track" },
  behind:      { fill: "rgba(239,68,68,0.22)",   stroke: "#ef4444", label: "Behind" },
  not_started: { fill: "rgba(100,116,139,0.20)", stroke: "#64748b", label: "Not Started" },
  extra_work:  { fill: "rgba(245,158,11,0.20)",  stroke: "#f59e0b", label: "Extra Work" },
  no_data:     { fill: "rgba(58,80,107,0.15)",    stroke: "#3a506b", label: "No Data" },
};

function getColour(type: string | null) {
  return DEVIATION_COLOURS[type ?? "no_data"] ?? DEVIATION_COLOURS.no_data;
}

const QUALITY_META: Record<string, { cls: string; label: string }> = {
  good:       { cls: "text-emerald-400", label: "Good" },
  acceptable: { cls: "text-amber-400",   label: "Acceptable" },
  poor:       { cls: "text-red-400",     label: "Poor" },
};

// ── Canvas renderer ──────────────────────────────────────────────────────

function drawElements(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  elements: ProjectedElement[],
  visibleCategories: Set<string>,
  hoveredId: string | null,
  imgW: number,
  imgH: number,
  zoom: number,
  panX: number,
  panY: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Adjust canvas logical size
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw image scaled + panned
  const scaleX = (canvas.width / imgW) * zoom;
  const scaleY = (canvas.height / imgH) * zoom;
  const scale = Math.min(scaleX, scaleY);

  const offsetX = (canvas.width - imgW * scale) / 2 + panX;
  const offsetY = (canvas.height - imgH * scale) / 2 + panY;

  ctx.drawImage(img, offsetX, offsetY, imgW * scale, imgH * scale);

  // Draw element polygons
  for (const el of elements) {
    if (!visibleCategories.has(el.category)) continue;
    if (el.polygon_2d.length < 2) continue;

    const isHovered = el.element_id === hoveredId;
    const { fill, stroke } = getColour(el.deviation_type);

    ctx.beginPath();
    for (let i = 0; i < el.polygon_2d.length; i++) {
      const [px, py] = el.polygon_2d[i];
      const sx = px * scale + offsetX;
      const sy = py * scale + offsetY;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();

    ctx.fillStyle = isHovered ? fill.replace(/[\d.]+\)$/, "0.45)") : fill;
    ctx.fill();

    ctx.strokeStyle = isHovered ? stroke : stroke;
    ctx.lineWidth = isHovered ? 2.5 : 1.2;
    ctx.stroke();

    // Hovered: draw label
    if (isHovered) {
      const cx = el.polygon_2d.reduce((s, p) => s + p[0], 0) / el.polygon_2d.length * scale + offsetX;
      const cy = el.polygon_2d.reduce((s, p) => s + p[1], 0) / el.polygon_2d.length * scale + offsetY;

      const label = el.element_name.slice(0, 24);
      ctx.font = "bold 11px Inter, sans-serif";
      const tw = ctx.measureText(label).width;

      ctx.fillStyle = "rgba(15,23,42,0.85)";
      ctx.beginPath();
      ctx.roundRect(cx - tw / 2 - 6, cy - 16, tw + 12, 22, 4);
      ctx.fill();

      ctx.fillStyle = stroke;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, cx, cy - 5);
      ctx.textAlign = "left";
    }
  }
}

// ── Main component ────────────────────────────────────────────────────────

export default function ReprojectionViewPage() {
  const { projectId, captureId } = useParams<{ projectId: string; captureId: string }>();
  const [searchParams] = useSearchParams();
  const bimModelId = searchParams.get("bim_model_id") ?? "";
  const frameUrl = searchParams.get("frame_url") ?? "";

  const [data, setData] = useState<ReprojectionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Image
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Interaction
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedEl, setSelectedEl] = useState<ProjectedElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  // Layer visibility
  const allCategories = data
    ? Array.from(new Set(data.projected_elements.map((e) => e.category)))
    : [];
  const [visibleCategories, setVisibleCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (allCategories.length && visibleCategories.size === 0) {
      setVisibleCategories(new Set(allCategories));
    }
  }, [allCategories.join(",")]);

  // Load reprojection data
  const load = useCallback(async () => {
    if (!projectId || !captureId || !bimModelId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: d } = await capturesApi.getReprojection(projectId, captureId, bimModelId);
      setData(d as ReprojectionData);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Failed to load reprojection data");
    } finally {
      setLoading(false);
    }
  }, [projectId, captureId, bimModelId]);

  useEffect(() => { load(); }, [load]);

  // Preload image
  useEffect(() => {
    if (!frameUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = frameUrl;
    img.onload = () => {
      imgRef.current = img;
      setImgLoaded(true);
    };
    imgRef.current = img;
  }, [frameUrl]);

  // Redraw canvas whenever data/image/hover/zoom changes
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !data || !imgLoaded) return;

    const imgW = data.image_width || img.naturalWidth || 1920;
    const imgH = data.image_height || img.naturalHeight || 960;

    drawElements(canvas, img, data.projected_elements, visibleCategories, hoveredId, imgW, imgH, zoom, pan.x, pan.y);
  }, [data, imgLoaded, visibleCategories, hoveredId, zoom, pan]);

  // Mouse events on canvas
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning.current) {
      setPan((prev) => ({
        x: prev.x + e.clientX - lastMouse.current.x,
        y: prev.y + e.clientY - lastMouse.current.y,
      }));
      lastMouse.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (!data || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const imgW = data.image_width;
    const imgH = data.image_height;
    const scale = Math.min((canvas.offsetWidth / imgW) * zoom, (canvas.offsetHeight / imgH) * zoom);
    const offsetX = (canvas.offsetWidth - imgW * scale) / 2 + pan.x;
    const offsetY = (canvas.offsetHeight - imgH * scale) / 2 + pan.y;

    // Convert mouse to BIM pixel coords
    const bx = (mx - offsetX) / scale;
    const by = (my - offsetY) / scale;

    // Hit-test: find element whose polygon contains mouse
    let hit: string | null = null;
    for (const el of data.projected_elements) {
      if (!visibleCategories.has(el.category)) continue;
      if (pointInPolygon(bx, by, el.polygon_2d)) {
        hit = el.element_id;
        break;
      }
    }
    setHoveredId(hit);
    canvas.style.cursor = hit ? "pointer" : isPanning.current ? "grabbing" : "grab";
  }, [data, zoom, pan, visibleCategories]);

  const handleClick = useCallback(() => {
    if (!data || !hoveredId) return;
    const el = data.projected_elements.find((e) => e.element_id === hoveredId);
    setSelectedEl(el ?? null);
  }, [data, hoveredId]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || e.altKey) {
      isPanning.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.5, Math.min(5, z - e.deltaY * 0.001)));
  }, []);

  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // ── Counts by deviation type ───────────────────────────────────────────
  const counts = data
    ? data.projected_elements.reduce<Record<string, number>>((acc, el) => {
        const k = el.deviation_type ?? "no_data";
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {})
    : {};

  const quality = data?.quality_grade ? QUALITY_META[data.quality_grade] : null;

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-white">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <Link
            to={`/projects/${projectId}`}
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            Back to Project
          </Link>
          <span className="text-slate-700">|</span>
          <h1 className="text-sm font-semibold text-white">BIM Reprojection View</h1>
          {quality && (
            <span className={clsx("text-xs font-medium", quality.cls)}>
              Alignment: {quality.label}
              {data?.reprojection_error != null && (
                <span className="ml-1 text-slate-400">
                  ({data.reprojection_error.toFixed(1)}px error)
                </span>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom((z) => Math.min(5, z + 0.25))}
            className="btn-ghost p-2" title="Zoom in"
          >
            <ZoomIn size={15} />
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
            className="btn-ghost p-2" title="Zoom out"
          >
            <ZoomOut size={15} />
          </button>
          <button onClick={resetView} className="btn-ghost p-2" title="Reset view">
            <RotateCcw size={15} />
          </button>
          <button onClick={load} className="btn-ghost p-2" title="Refresh">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          <span className="text-xs text-slate-500">
            {zoom.toFixed(1)}×
          </span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Canvas ──────────────────────────────────────────────────── */}
        <div className="relative flex-1 bg-slate-950">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-3 text-slate-400">
                <RefreshCw size={28} className="animate-spin text-mq-400" />
                <span className="text-sm">Computing reprojection…</span>
              </div>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-3 max-w-sm text-center">
                <AlertTriangle size={28} className="text-amber-400" />
                <p className="text-sm text-slate-300">{error}</p>
                <Link to={`/projects/${projectId}`} className="btn-primary text-sm">
                  Go to Project
                </Link>
              </div>
            </div>
          )}
          {!frameUrl && !loading && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="text-center text-slate-500 text-sm">
                <Info size={24} className="mx-auto mb-2" />
                No frame URL provided. Navigate here from the capture panel.
              </div>
            </div>
          )}
          <canvas
            ref={canvasRef}
            className="h-full w-full"
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onClick={handleClick}
            onWheel={handleWheel}
          />

          {/* Zoom hint */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/70 px-3 py-1 text-2xs text-slate-500 pointer-events-none">
            Scroll to zoom · Alt+drag to pan · Click element for details
          </div>
        </div>

        {/* ── Right panel ─────────────────────────────────────────────── */}
        <aside className="flex w-72 flex-col border-l border-slate-800 bg-slate-900">
          {/* Stats */}
          <div className="border-b border-slate-800 p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Deviation Summary
            </h2>
            {Object.entries(DEVIATION_COLOURS).map(([key, meta]) => {
              const count = counts[key] ?? 0;
              if (count === 0 && key === "no_data") return null;
              return (
                <div key={key} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-sm border"
                      style={{ backgroundColor: meta.fill, borderColor: meta.stroke }}
                    />
                    <span className="text-xs text-slate-400">{meta.label}</span>
                  </div>
                  <span className="text-xs font-medium tabular-nums text-white">
                    {count}
                  </span>
                </div>
              );
            })}
            {data && (
              <p className="text-2xs text-slate-600 mt-1">
                {data.elements_projected} of {data.elements_total} elements projected
              </p>
            )}
          </div>

          {/* Layer toggles */}
          <div className="border-b border-slate-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Layers size={12} />
                Layers
              </h2>
              <div className="flex gap-1">
                <button
                  onClick={() => setVisibleCategories(new Set(allCategories))}
                  className="text-2xs text-mq-400 hover:text-mq-300"
                >
                  All
                </button>
                <span className="text-slate-700">·</span>
                <button
                  onClick={() => setVisibleCategories(new Set())}
                  className="text-2xs text-slate-500 hover:text-slate-300"
                >
                  None
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              {allCategories.map((cat) => {
                const visible = visibleCategories.has(cat);
                return (
                  <button
                    key={cat}
                    onClick={() => {
                      setVisibleCategories((prev) => {
                        const next = new Set(prev);
                        if (next.has(cat)) next.delete(cat);
                        else next.add(cat);
                        return next;
                      });
                    }}
                    className={clsx(
                      "flex w-full items-center justify-between rounded px-2 py-1 text-xs transition-colors",
                      visible
                        ? "bg-slate-800 text-white"
                        : "text-slate-600 hover:text-slate-400"
                    )}
                  >
                    <span className="capitalize">{cat.replace("_", " ")}</span>
                    {visible ? (
                      <Eye size={12} className="text-slate-400" />
                    ) : (
                      <EyeOff size={12} className="text-slate-600" />
                    )}
                  </button>
                );
              })}
              {allCategories.length === 0 && (
                <p className="text-2xs text-slate-600">No elements projected yet</p>
              )}
            </div>
          </div>

          {/* Selected element detail */}
          <div className="flex-1 overflow-y-auto p-4">
            {selectedEl ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Element Detail
                  </h2>
                  <button
                    onClick={() => setSelectedEl(null)}
                    className="text-slate-600 hover:text-white text-xs"
                  >
                    ✕
                  </button>
                </div>

                <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3 space-y-2">
                  <div>
                    <p className="text-sm font-semibold text-white truncate">
                      {selectedEl.element_name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {selectedEl.ifc_type} · {selectedEl.level}
                    </p>
                  </div>

                  {selectedEl.deviation_type ? (
                    <>
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2.5 w-2.5 rounded-sm"
                          style={{
                            backgroundColor: DEVIATION_COLOURS[selectedEl.deviation_type]?.stroke ?? "#475569",
                          }}
                        />
                        <span
                          className="text-xs font-medium capitalize"
                          style={{ color: DEVIATION_COLOURS[selectedEl.deviation_type]?.stroke ?? "#94a3b8" }}
                        >
                          {DEVIATION_COLOURS[selectedEl.deviation_type]?.label ?? selectedEl.deviation_type}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <p className="text-slate-500">Observed</p>
                          <p className="font-semibold text-white">
                            {selectedEl.observed_percent?.toFixed(0) ?? "—"}%
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500">Scheduled</p>
                          <p className="font-semibold text-white">
                            {selectedEl.scheduled_percent?.toFixed(0) ?? "—"}%
                          </p>
                        </div>
                      </div>

                      {/* Progress bar showing gap */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-2xs text-slate-500">
                          <span>Observed</span>
                          <span>{selectedEl.observed_percent?.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-700 overflow-hidden relative">
                          {/* Scheduled bar (background) */}
                          <div
                            className="absolute inset-y-0 left-0 rounded-full bg-slate-600"
                            style={{ width: `${selectedEl.scheduled_percent ?? 0}%` }}
                          />
                          {/* Observed bar (foreground) */}
                          <div
                            className="absolute inset-y-0 left-0 rounded-full transition-all"
                            style={{
                              width: `${selectedEl.observed_percent ?? 0}%`,
                              backgroundColor:
                                DEVIATION_COLOURS[selectedEl.deviation_type]?.stroke ?? "#64748b",
                            }}
                          />
                        </div>
                        <div className="flex justify-between text-2xs text-slate-500">
                          <span>Scheduled</span>
                          <span>{selectedEl.scheduled_percent?.toFixed(1)}%</span>
                        </div>
                      </div>

                      {selectedEl.confidence_score != null && (
                        <p className="text-2xs text-slate-500">
                          Confidence: {(selectedEl.confidence_score * 100).toFixed(0)}%
                        </p>
                      )}

                      {selectedEl.narrative && (
                        <div className="rounded bg-slate-700/50 p-2">
                          <p className="text-2xs text-slate-300 leading-relaxed">
                            {selectedEl.narrative}
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-slate-500">
                      No progress data for this element
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center text-slate-600 gap-2">
                <Info size={20} />
                <p className="text-xs">Click an element on the canvas to view details</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── Geometry helpers ──────────────────────────────────────────────────────

function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
