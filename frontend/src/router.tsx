import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";
import AppLayout from "@/components/layout/AppLayout";
import ErrorBoundary from "@/components/ErrorBoundary";

// ── Skeleton fallback shown while a route chunk is loading ──────────────────
function RouteLoader() {
  return (
    <div className="flex-1 p-6 space-y-4 animate-pulse">
      <div className="h-7 w-48 rounded-lg skeleton-pulse" />
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl skeleton-pulse" />
        ))}
      </div>
      <div className="h-64 rounded-xl skeleton-pulse" />
    </div>
  );
}

function Lazy({ page }: { page: React.LazyExoticComponent<React.ComponentType> }) {
  const Page = page;
  return (
    <Suspense fallback={<RouteLoader />}>
      <Page />
    </Suspense>
  );
}

// ── Eagerly loaded (tiny, always needed) ───────────────────────────────────
import NotFoundPage from "@/pages/NotFoundPage";

// ── Lazily loaded — each becomes its own JS chunk ──────────────────────────
// Dashboard & top-level
const DashboardPage        = lazy(() => import("@/pages/DashboardPage"));
const ExecutiveOverviewPage= lazy(() => import("@/pages/ExecutiveOverviewPage"));
const ProjectsPage         = lazy(() => import("@/pages/ProjectsPage"));
const NewProjectPage       = lazy(() => import("@/pages/NewProjectPage"));
const SettingsPage         = lazy(() => import("@/pages/SettingsPage"));
const ReportsPage          = lazy(() => import("@/pages/ReportsPage"));

// Per-project pages
const ProjectDetailPage    = lazy(() => import("@/pages/ProjectDetailPage"));
const PlanTrackerPage      = lazy(() => import("@/pages/PlanTrackerPage"));
const TradesPage           = lazy(() => import("@/pages/TradesPage"));
const ScheduleDetailPage   = lazy(() => import("@/pages/ScheduleDetailPage"));
const BIMModelPickerPage   = lazy(() => import("@/pages/BIMModelPickerPage"));
const ProgressOverviewPage = lazy(() => import("@/pages/ProgressOverviewPage"));
const CaptureDetailPage    = lazy(() => import("@/pages/CaptureDetailPage"));
const DelayForecastPage    = lazy(() => import("@/pages/DelayForecastPage"));
const IntegrationsPage     = lazy(() => import("@/pages/IntegrationsPage"));

// Heavy 3D pages — Three.js only loads when these routes are visited
const BIMViewerPage        = lazy(() => import("@/pages/BIMViewerPage"));
const ReprojectionViewPage = lazy(() => import("@/pages/ReprojectionViewPage"));

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    errorElement: <ErrorBoundary><div /></ErrorBoundary>,
    children: [
      { path: "/",                                               element: <Lazy page={DashboardPage} /> },
      { path: "/executive",                                      element: <Lazy page={ExecutiveOverviewPage} /> },
      { path: "/projects",                                       element: <Lazy page={ProjectsPage} /> },
      { path: "/projects/new",                                   element: <Lazy page={NewProjectPage} /> },
      { path: "/projects/:projectId",                            element: <Lazy page={ProjectDetailPage} /> },
      { path: "/projects/:projectId/plan-tracker",               element: <Lazy page={PlanTrackerPage} /> },
      { path: "/projects/:projectId/trades",                     element: <Lazy page={TradesPage} /> },
      { path: "/projects/:projectId/schedules/:scheduleId",      element: <Lazy page={ScheduleDetailPage} /> },
      { path: "/projects/:projectId/bim",                        element: <Lazy page={BIMModelPickerPage} /> },
      { path: "/projects/:projectId/progress",                   element: <Lazy page={ProgressOverviewPage} /> },
      { path: "/projects/:projectId/captures/:captureId",        element: <Lazy page={CaptureDetailPage} /> },
      { path: "/projects/:projectId/forecast",                   element: <Lazy page={DelayForecastPage} /> },
      { path: "/projects/:projectId/integrations",               element: <Lazy page={IntegrationsPage} /> },
      { path: "/settings",                                       element: <Lazy page={SettingsPage} /> },
      { path: "/reports",                                        element: <Lazy page={ReportsPage} /> },
      { path: "/schedule",                                       element: <Lazy page={ProjectsPage} /> },
      { path: "*",                                               element: <NotFoundPage /> },
    ],
  },
  // Fullscreen pages (no sidebar) — also lazy: Three.js never loads on dashboard
  { path: "/viewer/:projectId/:modelId", element: <Lazy page={BIMViewerPage} /> },
  { path: "/viewer",                     element: <Lazy page={BIMViewerPage} /> },
  {
    path: "/projects/:projectId/captures/:captureId/reprojection",
    element: <Lazy page={ReprojectionViewPage} />,
  },
]);
