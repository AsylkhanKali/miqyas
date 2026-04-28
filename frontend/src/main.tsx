import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { router } from "@/router";
import { ThemeProvider } from "@/store/themeContext";
import "@/styles/globals.css";

// ── Render the app immediately — nothing blocks the first paint ───────────
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: "var(--color-bg-card)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            fontSize: "0.875rem",
          },
          success: {
            iconTheme: { primary: "#10b981", secondary: "var(--color-text-primary)" },
          },
          error: {
            iconTheme: { primary: "#ef4444", secondary: "var(--color-text-primary)" },
          },
        }}
      />
    </ThemeProvider>
  </React.StrictMode>
);

// ── Sentry — initialised after first paint so it never delays TTI ─────────
// Uses requestIdleCallback when available (Chrome/Edge) with a setTimeout
// fallback for Safari. The ~80 KB vendor-sentry chunk is only downloaded
// when the browser is idle, well after the user sees content.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  const initSentry = () => {
    import("@sentry/react").then((Sentry) => {
      Sentry.init({
        dsn: sentryDsn,
        environment: import.meta.env.VITE_SENTRY_ENV || "development",
        integrations: [Sentry.browserTracingIntegration()],
        tracesSampleRate: 0.1,
      });
    });
  };

  if ("requestIdleCallback" in window) {
    requestIdleCallback(initSentry, { timeout: 5000 });
  } else {
    // Safari fallback — 3s after render is safely past first paint
    setTimeout(initSentry, 3000);
  }
}
