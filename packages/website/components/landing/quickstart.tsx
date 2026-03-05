import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { AnimatedTerminal, type TerminalStep } from "@/components/animated-terminal";

const DEPLOY_STEPS: TerminalStep[] = [
  { icon: "$", text: "npx clawrun deploy", variant: "command", delay: 800 },
  { icon: "\u25C6", text: "ClawRun Setup", variant: "info", delay: 600 },
  {
    icon: "\u2192",
    text: 'Creating instance "jolly-books-relax"...',
    variant: "info",
    delay: 700,
  },
  { icon: "\u2713", text: "Instance created", variant: "success", delay: 500 },
  {
    icon: "\u2192",
    text: "Starting sandbox...",
    variant: "info",
    delay: 800,
  },
  { icon: "\u2713", text: "Sandbox: ok", variant: "success", delay: 400 },
  {
    icon: "\u26A1",
    text: "Agent live \u2192 jolly-books-relax.vercel.app",
    variant: "highlight",
    delay: 1500,
  },
];

export function Quickstart() {
  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="mb-5 text-center text-base text-muted-foreground">
        Deploy your first agent with a single command.
      </p>
      <AnimatedTerminal steps={DEPLOY_STEPS} height="h-[190px]" />
      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/docs/getting-started/quickstart"
          className="flex items-center gap-2 border border-primary bg-primary px-6 py-3 text-sm font-medium text-primary-foreground no-underline transition-all hover:brightness-110 active:brightness-90"
        >
          Start Building <ArrowRight size={16} aria-hidden="true" />
        </Link>
        <Link
          href="/docs"
          className="flex items-center gap-2 border border-border-strong px-6 py-3 text-sm font-medium text-foreground no-underline transition-all hover:border-dim hover:bg-surface-hover active:opacity-70"
        >
          Read Docs
        </Link>
      </div>
    </div>
  );
}
