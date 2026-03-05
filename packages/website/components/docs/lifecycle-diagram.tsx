"use client";

import { Circle, Play, Moon, RefreshCw, MessageSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";

function StateBox({
  icon: Icon,
  label,
  sub,
  active,
}: {
  icon: LucideIcon;
  label: string;
  sub: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex w-72 items-center gap-3 border px-4 py-3 sm:w-96 sm:px-5 ${
        active ? "border-primary/40 bg-primary/[0.06]" : "border-border-strong bg-surface"
      }`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center border ${
          active ? "border-primary/30 bg-primary/[0.08]" : "border-border bg-primary/[0.06]"
        }`}
      >
        <Icon size={14} className="text-primary" />
      </div>
      <div>
        <div className="text-[11px] font-medium uppercase tracking-wider text-heading sm:text-xs">
          {label}
        </div>
        <div className="text-[10px] leading-tight text-dim sm:text-[11px]">{sub}</div>
      </div>
    </div>
  );
}

function Connector({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center">
      <svg width="2" height="12" className="shrink-0">
        <line
          x1="1"
          y1="0"
          x2="1"
          y2="12"
          className="stroke-line"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      </svg>
      <div className="py-0.5 text-[10px] font-medium tracking-wide text-dim sm:text-[11px]">
        {label}
      </div>
      <svg width="2" height="12" className="shrink-0">
        <line
          x1="1"
          y1="0"
          x2="1"
          y2="12"
          className="stroke-line"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      </svg>
      <svg width="8" height="5" viewBox="0 0 8 5" className="-mt-px text-dim">
        <path d="M0 0 L4 5 L8 0" fill="currentColor" />
      </svg>
    </div>
  );
}

export function LifecycleDiagram() {
  return (
    <div className="my-6 flex flex-col items-center font-mono">
      <StateBox icon={Circle} label="No Sandbox" sub="Initial state or after destroy" />

      <Connector label="startNew()" />

      {/* Running box, webhook label outside the flow */}
      <div className="relative">
        {/* Mobile: webhook label above the box */}
        <div className="flex items-center justify-center gap-1.5 pb-1.5 sm:hidden">
          <MessageSquare size={10} className="text-dim" />
          <span className="text-[10px] font-medium tracking-wide text-dim">webhook or cron</span>
          <svg width="5" height="8" viewBox="0 0 5 8" className="rotate-90 text-dim">
            <path d="M0 0 L5 4 L0 8" fill="currentColor" />
          </svg>
        </div>

        {/* Desktop: webhook label to the left, absolutely positioned */}
        <div className="absolute right-full top-1/2 mr-3 hidden -translate-y-1/2 items-center gap-1.5 sm:flex">
          <MessageSquare size={10} className="text-dim" />
          <span className="whitespace-nowrap text-[10px] font-medium tracking-wide text-dim sm:text-[11px]">
            webhook or cron
          </span>
          <svg width="24" height="2" className="shrink-0">
            <line
              x1="0"
              y1="1"
              x2="24"
              y2="1"
              className="stroke-line"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          </svg>
          <svg width="5" height="8" viewBox="0 0 5 8" className="-ml-px text-dim">
            <path d="M0 0 L5 4 L0 8" fill="currentColor" />
          </svg>
        </div>

        <StateBox
          icon={Play}
          label="Running"
          sub="Agent active, heartbeat extends TTL every 60s"
          active
        />
      </div>

      {/* Extend self-loop */}
      <div className="flex w-72 items-center justify-center gap-1.5 py-1 sm:w-96">
        <RefreshCw size={10} className="shrink-0 text-dim" />
        <span className="text-[10px] font-medium tracking-wide text-dim sm:hidden">
          extend(), activity, grace, or cron
        </span>
        <span className="hidden text-[11px] font-medium tracking-wide text-dim sm:inline">
          extend(), grace period, file activity, or cron
        </span>
      </div>

      <Connector label="snapshot + stop" />

      <StateBox
        icon={Moon}
        label="Sleeping"
        sub="Sandbox stopped. Webhook or cron triggers wake()"
      />
    </div>
  );
}
