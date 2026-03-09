"use client";

import { useQuery, type QueryOptions } from "./use-api-client";
import { useSandboxState } from "./use-sandbox-state";

type SandboxQueryOptions = Omit<QueryOptions, "enabled">;

/**
 * Query hook that is tied to sandbox state. The query only executes
 * when the sandbox is running, and automatically fires when the
 * sandbox transitions to the running state.
 *
 * Use this instead of useQuery for any API call that requires
 * the sandbox to be online (e.g. listing memories, threads, cron jobs).
 */
export function useSandboxQuery<T>(
  queryFn: (signal: AbortSignal) => Promise<T>,
  deps: unknown[] = [],
  options?: SandboxQueryOptions,
) {
  const { state } = useSandboxState();
  return useQuery(queryFn, deps, { ...options, enabled: state === "running" });
}
