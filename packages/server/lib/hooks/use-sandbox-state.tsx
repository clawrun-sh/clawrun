"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useApiClient, useQuery } from "./use-api-client";

import type { HealthResult } from "@clawrun/agent";

type HealthResponse = Pick<HealthResult, "status" | "sandbox">;

// Terminal states where the sandbox is fully stopped
const OFFLINE_STATUSES = new Set(["paused", "stopped", "suspended", undefined]);

export type SandboxState = "loading" | "running" | "transitioning" | "offline";

interface SandboxStateContextValue {
  state: SandboxState;
  /** User-triggered action label (e.g. "Starting", "Stopping") when transitioning */
  transitionLabel: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  refetch: () => void;
}

const SandboxStateContext = createContext<SandboxStateContextValue | null>(null);

function deriveState(
  data: HealthResponse | null,
  loading: boolean,
  userAction: "starting" | "stopping" | null,
): { state: SandboxState; transitionLabel: string | null; actionSettled: boolean } {
  if (loading && !data) return { state: "loading", transitionLabel: null, actionSettled: false };

  const sandbox = data?.sandbox;
  const sandboxRunning = sandbox?.running ?? false;

  // "starting" stays in transition until settle timer clears it
  if (userAction === "starting") {
    return { state: "transitioning", transitionLabel: "Starting", actionSettled: sandboxRunning };
  }
  // "stopping" resolves as soon as the sandbox reports not running
  if (userAction === "stopping") {
    if (sandbox && !sandboxRunning) {
      return { state: "offline", transitionLabel: null, actionSettled: true };
    }
    return { state: "transitioning", transitionLabel: "Stopping", actionSettled: false };
  }

  if (!sandbox) return { state: "offline", transitionLabel: null, actionSettled: false };
  if (sandboxRunning) return { state: "running", transitionLabel: null, actionSettled: false };

  // Any non-terminal status is a transitional state
  if (!OFFLINE_STATUSES.has(sandbox.status)) {
    const raw = sandbox.status ?? "Busy";
    const label = raw.charAt(0).toUpperCase() + raw.slice(1);
    return { state: "transitioning", transitionLabel: label, actionSettled: false };
  }

  return { state: "offline", transitionLabel: null, actionSettled: false };
}

export function SandboxStateProvider({ children }: { children: React.ReactNode }) {
  const client = useApiClient();
  const { data, loading, refetch } = useQuery<HealthResponse>(
    (s) => client.health(s) as Promise<HealthResponse>,
    [client],
  );
  const [userAction, setUserAction] = useState<"starting" | "stopping" | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

  const { state, transitionLabel, actionSettled } = deriveState(data, loading, userAction);

  // Adaptive polling: 5s when transitioning/loading, 15s otherwise
  const isTransitioning = state === "transitioning" || state === "loading";
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    const interval = isTransitioning ? 5_000 : 15_000;
    intervalRef.current = setInterval(refetch, interval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refetch, isTransitioning]);

  // Clear user-initiated action when sandbox state catches up.
  // When starting, hold the transitioning state for 5s after sandbox
  // reports running to let the agent daemon fully start.
  const settleRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (!actionSettled) return;
    if (userAction === "starting" && !settleRef.current) {
      settleRef.current = setTimeout(() => {
        settleRef.current = null;
        setUserAction(null);
      }, 5_000);
    } else if (userAction === "stopping") {
      // deriveState already shows "offline" — clear stale action on next tick
      const id = setTimeout(() => setUserAction(null), 0);
      return () => clearTimeout(id);
    }
  }, [actionSettled, userAction]);

  // Clean up settle timer on unmount
  useEffect(() => {
    return () => {
      if (settleRef.current) clearTimeout(settleRef.current);
    };
  }, []);

  const start = useCallback(async () => {
    setUserAction("starting");
    try {
      await client.start();
      refetch();
    } catch {
      setUserAction(null);
    }
  }, [client, refetch]);

  const stop = useCallback(async () => {
    setUserAction("stopping");
    try {
      await client.stop();
      refetch();
    } catch {
      setUserAction(null);
    }
  }, [client, refetch]);

  return (
    <SandboxStateContext.Provider value={{ state, transitionLabel, start, stop, refetch }}>
      {children}
    </SandboxStateContext.Provider>
  );
}

export function useSandboxState(): SandboxStateContextValue {
  const ctx = useContext(SandboxStateContext);
  if (!ctx) {
    throw new Error("useSandboxState must be used within SandboxStateProvider");
  }
  return ctx;
}
