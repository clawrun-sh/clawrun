"use client";

import { useMemo, useState } from "react";
import { useApiClient, useQuery } from "../hooks/use-api-client";
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
import type { ThreadsResult } from "@clawrun/agent";
import { MessagesSquare, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { SandboxOfflineGuard } from "./sandbox-offline-guard";

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type SortColumn = "messageCount" | "lastActivity";
type SortDirection = "asc" | "desc";

function SortIcon({
  column,
  current,
  direction,
}: {
  column: SortColumn;
  current: SortColumn | null;
  direction: SortDirection;
}) {
  if (current !== column)
    return <ArrowUpDown className="ml-1 inline size-3.5 text-muted-foreground/50" />;
  return direction === "asc" ? (
    <ArrowUp className="ml-1 inline size-3.5" />
  ) : (
    <ArrowDown className="ml-1 inline size-3.5" />
  );
}

export default function ThreadsPage() {
  const client = useApiClient();
  const { data, loading, error } = useQuery((s) => client.listThreads(s), [client]);

  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const threads = data?.threads ?? [];

  const sorted = useMemo(() => {
    if (!sortColumn) return threads;
    return Array.from(threads).sort((a, b) => {
      let cmp = 0;
      if (sortColumn === "messageCount") {
        cmp = (a.messageCount ?? 0) - (b.messageCount ?? 0);
      } else if (sortColumn === "lastActivity") {
        cmp = new Date(a.lastActivity || 0).getTime() - new Date(b.lastActivity || 0).getTime();
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
  }, [threads, sortColumn, sortDirection]);

  const toggleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDirection("desc");
    }
  };

  return (
    <SandboxOfflineGuard>
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          {loading ? (
            <div className="space-y-2 px-4 lg:px-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="px-4 text-sm text-muted-foreground lg:px-6">{error}</p>
          ) : threads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessagesSquare className="mb-4 size-12 text-muted-foreground" />
              <p className="text-muted-foreground">No threads yet</p>
            </div>
          ) : (
            <div className="px-4 lg:px-6">
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Channel</TableHead>
                      <TableHead className="w-full">Preview</TableHead>
                      <TableHead
                        className="cursor-pointer select-none text-right"
                        onClick={() => toggleSort("messageCount")}
                      >
                        Messages
                        <SortIcon
                          column="messageCount"
                          current={sortColumn}
                          direction={sortDirection}
                        />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer select-none"
                        onClick={() => toggleSort("lastActivity")}
                      >
                        Last Activity
                        <SortIcon
                          column="lastActivity"
                          current={sortColumn}
                          direction={sortDirection}
                        />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.map((thread) => (
                      <TableRow key={thread.id}>
                        <TableCell>
                          <Badge variant="secondary">{thread.channel}</Badge>
                        </TableCell>
                        <TableCell>
                          <a
                            href={`/threads/${encodeURIComponent(thread.id)}`}
                            className="line-clamp-1 text-sm hover:underline"
                          >
                            {thread.preview || "—"}
                          </a>
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                          {thread.messageCount}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatDate(thread.lastActivity)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      </div>
    </SandboxOfflineGuard>
  );
}
