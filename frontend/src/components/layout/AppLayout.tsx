/**
 * AppLayout — construction-grounded sidebar + top bar.
 *
 * Design intent: warm steel palette, orange active states.
 * Sidebar: same background as canvas (border separates, not color).
 * Nav teaches the mental model: threats → project context → tools.
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
  TrendingUp,
  TrendingDown,
  Building2,
  Settings,
  ChevronLeft,
  ChevronRight,
  Hexagon,
  ChevronDown,
  AlertTriangle,
  Plus,
  Check,
  Sun,
  Moon,
} from "lucide-react";
import clsx from "clsx";
import { useProjectStore } from "@/store/projectStore";
import { useTheme } from "@/store/themeContext";

// ── Nav structure ─────────────────────────────────────────────────────────

interface NavItem {
  label: string;
  icon: React.ElementType;
  path: (projectId?: string) => string;
  requiresProject?: boolean;
  badge?: "projects";
}

const TOP_NAV: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, path: () => "/" },
  { label: "Executive",  icon: Building2,      path: () => "/executive" },
  { label: "Projects",   icon: FolderKanban,   path: () => "/projects", badge: "projects" },
];

const PROJECT_NAV: NavItem[] = [
  { label: "Plan Tracker", icon: CalendarCheck, path: (id) => id ? `/projects/${id}/plan-tracker` : "/projects", requiresProject: true },
  { label: "Trades",       icon: Users,         path: (id) => id ? `/projects/${id}/trades`       : "/projects", requiresProject: true },
  { label: "BIM Viewer",   icon: Box,           path: (id) => id ? `/projects/${id}/bim`          : "/projects", requiresProject: true },
  { label: "Progress",     icon: TrendingUp,    path: (id) => id ? `/projects/${id}/progress`     : "/projects", requiresProject: true },
  { label: "Forecast",     icon: TrendingDown,  path: (id) => id ? `/projects/${id}/forecast`     : "/projects", requiresProject: true },
  { label: "Reports",      icon: BarChart3,     path: () => "/reports" },
];

// ── Component ─────────────────────────────────────────────────────────────

export default function AppLayout() {
  const [collapsed,       setCollapsed]       = useState(false);
  const [projectDropdown, setProjectDropdown] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { projects, fetchProjects } = useProjectStore();
  const { theme, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    if (projects.length === 0) fetchProjects();
  }, [projects.length, fetchProjects]);

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
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg-primary)]">

      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <motion.aside
        animate={{ width: collapsed ? 64 : 240 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="relative flex flex-col shrink-0 bg-[var(--color-bg-secondary)] border-r border-[var(--color-border)]"
      >
        {/* Logo */}
        <div className="flex h-14 items-center gap-3 border-b border-[var(--color-border)] px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-mq-500 shrink-0">
            <Hexagon size={15} className="text-white" />
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                className="overflow-hidden whitespace-nowrap font-display text-sm font-bold tracking-widest text-[var(--color-text-primary)] uppercase"
              >
                Miqyas
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* Project Selector */}
        {!collapsed && (
          <div className="border-b border-[var(--color-border)] px-3 py-2.5">
            <div className="relative">
              <button
                onClick={() => setProjectDropdown(!projectDropdown)}
                className="flex w-full items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-border-hover)]"
              >
                <span className="truncate font-medium">
                  {currentProject?.name ?? "All Projects"}
                </span>
                <ChevronDown
                  size={12}
                  className={clsx("text-[var(--color-text-muted)] shrink-0 ml-1 transition-transform", projectDropdown && "rotate-180")}
                />
              </button>

              <AnimatePresence>
                {projectDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scaleY: 0.95 }}
                    animate={{ opacity: 1, y: 0, scaleY: 1 }}
                    exit={{ opacity: 0, y: -4, scaleY: 0.95 }}
                    className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-lg"
                    style={{ transformOrigin: "top" }}
                  >
                    <button
                      onClick={() => { setSelectedProject(null); setProjectDropdown(false); navigate("/"); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-[var(--color-bg-hover)]"
                      style={{ color: !selectedProject ? "var(--color-accent)" : "var(--color-text-muted)" }}
                    >
                      {!selectedProject && <Check size={11} className="text-[var(--color-accent)] shrink-0" />}
                      <span className={!selectedProject ? "ml-0" : "ml-[19px]"}>All Projects</span>
                    </button>

                    {projects.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => { setSelectedProject(p.id); setProjectDropdown(false); navigate(`/projects/${p.id}`); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-[var(--color-bg-hover)]"
                        style={{ color: selectedProject === p.id ? "var(--color-text-primary)" : "var(--color-text-muted)" }}
                      >
                        {selectedProject === p.id && <Check size={11} className="text-[var(--color-accent)] shrink-0" />}
                        <span className={clsx("truncate", selectedProject !== p.id && "ml-[19px]")}>{p.name}</span>
                      </button>
                    ))}

                    <div className="border-t border-[var(--color-border)] p-1">
                      <button
                        onClick={() => { setProjectDropdown(false); navigate("/projects/new"); }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors"
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
          <div className="border-b border-[var(--color-border)] flex justify-center py-2.5 px-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--color-bg-card)] text-[10px] font-bold text-[var(--color-text-primary)]">
              {(currentProject?.code ?? "P").slice(0, 2).toUpperCase()}
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto space-y-0.5 px-2 py-2">
          {TOP_NAV.map((item) => (
            <NavLink key={item.label} item={item} collapsed={collapsed} isActive={isActive(item)} selectedProject={selectedProject ?? undefined} />
          ))}

          {!collapsed && (
            <p className="px-3 pt-4 pb-1 text-[9px] font-semibold uppercase tracking-widest section-label">
              Project
            </p>
          )}
          {collapsed && <div className="my-2 border-t border-[var(--color-border)]" />}

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
        <div className="border-t border-[var(--color-border)] px-2 py-2 space-y-0.5">
          <Link
            to="/settings"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-all"
          >
            <Settings size={16} className="shrink-0" />
            {!collapsed && <span>Settings</span>}
          </Link>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex w-full items-center justify-center rounded-md p-2 text-[var(--color-text-disabled)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-muted)]"
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>
      </motion.aside>

      {/* Click-away for project dropdown */}
      {projectDropdown && (
        <div className="fixed inset-0 z-40" onClick={() => setProjectDropdown(false)} />
      )}

      {/* ── Main Area ────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-6 shrink-0">
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
            {currentProject && (
              <>
                <Link to="/projects" className="hover:text-[var(--color-text-secondary)] transition-colors">
                  Projects
                </Link>
                <span className="text-[var(--color-text-disabled)]">›</span>
                <Link
                  to={`/projects/${currentProject.id}`}
                  className="font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                  {currentProject.name}
                </Link>
              </>
            )}
            {!currentProject && (
              <span className="font-medium text-[var(--color-text-secondary)]">
                {TOP_NAV.find((n) => {
                  const p = n.path();
                  return p === "/" ? location.pathname === "/" : location.pathname.startsWith(p);
                })?.label ?? "Dashboard"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            {/* Alerts — dot signals active critical items */}
            <button className="relative flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] transition-colors">
              <AlertTriangle size={15} />
              <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[var(--color-critical)]" />
            </button>

            {/* Avatar */}
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-mq-600 text-[11px] font-bold text-white select-none">
              MQ
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6 bg-[var(--color-bg-primary)]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

// ── NavLink ────────────────────────────────────────────────────────────────

function NavLink({
  item, collapsed, isActive, selectedProject, dimmed,
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
        "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150",
        isActive
          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          : dimmed
          ? "text-[var(--color-text-disabled)] cursor-default pointer-events-none"
          : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
      )}
    >
      <item.icon
        size={16}
        className={clsx(
          "shrink-0 transition-colors",
          isActive  ? "text-[var(--color-accent)]"  :
          dimmed    ? "text-[var(--color-text-disabled)]" :
          "text-[var(--color-text-muted)] group-hover:text-[var(--color-text-primary)]"
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

      {/* Active bar — orange left edge */}
      {isActive && (
        <motion.div
          layoutId="nav-indicator"
          className="absolute -left-2 inset-y-0 my-auto h-6 w-[3px] rounded-r-full bg-mq-500"
          transition={{ duration: 0.2 }}
        />
      )}

      {/* Tooltip — collapsed mode */}
      {collapsed && (
        <div className="pointer-events-none absolute left-full ml-2 hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] px-2 py-1 text-xs text-[var(--color-text-primary)] shadow-lg group-hover:block whitespace-nowrap">
          {item.label}
        </div>
      )}
    </Link>
  );
}
