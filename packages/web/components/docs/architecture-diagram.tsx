"use client";

import {
  MessageSquare,
  Clock,
  Globe,
  RefreshCw,
  Database,
  Shield,
  Bot,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

function Node({
  icon: Icon,
  title,
  desc,
}: {
  icon: LucideIcon;
  title: string;
  desc?: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1.5 rounded-md border border-border/50 bg-background px-2 py-3 text-center">
      <Icon size={16} className="shrink-0 text-muted-foreground" />
      <div className="text-xs font-medium text-foreground">{title}</div>
      {desc && (
        <div className="text-[10px] leading-snug text-muted-foreground/70">
          {desc}
        </div>
      )}
    </div>
  );
}

function Layer({
  label,
  sublabel,
  children,
}: {
  label: string;
  sublabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-secondary/40 px-3 pb-3 pt-2">
      <div className="mb-2 text-center">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        {sublabel && (
          <span className="ml-1.5 text-[10px] font-normal normal-case tracking-normal text-muted-foreground/50">
            {sublabel}
          </span>
        )}
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center py-1">
      <div className="h-4 w-px bg-border" />
      <svg
        width="8"
        height="5"
        viewBox="0 0 8 5"
        className="-mt-px text-muted-foreground/50"
      >
        <path d="M0 0 L4 5 L8 0" fill="currentColor" />
      </svg>
      {label && (
        <div className="mt-1 text-[10px] text-muted-foreground/50">
          {label}
        </div>
      )}
    </div>
  );
}

export function ArchitectureDiagram() {
  return (
    <div className="not-prose my-8 mx-auto max-w-2xl font-mono">
      <Layer label="Input Sources">
        <Node
          icon={MessageSquare}
          title="Webhooks"
          desc="Telegram · Discord · Slack · WhatsApp · Lark · QQ"
        />
        <Node icon={Clock} title="Cron" desc="Scheduled tasks" />
      </Layer>

      <Arrow />

      <Layer label="ClawRun Orchestrator">
        <Node icon={Globe} title="Webhook Handler" />
        <Node icon={RefreshCw} title="Lifecycle Manager" />
        <Node icon={Database} title="State Store" desc="Redis" />
      </Layer>

      <Arrow label="start · wake · snapshot · stop · heartbeat" />

      <Layer label="Secure Sandbox" sublabel="(Firecracker microVM)">
        <Node icon={Shield} title="Sidecar" desc="Supervisor · Heartbeat" />
        <Node icon={Bot} title="Agent" desc="ZeroClaw" />
        <Node icon={Wrench} title="Tools" desc="Browser · GitHub CLI" />
      </Layer>
    </div>
  );
}
