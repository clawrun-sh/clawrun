"use client";

import { useApiClient } from "../hooks/use-api-client";
import { useSandboxQuery } from "../hooks/use-sandbox-query";
import { Card, CardDescription, CardHeader, CardTitle } from "@clawrun/ui/components/ui/card";
import { Skeleton } from "@clawrun/ui/components/ui/skeleton";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@clawrun/ui/components/ui/input-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@clawrun/ui/components/ui/dialog";
import { Separator } from "@clawrun/ui/components/ui/separator";
import type { RuntimeToolInfo } from "@clawrun/agent";
import { Search, Wrench } from "lucide-react";
import { SandboxOfflineGuard } from "./sandbox-offline-guard";
import { JsonSchemaTable } from "@clawrun/ui/components/ui/json-schema-table";
import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Tool detail dialog
// ---------------------------------------------------------------------------

function ToolDetailDialog({
  tool,
  open,
  onOpenChange,
}: {
  tool: RuntimeToolInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const schema = tool.parameters ?? {};
  const hasParams =
    typeof schema.properties === "object" &&
    schema.properties !== null &&
    Object.keys(schema.properties as Record<string, unknown>).length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="font-mono">{tool.name}</DialogTitle>
          <DialogDescription>{tool.description || "No description"}</DialogDescription>
        </DialogHeader>

        {hasParams && (
          <>
            <Separator className="shrink-0" />
            <div className="flex min-h-0 flex-1 flex-col">
              <h4 className="mb-3 shrink-0 text-sm font-medium">Parameters</h4>
              <JsonSchemaTable schema={schema} className="min-h-0 flex-1" />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ToolsPage() {
  const client = useApiClient();
  const { data, loading, error } = useSandboxQuery((s) => client.listTools(s), [client]);
  const [search, setSearch] = useState("");
  const [selectedTool, setSelectedTool] = useState<RuntimeToolInfo | null>(null);

  const allTools: RuntimeToolInfo[] = useMemo(() => data?.tools ?? [], [data]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allTools;
    const q = search.toLowerCase();
    return allTools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) || (t.description?.toLowerCase().includes(q) ?? false),
    );
  }, [allTools, search]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
  }, []);

  return (
    <SandboxOfflineGuard>
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          {loading ? (
            <div className="space-y-2 px-4 lg:px-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="px-4 text-sm text-muted-foreground lg:px-6">{error}</p>
          ) : allTools.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Wrench className="mb-4 size-12 text-muted-foreground" />
              <p className="text-muted-foreground">No tools available</p>
            </div>
          ) : (
            <div className="px-4 lg:px-6">
              <InputGroup className="mb-6">
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  autoFocus
                  placeholder="Search tools..."
                  value={search}
                  onChange={handleSearchChange}
                />
                <InputGroupAddon align="inline-end">
                  {filtered.length} {filtered.length === 1 ? "tool" : "tools"}
                </InputGroupAddon>
              </InputGroup>

              {filtered.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No tools match your search
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filtered.map((tool) => (
                    <Card
                      key={tool.name}
                      className="cursor-pointer transition-colors hover:bg-accent/50"
                      onClick={() => setSelectedTool(tool)}
                    >
                      <CardHeader>
                        <CardTitle className="font-mono text-sm">{tool.name}</CardTitle>
                        <CardDescription className="line-clamp-2">
                          {tool.description || "No description"}
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {selectedTool && (
        <ToolDetailDialog
          tool={selectedTool}
          open={!!selectedTool}
          onOpenChange={(open) => {
            if (!open) setSelectedTool(null);
          }}
        />
      )}
    </SandboxOfflineGuard>
  );
}
