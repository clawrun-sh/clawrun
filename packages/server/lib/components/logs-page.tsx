"use client";

import { useMemo, useState } from "react";
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
import { Badge } from "@clawrun/ui/components/ui/badge";
import { Input } from "@clawrun/ui/components/ui/input";
import { Skeleton } from "@clawrun/ui/components/ui/skeleton";
import type { LogEntry } from "@clawrun/agent";
import { FileText, RefreshCw, Search, X } from "lucide-react";
import { SandboxOfflineGuard } from "./sandbox-offline-guard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LEVEL_LABELS: Record<number, string> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

const LEVEL_BADGE_COLORS: Record<string, string> = {
  trace: "bg-muted text-muted-foreground",
  debug: "bg-muted text-muted-foreground",
  info: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  warn: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  error: "bg-destructive/10 text-destructive",
  fatal: "bg-destructive/10 text-destructive",
};

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function levelLabel(level: number): string {
  return LEVEL_LABELS[level] ?? `L${level}`;
}

// ---------------------------------------------------------------------------
// Table row type — extends LogEntry with a derived `levelLabel` for filtering
// ---------------------------------------------------------------------------

interface LogRow extends LogEntry {
  levelLabel: string;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const columns: ColumnDef<LogRow>[] = [
  {
    accessorKey: "time",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Time" />,
    cell: ({ row }) => (
      <span className="text-sm tabular-nums text-muted-foreground">
        {formatDateTime(row.getValue("time"))}
      </span>
    ),
    size: 180,
    sortingFn: "basic",
  },
  {
    accessorKey: "levelLabel",
    header: "Level",
    cell: ({ row }) => {
      const label = row.getValue("levelLabel") as string;
      const color = LEVEL_BADGE_COLORS[label] ?? "bg-muted text-muted-foreground";
      return (
        <Badge variant="secondary" className={`text-[10px] ${color}`}>
          {label}
        </Badge>
      );
    },
    size: 80,
    filterFn: (row, id, filterValues: string[]) => {
      if (!filterValues?.length) return true;
      return filterValues.includes(row.getValue(id) as string);
    },
  },
  {
    accessorKey: "tag",
    header: "Tag",
    cell: ({ row }) => {
      const tag = row.getValue("tag") as string | undefined;
      return tag ? (
        <Badge variant="outline" className="text-[10px]">
          {tag}
        </Badge>
      ) : null;
    },
    size: 110,
    filterFn: (row, id, filterValues: string[]) => {
      if (!filterValues?.length) return true;
      return filterValues.includes(row.getValue(id) as string);
    },
  },
  {
    accessorKey: "msg",
    header: "Message",
    cell: ({ row }) => <span className="font-mono text-xs">{row.getValue("msg")}</span>,
    enableSorting: false,
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LogsPage() {
  const client = useApiClient();
  const {
    data,
    error,
    isLoading: loading,
    mutate,
  } = useSandboxSWR("logs", () => client.readLogs({ limit: 1000 }));

  // Reverse so newest entries come first, derive levelLabel for filtering
  const rows: LogRow[] = useMemo(() => {
    if (!data?.entries) return [];
    return [...data.entries].reverse().map((e) => ({
      ...e,
      levelLabel: levelLabel(e.level),
    }));
  }, [data]);

  const [sorting, setSorting] = useState<SortingState>([{ id: "time", desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = useState("");

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table API is incompatible with React Compiler by design
  const table = useReactTable({
    data: rows,
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
    initialState: { pagination: { pageSize: 50 } },
  });

  const isFiltered = columnFilters.length > 0 || globalFilter.length > 0;

  return (
    <SandboxOfflineGuard>
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          {loading ? (
            <div className="space-y-2 px-4 lg:px-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="px-4 text-sm text-muted-foreground lg:px-6">{error?.message}</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="mb-4 size-12 text-muted-foreground" />
              <p className="text-muted-foreground">No log entries</p>
            </div>
          ) : (
            <div className="px-4 lg:px-6">
              <div className="flex items-center gap-3 pb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Search logs..."
                    value={globalFilter}
                    onChange={(e) => setGlobalFilter(e.target.value)}
                  />
                </div>
                {table.getColumn("levelLabel") && (
                  <DataTableFacetedFilter column={table.getColumn("levelLabel")} title="Level" />
                )}
                {table.getColumn("tag") && (
                  <DataTableFacetedFilter column={table.getColumn("tag")} title="Tag" />
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
                <div className="ml-auto flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => mutate()}>
                    <RefreshCw className="mr-1 size-3.5" />
                    Refresh
                  </Button>
                  <DataTableViewOptions table={table} />
                </div>
              </div>
              <DataTable
                table={table}
                columns={columns}
                containerClassName="overflow-auto"
                tableClassName="table-auto"
              />
              <DataTablePagination table={table} pageSizeOptions={[20, 50, 100]} />
            </div>
          )}
        </div>
      </div>
    </SandboxOfflineGuard>
  );
}
