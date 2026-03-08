"use client";

import { useSandboxState } from "../hooks/use-sandbox-state";

export function ContentShell({ children }: { children: React.ReactNode }) {
  const { state } = useSandboxState();

  let borderOverlay = null;
  if (state === "offline") {
    borderOverlay = (
      <div className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] border-2 border-destructive/50" />
    );
  } else if (state === "transitioning") {
    borderOverlay = (
      <div
        className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] border-2 border-amber-500/70"
        style={{ animation: "border-pulse 1.5s ease-in-out infinite" }}
      />
    );
  }

  return (
    <div className="relative flex flex-1 flex-col rounded-[inherit] overflow-hidden">
      {borderOverlay}
      {children}
    </div>
  );
}
