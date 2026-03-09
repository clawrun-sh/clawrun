"use client";

import { CloudOff, Loader2, Play } from "lucide-react";
import { Button } from "@clawrun/ui/components/ui/button";
import { Skeleton } from "@clawrun/ui/components/ui/skeleton";
import { useSandboxState } from "../hooks/use-sandbox-state";

export function SandboxOfflineGuard({ children }: { children: React.ReactNode }) {
  const { state, transitionLabel, start } = useSandboxState();

  if (state === "loading") {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (state === "offline") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24">
        <CloudOff className="size-12 text-muted-foreground" />
        <div className="text-center">
          <p className="font-medium text-muted-foreground">Sandbox offline</p>
          <p className="mt-1 text-sm text-muted-foreground/70">
            Start the sandbox to access this page
          </p>
        </div>
        <Button onClick={start} size="sm" className="gap-2">
          <Play className="size-4" />
          Start Sandbox
        </Button>
      </div>
    );
  }

  if (state === "transitioning") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24">
        <Loader2 className="size-10 animate-spin text-muted-foreground" />
        <p className="text-sm font-medium text-muted-foreground">
          {transitionLabel ?? "Starting"}&hellip;
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
