import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Layers,
  Eye,
  EyeOff,
  Box,
  ChevronRight,
  RotateCcw,
  Maximize2,
  Grid3X3,
  Info,
  X,
  Search,
  Palette,
  Activity,
  Columns,
  GitBranch,
  Hexagon,
  AlertCircle,
  Flame,
} from "lucide-react";
import clsx from "clsx";
import type * as THREE from "three";
import toast from "react-hot-toast";
import { bimApi, progressApi, capturesApi } from "@/services/api";
import type { BIMElement, BIMModel, BIMModelInfo, ElementCategory, ProgressItem, VideoCapture, DeviationType } from "@/types";
import {
  buildFakeSchedule,
  delayedElementIds as deriveDelayedIds,
  predictedDelayChain,
} from "@/utils/fakeBimDelays";
import TimelineSlider from "@/components/bim/TimelineSlider";
import ElementInsightPanel from "@/components/bim/ElementInsightPanel";

// IFC type constant → category hex color (constants verified from web-ifc package)
// This lets the viewer render distinct colors even when DB element matching fails.
const IFC_TYPE_COLORS: Record<number, string> = {
  2391406946: "#64748b",  // IFCWALL
  3512223829: "#64748b",  // IFCWALLSTANDARDCASE
  1529196076: "#8b5cf6",  // IFCSLAB
  843113511:  "#f59e0b",  // IFCCOLUMN
  753842376:  "#ef4444",  // IFCBEAM
  395920057:  "#10b981",  // IFCDOOR
  3304561284: "#06b6d4",  // IFCWINDOW
  331165859:  "#ec4899",  // IFCSTAIR
  4252922144: "#ec4899",  // IFCSTAIRFLIGHT
  2262370178: "#78716c",  // IFCRAILING
  1973544240: "#a78bfa",  // IFCCOVERING
  3495092785: "#38bdf8",  // IFCCURTAINWALL
  3171933400: "#94a3b8",  // IFCPLATE
  1073191201: "#94a3b8",  // IFCMEMBER
  900683007:  "#d97706",  // IFCFOOTING
  2016517767: "#6366f1",  // IFCROOF
  3024970846: "#14b8a6",  // IFCRAMP
  3283111854: "#14b8a6",  // IFCRAMPFLIGHT
};

// Category color map for the 3D viewer and UI
const CATEGORY_COLORS: Record<ElementCategory, { hex: string; label: string }> = {
  wall: { hex: "#64748b", label: "Walls" },
  slab: { hex: "#8b5cf6", label: "Slabs" },
  column: { hex: "#f59e0b", label: "Columns" },
  beam: { hex: "#ef4444", label: "Beams" },
  door: { hex: "#10b981", label: "Doors" },
  window: { hex: "#06b6d4", label: "Windows" },
  stair: { hex: "#ec4899", label: "Stairs" },
  railing: { hex: "#78716c", label: "Railings" },
  ceiling: { hex: "#a78bfa", label: "Ceilings" },
  curtain_wall: { hex: "#38bdf8", label: "Curtain Walls" },
  mep: { hex: "#22c55e", label: "MEP" },
  furniture: { hex: "#d97706", label: "Furniture" },
  other: { hex: "#94a3b8", label: "Other" },
};

// Deviation color map for progress coloring mode
const DEVIATION_COLORS: Record<DeviationType, { hex: string; label: string }> = {
  ahead: { hex: "#10b981", label: "Ahead" },
  on_track: { hex: "#3b82f6", label: "On Track" },
  behind: { hex: "#ef4444", label: "Behind" },
  not_started: { hex: "#64748b", label: "Not Started" },
  extra_work: { hex: "#f59e0b", label: "Extra Work" },
};
const NO_PROGRESS_COLOR = "#3a506b";

type ColorMode = "category" | "progress";

