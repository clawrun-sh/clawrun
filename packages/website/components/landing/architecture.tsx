"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  GitBranch,
  Terminal,
  Globe,
  Webhook,
  Cloud,
  Cpu,
  Lock,
  Shield,
  Server,
  Code2,
  RefreshCw,
  Camera,
  ShieldCheck,
  LayoutDashboard,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { cloudProviders } from "@/components/icons/cloud-providers";
import { useIsMobile } from "@/lib/hooks";

const AGENTS = ["ZeroClaw", "OpenClaw", "NanoClaw"];
const LLMS = ["OpenAI", "Anthropic", "Google", "Mistral", "Llama"];

const FEATS = [
  { Icon: GitBranch, label: "Routing" },
  { Icon: Terminal, label: "TUI" },
  { Icon: Globe, label: "Web UI" },
  { Icon: Webhook, label: "Hooks" },
  { Icon: Cloud, label: "Serverless" },
];

/* Animated swap chip */
function SwapChip({ items, small }: { items: readonly string[]; small: boolean }) {
  const [idx, setIdx] = useState(0);
  const [fade, setFade] = useState(false);

  useEffect(() => {
    const t = setInterval(() => {
      setFade(true);
      setTimeout(() => {
        setIdx((i) => (i + 1) % items.length);
        setFade(false);
      }, 250);
    }, 3400);
    return () => clearInterval(t);
  }, [items.length]);

  return (
    <div className="inline-flex items-center gap-2 border border-dim px-2.5 py-1 sm:px-3">
      <Code2 size={small ? 10 : 14} className="text-dim" />
      <span
        className="min-w-[70px] text-center text-[10px] uppercase tracking-wider text-foreground transition-all duration-250 sm:min-w-[90px] sm:text-xs"
        style={{
          opacity: fade ? 0 : 1,
          transform: fade ? "translateY(-2px)" : "none",
        }}
      >
        {items[idx]}
      </span>
      <RefreshCw size={small ? 8 : 10} className="animate-[spin_10s_linear_infinite] text-dim" />
    </div>
  );
}

