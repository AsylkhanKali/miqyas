/**
 * PannableImage — drag-to-pan + wheel/pinch-zoom viewer for a high-res photo.
 *
 * The Al Falah captures are flat 4K (16:9) stills, not equirectangular 360°
 * panoramas, so a true spherical viewer would distort geometry. Instead this
 * lets you drag around and zoom into the real, undistorted image. All transform
 * state lives in refs so dragging never triggers React re-renders.
 */

import { useEffect, useRef, useCallback } from "react";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

interface PannableImageProps {
  src: string;
  alt?: string;
  className?: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;

export default function PannableImage({ src, alt = "", className }: PannableImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const state = useRef({ scale: 1, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0, moved: false });

  const apply = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const s = state.current;
    img.style.transform = `translate(${s.x}px, ${s.y}px) scale(${s.scale})`;
  }, []);

  // Clamp pan so the image can't be dragged fully off-screen
  const clamp = useCallback(() => {
    const c = containerRef.current;
    const s = state.current;
    if (!c) return;
    const maxX = (c.clientWidth * (s.scale - 1)) / 2;
    const maxY = (c.clientHeight * (s.scale - 1)) / 2;
    s.x = Math.max(-maxX, Math.min(maxX, s.x));
    s.y = Math.max(-maxY, Math.min(maxY, s.y));
  }, []);

  const reset = useCallback(() => {
    const s = state.current;
    s.scale = 1; s.x = 0; s.y = 0;
    apply();
  }, [apply]);

  const zoomBy = useCallback((factor: number) => {
    const s = state.current;
    s.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s.scale * factor));
    if (s.scale === 1) { s.x = 0; s.y = 0; }
    clamp();
    apply();
  }, [apply, clamp]);

  // Reset when the image changes
  useEffect(() => { reset(); }, [src, reset]);

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const s = state.current;
      const rect = c!.getBoundingClientRect();
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      const prev = s.scale;
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      // zoom toward cursor
      const ratio = next / prev;
      s.x = px - (px - s.x) * ratio;
      s.y = py - (py - s.y) * ratio;
      s.scale = next;
      if (s.scale === 1) { s.x = 0; s.y = 0; }
      clamp();
      apply();
    }

    function onDown(e: MouseEvent) {
      const s = state.current;
      s.dragging = true; s.moved = false;
      s.lastX = e.clientX; s.lastY = e.clientY;
      c!.style.cursor = "grabbing";
    }
    function onMove(e: MouseEvent) {
      const s = state.current;
      if (!s.dragging) return;
      const dx = e.clientX - s.lastX;
      const dy = e.clientY - s.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) s.moved = true;
      s.lastX = e.clientX; s.lastY = e.clientY;
      s.x += dx; s.y += dy;
      clamp();
      apply();
    }
    function onUp() {
      state.current.dragging = false;
      c!.style.cursor = "grab";
    }
    function onDblClick() {
      const s = state.current;
      if (s.scale > 1) reset(); else zoomBy(2);
    }

    c.addEventListener("wheel", onWheel, { passive: false });
    c.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    c.addEventListener("dblclick", onDblClick);
    return () => {
      c.removeEventListener("wheel", onWheel);
      c.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      c.removeEventListener("dblclick", onDblClick);
    };
  }, [apply, clamp, reset, zoomBy]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", overflow: "hidden", cursor: "grab", touchAction: "none" }}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        className="w-full h-full object-cover select-none"
        style={{ transformOrigin: "center center", transition: "transform 0.05s linear", willChange: "transform" }}
      />

      {/* Drag hint */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/50 backdrop-blur px-3 py-1 text-[11px] font-semibold tracking-wide text-white">
        ↔ Drag to pan · scroll to zoom
      </div>

      {/* Zoom controls */}
      <div className="absolute top-3 right-3 flex flex-col gap-1.5">
        <button onClick={() => zoomBy(1.4)} title="Zoom in"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/50 text-white backdrop-blur hover:bg-black/70">
          <ZoomIn size={15} />
        </button>
        <button onClick={() => zoomBy(1 / 1.4)} title="Zoom out"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/50 text-white backdrop-blur hover:bg-black/70">
          <ZoomOut size={15} />
        </button>
        <button onClick={reset} title="Reset view"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/50 text-white backdrop-blur hover:bg-black/70">
          <Maximize2 size={15} />
        </button>
      </div>
    </div>
  );
}
