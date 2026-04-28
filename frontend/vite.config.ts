import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  build: {
    // Raise the warning limit slightly — we're splitting explicitly below
    chunkSizeWarningLimit: 600,

    rollupOptions: {
      output: {
        // ── Manual vendor chunks ──────────────────────────────────────────
        // Each group lands in its own file that can be cached independently.
        // Users who visit only the dashboard never download vendor-three.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          // ── Heaviest / most isolated chunks first ─────────────────────

          // Three.js + IFC ecosystem: only loaded on BIMViewer / Reprojection routes
          if (
            id.includes("/three/") ||
            id.includes("/@react-three/") ||
            id.includes("/web-ifc")
          ) {
            return "vendor-three";
          }

          // Sentry: monitoring — loaded idle after first paint, never critical
          if (id.includes("/@sentry/")) {
            return "vendor-sentry";
          }

          // Recharts: charting library for dashboard + forecast pages
          if (id.includes("/recharts/") || id.includes("/victory-vendor/")) {
            return "vendor-charts";
          }

          // Framer Motion: animations — separate so it cache-busts on its own
          if (id.includes("/framer-motion/")) {
            return "vendor-motion";
          }

          // Core React runtime — almost never changes, maximise cache TTL
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/react-router")
          ) {
            return "vendor-react";
          }

          // Everything else in node_modules (zustand, axios, date-fns, etc.)
          return "vendor";
        },
      },
    },
  },

  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },

  assetsInclude: ["**/*.wasm"],
});
