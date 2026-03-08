"use client";

import { IconCloudOff } from "@tabler/icons-react";
import { IconPlayerPlay } from "@tabler/icons-react";
import { Button } from "@clawrun/ui/components/ui/button";
import { Skeleton } from "@clawrun/ui/components/ui/skeleton";
import { useSandboxState } from "../hooks/use-sandbox-state";

export function SandboxOfflineGuard({ children }: { children: React.ReactNode }) {
  const { state, start } = useSandboxState();

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
        <IconCloudOff className="size-12 text-muted-foreground" />
        <div className="text-center">
          <p className="font-medium text-muted-foreground">Sandbox offline</p>
          <p className="mt-1 text-sm text-muted-foreground/70">
            Start the sandbox to access this page
          </p>
        </div>
        <Button onClick={start} size="sm" className="gap-2">
          <IconPlayerPlay className="size-4" />
          Start Sandbox
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
