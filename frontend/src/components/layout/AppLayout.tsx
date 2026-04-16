/**
 * AppLayout — Buildots-style sidebar + top bar.
 *
 * New features:
 *  - Project selector dropdown at the top
 *  - Extended nav: Plan Tracker, Trades, Alerts
 *  - Collapsible sidebar with icon-only mode
 */

import { useState, useEffect } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  FolderKanban,
  Box,
  CalendarCheck,
  Users,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Hexagon,
  ChevronDown,
  AlertTriangle,
  Video,
  Plus,
  Check,
} from "lucide-react";
import clsx from "clsx";
import { useProjectStore } from "@/store/projectStore";

// ── Nav structure ─────────────────────────────────────────────────────────

interface NavItem {
  label: string;
  icon: React.ElementType;
  // Static path or function that receives selectedProjectId
  path: (projectId?: string) => string;
  requiresProject?: boolean;
  badge?: "projects";
}

const TOP_NAV: NavItem[] = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    path: () => "/",
  },
  {
    label: "Projects",
    icon: FolderKanban,
    path: () => "/projects",
    badge: "projects",
  },
];

const PROJECT_NAV: NavItem[] = [
  {
    label: "Plan Tracker",
    icon: CalendarCheck,
    path: (id) => id ? `/projects/${id}/plan-tracker` : "/projects",
    requiresProject: true,
  },
  {
    label: "Trades",
    icon: Users,
    path: (id) => id ? `/projects/${id}/trades` : "/projects",
    requiresProject: true,
  },
  {
    label: "BIM Viewer",
    icon: Box,
    path: (id) => id ? `/viewer/${id}/` : "/viewer",
  },
  {
    label: "Reports",
    icon: BarChart3,
    path: () => "/reports",
  },
];

// ── Component ─────────────────────────────────────────────────────────────

