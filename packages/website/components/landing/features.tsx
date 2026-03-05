import Link from "next/link";
import {
  Camera,
  Shield,
  MessageSquare,
  Layers,
  Terminal,
  Puzzle,
  ArrowUpRight,
} from "lucide-react";

const FEATS = [
  {
    Icon: Camera,
    title: "Snapshot & Resume",
    href: "/docs/sandbox/snapshot-resume",
    desc: "Sandbox sleeps when idle, wakes from snapshot. State persists across cycles.",
  },
  {
    Icon: Shield,
    title: "Secure Sandbox",
    href: "/docs/sandbox",
    desc: "Firecracker microVMs with network policies. Isolated, ephemeral, zero shared state.",
  },
  {
    Icon: MessageSquare,
    title: "9+ Channels",
    href: "/docs/use-cases/channels",
    desc: "Telegram, Discord, Slack, WhatsApp, and more. Webhook-driven wake on message.",
  },
  {
    Icon: Layers,
    title: "40+ LLM Providers",
    href: "/docs/getting-started/providers-and-agents",
    desc: "OpenRouter, Anthropic, OpenAI, Google, Groq, Mistral, DeepSeek, and more.",
  },
  {
    Icon: Terminal,
    title: "CLI + Web UI",
    href: "/docs/cli",
    desc: "Terminal for operators. Web dashboard for teams. Same agent, same API.",
  },
  {
    Icon: Puzzle,
    title: "Pluggable Agents",
    href: "/docs/getting-started/providers-and-agents",
    desc: "Abstract agent interface. Swap frameworks without rewriting deployment config.",
  },
];

export function Features() {
  return (
    <div className="grid grid-cols-1 gap-px bg-border font-mono sm:grid-cols-2 lg:grid-cols-3">
      {FEATS.map((f) => (
        <Link
          key={f.title}
          href={f.href}
          className="group border border-transparent bg-background p-6 no-underline transition-colors duration-300 hover:border-border-strong md:p-8"
        >
          <div className="mb-4 flex h-10 w-10 items-center justify-center border border-border bg-primary/[0.06] transition-colors duration-300 group-hover:border-primary/30 group-hover:bg-primary/10">
            <f.Icon size={20} className="text-primary" aria-hidden="true" />
          </div>
          <h3 className="mb-1.5 flex items-center gap-2 text-base font-semibold text-heading transition-colors duration-300 group-hover:text-primary">
            {f.title}
            <ArrowUpRight
              size={14}
              aria-hidden="true"
              className="opacity-0 transition-all duration-300 group-hover:opacity-60"
            />
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
        </Link>
      ))}
    </div>
  );
}
