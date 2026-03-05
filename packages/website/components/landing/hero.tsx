"use client";

import { useState, useEffect, useRef } from "react";
import { ArrowRight, Github } from "lucide-react";
import Link from "next/link";
import { TerminalWindow } from "@/components/terminal-window";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ01";

const WORDS = ["anywhere.", "at scale.", "securely.", "on the edge.", "in seconds."];

const LOG_LINES = [
  { icon: "\u2192", text: 'Creating instance "jolly-books-relax"...', color: "text-term-muted" },
  { icon: "\u2713", text: "Instance created", color: "text-term-green" },
  { icon: "\u2192", text: "Starting sandbox...", color: "text-term-muted" },
  { icon: "\u2713", text: "Sandbox: ok", color: "text-term-green" },
  {
    icon: "\u26A1",
    text: "Agent live \u2192 jolly-books-relax.vercel.app",
    color: "text-term-blue",
  },
];

function ScrambleWord() {
  const [text, setText] = useState(WORDS[0]);
  const idxRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    const cycle = setInterval(() => {
      const nextIdx = (idxRef.current + 1) % WORDS.length;
      const target = WORDS[nextIdx];
      let tick = 0;

      const run = () => {
        tick++;
        let out = "";
        let done = true;
        for (let i = 0; i < target.length; i++) {
          if (tick > i * 2 + 3) {
            out += target[i];
          } else {
            done = false;
            out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          }
        }
        setText(out);
        if (done) {
          setText(target);
          idxRef.current = nextIdx;
        } else {
          timerRef.current = setTimeout(run, 30);
        }
      };
      run();
    }, 4000);

    return () => {
      clearInterval(cycle);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <span className="text-primary">
      {text.split("").map((ch, i) => (
        <span
          key={i}
          className="inline-block"
          style={{ minWidth: ch === " " ? "0.3em" : undefined }}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}

function HeroTerminal() {
  const [idx, setIdx] = useState(0);
  const [fade, setFade] = useState(false);

  useEffect(() => {
    let fadeTimeout: ReturnType<typeof setTimeout>;
    const iv = setInterval(() => {
      setFade(true);
      fadeTimeout = setTimeout(() => {
        setIdx((i) => (i + 1) % LOG_LINES.length);
        setFade(false);
      }, 200);
    }, 2000);
    return () => {
      clearInterval(iv);
      clearTimeout(fadeTimeout);
    };
  }, []);

  return (
    <TerminalWindow className="mt-10 inline-block w-full max-w-md text-left">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-term-green">~</span>
          <span className="text-sm text-term-dim">$</span>
          <span className="text-sm text-term-text">npx clawrun deploy</span>
        </div>
        <div className="mt-2 flex h-5 items-center gap-1.5 overflow-hidden">
          <span
            className={`text-xs transition-all duration-200 ${LOG_LINES[idx].color}`}
            style={{
              opacity: fade ? 0 : 1,
              transform: fade ? "translateY(-4px)" : "none",
            }}
          >
            {LOG_LINES[idx].icon} {LOG_LINES[idx].text}
          </span>
        </div>
      </div>
    </TerminalWindow>
  );
}

export function Hero() {
  return (
    <div className="relative overflow-hidden px-6 py-20 md:py-32">
      {/* Grid background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse 65% 50% at 50% 35%, black, transparent)",
          WebkitMaskImage: "radial-gradient(ellipse 65% 50% at 50% 35%, black, transparent)",
        }}
      />

      <div className="relative mx-auto max-w-2xl text-center">
        {/* Version badge */}
        <div className="mb-6 inline-flex items-center gap-2 border border-border px-3 py-1.5">
          <div className="h-2 w-2 rounded-full bg-term-green shadow-[0_0_6px_#22c55e]" />
          <span className="text-xs uppercase tracking-[0.1em] text-muted-foreground">
            v0.1.0 — Public Beta
          </span>
        </div>

        {/* Headline */}
        <h1 className="mb-5 text-4xl font-bold leading-[1.05] tracking-tight text-heading md:text-6xl">
          Run AI Agents
          <br />
          <ScrambleWord />
        </h1>

        <p className="mx-auto mb-8 max-w-xl text-base leading-relaxed text-dim md:text-lg">
          One config to deploy secure, sandboxed AI agents across any cloud. Route to any LLM. Swap
          frameworks without rewriting code.
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/docs/getting-started/quickstart"
            className="flex items-center gap-2 border border-primary bg-primary px-6 py-3 text-sm font-medium text-primary-foreground no-underline transition-all hover:brightness-110 active:brightness-90"
          >
            Get Started <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <a
            href="https://github.com/clawrun-sh/clawrun"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub (opens in new tab)"
            className="flex items-center gap-2 border border-border-strong px-6 py-3 text-sm font-medium text-foreground no-underline transition-all hover:border-dim hover:bg-surface-hover active:opacity-70"
          >
            <Github size={16} aria-hidden="true" /> GitHub
          </a>
        </div>

        <HeroTerminal />
      </div>
    </div>
  );
}
