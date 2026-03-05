"use client";

import { Clock, Database, Camera, HeartPulse, Sun, Play } from "lucide-react";
import type { LucideIcon } from "lucide-react";

function Step({ icon: Icon, label, sub }: { icon: LucideIcon; label: string; sub: string }) {
  return (
    <div className="flex w-72 items-center gap-3 border border-border-strong bg-surface px-4 py-3 sm:w-96 sm:px-5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-border bg-primary/[0.06]">
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

function Connector() {
  return (
    <svg width="2" height="24" className="shrink-0">
      <line
        x1="1"
        y1="0"
        x2="1"
        y2="24"
        className="stroke-line"
        strokeWidth="1"
        strokeDasharray="3 3"
        style={{ animation: "flow-dash 3s linear infinite" }}
      />
    </svg>
  );
}

const steps = [
  {
    icon: Clock,
    label: "Discover Schedule",
    sub: "ClawRun queries agent for cron jobs each heartbeat",
  },
  {
    icon: Database,
    label: "Persist Next Run",
    sub: "Earliest run time stored in state store",
  },
  {
    icon: Camera,
    label: "Snapshot & Sleep",
    sub: "Sandbox goes idle, state captured",
  },
  {
    icon: HeartPulse,
    label: "Heartbeat Check",
    sub: "Periodic tick checks if cron is due soon",
  },
  {
    icon: Sun,
    label: "Wake from Snapshot",
    sub: "Sandbox restored before scheduled time",
  },
  {
    icon: Play,
    label: "Agent Runs Task",
    sub: "Scheduled job executes, cycle repeats",
  },
] as const;

export function CronWakeDiagram() {
  return (
    <div className="my-6 flex flex-col items-center font-mono">
      {steps.map((step, i) => (
        <div key={step.label} className="flex flex-col items-center">
          {i > 0 && <Connector />}
          <Step {...step} />
        </div>
      ))}
    </div>
  );
}
