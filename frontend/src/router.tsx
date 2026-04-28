import { createBrowserRouter } from "react-router-dom";
import AppLayout from "@/components/layout/AppLayout";
import ErrorBoundary from "@/components/ErrorBoundary";
import DashboardPage from "@/pages/DashboardPage";
import ProjectsPage from "@/pages/ProjectsPage";
import NewProjectPage from "@/pages/NewProjectPage";
import ProjectDetailPage from "@/pages/ProjectDetailPage";
import BIMViewerPage from "@/pages/BIMViewerPage";
import ScheduleDetailPage from "@/pages/ScheduleDetailPage";
import ReportsPage from "@/pages/ReportsPage";
import IntegrationsPage from "@/pages/IntegrationsPage";
import ReprojectionViewPage from "@/pages/ReprojectionViewPage";
import PlanTrackerPage from "@/pages/PlanTrackerPage";
import TradesPage from "@/pages/TradesPage";
import ExecutiveOverviewPage from "@/pages/ExecutiveOverviewPage";
import BIMModelPickerPage from "@/pages/BIMModelPickerPage";
import ProgressOverviewPage from "@/pages/ProgressOverviewPage";
import CaptureDetailPage from "@/pages/CaptureDetailPage";
import DelayForecastPage from "@/pages/DelayForecastPage";
import SettingsPage from "@/pages/SettingsPage";
import NotFoundPage from "@/pages/NotFoundPage";

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    errorElement: <ErrorBoundary><div /></ErrorBoundary>,
    children: [
      { path: "/",                                               element: <DashboardPage /> },
      { path: "/executive",                                      element: <ExecutiveOverviewPage /> },
      { path: "/projects",                                       element: <ProjectsPage /> },
      { path: "/projects/new",                                   element: <NewProjectPage /> },
      { path: "/projects/:projectId",                            element: <ProjectDetailPage /> },
      { path: "/projects/:projectId/plan-tracker",               element: <PlanTrackerPage /> },
      { path: "/projects/:projectId/trades",                     element: <TradesPage /> },
      { path: "/projects/:projectId/schedules/:scheduleId",      element: <ScheduleDetailPage /> },
      { path: "/projects/:projectId/bim",                         element: <BIMModelPickerPage /> },
      { path: "/projects/:projectId/progress",                   element: <ProgressOverviewPage /> },
      { path: "/projects/:projectId/captures/:captureId",        element: <CaptureDetailPage /> },
      { path: "/projects/:projectId/forecast",                   element: <DelayForecastPage /> },
      { path: "/projects/:projectId/integrations",               element: <IntegrationsPage /> },
      { path: "/settings",                                        element: <SettingsPage /> },
      { path: "/reports",                                        element: <ReportsPage /> },
      { path: "/schedule",                                       element: <ProjectsPage /> },
      { path: "*",                                               element: <NotFoundPage /> },
    ],
  },
  // Fullscreen pages (no sidebar)
  { path: "/viewer/:projectId/:modelId", element: <BIMViewerPage /> },
  { path: "/viewer",                     element: <BIMViewerPage /> },
  {
    path: "/projects/:projectId/captures/:captureId/reprojection",
    element: <ReprojectionViewPage />,
  },
]);
