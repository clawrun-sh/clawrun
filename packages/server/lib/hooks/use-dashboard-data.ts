"use client";

import { useRef } from "react";
import useSWRSubscription from "swr/subscription";
import type { SWRSubscription } from "swr/subscription";
import type { AgentStatus, CostInfo, HealthResult } from "@clawrun/agent";

export interface DashboardSnapshot {
  health: HealthResult & { provider: string };
  status: AgentStatus | null;
  cost: CostInfo | null;
  timestamp: string;
}

export class ReconnectingError extends Error {
  constructor() {
    super("Reconnecting to server");
    this.name = "ReconnectingError";
  }
}

export interface DashboardDataResult {
  data: DashboardSnapshot | undefined;
  error: Error | undefined;
  reconnecting: boolean;
}

const RECONNECT_GRACE_MS = 5_000;

export function useDashboardData(): DashboardDataResult {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const subscribe: SWRSubscription<string, DashboardSnapshot, Error> = (url, { next }) => {
    const es = new EventSource(url);

    es.onmessage = (e) => {
      // Connection recovered — clear grace timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      try {
        next(null, JSON.parse(e.data));
      } catch {
        next(new Error("Failed to parse event data"));
      }
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        // Permanent failure
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        next(new Error("Connection closed"));
      } else if (es.readyState === EventSource.CONNECTING && !timerRef.current) {
        // Auto-reconnecting — give it a grace period before surfacing
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          next(new ReconnectingError());
        }, RECONNECT_GRACE_MS);
      }
    };

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      es.close();
    };
  };

  const { data, error } = useSWRSubscription("/api/v1/events", subscribe);

  return {
    data,
    error,
    reconnecting: error instanceof ReconnectingError,
  };
}

export function useDashboardHealth() {
  const { data, error, reconnecting } = useDashboardData();
  return { data: data?.health, error, reconnecting };
}

export function useDashboardStatus() {
  const { data, error } = useDashboardData();
  return { data: data?.status, error };
}

export function useDashboardCost() {
  const { data, error } = useDashboardData();
  return { data: data?.cost, error };
}
