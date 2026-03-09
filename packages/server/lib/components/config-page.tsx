"use client";

import { useCallback, useState } from "react";
import { useApiClient } from "../hooks/use-api-client";
import { useSandboxQuery } from "../hooks/use-sandbox-query";
import { useQuery } from "../hooks/use-api-client";
import { Skeleton } from "@clawrun/ui/components/ui/skeleton";
import { Badge } from "@clawrun/ui/components/ui/badge";
import { Button } from "@clawrun/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@clawrun/ui/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@clawrun/ui/components/ui/tabs";
import type { WorkspaceFile } from "@clawrun/agent";
import { FileText, Info } from "lucide-react";
import { SandboxOfflineGuard } from "./sandbox-offline-guard";

// ---------------------------------------------------------------------------
// Config tab (unchanged logic)
// ---------------------------------------------------------------------------

function ConfigTab() {
  const client = useApiClient();
  const { data, loading, error } = useSandboxQuery((s) => client.getConfig(s), [client]);

  return (
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
  );
}

// ---------------------------------------------------------------------------
// Workspace tab
// ---------------------------------------------------------------------------

function WorkspaceTab() {
  const client = useApiClient();
  const { data, loading, error } = useSandboxQuery((s) => client.listWorkspaceFiles(s), [client]);

  const files: WorkspaceFile[] = data?.files ?? [];
  const [selected, setSelected] = useState<string | null>(null);

  // Auto-select first file when list loads
  const activeFile = selected ?? files[0]?.name ?? null;

  const fileFetcher = useCallback(
    (signal: AbortSignal) => {
      if (!activeFile) return Promise.resolve(null);
      return client.readWorkspaceFile(activeFile, signal);
    },
    [client, activeFile],
  );
  const {
    data: fileData,
    loading: fileLoading,
    error: fileError,
  } = useQuery(fileFetcher, [fileFetcher]);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-muted-foreground">{error}</p>;
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FileText className="mb-4 size-12 text-muted-foreground" />
        <p className="text-muted-foreground">No workspace files</p>
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-18rem)]">
      {/* File list sidebar */}
      <div className="flex w-48 shrink-0 flex-col gap-1 overflow-auto rounded-md border bg-muted/30 p-2">
        {files.map((f) => (
          <Button
            key={f.name}
            variant={activeFile === f.name ? "default" : "ghost"}
            size="sm"
            className="justify-start font-mono text-xs"
            onClick={() => setSelected(f.name)}
          >
            {f.name}
          </Button>
        ))}
      </div>

      {/* File content */}
      <Card className="flex min-w-0 flex-1 flex-col">
        <CardHeader className="shrink-0 pb-3">
          <CardTitle className="flex items-center gap-2 font-mono text-sm">{activeFile}</CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col">
          {fileLoading ? (
            <Skeleton className="h-full w-full flex-1" />
          ) : fileError ? (
            <p className="text-sm text-muted-foreground">{fileError}</p>
          ) : (
            <pre className="flex-1 overflow-auto rounded-md border bg-muted/50 p-4 font-mono text-sm">
              {fileData?.content ?? ""}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ConfigPage() {
  return (
    <SandboxOfflineGuard>
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="px-4 lg:px-6">
            <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <Info className="size-4 shrink-0" />
              <span>
                To update the config or workspace files, edit them locally and redeploy with{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">clawrun deploy</code>
              </span>
            </div>
            <Tabs defaultValue="config">
              <TabsList>
                <TabsTrigger value="config">Config</TabsTrigger>
                <TabsTrigger value="workspace">Workspace</TabsTrigger>
              </TabsList>
              <TabsContent value="config">
                <ConfigTab />
              </TabsContent>
              <TabsContent value="workspace">
                <WorkspaceTab />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </SandboxOfflineGuard>
  );
}
