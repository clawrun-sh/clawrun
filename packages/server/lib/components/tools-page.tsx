"use client";

import { useApiClient, useQuery } from "../hooks/use-api-client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@clawrun/ui/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@clawrun/ui/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@clawrun/ui/components/ui/table";
import { Badge } from "@clawrun/ui/components/ui/badge";
import { Skeleton } from "@clawrun/ui/components/ui/skeleton";
import type { ToolsResult } from "@clawrun/agent";
import { IconTool } from "@tabler/icons-react";
import { SandboxOfflineGuard } from "./sandbox-offline-guard";

export default function ToolsPage() {
  const client = useApiClient();
  const { data, loading, error } = useQuery((s) => client.listTools(s), [client]);

  const tools = data?.tools ?? [];
  const cliTools = data?.cliTools ?? [];

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
          ) : tools.length === 0 && cliTools.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <IconTool className="mb-4 size-12 text-muted-foreground" />
              <p className="text-muted-foreground">No tools available</p>
            </div>
          ) : (
            <div className="px-4 lg:px-6">
              <Tabs defaultValue="agent">
                <TabsList>
                  <TabsTrigger value="agent">Agent Tools ({tools.length})</TabsTrigger>
                  <TabsTrigger value="cli">CLI Tools ({cliTools.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="agent" className="mt-4">
                  {tools.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No agent tools reported
                    </p>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {tools.map((tool) => (
                        <Card key={tool.name}>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm">{tool.name}</CardTitle>
                            <CardDescription className="line-clamp-2">
                              {tool.description || "No description"}
                            </CardDescription>
                          </CardHeader>
                          {tool.parameters && Object.keys(tool.parameters).length > 0 && (
                            <CardContent>
                              <div className="flex flex-wrap gap-1">
                                {Object.keys(tool.parameters).map((param) => (
                                  <Badge key={param} variant="secondary" className="text-xs">
                                    {param}
                                  </Badge>
                                ))}
                              </div>
                            </CardContent>
                          )}
                        </Card>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="cli" className="mt-4">
                  {cliTools.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No CLI tools installed
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Version</TableHead>
                            <TableHead>Path</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {cliTools.map((tool) => (
                            <TableRow key={tool.name}>
                              <TableCell className="font-medium">{tool.name}</TableCell>
                              <TableCell>
                                {tool.category && (
                                  <Badge variant="secondary">{tool.category}</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {tool.version ?? "—"}
                              </TableCell>
                              <TableCell className="max-w-48 truncate font-mono text-xs text-muted-foreground">
                                {tool.path ?? "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </div>
    </SandboxOfflineGuard>
  );
}
