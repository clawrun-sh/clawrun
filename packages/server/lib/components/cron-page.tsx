"use client";

import { useCallback, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@clawrun/ui/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@clawrun/ui/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@clawrun/ui/components/ui/tooltip";
import { Label } from "@clawrun/ui/components/ui/label";
import type { CronJob } from "@clawrun/agent";
import { Clock, Plus, Search, Trash2, X } from "lucide-react";
import { SandboxOfflineGuard } from "./sandbox-offline-guard";
import { timeAgo } from "@clawrun/ui/lib/time-ago";

const columns: ColumnDef<CronJob>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <span className="font-medium truncate block">{row.original.name ?? row.original.id}</span>
    ),
    enableHiding: false,
  },
  {
    accessorKey: "enabled",
    id: "status",
    header: "Status",
    size: 90,
    cell: ({ row }) => {
      const job = row.original;
      return job.enabled === false ? (
        <Badge variant="secondary" className="capitalize">
          Disabled
        </Badge>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-block size-2 rounded-full bg-emerald-500" />
          </TooltipTrigger>
          <TooltipContent>Active</TooltipContent>
        </Tooltip>
      );
    },
    filterFn: (row, _id, filterValues: string[]) => {
      if (!filterValues?.length) return true;
      const enabled = row.original.enabled !== false;
      return filterValues.includes(enabled ? "active" : "disabled");
    },
    enableSorting: false,
  },
  {
    accessorKey: "command",
    header: "Command",
    cell: ({ row }) => {
      const val: string | undefined = row.getValue("command");
      return (
        <span
          className={val ? "font-mono text-xs truncate block" : "text-xs text-muted-foreground"}
        >
          {val || "—"}
        </span>
      );
    },
  },
  {
    accessorKey: "nextRun",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Next Run" />,
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {timeAgo(row.getValue("nextRun"))}
      </span>
    ),
    size: 140,
    sortingFn: "datetime",
  },
  {
    accessorKey: "lastRun",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Last Run" />,
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {timeAgo(row.getValue("lastRun"))}
      </span>
    ),
    size: 140,
    sortingFn: "datetime",
  },
  {
    accessorKey: "lastStatus",
    header: "Last Status",
    size: 100,
    cell: ({ row }) => {
      const val: string | undefined = row.getValue("lastStatus");
      if (!val) return <span className="text-xs text-muted-foreground">—</span>;
      return (
        <Badge
          variant="secondary"
          className={
            val === "ok"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-destructive/10 text-destructive"
          }
        >
          {val}
        </Badge>
      );
    },
    enableSorting: false,
  },
  {
    id: "actions",
    cell: function ActionsCell({ row, table }) {
      const handleDelete = (table.options.meta as { handleDelete: (id: string) => void })
        ?.handleDelete;
      const job = row.original;
      return (
        <AlertDialog>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Trash2 className="size-4" />
                </Button>
              </AlertDialogTrigger>
            </TooltipTrigger>
            <TooltipContent>Delete cron job</TooltipContent>
          </Tooltip>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete cron job?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete &ldquo;{job.name ?? job.id}&rdquo;. This action cannot
                be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => handleDelete?.(job.id)}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
    },
    size: 56,
    enableHiding: false,
  },
];

const statusOptions = [
  { label: "Active", value: "active" },
  { label: "Disabled", value: "disabled" },
];

export default function CronPage() {
  const client = useApiClient();
  const {
    data,
    error,
    isLoading: loading,
    mutate,
  } = useSandboxSWR("cron", () => client.listCronJobs());
  const jobs = data?.jobs ?? [];

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = useState("");

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await client.deleteCronJob(id);
        mutate();
      } catch {}
    },
    [client, mutate],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table API is incompatible with React Compiler by design
  const table = useReactTable({
    data: jobs,
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
    meta: { handleDelete },
  });

  const isFiltered = columnFilters.length > 0 || globalFilter.length > 0;

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSchedule, setNewSchedule] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = useCallback(async () => {
    if (!newSchedule.trim() || !newCommand.trim()) return;
    setAdding(true);
    try {
      await client.createCronJob({
        name: newName.trim() || undefined,
        schedule: newSchedule.trim(),
        command: newCommand.trim(),
      });
      setAddOpen(false);
      setNewName("");
      setNewSchedule("");
      setNewCommand("");
      mutate();
    } catch {}
    setAdding(false);
  }, [client, newName, newSchedule, newCommand, mutate]);

  return (
    <SandboxOfflineGuard>
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="flex items-center justify-between gap-3 px-4 lg:px-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Filter jobs..."
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
              />
            </div>
            {table.getColumn("status") && (
              <DataTableFacetedFilter
                column={table.getColumn("status")}
                title="Status"
                options={statusOptions}
              />
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
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-1 size-4" />
                  Add Job
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Cron Job</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="cron-name">Name (optional)</Label>
                    <Input
                      id="cron-name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="my-job"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cron-schedule">Schedule</Label>
                    <Input
                      id="cron-schedule"
                      value={newSchedule}
                      onChange={(e) => setNewSchedule(e.target.value)}
                      placeholder="*/5 * * * *"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cron-command">Command</Label>
                    <Input
                      id="cron-command"
                      value={newCommand}
                      onChange={(e) => setNewCommand(e.target.value)}
                      placeholder="echo hello"
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleAdd}
                    disabled={adding || !newSchedule.trim() || !newCommand.trim()}
                  >
                    {adding ? "Adding..." : "Add"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="px-4 lg:px-6">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : error ? (
              <p className="text-sm text-muted-foreground">{error?.message}</p>
            ) : jobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Clock className="mb-4 size-12 text-muted-foreground" />
                <p className="text-muted-foreground">No cron jobs configured</p>
              </div>
            ) : (
              <>
                <DataTable table={table} columns={columns} />
                <DataTablePagination table={table} />
              </>
            )}
          </div>
        </div>
      </div>
    </SandboxOfflineGuard>
  );
}
