import { Video, Construction } from "lucide-react";

function PlaceholderPage({
  icon: Icon,
  title,
  week,
}: {
  icon: typeof Video;
  title: string;
  week: number;
}) {
  return (
    <div className="flex h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-800/60 border border-slate-700">
        <Icon size={28} className="text-slate-500" />
      </div>
      <h1 className="page-title">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">Coming in Week {week}</p>
      <div className="mt-6 flex items-center gap-2 text-xs text-slate-600">
        <Construction size={14} />
        Under construction
      </div>
    </div>
  );
}

export function CapturesPage() {
  return <PlaceholderPage icon={Video} title="Video Captures" week={3} />;
}

