import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Compass, ArrowLeft } from "lucide-react";

export default function NotFoundPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex h-[70vh] flex-col items-center justify-center text-center"
    >
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-800/60 mb-6">
        <Compass size={40} className="text-slate-500" />
      </div>
      <h1 className="text-4xl font-bold font-display text-white">404</h1>
      <p className="mt-2 text-lg text-slate-400">Page not found</p>
      <p className="mt-1 text-sm text-slate-500">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Link to="/" className="btn-primary mt-8">
        <ArrowLeft size={16} />
        Back to Dashboard
      </Link>
    </motion.div>
  );
}