export default function AppLayout() {
  const [collapsed,       setCollapsed]       = useState(false);
  const [projectDropdown, setProjectDropdown] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const location   = useLocation();
  const navigate   = useNavigate();
  const { projects, fetchProjects } = useProjectStore();

  useEffect(() => {
    if (projects.length === 0) fetchProjects();
  }, [projects.length, fetchProjects]);

  // Auto-detect project from URL
  useEffect(() => {
    const match = location.pathname.match(/\/projects\/([a-f0-9-]{36})/);
    if (match) setSelectedProject(match[1]);
  }, [location.pathname]);

  const currentProject = projects.find((p) => p.id === selectedProject);

  const isActive = (item: NavItem): boolean => {
    const path = item.path(selectedProject ?? undefined);
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path) || location.pathname === path;
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#0d1526]">

      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <motion.aside
        animate={{ width: collapsed ? 72 : 248 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="relative flex flex-col border-r border-[#2d3d54] bg-[#16213a] shrink-0"
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-[#2d3d54] px-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-mq-500 to-mq-700 shadow-lg shadow-mq-500/30 shrink-0">
            <Hexagon size={18} className="text-white" />
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                className="overflow-hidden whitespace-nowrap font-display text-lg font-bold tracking-tight text-white"
              >
                MIQYAS
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* Project Selector */}
        {!collapsed && (
          <div className="border-b border-[#2d3d54] px-3 py-3">
            <div className="relative">
              <button
                onClick={() => setProjectDropdown(!projectDropdown)}
                className="flex w-full items-center justify-between rounded-lg border border-[#2d3d54] bg-[#1e293b] px-3 py-2 text-xs text-white transition-colors hover:border-[#3f536e] hover:bg-[#263347]"
              >
                <span className="truncate font-medium">
                  {currentProject?.name ?? "All Projects"}
                </span>
                <ChevronDown
                  size={13}
                  className={clsx(
                    "text-slate-400 shrink-0 ml-1 transition-transform",
                    projectDropdown && "rotate-180"
                  )}
                />
              </button>

              <AnimatePresence>
                {projectDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scaleY: 0.95 }}
                    animate={{ opacity: 1, y: 0, scaleY: 1 }}
                    exit={{ opacity: 0, y: -4, scaleY: 0.95 }}
                    className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-[#2d3d54] bg-[#1e293b] shadow-xl shadow-black/30"
                    style={{ transformOrigin: "top" }}
                  >
                    {/* All projects option */}
                    <button
                      onClick={() => {
                        setSelectedProject(null);
                        setProjectDropdown(false);
                        navigate("/");
                      }}
                      className={clsx(
                        "flex w-full items-center gap-2 px-3 py-2.5 text-xs transition-colors hover:bg-[#263347]",
                        !selectedProject ? "text-mq-400 font-medium" : "text-slate-400"
                      )}
                    >
                      {!selectedProject && <Check size={11} className="text-mq-400 shrink-0" />}
                      <span className={!selectedProject ? "ml-0" : "ml-[19px]"}>
                        All Projects
                      </span>
                    </button>

                    {/* Project list */}
                    {projects.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setSelectedProject(p.id);
                          setProjectDropdown(false);
                          navigate(`/projects/${p.id}`);
                        }}
                        className={clsx(
                          "flex w-full items-center gap-2 px-3 py-2.5 text-xs transition-colors hover:bg-[#263347]",
                          selectedProject === p.id ? "text-white font-medium" : "text-slate-400"
                        )}
                      >
                        {selectedProject === p.id && (
                          <Check size={11} className="text-mq-400 shrink-0" />
                        )}
                        <span className={clsx(
                          "truncate",
                          selectedProject !== p.id && "ml-[19px]"
                        )}>
                          {p.name}
                        </span>
                      </button>
                    ))}

                    {/* New project */}
                    <div className="border-t border-[#2d3d54] p-1.5">
                      <button
                        onClick={() => {
                          setProjectDropdown(false);
                          navigate("/projects/new");
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-slate-400 hover:bg-[#263347] hover:text-white transition-colors"
                      >
                        <Plus size={12} />
                        New Project
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Collapsed: project avatar */}
        {collapsed && selectedProject && (
          <div className="border-b border-[#2d3d54] flex justify-center py-3 px-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#263347] text-[10px] font-bold text-white">
              {(currentProject?.code ?? "P").slice(0, 2).toUpperCase()}
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto space-y-0.5 px-3 py-3">
          {/* Top nav items */}
          {TOP_NAV.map((item) => <NavLink key={item.label} item={item} collapsed={collapsed} isActive={isActive(item)} selectedProject={selectedProject ?? undefined} />)}

          {/* Divider + project-specific section */}
          {!collapsed && (
            <p className="px-3 pt-4 pb-1.5 text-[9px] font-semibold uppercase tracking-widest text-slate-600">
              Project
            </p>
          )}
          {collapsed && <div className="my-2 border-t border-slate-800/60" />}

          {PROJECT_NAV.map((item) => (
            <NavLink
              key={item.label}
              item={item}
              collapsed={collapsed}
              isActive={isActive(item)}
              selectedProject={selectedProject ?? undefined}
              dimmed={item.requiresProject && !selectedProject}
            />
          ))}
        </nav>

        {/* Bottom: settings + collapse */}
        <div className="border-t border-[#2d3d54] px-3 py-3 space-y-1">
          <Link
            to="/settings"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-400 hover:bg-[#1e293b] hover:text-white transition-all"
          >
            <Settings size={18} className="shrink-0" />
            {!collapsed && <span>Settings</span>}
          </Link>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex w-full items-center justify-center rounded-lg p-2 text-slate-500 transition-colors hover:bg-[#1e293b] hover:text-slate-300"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </motion.aside>

      {/* Click-away for project dropdown */}
      {projectDropdown && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setProjectDropdown(false)}
        />
      )}

      {/* ── Main Area ────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 items-center justify-between border-b border-[#2d3d54] bg-[#16213a] px-6 shrink-0">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            {currentProject && (
              <>
                <Link to="/projects" className="hover:text-slate-200 transition-colors">
                  Projects
                </Link>
                <span className="text-slate-700">›</span>
                <Link
                  to={`/projects/${currentProject.id}`}
                  className="font-medium text-slate-200 hover:text-white transition-colors"
                >
                  {currentProject.name}
                </Link>
              </>
            )}
            {!currentProject && (
              <span className="font-medium text-slate-300">
                {TOP_NAV.find((n) =>
                  n.path() === "/" ? location.pathname === "/" : location.pathname.startsWith(n.path())
                )?.label ?? "Dashboard"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* Notifications */}
            <button className="relative flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-[#1e293b] hover:text-white transition-colors">
              <AlertTriangle size={16} />
            </button>

            {/* Avatar */}
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-mq-500 to-mq-700 text-[11px] font-bold text-white select-none">
              MQ
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6 bg-[#0d1526]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

// ── NavLink component ──────────────────────────────────────────────────────

function NavLink({
  item,
  collapsed,
  isActive,
  selectedProject,
  dimmed,
}: {
  item: NavItem;
  collapsed: boolean;
  isActive: boolean;
  selectedProject?: string;
  dimmed?: boolean;
}) {
  const path = item.path(selectedProject);

  return (
    <Link
      to={path}
      title={collapsed ? item.label : undefined}
      className={clsx(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
        isActive
          ? "bg-mq-500/15 text-mq-400"
          : dimmed
          ? "text-slate-600 hover:text-slate-500 cursor-default pointer-events-none"
          : "text-slate-400 hover:bg-[#1e293b] hover:text-white"
      )}
    >
      <item.icon
        size={18}
        className={clsx(
          "shrink-0 transition-colors",
          isActive ? "text-mq-400" :
          dimmed  ? "text-slate-700" :
          "text-slate-500 group-hover:text-slate-300"
        )}
      />
      <AnimatePresence>
        {!collapsed && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="truncate"
          >
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>

      {/* Active indicator */}
      {isActive && (
        <motion.div
          layoutId="nav-indicator"
          className="absolute -left-3 top-1/2 -translate-y-1/2 h-8 w-[3px] rounded-r-full bg-mq-500"
          transition={{ duration: 0.2 }}
        />
      )}

      {/* Tooltip for collapsed mode */}
      {collapsed && (
        <div className="pointer-events-none absolute left-full ml-2 hidden rounded-md border border-[#2d3d54] bg-[#1e293b] px-2 py-1 text-xs text-white shadow-lg group-hover:block whitespace-nowrap">
          {item.label}
        </div>
      )}
    </Link>
  );
}
