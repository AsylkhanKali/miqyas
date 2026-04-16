import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import * as Sentry from "@sentry/react";
import { router } from "@/router";
import "@/styles/globals.css";

// ── Sentry ────────────────────────────────────────────────────────────
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.VITE_SENTRY_ENV || "development",
    integrations: [
      Sentry.browserTracingIntegration(),
    ],
    tracesSampleRate: 0.1,
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
    <Toaster
      position="bottom-right"
      toastOptions={{
        duration: 4000,
        style: {
          background: "#1e293b",
          color: "#f1f5f9",
          border: "1px solid #334155",
          borderRadius: "0.75rem",
          fontSize: "0.875rem",
        },
        success: {
          iconTheme: { primary: "#10b981", secondary: "#f1f5f9" },
        },
        error: {
          iconTheme: { primary: "#ef4444", secondary: "#f1f5f9" },
        },
      }}
    />
  </React.StrictMode>
);
