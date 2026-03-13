"use client";

import { useState } from "react";
import Link from "next/link";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  getCoreRowModel,
  getFilteredRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useApiClient } from "../hooks/use-api-client";
import { useSandboxSWR } from "../hooks/use-sandbox-query";
import { DataTable } from "@clawrun/ui/components/ui/data-table";
import { DataTablePagination } from "@clawrun/ui/components/ui/data-table-pagination";
import { DataTableColumnHeader } from "@clawrun/ui/components/ui/data-table-column-header";
import { DataTableViewOptions } from "@clawrun/ui/components/ui/data-table-view-options";
import { DataTableFacetedFilter } from "@clawrun/ui/components/ui/data-table-faceted-filter";
import { Button } from "@clawrun/ui/components/ui/button";
import { Input } from "@clawrun/ui/components/ui/input";
import { Badge } from "@clawrun/ui/components/ui/badge";
import { Skeleton } from "@clawrun/ui/components/ui/skeleton";
import type { ThreadInfo } from "@clawrun/agent";
import { MessagesSquare, Search, X } from "lucide-react";
import { SandboxOfflineGuard } from "./sandbox-offline-guard";
import { timeAgo } from "@clawrun/ui/lib/time-ago";

const columns: ColumnDef<ThreadInfo>[] = [
  {
    accessorKey: "channel",
    header: "Channel",
    cell: ({ row }) => <Badge variant="secondary">{row.getValue("channel")}</Badge>,
    size: 120,
    filterFn: (row, id, filterValues: string[]) => {
      if (!filterValues?.length) return true;
      return filterValues.includes(row.getValue(id) as string);
    },
  },
  {
    accessorKey: "preview",
    header: "Preview",
    cell: ({ row }) => (
      <Link
        href={`/threads/${encodeURIComponent(row.original.id)}`}
        className="truncate text-sm hover:underline block"
      >
        {row.original.preview || "—"}
      </Link>
    ),
    enableSorting: false,
  },
  {
    accessorKey: "messageCount",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Messages" className="justify-end" />
    ),
    cell: ({ row }) => (
      <span className="text-right text-sm text-muted-foreground tabular-nums block">
        {row.getValue("messageCount")}
      </span>
    ),
    size: 100,
    meta: { cellClassName: "text-right" },
  },
  {
    accessorKey: "lastActivity",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Last Activity" />,
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-sm text-muted-foreground">
        {timeAgo(row.getValue("lastActivity"))}
      </span>
    ),
    size: 160,
    sortingFn: "datetime",
  },
];

export default function ThreadsPage() {
  const client = useApiClient();
  const { data, error, isLoading: loading } = useSandboxSWR("threads", () => client.listThreads());
  const threads = data?.threads ?? [];

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = useState("");

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table API is incompatible with React Compiler by design
  const table = useReactTable({
    data: threads,
    columns,
    state: { sorting, columnFilters, columnVisibility, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const isFiltered = columnFilters.length > 0 || globalFilter.length > 0;

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
            <p className="px-4 text-sm text-muted-foreground lg:px-6">{error?.message}</p>
          ) : threads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <MessagesSquare className="mb-4 size-12 text-muted-foreground" />
              <p className="text-muted-foreground">No threads yet</p>
            </div>
          ) : (
            <div className="px-4 lg:px-6">
              <div className="flex items-center gap-3 pb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Filter threads..."
                    value={globalFilter}
                    onChange={(e) => setGlobalFilter(e.target.value)}
                  />
                </div>
                {table.getColumn("channel") && (
                  <DataTableFacetedFilter column={table.getColumn("channel")} title="Channel" />
                )}
                {isFiltered && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setColumnFilters([]);
                      setGlobalFilter("");
                    }}
                  >
                    Reset
                    <X className="ml-1 size-3.5" />
                  </Button>
                )}
                <DataTableViewOptions table={table} />
              </div>
              <DataTable table={table} columns={columns} />
              <DataTablePagination table={table} />
            </div>
          )}
        </div>
      </div>
    </SandboxOfflineGuard>
  );
}
