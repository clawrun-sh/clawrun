"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ClawRunInstance } from "@clawrun/sdk/browser";

const ApiClientContext = createContext<ClawRunInstance | null>(null);

export const ApiClientProvider = ApiClientContext.Provider;

export function useApiClient(): ClawRunInstance {
  const instance = useContext(ApiClientContext);
  if (!instance) {
    throw new Error("useApiClient must be used within ApiClientProvider");
  }
  return instance;
}

interface QueryResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
}

export interface QueryOptions {
  /** Re-fetch on this interval (ms). Polling stops on unmount. */
  pollInterval?: number;
  /** When false, the query will not execute. Fetches automatically when it becomes true. */
  enabled?: boolean;
}

/**
 * Generic async query hook. Takes an async function and manages
 * loading/error/data state with abort support.
 *
 * Usage with useApiClient:
 * ```
 * const client = useApiClient();
 * const { data, loading, error } = useQuery((s) => client.getConfig(s));
 * ```
 */
export function useQuery<T>(
  queryFn: (signal: AbortSignal) => Promise<T>,
  deps: unknown[] = [],
  options?: QueryOptions,
): QueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const enabled = options?.enabled ?? true;

  const queryFnRef = useRef(queryFn);
  queryFnRef.current = queryFn;

  const refetch = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    queryFnRef
      .current(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Unknown error");
          setLoading(false);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!enabled) return;
    refetch();
    return () => abortRef.current?.abort();
  }, [refetch, enabled]);

  // Polling
  const pollInterval = options?.pollInterval;
  useEffect(() => {
    if (!pollInterval || !enabled) return;
    const id = setInterval(refetch, pollInterval);
    return () => clearInterval(id);
  }, [refetch, pollInterval, enabled]);

  return { data, error, loading, refetch };
}
