"use client";

import { useState, useEffect } from "react";
import { TerminalWindow } from "@/components/terminal-window";

export interface TerminalStep {
  icon: string;
  text: string;
  variant: "command" | "info" | "success" | "highlight";
  delay: number;
}

const VARIANT_COLOR: Record<TerminalStep["variant"], string> = {
  command: "text-term-dim",
  info: "text-term-muted",
  success: "text-term-green",
  highlight: "text-term-blue",
};

export function AnimatedTerminal({
  steps,
  doneText,
  height = "h-[200px]",
  replayDelay = 2500,
}: {
  steps: TerminalStep[];
  doneText?: string;
  height?: string;
  replayDelay?: number;
}) {
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (visible < steps.length) {
      const tm = setTimeout(() => setVisible((v) => v + 1), steps[visible].delay);
      return () => clearTimeout(tm);
    }
    const tm = setTimeout(() => setVisible(0), replayDelay);
    return () => clearTimeout(tm);
  }, [visible, steps, replayDelay]);

  return (
    <TerminalWindow>
      <div className={`${height} overflow-hidden px-4 py-3`}>
        {steps.slice(0, visible).map((s, i) =>
          s.variant === "command" ? (
            <div key={i} className="mb-1 flex items-center gap-2 text-sm">
              <span className="text-term-green">~</span>
              <span className="text-term-dim">$</span>
              <span className="text-term-text">{s.text}</span>
            </div>
          ) : (
            <div
              key={i}
              className={`mb-1 flex items-start gap-2 text-xs ${VARIANT_COLOR[s.variant]}`}
            >
              <span className="shrink-0">{s.icon}</span>
              <span>{s.text}</span>
            </div>
          ),
        )}
        {visible < steps.length && (
          <span
            className="inline-block h-4 w-[6px] bg-term-blue"
            style={{ animation: "cursor-blink 1s step-end infinite" }}
          />
        )}
        {doneText && visible >= steps.length && (
          <div className="mt-2 text-xs text-term-dim">{doneText}</div>
        )}
      </div>
    </TerminalWindow>
  );
}
