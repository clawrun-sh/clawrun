"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconLoader2, IconPlayerPlay, IconServer } from "@tabler/icons-react";
import { Button } from "@clawrun/ui/components/ui/button";
import {
  SidebarMenuItem,
  SidebarMenuButton,
} from "@clawrun/ui/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@clawrun/ui/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@clawrun/ui/components/ui/alert-dialog";
import { useApi, apiPost } from "../hooks/use-api";

interface HealthResponse {
  status: string;
  sandbox?: { running: boolean; status?: string };
}

// Terminal states where the sandbox is fully stopped — show "Start Sandbox" button
const OFFLINE_STATUSES = new Set(["paused", "stopped", "suspended", undefined]);

type DisplayState =
  | { kind: "loading" }
  | { kind: "running" }
  | { kind: "transitioning"; label: string }
  | { kind: "offline" };

function deriveDisplay(
  data: HealthResponse | null,
  loading: boolean,
  userAction: "starting" | "stopping" | null,
): DisplayState {
  if (loading && !data) return { kind: "loading" };
  if (userAction === "starting") return { kind: "transitioning", label: "Starting" };
  if (userAction === "stopping") return { kind: "transitioning", label: "Stopping" };

  const sandbox = data?.sandbox;
  if (!sandbox) return { kind: "offline" };
  if (sandbox.running) return { kind: "running" };

  // Any non-terminal status is a transitional state
  if (!OFFLINE_STATUSES.has(sandbox.status)) {
    const raw = sandbox.status ?? "Busy";
    const label = raw.charAt(0).toUpperCase() + raw.slice(1);
    return { kind: "transitioning", label };
  }

  return { kind: "offline" };
}

export function SandboxStatus() {
  const { data, loading, refetch } = useApi<HealthResponse>("/api/v1/health");
  const [userAction, setUserAction] = useState<"starting" | "stopping" | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

  const display = deriveDisplay(data, loading, userAction);

  // Adaptive polling: 5s when transitioning, 15s otherwise
  const isTransitioning = display.kind === "transitioning" || display.kind === "loading";
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const interval = isTransitioning ? 5_000 : 15_000;
    intervalRef.current = setInterval(refetch, interval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refetch, isTransitioning]);

  // Clear user-initiated action when sandbox state changes
  useEffect(() => {
    if (userAction === "starting" && data?.sandbox?.running) {
      setUserAction(null);
    }
    if (userAction === "stopping" && data?.sandbox && !data.sandbox.running) {
      setUserAction(null);
    }
  }, [userAction, data?.sandbox?.running, data?.sandbox]);

  const handleStart = useCallback(async () => {
    setUserAction("starting");
    try {
      await apiPost("/api/v1/sandbox/start");
      refetch();
    } catch {
      setUserAction(null);
    }
  }, [refetch]);

  const handleStop = useCallback(async () => {
    setUserAction("stopping");
    try {
      await apiPost("/api/v1/sandbox/stop");
      refetch();
    } catch {
      setUserAction(null);
    }
  }, [refetch]);

  // Offline — primary action button
  if (display.kind === "offline") {
    return (
      <SidebarMenuItem>
        <Button
          variant="default"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleStart}
        >
          <IconPlayerPlay className="size-4" />
          Start Sandbox
        </Button>
      </SidebarMenuItem>
    );
  }

  // Running — clickable with tooltip + confirmation to stop
  if (display.kind === "running") {
    return (
      <SidebarMenuItem>
        <AlertDialog>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertDialogTrigger asChild>
                <SidebarMenuButton className="cursor-pointer">
                  <IconServer />
                  <span>Sandbox</span>
                  <span className="ml-auto size-2 shrink-0 rounded-full bg-emerald-500" />
                </SidebarMenuButton>
              </AlertDialogTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">Stop Sandbox</TooltipContent>
          </Tooltip>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Stop Sandbox?</AlertDialogTitle>
              <AlertDialogDescription>
                The sandbox will be snapshotted and stopped. It will automatically
                wake on the next incoming message or you can start it again manually.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={handleStop}>
                Stop Sandbox
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SidebarMenuItem>
    );
  }

  // Loading / transitioning — non-interactive with status dot
  const dotColor =
    display.kind === "transitioning"
      ? "bg-amber-500 animate-pulse"
      : "bg-muted-foreground/40";

  return (
    <SidebarMenuItem>
      <SidebarMenuButton className="pointer-events-none">
        <IconLoader2 className="animate-spin" />
        <span>Sandbox</span>
        <span className={`ml-auto size-2 shrink-0 rounded-full ${dotColor}`} />
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
