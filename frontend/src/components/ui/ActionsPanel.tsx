/**
 * ActionsPanel — "what to do today" call-to-action widget.
 *
 * Shows prioritised action items and urgency delay callouts.
 * Fake data until backend analytics surfaces actionable insights.
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
}

export interface DelayCallout {
  label: string;
  days: number;
  critical: boolean;
}

const PRIORITY = {
  critical: {
    dot:       "bg-red-500",
    badge:     "bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20",
    icon:      AlertTriangle,
  },
  warning: {
    dot:       "bg-amber-500",
    badge:     "bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20",
    icon:      RefreshCw,
  },
  info: {
    dot:       "bg-mq-500",
    badge:     "bg-mq-500/10 border-mq-500/20 text-mq-400 hover:bg-mq-500/20",
    icon:      Eye,
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
    sub: "Rebar 61% vs 85% planned — 8 days behind critical path",
    project: "Aldaar Square · Abu Dhabi",
    cta: "View in BIM",
    href: "/projects",
  },
  {
    id: "a2",
    priority: "critical",
    title: "Review Wall Works Tower A",
    sub: "Block B partitions 62% complete, 18 days delayed",
    project: "Bloom Living Phase 2 · Abu Dhabi",
    cta: "Open report",
    href: "/projects",
  },
  {
    id: "a3",
    priority: "critical",
    title: "3 critical zones need attention today",
    sub: "MEP Zone 4 & 5 failed commissioning test — re-test required",
    project: "Aldaar HQ · Abu Dhabi",
    cta: "View details",
    href: "/projects",
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
    <div className={clsx("rounded-xl border border-[#2d3d54] bg-[#16213a] overflow-hidden", className)}>

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#2d3d54]">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-amber-400" />
          <span className="text-sm font-semibold text-white">Actions Required</span>
          {criticalCount > 0 && (
            <span className="rounded-full bg-red-500/15 border border-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-400">
              {criticalCount} critical
            </span>
          )}
        </div>
        <span className="text-[10px] text-slate-500">{items.length} items today</span>
      </div>

      {/* Urgency delay callouts */}
      {delays.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto px-5 py-2.5 border-b border-[#1e2d42] scrollbar-none">
          <span className="shrink-0 flex items-center gap-1 text-[10px] text-slate-600 font-medium">
            <Clock size={9} /> Delays:
          </span>
          {delays.map((d, i) => (
            <span
              key={i}
              className={clsx(
                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap",
                d.critical
                  ? "bg-red-500/10 border-red-500/20 text-red-400"
                  : "bg-amber-500/10 border-amber-500/20 text-amber-400"
              )}
            >
              {d.label} <span className="font-bold">{d.days}d</span>
            </span>
          ))}
        </div>
      )}

      {/* Action items */}
      <div className="divide-y divide-[#1a2535]">
        {items.map((item) => {
          const p    = PRIORITY[item.priority];
          const Icon = p.icon;

          return (
            <div
              key={item.id}
              className="flex items-center gap-3 px-5 py-3.5 hover:bg-[#1a2740] transition-colors"
            >
              {/* Priority dot */}
              <span className={clsx("mt-1 h-2 w-2 shrink-0 self-start rounded-full", p.dot)} />

              {/* Content */}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white leading-snug">{item.title}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{item.sub}</p>
                <p className="mt-0.5 text-[10px] font-mono text-slate-600">{item.project}</p>
              </div>

              {/* CTA button */}
              <Link
                to={item.href}
                onClick={(e) => e.stopPropagation()}
                className={clsx(
                  "shrink-0 flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap transition-colors",
                  p.badge
                )}
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