export default function BIMViewerPage() {
  const { projectId, modelId } = useParams<{ projectId: string; modelId: string }>();
  const [model, setModel] = useState<BIMModel | null>(null);
  const [elements, setElements] = useState<BIMElement[]>([]);
  const [selectedElement, setSelectedElement] = useState<BIMElement | null>(null);
  const [levels, setLevels] = useState<string[]>([]);
  const [visibleLevels, setVisibleLevels] = useState<Set<string>>(new Set());
  const [visibleCategories, setVisibleCategories] = useState<Set<ElementCategory>>(
    new Set(Object.keys(CATEGORY_COLORS) as ElementCategory[])
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [showSidebar, setShowSidebar] = useState(true);
  const [loading, setLoading] = useState(true);

  // Week 6 state
  const [colorMode, setColorMode] = useState<ColorMode>("category");
  const [progressData, setProgressData] = useState<ProgressItem[]>([]);
  const [captures, setCaptures] = useState<VideoCapture[]>([]);
  const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
  const [showTrajectory, setShowTrajectory] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [highlightDelays, setHighlightDelays] = useState(false);

  // Phase 4: mesh rendering state
  const [renderMode, setRenderMode] = useState<RenderMode>("mesh");
  const [modelInfo, setModelInfo] = useState<BIMModelInfo | null>(null);
  const [ifcFileUrl, setIfcFileUrl] = useState<string | null>(null);
  const [reparsing, setReparsing] = useState(false);
  // Set when mesh-mode fetch returns 404 (file lost on server restart)
  const [meshFileNotFound, setMeshFileNotFound] = useState(false);

  // Stable ref so the Three.js animation loop can read the latest
  // selectedElement without re-running the entire scene-init effect.
  const selectedElementRef = useRef<BIMElement | null>(null);
  useEffect(() => { selectedElementRef.current = selectedElement; }, [selectedElement]);

  // Load model + elements
  useEffect(() => {
    if (!projectId || !modelId) return;

    const load = async () => {
      setLoading(true);
      try {
        const { data: elData } = await bimApi.listElements(projectId, modelId, { limit: 5000 });
        setElements(elData.items);

        // Extract unique levels
        const lvls = [...new Set(elData.items.map((e) => e.level).filter(Boolean))].sort();
        setLevels(lvls);
        setVisibleLevels(new Set(lvls));
      } catch (err) {
        console.error("Failed to load elements:", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [projectId, modelId]);

  // Phase 4: Load model info and set up IFC file URL for mesh rendering
  useEffect(() => {
    if (!projectId || !modelId) return;
    bimApi.getModelInfo(projectId, modelId).then(({ data }) => {
      setModelInfo(data);
      // Mesh mode renders via web-ifc in the browser, so it works even when
      // backend geometry_bbox is empty. Only fall back to bbox for very large
      // files (>200MB) where parsing in-browser would freeze the tab.
      if (data.file_size_mb > 200) {
        setRenderMode("bbox");
      }
      setIfcFileUrl(bimApi.getFileUrl(projectId, modelId));
    }).catch(() => {
      // If we can't even get model info, try mesh anyway via the file URL —
      // the backend might be returning partial data.
      setIfcFileUrl(bimApi.getFileUrl(projectId, modelId));
    });
  }, [projectId, modelId]);

  // Load captures list for progress data — prefer the most recent "compared" capture
  useEffect(() => {
    if (!projectId) return;
    capturesApi.list(projectId).then(({ data }) => {
      setCaptures(data);
      if (data.length > 0) {
        const compared = data.find((c) => c.status === "compared");
        setSelectedCaptureId((compared ?? data[0]).id);
      }
    }).catch(() => {});
  }, [projectId]);

  // Load progress data when capture is selected
  useEffect(() => {
    if (!projectId || !selectedCaptureId) return;
    progressApi.list(projectId, selectedCaptureId).then(({ data }) => {
      setProgressData(data);
    }).catch(() => setProgressData([]));
  }, [projectId, selectedCaptureId]);

  // Build element_id -> ProgressItem lookup
  const progressByElementId = useMemo(() => {
    const map = new Map<string, ProgressItem>();
    progressData.forEach((p) => map.set(p.element_id, p));
    return map;
  }, [progressData]);

  // Fake-but-deterministic schedule data — used until real progress + critical
  // path analytics surface per-element planned/actual %. Drives the red-pulse
  // delay highlight, the schedule status panel, and the predicted delay chain.
  const fakeSchedule = useMemo(() => buildFakeSchedule(elements), [elements]);
  const delayedIds   = useMemo(() => deriveDelayedIds(fakeSchedule), [fakeSchedule]);
  const delayChain   = useMemo(
    () => predictedDelayChain(elements, fakeSchedule, 8),
    [elements, fakeSchedule],
  );

  const toggleLevel = (level: string) => {
    setVisibleLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  const toggleCategory = (cat: ElementCategory) => {
    setVisibleCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // Filter elements for the element list
  const filteredElements = elements.filter((el) => {
    if (!visibleLevels.has(el.level) && el.level) return false;
    if (!visibleCategories.has(el.category)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        el.name.toLowerCase().includes(q) ||
        el.ifc_type.toLowerCase().includes(q) ||
        el.ifc_guid.toLowerCase().includes(q) ||
        el.material.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Group elements by category for summary
  const categoryCounts = elements.reduce(
    (acc, el) => {
      acc[el.category] = (acc[el.category] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // Detect "no geometry" state: elements loaded but none have bboxes.
  // Bbox mode cannot render anything; mesh mode still works if ifcFileUrl loads.
  const hasAnyBbox = useMemo(
    () => elements.some((el) => el.geometry_bbox != null),
    [elements],
  );
  const noGeometry = !loading && elements.length > 0 && !hasAnyBbox;

  const handleReparse = useCallback(async () => {
    if (!projectId || !modelId || reparsing) return;
    setReparsing(true);
    try {
      await bimApi.reparse(projectId, modelId);
      setMeshFileNotFound(false);
      toast.success("Re-parse scheduled. Refresh in a minute to see results.");
    } catch (err: unknown) {
      // Extract FastAPI detail from Axios response if available
      const axiosDetail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      const msg = axiosDetail ?? (err instanceof Error ? err.message : "Re-parse failed");
      toast.error(msg);
    } finally {
      setReparsing(false);
    }
  }, [projectId, modelId, reparsing]);

  return (
    <div className="flex h-screen w-screen fixed inset-0 z-50">
      {/* ── Left Panel: Levels + Categories ─────────────────── */}
        {showSidebar && (
          <div
            style={{ width: 280, minWidth: 280 }}
            className="flex flex-col overflow-hidden border-r border-slate-800 bg-slate-950"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <h2 className="text-sm font-semibold text-white font-display">Model Explorer</h2>
              <button onClick={() => setShowSidebar(false)} className="text-slate-500 hover:text-slate-300">
                <X size={16} />
              </button>
            </div>

            {/* Search */}
            <div className="border-b border-slate-800 px-3 py-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  className="input py-1.5 pl-8 text-xs"
                  placeholder="Search elements..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Levels section */}
              <div className="border-b border-slate-800 p-3">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                  Levels ({levels.length})
                </h3>
                <div className="space-y-0.5">
                  {levels.map((level) => (
                    <button
                      key={level}
                      onClick={() => toggleLevel(level)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-slate-800/50"
                    >
                      {visibleLevels.has(level) ? (
                        <Eye size={13} className="text-mq-400" />
                      ) : (
                        <EyeOff size={13} className="text-slate-600" />
                      )}
                      <span
                        className={clsx(
                          "truncate",
                          visibleLevels.has(level) ? "text-slate-200" : "text-slate-500"
                        )}
                      >
                        {level}
                      </span>
                      <span className="ml-auto text-2xs text-slate-600">
                        {elements.filter((e) => e.level === level).length}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Categories section */}
              <div className="p-3">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                  Categories
                </h3>
                <div className="space-y-0.5">
                  {(Object.keys(CATEGORY_COLORS) as ElementCategory[])
                    .filter((cat) => categoryCounts[cat])
                    .map((cat) => (
                      <button
                        key={cat}
                        onClick={() => toggleCategory(cat)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-slate-800/50"
                      >
                        <div
                          className="h-3 w-3 rounded-sm border"
                          style={{
                            backgroundColor: visibleCategories.has(cat)
                              ? CATEGORY_COLORS[cat].hex
                              : "transparent",
                            borderColor: CATEGORY_COLORS[cat].hex,
                            opacity: visibleCategories.has(cat) ? 1 : 0.3,
                          }}
                        />
                        <span
                          className={clsx(
                            "truncate",
                            visibleCategories.has(cat) ? "text-slate-200" : "text-slate-500"
                          )}
                        >
                          {CATEGORY_COLORS[cat].label}
                        </span>
                        <span className="ml-auto text-2xs text-slate-600">
                          {categoryCounts[cat] || 0}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            </div>

            {/* Element list */}
            <div className="border-t border-slate-800">
              <div className="px-3 py-2">
                <h3 className="text-xs font-medium text-slate-500">
                  Elements ({filteredElements.length})
                </h3>
              </div>
              <div className="h-48 overflow-y-auto px-1">
                {filteredElements.slice(0, 200).map((el) => (
                  <button
                    key={el.id}
                    onClick={() => setSelectedElement(el)}
                    className={clsx(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                      selectedElement?.id === el.id
                        ? "bg-mq-600/15 text-mq-400"
                        : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
                    )}
                  >
                    <div
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: CATEGORY_COLORS[el.category]?.hex || "#94a3b8" }}
                    />
                    <span className="truncate">{el.name || el.ifc_type}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

      {/* ── Center: 3D Viewport ─────────────────────────────── */}
      <div className={clsx("relative flex-1 bg-slate-950", showComparison && "flex")}>
        {/* Main 3D panel */}
        <div className={clsx("relative overflow-hidden", showComparison ? "w-1/2 border-r border-slate-700" : "w-full h-full")}>
          {/* Toolbar */}
          <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
            {!showSidebar && (
              <button onClick={() => setShowSidebar(true)} className="btn-secondary py-2 px-3 text-xs">
                <Layers size={14} />
                Explorer
              </button>
            )}
            <Link
              to={projectId ? `/projects/${projectId}` : "/projects"}
              className="btn-secondary py-2 px-3 text-xs"
            >
              <ArrowLeft size={14} />
              Back
            </Link>
          </div>

          {/* View controls */}
          <div className="absolute right-4 top-4 z-10 flex flex-col gap-1.5">
            <button className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800/80 text-slate-400 backdrop-blur-sm transition-colors hover:text-white"
              title="Reset view">
              <RotateCcw size={15} />
            </button>
            <button className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800/80 text-slate-400 backdrop-blur-sm transition-colors hover:text-white"
              title="Fit to view">
              <Maximize2 size={15} />
            </button>
            <button className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800/80 text-slate-400 backdrop-blur-sm transition-colors hover:text-white"
              title="Toggle grid">
              <Grid3X3 size={15} />
            </button>
            {/* Week 6: Color mode toggle */}
            <button
              onClick={() => setColorMode((m) => (m === "category" ? "progress" : "category"))}
              className={clsx(
                "flex h-9 w-9 items-center justify-center rounded-lg border backdrop-blur-sm transition-colors",
                colorMode === "progress"
                  ? "border-mq-500 bg-mq-600/20 text-mq-400"
                  : "border-slate-700 bg-slate-800/80 text-slate-400 hover:text-white"
              )}
              title={colorMode === "category" ? "Switch to progress coloring" : "Switch to category coloring"}
            >
              <Palette size={15} />
            </button>
            {/* Week 6: Camera trajectory toggle */}
            <button
              onClick={() => setShowTrajectory((v) => !v)}
              className={clsx(
                "flex h-9 w-9 items-center justify-center rounded-lg border backdrop-blur-sm transition-colors",
                showTrajectory
                  ? "border-mq-500 bg-mq-600/20 text-mq-400"
                  : "border-slate-700 bg-slate-800/80 text-slate-400 hover:text-white"
              )}
              title="Toggle camera trajectory"
            >
              <GitBranch size={15} />
            </button>
            {/* Week 6: Side-by-side comparison toggle */}
            <button
              onClick={() => setShowComparison((v) => !v)}
              className={clsx(
                "flex h-9 w-9 items-center justify-center rounded-lg border backdrop-blur-sm transition-colors",
                showComparison
                  ? "border-mq-500 bg-mq-600/20 text-mq-400"
                  : "border-slate-700 bg-slate-800/80 text-slate-400 hover:text-white"
              )}
              title="Toggle side-by-side comparison"
            >
              <Columns size={15} />
            </button>
            {/* Phase 4: Mesh / Bbox render mode toggle */}
            <button
              onClick={() => setRenderMode((m) => (m === "mesh" ? "bbox" : "mesh"))}
              className={clsx(
                "flex h-9 w-9 items-center justify-center rounded-lg border backdrop-blur-sm transition-colors",
                renderMode === "mesh"
                  ? "border-emerald-500 bg-emerald-600/20 text-emerald-400"
                  : "border-slate-700 bg-slate-800/80 text-slate-400 hover:text-white"
              )}
              title={renderMode === "mesh" ? "IFC mesh mode (click for bbox)" : "Bbox mode (click for IFC mesh)"}
            >
              <Hexagon size={15} />
            </button>
            {/* Delay highlight toggle — pulses delayed elements red */}
            <button
              onClick={() => setHighlightDelays((v) => !v)}
              className={clsx(
                "flex h-9 w-9 items-center justify-center rounded-lg border backdrop-blur-sm transition-colors",
                highlightDelays
                  ? "border-red-500 bg-red-600/20 text-red-400"
                  : "border-slate-700 bg-slate-800/80 text-slate-400 hover:text-white"
              )}
              title={highlightDelays
                ? `Highlighting ${delayedIds.size} delayed elements (click to disable)`
                : "Highlight delayed elements"}
            >
              <Flame size={15} />
            </button>
          </div>

          {/* 3D Canvas — extended with progress data + color mode + mesh rendering */}
          <IFCViewerCanvas
            elements={filteredElements}
            selectedElementRef={selectedElementRef}
            colorMode={colorMode}
            progressByElementId={progressByElementId}
            showTrajectory={showTrajectory}
            renderMode={renderMode}
            ifcFileUrl={ifcFileUrl}
            delayedElementIds={delayedIds}
            highlightDelays={highlightDelays}
            onFileNotFound={() => setMeshFileNotFound(true)}
          />

          {/* Bottom timeline slider */}
          {!showComparison && (
            <TimelineSlider
              captures={captures}
              selectedCaptureId={selectedCaptureId}
              onSelectCapture={setSelectedCaptureId}
            />
          )}

          {/* No-geometry banner — backend bbox is empty for all elements */}
          {noGeometry && (
            <div className="absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-lg border border-red-500/40 bg-red-950/90 px-4 py-3 text-xs text-red-200 backdrop-blur-sm flex items-center gap-3 shadow-xl">
              <AlertCircle size={14} className="shrink-0" />
              <div>
                <div className="font-semibold">No geometry parsed for this model</div>
                <div className="mt-0.5 text-red-300/80">
                  Bbox mode has nothing to render. Try mesh mode, or re-parse the IFC file.
                </div>
              </div>
              <button
                onClick={() => setRenderMode("mesh")}
                className="rounded px-2.5 py-1 text-xs bg-slate-700/60 hover:bg-slate-700 text-slate-100 border border-slate-600"
              >
                Try mesh mode
              </button>
              <button
                onClick={handleReparse}
                disabled={reparsing}
                className="rounded px-2.5 py-1 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-100 border border-red-500/50 disabled:opacity-50"
              >
                {reparsing ? "Re-parsing…" : "Re-parse IFC"}
              </button>
            </div>
          )}

          {/* IFC file not found on server — lost after Railway restart */}
          {meshFileNotFound && (
            <div className="absolute left-1/2 top-16 z-20 -translate-x-1/2 w-max max-w-sm rounded-lg border border-amber-500/40 bg-amber-950/95 px-4 py-3 text-xs text-amber-200 backdrop-blur-sm flex items-center gap-3 shadow-xl">
              <AlertCircle size={14} className="shrink-0 text-amber-400" />
              <div>
                <div className="font-semibold text-amber-300">IFC file not found on server</div>
                <div className="mt-0.5 text-amber-200/70">
                  The file was lost after a server restart. Re-upload it from the project page.
                </div>
              </div>
              <Link
                to={projectId ? `/projects/${projectId}` : "/projects"}
                className="shrink-0 rounded px-2.5 py-1 text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 border border-amber-500/40 transition-colors"
              >
                Go to project
              </Link>
            </div>
          )}

          {/* Mock/simulated data warning banner */}
          {colorMode === "progress" && progressData.length > 0 &&
            progressData.some((p) => p.narrative.startsWith("[SIMULATED]") || p.narrative.startsWith("Mock:")) && (
            <div className="absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-lg border border-amber-500/30 bg-amber-950/80 px-4 py-2.5 text-xs text-amber-300 backdrop-blur-sm flex items-center gap-2">
              <AlertCircle size={13} className="shrink-0" />
              <span>
                <span className="font-semibold">Simulated data</span> — progress values are mock-generated, not from real CV analysis.
              </span>
            </div>
          )}

          {/* No-progress-data warning banner */}
          {colorMode === "progress" && progressData.length === 0 && (
            <div className="absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-lg border border-amber-500/30 bg-amber-950/80 px-4 py-2.5 text-xs text-amber-300 backdrop-blur-sm flex items-center gap-2">
              <Activity size={13} className="shrink-0" />
              No progress data linked. Process a video capture first to see element-level progress.
              <button
                onClick={() => setColorMode("category")}
                className="ml-2 rounded px-2 py-0.5 text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40"
              >
                Back to categories
              </button>
            </div>
          )}

          {/* Progress legend (bottom-right, only in progress mode) */}
          {colorMode === "progress" && (
            <div className="absolute bottom-14 right-4 z-10 rounded-lg border border-slate-700 bg-slate-900/90 p-3 backdrop-blur-sm">
              <h4 className="mb-2 text-xs font-medium text-slate-300">Progress Legend</h4>
              <div className="space-y-1.5">
                {(Object.keys(DEVIATION_COLORS) as DeviationType[]).map((dt) => (
                  <div key={dt} className="flex items-center gap-2 text-xs">
                    <div
                      className="h-3 w-3 rounded-sm"
                      style={{ backgroundColor: DEVIATION_COLORS[dt].hex }}
                    />
                    <span className="text-slate-300">{DEVIATION_COLORS[dt].label}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 text-xs">
                  <div
                    className="h-3 w-3 rounded-sm"
                    style={{ backgroundColor: NO_PROGRESS_COLOR, opacity: 0.5 }}
                  />
                  <span className="text-slate-500">No Data</span>
                </div>
              </div>
            </div>
          )}

          {/* Bottom status bar */}
          <div className="absolute bottom-4 left-4 right-4 z-10 flex items-center justify-between">
            <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-400 backdrop-blur-sm">
              <span>{elements.length} elements</span>
              <span className="text-slate-700">|</span>
              <span>{filteredElements.length} visible</span>
              <span className="text-slate-700">|</span>
              <span>{levels.length} levels</span>
              {colorMode === "progress" && (
                <>
                  <span className="text-slate-700">|</span>
                  <span className="text-mq-400">{progressData.length} tracked</span>
                </>
              )}
              <span className="text-slate-700">|</span>
              <span className={renderMode === "mesh" ? "text-emerald-400" : "text-slate-400"}>
                {renderMode === "mesh" ? "Mesh" : "Bbox"}
                {modelInfo && ` (${modelInfo.file_size_mb}MB)`}
              </span>
            </div>
          </div>
        </div>

        {/* ── Side-by-side comparison panel (Week 6) ────────── */}
        {showComparison && (
          <div className="relative flex w-1/2 flex-col bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <h3 className="text-sm font-semibold text-white font-display">Comparison View</h3>
              <button onClick={() => setShowComparison(false)} className="text-slate-500 hover:text-slate-300">
                <X size={16} />
              </button>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
              {/* Observed (frame image) placeholder */}
              <div className="w-full flex-1 rounded-lg border border-slate-700 bg-slate-900/50 flex flex-col items-center justify-center">
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                  Observed (Camera Frame)
                </div>
                <div className="flex h-40 w-64 items-center justify-center rounded-md border border-dashed border-slate-700 text-xs text-slate-600">
                  Frame image will appear here once a capture is processed
                </div>
                {captures.length > 0 && (
                  <div className="mt-3">
                    <select
                      className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300"
                      value={selectedCaptureId || ""}
                      onChange={(e) => setSelectedCaptureId(e.target.value)}
                    >
                      {captures.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.filename}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              {/* Expected (BIM rendering) placeholder */}
              <div className="w-full flex-1 rounded-lg border border-slate-700 bg-slate-900/50 flex flex-col items-center justify-center">
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                  Expected (BIM Rendering)
                </div>
                <div className="flex h-40 w-64 items-center justify-center rounded-md border border-dashed border-slate-700 text-xs text-slate-600">
                  BIM rendering will appear here from the comparison pipeline
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Right Panel: Properties ─────────────────────────── */}
      <AnimatePresence>
        {selectedElement && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col overflow-hidden border-l border-slate-800 bg-slate-925"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <h2 className="text-sm font-semibold text-white font-display">Properties</h2>
              <button
                onClick={() => setSelectedElement(null)}
                className="text-slate-500 hover:text-slate-300"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Schedule status + evidence + predicted delay chain */}
              <ElementInsightPanel
                element={selectedElement}
                schedule={fakeSchedule.get(selectedElement.id)}
                delayChain={delayChain}
                onSelectElement={setSelectedElement}
              />

              {/* Identity */}
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                  Identity
                </h3>
                <div className="space-y-1.5">
                  <PropRow label="Name" value={selectedElement.name || "—"} />
                  <PropRow label="IFC Type" value={selectedElement.ifc_type} />
                  <PropRow label="GUID" value={selectedElement.ifc_guid} mono />
                  <PropRow
                    label="Category"
                    value={
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: CATEGORY_COLORS[selectedElement.category]?.hex }}
                        />
                        {CATEGORY_COLORS[selectedElement.category]?.label}
                      </span>
                    }
                  />
                </div>
              </div>

              {/* Location */}
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                  Location
                </h3>
                <div className="space-y-1.5">
                  <PropRow label="Level" value={selectedElement.level || "—"} />
                  <PropRow label="Zone" value={selectedElement.zone || "—"} />
                </div>
              </div>

              {/* Material */}
              {selectedElement.material && (
                <div>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                    Material
                  </h3>
                  <PropRow label="Primary" value={selectedElement.material} />
                </div>
              )}

              {/* Geometry */}
              {selectedElement.geometry_bbox && (
                <div>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                    Bounding Box
                  </h3>
                  <div className="rounded-lg bg-slate-800/40 p-3 font-mono text-xs text-slate-300 space-y-1">
                    <div>
                      Min: [{selectedElement.geometry_bbox.min.map((v) => v.toFixed(2)).join(", ")}]
                    </div>
                    <div>
                      Max: [{selectedElement.geometry_bbox.max.map((v) => v.toFixed(2)).join(", ")}]
                    </div>
                  </div>
                </div>
              )}

              {/* Quantities */}
              {Object.keys(selectedElement.quantity_data).length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                    Quantities
                  </h3>
                  <div className="space-y-1.5">
                    {Object.entries(selectedElement.quantity_data).map(([key, val]) => (
                      <PropRow key={key} label={key} value={typeof val === "number" ? val.toFixed(2) : String(val)} />
                    ))}
                  </div>
                </div>
              )}

              {/* Properties */}
              {Object.keys(selectedElement.properties).length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                    IFC Properties
                  </h3>
                  {Object.entries(selectedElement.properties).map(([psetName, psetVals]) => (
                    <details key={psetName} className="group mb-2">
                      <summary className="cursor-pointer rounded-md px-2 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800/50">
                        <span className="ml-1">{psetName}</span>
                      </summary>
                      <div className="mt-1 space-y-1 pl-3">
                        {Object.entries(psetVals as Record<string, unknown>).map(([k, v]) => (
                          <PropRow key={k} label={k} value={String(v ?? "—")} />
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Property row ────────────────────────────────────────────────────────

function PropRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-xs">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span
        className={clsx(
          "text-right text-slate-200 break-all",
          mono && "font-mono text-2xs"
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ── 3D Viewer Canvas ────────────────────────────────────────────────────

type RenderMode = "mesh" | "bbox";

function IFCViewerCanvas({
  elements,
  selectedElementRef,
  colorMode = "category",
  progressByElementId = new Map(),
  showTrajectory = false,
  renderMode = "mesh",
  ifcFileUrl,
  delayedElementIds,
  highlightDelays = false,
  onFileNotFound,
}: {
  elements: BIMElement[];
  selectedElementRef: React.RefObject<BIMElement | null>;
  colorMode?: ColorMode;
  progressByElementId?: Map<string, ProgressItem>;
  showTrajectory?: boolean;
  renderMode?: RenderMode;
  ifcFileUrl?: string | null;
  delayedElementIds?: Set<string>;
  highlightDelays?: boolean;
  onFileNotFound?: () => void;
}) {
  // Stable refs so the animation loop sees latest values without re-init
  const delayedIdsRef = useRef<Set<string>>(delayedElementIds ?? new Set());
  const highlightDelaysRef = useRef<boolean>(highlightDelays);
  useEffect(() => { delayedIdsRef.current = delayedElementIds ?? new Set(); }, [delayedElementIds]);
  useEffect(() => { highlightDelaysRef.current = highlightDelays; }, [highlightDelays]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    let animId: number;
    const canvas = canvasRef.current;

    const initViewer = async () => {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x080e1a);

      // IFC content root — rotated -90° around X so IFC Z-up becomes
      // Three.js Y-up. This is a *proper rotation* (preserves winding order
      // and normals), unlike the per-vertex swap the viewer used to do
      // (which was a reflection — broke lighting + didn't compose correctly
      // with the IFC placement matrix).
      const ifcRoot = new THREE.Group();
      ifcRoot.rotation.x = -Math.PI / 2;
      scene.add(ifcRoot);

      // Ambient + directional lights
      scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
      dirLight.position.set(50, 100, 50);
      dirLight.castShadow = true;
      scene.add(dirLight);
      const fillLight = new THREE.DirectionalLight(0xb0c4ff, 0.25);
      fillLight.position.set(-60, 30, -40);
      scene.add(fillLight);

      // Grid — added *after* we know model extent (see bottom of init)
      let grid: THREE.GridHelper | null = null;

      // Camera
      const camera = new THREE.PerspectiveCamera(
        55,
        canvas.clientWidth / canvas.clientHeight,
        0.1,
        2000
      );
      camera.position.set(30, 40, 50);

      // Renderer
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;

      // Controls
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.minDistance = 5;
      controls.maxDistance = 500;
      controls.target.set(0, 10, 0);

      const meshes: THREE.Mesh[] = [];
      const elementMeshMap = new Map<string, THREE.Mesh>();

      // Helper: resolve element color based on current color mode
      const hasAnyProgressData = progressByElementId.size > 0;
      const getElementColor = (el: BIMElement): { hex: string; opacity: number } => {
        if (colorMode === "progress") {
          if (!hasAnyProgressData) {
            return { hex: CATEGORY_COLORS[el.category]?.hex || "#94a3b8", opacity: 0.3 };
          }
          const prog = progressByElementId.get(el.id);
          if (prog) {
            return { hex: DEVIATION_COLORS[prog.deviation_type]?.hex || NO_PROGRESS_COLOR, opacity: 0.8 };
          }
          return { hex: NO_PROGRESS_COLOR, opacity: 0.35 };
        }
        return { hex: CATEGORY_COLORS[el.category]?.hex || "#94a3b8", opacity: 0.7 };
      };

      // ── Mesh rendering mode (web-ifc) ─────────────────────
      // All IFC vertices / bboxes live in IFC space (Z-up). We attach them
      // to `ifcRoot` which is rotated -90° around X, so we DON'T swap axes
      // manually — rotation is applied once by the parent group.
      let ifcMeshLoaded = false;
      if (renderMode === "mesh" && ifcFileUrl) {
        try {
          const { IFCMeshLoader } = await import("@/services/ifc-loader");
          const loader = new IFCMeshLoader();
          await loader.init();
          const ifcMeshes = await loader.loadFromUrl(ifcFileUrl);

          // Build centroid map from our DB elements — in raw IFC space
          // (no axis swap). Used for mesh↔element association.
          const elementCentroids = new Map<string, THREE.Vector3>();
          elements.forEach((el) => {
            if (!el.geometry_bbox) return;
            const { min, max } = el.geometry_bbox;
            elementCentroids.set(
              el.id,
              new THREE.Vector3(
                (min[0] + max[0]) / 2,
                (min[1] + max[1]) / 2,
                (min[2] + max[2]) / 2,
              ),
            );
          });

          // Estimate scene scale to derive a unit-agnostic match threshold.
          // IFC files can be in meters, cm, or mm — a hardcoded 5.0 threshold
          // fails on mm-scale models (every element gets dropped to default grey).
          const overallBox = new THREE.Box3();
          if (elementCentroids.size > 0) {
            elementCentroids.forEach((c) => overallBox.expandByPoint(c));
          }
          const sceneDiag = overallBox.isEmpty()
            ? 0
            : overallBox.getSize(new THREE.Vector3()).length();
          // 1.5% of scene diagonal, with a floor of 0.1 and ceiling of 500
          // (500mm ≈ half a metre in mm-files, reasonable for element center
          // slop after IFC placement vs backend centroid).
          const matchThreshold = Math.max(0.1, Math.min(sceneDiag * 0.015, 500));

          const matchedElements = new Set<string>();

          ifcMeshes.forEach((meshData) => {
            const verts = meshData.vertices;
            const indices = meshData.indices;
            if (verts.length === 0 || indices.length === 0) return;

            // Pass vertices straight through — no swap. The ifcRoot group
            // rotates them into Y-up display space once at the parent level.
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
            geometry.setIndex(new THREE.BufferAttribute(indices, 1));
            geometry.computeVertexNormals();
            geometry.computeBoundingBox();

            // Mesh centroid in IFC space
            const centroid = new THREE.Vector3();
            geometry.boundingBox!.getCenter(centroid);

            // Closest unmatched element
            let bestElId: string | null = null;
            let bestDist = Infinity;
            elementCentroids.forEach((elCenter, elId) => {
              if (matchedElements.has(elId)) return;
              const dist = centroid.distanceTo(elCenter);
              if (dist < bestDist) {
                bestDist = dist;
                bestElId = elId;
              }
            });

            const matchEl: BIMElement | null =
              bestElId != null && bestDist <= matchThreshold
                ? (elements.find((e) => e.id === bestElId) ?? null)
                : null;
            if (matchEl) matchedElements.add(matchEl.id);

            // Color priority:
            // 1. If progress mode and element matched → deviation color
            // 2. If element matched → category color from DB element
            // 3. IFC type → category color directly from IFC (always has color)
            // 4. Default grey (fallback only if type unknown)
            const typeHex = IFC_TYPE_COLORS[meshData.ifcType] ?? "#94a3b8";
            const elColor = matchEl
              ? getElementColor(matchEl)
              : { hex: typeHex, opacity: 0.75 };

            const material = new THREE.MeshPhongMaterial({
              color: new THREE.Color(elColor.hex),
              transparent: elColor.opacity < 1,
              opacity: elColor.opacity,
              side: THREE.DoubleSide,
              flatShading: false,
            });

            const mesh = new THREE.Mesh(geometry, material);
            ifcRoot.add(mesh);
            meshes.push(mesh);
            if (matchEl) elementMeshMap.set(matchEl.id, mesh);
          });

          ifcMeshLoaded = meshes.length > 0;
          loader.dispose();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // 404 = IFC file was lost on disk (ephemeral Railway filesystem)
          if (msg.includes("404")) {
            onFileNotFound?.();
          }
          console.warn("web-ifc mesh loading failed, falling back to bbox:", err);
        }
      }

      // ── Bbox fallback ─────────────────────────────────────
      // Bboxes stored in DB are in raw IFC space too; attach to ifcRoot
      // without any axis swap.
      if (!ifcMeshLoaded) {
        elements.forEach((el) => {
          if (!el.geometry_bbox) return;
          const { min, max } = el.geometry_bbox;
          const sx = max[0] - min[0];
          const sy = max[1] - min[1];
          const sz = max[2] - min[2];
          if (sx <= 0 || sy <= 0 || sz <= 0) return;

          const { hex: color, opacity } = getElementColor(el);
          const geometry = new THREE.BoxGeometry(sx, sy, sz);
          const material = new THREE.MeshPhongMaterial({
            color: new THREE.Color(color),
            transparent: opacity < 1,
            opacity,
            side: THREE.DoubleSide,
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set(
            (min[0] + max[0]) / 2,
            (min[1] + max[1]) / 2,
            (min[2] + max[2]) / 2,
          );
          ifcRoot.add(mesh);
          meshes.push(mesh);
          elementMeshMap.set(el.id, mesh);
        });
      }

      // Fit camera to content (measured in WORLD space after group rotation).
      if (meshes.length > 0) {
        // Force world matrices to update so Box3.expandByObject sees the
        // rotation we applied on ifcRoot.
        ifcRoot.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(ifcRoot);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 10;

        camera.position.copy(center).add(
          new THREE.Vector3(maxDim * 0.9, maxDim * 0.8, maxDim * 0.9),
        );
        camera.near = Math.max(maxDim / 1000, 0.01);
        camera.far = maxDim * 20;
        camera.updateProjectionMatrix();
        controls.target.copy(center);
        controls.minDistance = maxDim / 50;
        controls.maxDistance = maxDim * 10;
        controls.update();

        // Size grid to model footprint (round up to nice multiple).
        const footprint = Math.max(size.x, size.z);
        const gridSize = Math.pow(2, Math.ceil(Math.log2(footprint * 1.5)));
        const gridDivs = 40;
        grid = new THREE.GridHelper(gridSize, gridDivs, 0x1a2332, 0x111827);
        grid.position.set(center.x, box.min.y, center.z);
        scene.add(grid);
      } else {
        // Default grid for empty scenes
        grid = new THREE.GridHelper(200, 40, 0x1a2332, 0x111827);
        scene.add(grid);
      }

      // Camera trajectory overlay
      let trajectoryLine: THREE.Line | null = null;
      const trajectoryPositions: THREE.Vector3[] = [];
      let trajectoryRecordInterval: ReturnType<typeof setInterval> | null = null;

      if (showTrajectory) {
        const trajGeometry = new THREE.BufferGeometry();
        const trajMaterial = new THREE.LineBasicMaterial({
          color: 0x0a7cff,
          transparent: true,
          opacity: 0.7,
          linewidth: 2,
        });
        trajectoryLine = new THREE.Line(trajGeometry, trajMaterial);
        scene.add(trajectoryLine);

        trajectoryRecordInterval = setInterval(() => {
          const pos = camera.position.clone();
          const last = trajectoryPositions[trajectoryPositions.length - 1];
          if (!last || pos.distanceTo(last) > 0.5) {
            trajectoryPositions.push(pos);
            if (trajectoryPositions.length >= 2) {
              trajGeometry.setFromPoints(trajectoryPositions);
            }
          }
        }, 200);
      }

      // Highlight selected element — reads from ref so no effect re-run needed
      let highlightedMesh: THREE.Mesh | null = null;
      let prevSelectedId: string | null = null;

      const updateSelection = () => {
        const selectedElement = selectedElementRef.current;
        const newId = selectedElement?.id ?? null;
        if (newId === prevSelectedId) return;
        prevSelectedId = newId;

        // Restore previous
        if (highlightedMesh) {
          const mat = highlightedMesh.material as THREE.MeshPhongMaterial;
          const el = elements.find((e) => elementMeshMap.get(e.id) === highlightedMesh);
          if (el) {
            const { hex, opacity } = getElementColor(el);
            mat.color.set(hex);
            mat.emissive.set(0x000000);
            mat.emissiveIntensity = 0;
            mat.opacity = opacity;
            mat.transparent = opacity < 1;
          }
          highlightedMesh = null;
        }

        // Apply new highlight
        if (selectedElement) {
          const mesh = elementMeshMap.get(selectedElement.id);
          if (mesh) {
            const mat = mesh.material as THREE.MeshPhongMaterial;
            mat.color.set(0x3b82f6);
            mat.emissive.set(0x1a3a7a);
            mat.emissiveIntensity = 0.4;
            mat.opacity = 1.0;
            mat.transparent = false;
            highlightedMesh = mesh;
          }
        }
      };

      // Track which meshes are currently pulsing so we can restore them
      // when the user toggles the highlight off.
      const pulsingDelayedMeshes = new Set<THREE.Mesh>();

      const updateDelayPulse = () => {
        const enabled = highlightDelaysRef.current;
        const delayedIds = delayedIdsRef.current;
        const selectedId = selectedElementRef.current?.id ?? null;

        if (!enabled) {
          // Restore previously-pulsing meshes to their base color
          if (pulsingDelayedMeshes.size > 0) {
            pulsingDelayedMeshes.forEach((mesh) => {
              if (mesh === highlightedMesh) return;
              const mat = mesh.material as THREE.MeshPhongMaterial;
              // Only clear the emissive glow — base color was never changed.
              mat.emissive.set(0x000000);
              mat.emissiveIntensity = 0;
            });
            pulsingDelayedMeshes.clear();
          }
          return;
        }

        // sin wave 0..1 ~1 Hz — subtle red glow, keeps base category color
        const t = performance.now() * 0.003;
        const pulse = 0.5 + 0.5 * Math.sin(t);
        const intensity = 0.25 + pulse * 0.5;

        delayedIds.forEach((elId) => {
          if (elId === selectedId) return; // selection takes precedence
          const mesh = elementMeshMap.get(elId);
          if (!mesh) return;
          const mat = mesh.material as THREE.MeshPhongMaterial;
          // Keep base color intact — only add a red emissive glow so the
          // element is still recognisable by category color.
          mat.emissive.set(0xff2a2a);
          mat.emissiveIntensity = intensity;
          pulsingDelayedMeshes.add(mesh);
        });
      };

      // Animation loop
      const animate = () => {
        animId = requestAnimationFrame(animate);
        controls.update();
        updateSelection();
        updateDelayPulse();
        renderer.render(scene, camera);
      };
      animate();

      // Resize handler
      const handleResize = () => {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      };
      const resizeObserver = new ResizeObserver(handleResize);
      resizeObserver.observe(canvas);

      return () => {
        resizeObserver.disconnect();
        cancelAnimationFrame(animId);
        if (trajectoryRecordInterval) clearInterval(trajectoryRecordInterval);
        if (trajectoryLine) {
          trajectoryLine.geometry.dispose();
          (trajectoryLine.material as THREE.Material).dispose();
        }
        if (grid) {
          grid.geometry.dispose();
          (grid.material as THREE.Material).dispose();
        }
        renderer.dispose();
        controls.dispose();
        meshes.forEach((m) => {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        });
      };
    };

    const cleanup = initViewer();
    return () => {
      cleanup.then((fn) => fn?.());
    };
  // Note: selectedElement is intentionally excluded — selection highlight is
  // handled inside the animation loop via updateSelection(), which reads
  // `selectedElement` via closure ref. Re-running the whole effect on every
  // click would rebuild the scene unnecessarily.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, colorMode, progressByElementId, showTrajectory, renderMode, ifcFileUrl]);

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full"
      style={{ display: "block" }}
    />
  );
}
