"use client";

import { useApiClient, useQuery } from "../hooks/use-api-client";
import { Skeleton } from "@clawrun/ui/components/ui/skeleton";
import { Badge } from "@clawrun/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@clawrun/ui/components/ui/card";
import type { AgentConfig } from "@clawrun/agent";
import { Info } from "lucide-react";
import { SandboxOfflineGuard } from "./sandbox-offline-guard";

export default function ConfigPage() {
  const client = useApiClient();
  const { data, loading, error } = useQuery((s) => client.getConfig(s), [client]);

  return (
    <SandboxOfflineGuard>
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="px-4 lg:px-6">
            <Card>
              <CardHeader>
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    Agent Config
                    {data?.format && (
                      <Badge variant="secondary" className="text-xs">
                        {data.format.toUpperCase()}
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>Read-only view of the agent configuration file</CardDescription>
                </div>
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  <Info className="size-4 shrink-0" />
                  <span>
                    To update the config, edit it locally and redeploy with{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono">clawrun deploy</code>
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-96 w-full" />
                ) : error ? (
                  <p className="text-sm text-muted-foreground">{error}</p>
                ) : (
                  <pre className="h-[calc(100vh-22rem)] w-full overflow-auto rounded-md border bg-muted/50 p-4 font-mono text-sm">
                    {data?.content ?? ""}
                  </pre>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </SandboxOfflineGuard>
  );
}
