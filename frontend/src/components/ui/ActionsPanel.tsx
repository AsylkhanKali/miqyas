/**
 * ActionsPanel — the signature MIQYAS component.
 *
 * Delay callouts strip names the affected work with days of slip.
 * Each action row echoes its critical-path impact inline —
 * making the connection between "what's delayed" and "what to do" explicit.
 *
 * Design intent: site supervisor scans threats in <3 seconds.
 * Red = act now. Amber = float running out. Orange = scheduled.
 */

import { Link } from "react-router-dom";
import { AlertTriangle, RefreshCw, Eye, ArrowRight, Zap, Clock } from "lucide-react";
import clsx from "clsx";

export interface ActionItem {
  id: string;
  priority: "critical" | "warning" | "info";
  title: string;
  sub: string;
  project: string;
  cta: string;
  href: string;
  /** Days behind on critical path — shown as a CP tag on the row */
  cpDays?: number;
}

export interface DelayCallout {
  label: string;
  days: number;
  critical: boolean;
}

const PRIORITY = {
  critical: {
    dot:     "bg-[var(--color-critical)]",
    color:   "var(--color-critical)",
    bg:      "var(--color-critical-bg)",
    icon:    AlertTriangle,
  },
  warning: {
    dot:     "bg-[var(--color-warning)]",
    color:   "var(--color-warning)",
    bg:      "var(--color-warning-bg)",
    icon:    RefreshCw,
  },
  info: {
    dot:     "bg-[var(--color-accent)]",
    color:   "var(--color-accent)",
    bg:      "var(--color-accent-soft)",
    icon:    Eye,
  },
};

export const FAKE_DELAY_CALLOUTS: DelayCallout[] = [
  { label: "Tower B partitions",   days: 18, critical: true },
  { label: "AHU commissioning",    days: 12, critical: true },
  { label: "Level 4 slab rebar",   days: 8,  critical: true },
  { label: "Elec. rough-in B4–6",  days: 7,  critical: false },
  { label: "Waterproofing podium", days: 5,  critical: false },
];

export const FAKE_ACTIONS: ActionItem[] = [
  {
    id: "a1",
    priority: "critical",
    title: "Reinspect slab Level 4",
    sub: "Rebar 61% vs 85% planned — behind critical path",
    project: "Aldaar Square · Abu Dhabi",
    cta: "View in BIM",
    href: "/projects",
    cpDays: 8,
  },
  {
    id: "a2",
    priority: "critical",
    title: "Review Wall Works Tower A",
    sub: "Block B partitions 62% complete",
    project: "Bloom Living Phase 2 · Abu Dhabi",
    cta: "Open report",
    href: "/projects",
    cpDays: 18,
  },
  {
    id: "a3",
    priority: "critical",
    title: "3 critical zones need attention today",
    sub: "MEP Zone 4 & 5 failed commissioning test — re-test required",
    project: "Aldaar HQ · Abu Dhabi",
    cta: "View details",
    href: "/projects",
    cpDays: 12,
  },
  {
    id: "a4",
    priority: "warning",
    title: "Façade cladding falling behind",
    sub: "Delivery delay flagged — impacts Level 12–18 programme",
    project: "Reem Hills Tower B · Abu Dhabi",
    cta: "Review plan",
    href: "/projects",
  },
  {
    id: "a5",
    priority: "info",
    title: "Weekly capture due",
    sub: "Last scan 6 days ago — schedule new capture to stay on track",
    project: "KIZAD Logistics Hub Z4 · Abu Dhabi",
    cta: "Upload capture",
    href: "/projects",
  },
];

interface ActionsPanelProps {
  items?: ActionItem[];
  delays?: DelayCallout[];
  className?: string;
}

export default function ActionsPanel({
  items = FAKE_ACTIONS,
  delays = FAKE_DELAY_CALLOUTS,
  className,
}: ActionsPanelProps) {
  const criticalCount = items.filter((i) => i.priority === "critical").length;

  return (
    <div
      className={clsx("rounded-xl overflow-hidden", className)}
      style={{
        backgroundColor: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <div className="flex items-center gap-2">
          <Zap size={13} style={{ color: "var(--color-warning)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Actions Required
          </span>
          {criticalCount > 0 && (
            <span
              className="rounded-full border px-2 py-0.5 text-[10px] font-bold"
              style={{
                backgroundColor: "var(--color-critical-bg)",
                borderColor:     "var(--color-critical)",
                color:           "var(--color-critical)",
              }}
            >
              {criticalCount} critical
            </span>
          )}
        </div>
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {items.length} items today
        </span>
      </div>

      {/* Delay callout strip — the signature element */}
      {delays.length > 0 && (
        <div
          className="flex items-center gap-2 overflow-x-auto px-5 py-2 scrollbar-none"
          style={{
            borderBottom: "1px solid var(--color-border)",
            /* right-edge fade to signal overflow */
            maskImage: "linear-gradient(to right, black 85%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to right, black 85%, transparent 100%)",
          }}
        >
          <span
            className="shrink-0 flex items-center gap-1 text-xs font-medium"
            style={{ color: "var(--color-text-muted)" }}
          >
            <Clock size={10} /> Delays:
          </span>
          {delays.map((d, i) => (
            <span
              key={i}
              className="shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap"
              style={{
                backgroundColor: d.critical ? "var(--color-critical-bg)" : "var(--color-warning-bg)",
                borderColor:     d.critical ? "var(--color-critical)"    : "var(--color-warning)",
                color:           d.critical ? "var(--color-critical)"    : "var(--color-warning)",
              }}
            >
              {d.label} <span className="font-bold">{d.days}d</span>
            </span>
          ))}
        </div>
      )}

      {/* Action rows */}
      <div>
        {items.map((item, idx) => {
          const p    = PRIORITY[item.priority];
          const Icon = p.icon;

          return (
            <div
              key={item.id}
              className="flex items-center gap-3 px-5 py-3 transition-colors"
              style={{
                borderTop: idx > 0 ? "1px solid var(--color-border)" : undefined,
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.backgroundColor = "var(--color-bg-hover)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.backgroundColor = "transparent";
              }}
            >
              {/* Priority dot */}
              <span className={clsx("mt-1 h-2 w-2 shrink-0 self-start rounded-full", p.dot)} />

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p
                    className="text-sm font-medium leading-snug"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    {item.title}
                  </p>
                  {/* CP tag — threads delay strip to action row */}
                  {item.cpDays != null && (
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold font-mono tracking-tight border"
                      style={{
                        backgroundColor: "var(--color-critical-bg)",
                        borderColor:     "var(--color-critical)",
                        color:           "var(--color-critical)",
                      }}
                    >
                      CP · {item.cpDays}d
                    </span>
                  )}
                </div>
                <p
                  className="mt-0.5 text-xs leading-snug"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {item.sub}
                </p>
                <p
                  className="mt-0.5 text-[10px] font-mono"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {item.project}
                </p>
              </div>

              {/* CTA */}
              <Link
                to={item.href}
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: p.bg,
                  borderColor:     p.color,
                  color:           p.color,
                }}
              >
                <Icon size={10} />
                {item.cta}
                <ArrowRight size={9} />
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
