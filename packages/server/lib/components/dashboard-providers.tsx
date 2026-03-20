"use client";

import { useEffect, useMemo, useRef } from "react";
import { SWRConfig } from "swr";
import { ClawRunInstance } from "@clawrun/sdk/browser";
import { Toaster } from "@clawrun/ui/components/ui/sonner";
import { toast } from "@clawrun/ui/components/ui/sonner";
import { ApiClientProvider } from "../hooks/use-api-client";
import { SandboxStateProvider, useSandboxState } from "../hooks/use-sandbox-state";

const TOAST_ID = "sse-connection";

/** Always-mounted component that shows connection status toasts. */
function ConnectionToast() {
  const { reconnecting, connectionError } = useSandboxState();
  const wasDisruptedRef = useRef(false);

  useEffect(() => {
    if (reconnecting) {
      toast.loading("Reconnecting to server\u2026", { id: TOAST_ID, duration: Infinity });
      wasDisruptedRef.current = true;
    } else if (connectionError) {
      toast.error("Connection lost", {
        id: TOAST_ID,
        description: "Unable to reach the server. Check your network.",
        duration: Infinity,
      });
      wasDisruptedRef.current = true;
    } else if (wasDisruptedRef.current) {
      // Recovered — dismiss the error/reconnecting toast silently.
      // Don't show "Connected" to avoid toast noise on normal SSE timeout cycles.
      toast.dismiss(TOAST_ID);
      wasDisruptedRef.current = false;
    }
  }, [reconnecting, connectionError]);

  return null;
}

export function DashboardProviders({ children }: { children: React.ReactNode }) {
  const client = useMemo(() => ClawRunInstance.browser(), []);
  return (
    <SWRConfig value={{ revalidateOnFocus: false }}>
      <ApiClientProvider value={client}>
        <SandboxStateProvider>
          <ConnectionToast />
          {children}
        </SandboxStateProvider>
      </ApiClientProvider>
      <Toaster position="bottom-center" />
    </SWRConfig>
  );
}
