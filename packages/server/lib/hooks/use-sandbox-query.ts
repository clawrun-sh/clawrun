"use client";

import useSWR from "swr";
import type { SWRConfiguration } from "swr";
import { useSandboxState } from "./use-sandbox-state";

/**
 * SWR hook that is tied to sandbox state. The query only executes
 * when the sandbox is running (null key pauses SWR).
 *
 * Use this for any API call that requires the sandbox to be online
 * (e.g. listing memories, threads, cron jobs).
 */
export function useSandboxSWR<T>(
  key: string,
  fetcher: () => Promise<T>,
  config?: SWRConfiguration<T>,
) {
  const { state } = useSandboxState();
  return useSWR<T>(state === "running" ? key : null, fetcher, config);
}
