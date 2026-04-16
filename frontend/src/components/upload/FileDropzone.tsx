import { useCallback, type ReactNode } from "react";
import { useDropzone, type Accept } from "react-dropzone";
import { Upload, X, FileCheck } from "lucide-react";
import clsx from "clsx";

interface FileDropzoneProps {
  accept: Accept;
  label: string;
  sublabel?: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  icon?: ReactNode;
  maxSize?: number; // bytes
}

export default function FileDropzone({
  accept,
  label,
  sublabel,
  file,
  onFileChange,
  icon,
  maxSize = 500 * 1024 * 1024, // 500MB default
}: FileDropzoneProps) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) onFileChange(accepted[0]);
    },
    [onFileChange]
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept,
    maxFiles: 1,
    maxSize,
  });

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  if (file) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-mq-600/30 bg-mq-600/5 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mq-600/15">
            <FileCheck size={20} className="text-mq-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">{file.name}</p>
            <p className="text-xs text-slate-400">{formatBytes(file.size)}</p>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFileChange(null);
          }}
          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={clsx(
        "cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-all duration-200",
        isDragActive && !isDragReject && "border-mq-500 bg-mq-600/5 scale-[1.01]",
        isDragReject && "border-red-500 bg-red-600/5",
        !isDragActive && "border-slate-700 hover:border-slate-600 hover:bg-slate-800/30"
      )}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center gap-3">
        {icon || <Upload size={32} className="text-slate-500" />}
        <div>
          <p className="text-sm font-medium text-slate-300">{label}</p>
          {sublabel && <p className="mt-1 text-xs text-slate-500">{sublabel}</p>}
        </div>
        <p className="text-xs text-slate-600">
          {isDragActive ? "Drop to upload" : "Click or drag & drop"}
        </p>
      </div>
    </div>
  );
}
