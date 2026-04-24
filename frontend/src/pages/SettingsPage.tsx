/**
 * SettingsPage — app-level configuration.
 */

import { useSettingsStore } from "@/store/settingsStore";
import { FlaskConical, Database } from "lucide-react";
import clsx from "clsx";

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none",
        checked ? "bg-mq-500" : "bg-slate-700",
      )}
    >
      <span
        className={clsx(
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

function SettingRow({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
  badge,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  badge?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-4 border-b border-[#2d3d54] last:border-0">
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1e293b]">
          <Icon size={15} className="text-slate-400" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-white">{title}</p>
            {badge && (
              <span className="rounded-full bg-amber-500/15 border border-amber-500/25 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                {badge}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        </div>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

export default function SettingsPage() {
  const { useFakeData, setUseFakeData } = useSettingsStore();

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-4">
      <div>
        <h1 className="text-xl font-semibold text-white">Settings</h1>
        <p className="mt-0.5 text-sm text-slate-400">App configuration and display preferences</p>
      </div>

      {/* Data section */}
      <div className="rounded-xl border border-[#2d3d54] bg-[#16213a] px-5">
        <div className="flex items-center gap-2 py-3 border-b border-[#2d3d54]">
          <Database size={13} className="text-slate-500" />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Data</p>
        </div>

        <SettingRow
          icon={FlaskConical}
          title="Use fake data"
          description="Show realistic demo data on the Dashboard and Executive Overview instead of live API data. Useful for demos and screenshots."
          checked={useFakeData}
          onChange={setUseFakeData}
          badge="Demo mode"
        />
      </div>

      {useFakeData && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-xs text-amber-400">
          <FlaskConical size={13} className="mt-0.5 shrink-0" />
          <span>
            Demo mode is <strong>on</strong> — Dashboard and Executive Overview are showing fake data.
            Turn this off to see live data from your projects.
          </span>
        </div>
      )}
    </div>
  );
}