/* Cloud provider bar */
function CloudBar({ small }: { small: boolean }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setActive((i) => (i + 1) % cloudProviders.length), 2400);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col items-center gap-2 sm:gap-3">
      <div className="flex items-center gap-1.5">
        <Server size={small ? 10 : 12} className="text-dim" />
        <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground sm:text-xs">
          deploys on
        </span>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        {cloudProviders.map((p, i) => {
          const on = i === active;
          return (
            <div
              key={p.name}
              className="flex flex-col items-center transition-all duration-500"
              style={{ opacity: on ? 1 : 0.5 }}
            >
              <div
                className={cn(
                  "flex items-center justify-center border transition-all duration-500",
                  on ? "border-primary bg-primary/[0.08]" : "border-border bg-transparent",
                  small ? "h-10 w-10" : "h-14 w-14",
                )}
              >
                <span className={cn(on ? "text-heading" : "text-dim")}>
                  <p.Logo size={small ? 20 : 28} />
                </span>
              </div>
              <span
                className={cn(
                  "mt-1 text-center text-[9px] uppercase tracking-wider transition-all duration-500 sm:text-[10px]",
                  on ? "text-foreground" : "text-muted-foreground",
                )}
                style={{ minWidth: small ? 40 : 56 }}
              >
                {p.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* Dashed connector line */
function Connector({ height = 36 }: { height?: number }) {
  return (
    <svg width="2" height={height} className="shrink-0">
      <line
        x1="1"
        y1="0"
        x2="1"
        y2={height}
        className="stroke-line"
        strokeWidth="1"
        strokeDasharray="3 3"
        style={{ animation: "flow-dash 3s linear infinite" }}
      />
    </svg>
  );
}

/* Pulse ring for sandbox */
function PulseRing({ size }: { size: number }) {
  return (
    <div
      className="pointer-events-none absolute rounded-full border border-primary/10"
      style={{
        width: size,
        height: size,
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        animation: "pulse-ring 4s ease-in-out infinite",
      }}
    />
  );
}

/* Side annotation card (desktop only) */
function AnnotationCard({
  icon: Icon,
  title,
  desc,
  side,
  visible,
  delay,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  side: "left" | "right";
  visible: boolean;
  delay: number;
}) {
  return (
    <div
      className={cn(
        "flex max-w-[160px] items-center gap-2.5 transition-all duration-700",
        side === "left" ? "flex-row-reverse text-right" : "flex-row text-left",
      )}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : `translateX(${side === "left" ? "-12px" : "12px"})`,
        transitionDelay: `${delay}ms`,
      }}
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center border border-border bg-primary/[0.06]">
        <Icon size={14} className="text-dim" />
      </div>
      <div>
        <div className="text-[11px] font-medium uppercase tracking-wider text-heading">{title}</div>
        <div className="text-[10px] leading-tight text-muted-foreground">{desc}</div>
      </div>
    </div>
  );
}

/* Horizontal dashed connector */
function HConnector() {
  return <div className="min-w-3 flex-1 border-t border-dashed border-line" />;
}

/* Row with side annotations on desktop, plain single-column on mobile */
function AnnotatedRow({
  left,
  right,
  visible,
  baseDelay,
  children,
}: {
  left: { icon: LucideIcon; title: string; desc: string };
  right: { icon: LucideIcon; title: string; desc: string };
  visible: boolean;
  baseDelay: number;
  children: React.ReactNode;
}) {
  return (
    <div className="grid w-full grid-cols-1 items-center md:grid-cols-[1fr_auto_1fr]">
      <div className="hidden items-center justify-end md:flex">
        <AnnotationCard {...left} side="left" visible={visible} delay={baseDelay} />
        <HConnector />
      </div>
      <div className="flex justify-center">{children}</div>
      <div className="hidden items-center justify-start md:flex">
        <HConnector />
        <AnnotationCard {...right} side="right" visible={visible} delay={baseDelay + 150} />
      </div>
    </div>
  );
}

export function Architecture() {
  const m = useIsMobile();
  const [hov, setHov] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const ch = m ? 28 : 40;
  const clipPath = m
    ? "polygon(9% 0%,91% 0%,100% 18%,100% 82%,91% 100%,9% 100%,0% 82%,0% 18%)"
    : "polygon(9% 0%,91% 0%,100% 25%,100% 75%,91% 100%,9% 100%,0% 75%,0% 25%)";

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="mx-auto flex w-full max-w-4xl flex-col items-center px-4 py-10 font-mono sm:px-8 md:py-16"
    >
      {/* ClawRun orchestration box */}
      <AnnotatedRow
        left={{
          icon: Webhook,
          title: "Wake Triggers",
          desc: "Webhooks, cron, event streams",
        }}
        right={{
          icon: LayoutDashboard,
          title: "Full Control",
          desc: "CLI + web dashboard",
        }}
        visible={visible}
        baseDelay={0}
      >
        <Link
          href="/docs/getting-started/quickstart"
          className={cn(
            "relative flex flex-col items-center border px-5 py-5 no-underline transition-all duration-500 sm:px-8 sm:py-6",
            m ? "w-full max-w-[280px]" : "w-[420px]",
            hov === "c" ? "border-primary bg-primary/[0.04]" : "border-border-strong bg-surface",
          )}
          onMouseEnter={() => setHov("c")}
          onMouseLeave={() => setHov(null)}
        >
          <div className="mb-2 flex items-center gap-2">
            <Logo size={m ? 18 : 24} className="text-primary" aria-hidden="true" />
            <span className="text-xl font-bold tracking-wide text-primary md:text-2xl">
              ClawRun
            </span>
          </div>
          <span className="mb-3 text-[10px] uppercase tracking-[0.3em] text-foreground md:text-xs">
            Orchestration Layer
          </span>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {FEATS.map(({ Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-1 border border-border px-2 py-0.5 sm:px-2.5"
              >
                <Icon size={m ? 10 : 12} className="text-dim" />
                <span className="text-[10px] uppercase tracking-wider text-foreground md:text-xs">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </Link>
      </AnnotatedRow>

      <Connector height={ch} />

      {/* Sandbox hexagon */}
      <AnnotatedRow
        left={{
          icon: Camera,
          title: "Snapshot & Resume",
          desc: "State persists across cycles",
        }}
        right={{
          icon: ShieldCheck,
          title: "Zero Trust",
          desc: "Isolated ephemeral microVMs",
        }}
        visible={visible}
        baseDelay={300}
      >
        <Link
          href="/docs/sandbox"
          className="relative block overflow-hidden no-underline"
          style={{ width: m ? 240 : 420 }}
          onMouseEnter={() => setHov("s")}
          onMouseLeave={() => setHov(null)}
        >
          <svg
            viewBox={m ? "0 0 240 180" : "0 0 420 200"}
            className="absolute inset-0 h-full w-full"
            preserveAspectRatio="none"
          >
            <polygon
              points={
                m
                  ? "20,0 220,0 240,30 240,150 220,180 20,180 0,150 0,30"
                  : "34,0 386,0 420,50 420,150 386,200 34,200 0,150 0,50"
              }
              className={cn(
                "transition-[fill] duration-500",
                hov === "s" ? "fill-surface-hover" : "fill-surface",
              )}
              stroke="var(--border-strong)"
              strokeWidth="1"
            />
          </svg>
          <div
            className="relative z-10 flex flex-col items-center"
            style={{
              clipPath,
              padding: m ? "14px 18px 10px" : "18px 28px 14px",
            }}
          >
            <div
              className="mb-0.5 flex w-full items-center justify-between"
              style={{ paddingInline: m ? 4 : 8 }}
            >
              <Lock size={m ? 10 : 14} className="text-dim" />
              <Shield size={m ? 10 : 14} className="text-dim" />
            </div>

            {/* Spinning rings + agent icon */}
            <div
              className="relative flex items-center justify-center"
              style={{ width: m ? 76 : 96, height: m ? 76 : 96 }}
            >
              <div
                className="absolute inset-0 rounded-full border border-dashed border-border-strong"
                style={{ animation: "spin 20s linear infinite" }}
              />
              <div
                className="absolute rounded-full border border-border"
                style={{
                  inset: m ? 8 : 10,
                  animation: "spin-reverse 14s linear infinite",
                }}
              />
              <div
                className="absolute flex items-center justify-center"
                style={{ inset: m ? 18 : 22 }}
              >
                <div
                  className="bg-gradient-to-br from-primary/55 to-primary/[0.18]"
                  style={{
                    width: m ? 34 : 44,
                    height: m ? 34 : 44,
                    transform: "rotate(45deg)",
                    borderRadius: 2,
                  }}
                />
              </div>
              <PulseRing size={m ? 88 : 112} />
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
                <Cpu size={m ? 10 : 14} className="text-primary" aria-hidden="true" />
                <span
                  className="text-[8px] font-semibold uppercase tracking-[0.15em] text-primary md:text-[10px]"
                  style={{ lineHeight: 1 }}
                >
                  Agent
                </span>
              </div>
            </div>

            <div className="mt-2">
              <SwapChip items={AGENTS} small={m} />
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <Lock size={m ? 8 : 10} className="text-dim" />
              <span className="text-[9px] uppercase tracking-[0.2em] text-foreground md:text-[11px]">
                Secure Sandbox
              </span>
            </div>
          </div>
        </Link>
      </AnnotatedRow>

      <Connector height={ch} />
      <CloudBar small={m} />
      <Connector height={ch} />

      {/* LLM chips */}
      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
        {LLMS.map((name) => (
          <div key={name} className="border border-border-strong bg-surface px-4 py-2">
            <span className="text-xs font-medium tracking-wider text-foreground sm:text-sm">
              {name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
