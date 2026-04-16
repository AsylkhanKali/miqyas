import { useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, ArrowRight, FolderKanban } from "lucide-react";
import { useProjectStore } from "@/store/projectStore";
import { format } from "date-fns";

export default function ProjectsPage() {
  const { projects, fetchProjects, loading } = useProjectStore();

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="mt-1 text-sm text-slate-400">Manage your construction projects</p>
        </div>
        <Link to="/projects/new" className="btn-primary">
          <Plus size={16} />
          New Project
        </Link>
      </div>

      {projects.length === 0 && !loading ? (
        <div className="card border-dashed p-16 text-center">
          <FolderKanban size={48} className="mx-auto mb-4 text-slate-600" />
          <h3 className="text-lg font-medium text-slate-300">No projects</h3>
          <p className="mt-1 text-sm text-slate-500">Get started by creating your first project</p>
          <Link to="/projects/new" className="btn-primary mt-6">
            <Plus size={16} />
            Create Project
          </Link>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/projects/${project.id}`}
              className="card-hover group p-5"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-mq-600/15 font-mono text-sm font-bold text-mq-400">
                  {project.code.slice(0, 3)}
                </div>
                <span
                  className={`badge ${
                    project.status === "active" ? "badge-ontrack" : "bg-slate-800 text-slate-400 border border-slate-700"
                  }`}
                >
                  {project.status}
                </span>
              </div>
              <h3 className="mt-4 font-display font-semibold text-white group-hover:text-mq-400 transition-colors">
                {project.name}
              </h3>
              <p className="mt-1 text-xs text-slate-500 line-clamp-2">
                {project.description || "No description"}
              </p>
              <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3">
                <span className="text-2xs text-slate-500">
                  {project.location || "No location"}
                </span>
                <span className="text-2xs text-slate-600">
                  {format(new Date(project.created_at), "MMM d, yyyy")}
                </span>
              </div>
            </Link>
          ))}
        </motion.div>
      )}
    </div>
  );
}
