"use client";

import { useMemo } from "react";
import { ClawRunInstance } from "@clawrun/sdk/browser";
import { ApiClientProvider } from "../hooks/use-api-client";
import { SandboxStateProvider } from "../hooks/use-sandbox-state";

export function DashboardProviders({ children }: { children: React.ReactNode }) {
  const client = useMemo(() => ClawRunInstance.browser(), []);
  return (
    <ApiClientProvider value={client}>
      <SandboxStateProvider>{children}</SandboxStateProvider>
    </ApiClientProvider>
  );
}
