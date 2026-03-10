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
import { useSandboxQuery } from "../hooks/use-sandbox-query";
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
import type { MemoryEntryInfo } from "@clawrun/agent";
import { Separator } from "@clawrun/ui/components/ui/separator";
import {
  Brain,
  Clock,
  Fingerprint,
  MessageSquare,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { SandboxOfflineGuard } from "./sandbox-offline-guard";
import { timeAgo } from "@clawrun/ui/lib/time-ago";

const categoryIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  conversation: MessageSquare,
  core: Fingerprint,
};

const sourceIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  cron: Clock,
};

function CategoryIcon({ category }: { category?: string }) {
  if (!category) return null;
  const Icon = categoryIcons[category] ?? Tag;
  return <Icon className="size-3.5 shrink-0" />;
}

const columns: ColumnDef<MemoryEntryInfo>[] = [
  {
    accessorKey: "key",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Key" />,
    cell: ({ row }) => (
      <span className="truncate font-mono text-xs block">{row.getValue("key")}</span>
    ),
    size: 180,
    enableHiding: false,
  },
  {
    accessorKey: "content",
    header: "Content",
    cell: function ContentCell({ row, table }) {
      const onView = (table.options.meta as { onViewEntry?: (entry: MemoryEntryInfo) => void })
        ?.onViewEntry;
      return (
        <button
          type="button"
          className="line-clamp-2 text-sm text-left hover:underline cursor-pointer w-full overflow-hidden"
          onClick={() => onView?.(row.original)}
        >
          {row.getValue("content")}
        </button>
      );
    },
    meta: { cellClassName: "whitespace-normal" },
  },
  {
    accessorKey: "category",
    header: "Category",
    cell: ({ row }) => {
      const category = row.getValue("category") as string | undefined;
      const source = row.original.source;
      if (!category && !source) return null;
      return (
        <div className="flex items-center gap-1 overflow-hidden">
          {category && (
            <Badge variant="secondary" className="gap-1 shrink-0">
              <CategoryIcon category={category} />
              {category}
            </Badge>
          )}
          {source &&
            (() => {
              const Icon = sourceIcons[source.type] ?? Tag;
              return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="gap-1 shrink-0">
                      <Icon className="size-3 shrink-0" />
                      {source.type}
                    </Badge>
                  </TooltipTrigger>
                  {source.name && (
                    <TooltipContent>
                      {source.name}
                      {source.id ? ` (${source.id})` : ""}
                    </TooltipContent>
                  )}
                </Tooltip>
              );
            })()}
        </div>
      );
    },
    size: 200,
    filterFn: (row, id, filterValues: string[]) => {
      if (!filterValues?.length) return true;
      const val = row.getValue(id) as string | undefined;
      return val != null && filterValues.includes(val);
    },
  },
  {
    id: "source",
    accessorFn: (row) => row.source?.type,
    header: "Source",
    enableHiding: false,
    filterFn: (row, _id, filterValues: string[]) => {
      if (!filterValues?.length) return true;
      const val = row.original.source?.type;
      return val != null && filterValues.includes(val);
    },
  },
  {
    accessorKey: "timestamp",
    header: ({ column }) => <DataTableColumnHeader column={column} title="Timestamp" />,
    cell: ({ row }) => {
      const ts = row.getValue("timestamp") as string | undefined;
      return <span className="whitespace-nowrap text-xs text-muted-foreground">{timeAgo(ts)}</span>;
    },
    size: 120,
    sortingFn: "datetime",
  },
  {
    id: "actions",
    cell: function ActionsCell({ row, table }) {
      const handleDelete = (table.options.meta as { handleDelete: (key: string) => void })
        ?.handleDelete;
      const entry = row.original;
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
            <TooltipContent>Delete memory</TooltipContent>
          </Tooltip>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete memory entry?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete &ldquo;{entry.key}&rdquo;. This action cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => handleDelete?.(entry.key)}>
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

export default function MemoryPage() {
  const client = useApiClient();

  const { data, loading, error, refetch } = useSandboxQuery(
    (s) => client.listMemories({}, s),
    [client],
  );

  const entries = data?.entries ?? [];

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({ source: false });
  const [globalFilter, setGlobalFilter] = useState("");

  const [viewEntry, setViewEntry] = useState<MemoryEntryInfo | null>(null);

  const handleDelete = useCallback(
    async (key: string) => {
      try {
        await client.deleteMemory(key);
        refetch();
      } catch {}
    },
    [client, refetch],
  );

  const table = useReactTable({
    data: entries,
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
    meta: { handleDelete, onViewEntry: setViewEntry },
  });

  const isFiltered = columnFilters.length > 0 || globalFilter.length > 0;

  const [addOpen, setAddOpen] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = useCallback(async () => {
    if (!newKey.trim() || !newContent.trim()) return;
    setAdding(true);
    try {
      await client.createMemory({
        key: newKey.trim(),
        content: newContent.trim(),
        category: newCategory.trim() || undefined,
      });
      setAddOpen(false);
      setNewKey("");
      setNewContent("");
      setNewCategory("");
      refetch();
    } catch {}
    setAdding(false);
  }, [client, newKey, newContent, newCategory, refetch]);

  return (
    <SandboxOfflineGuard>
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          {/* Controls */}
          <div className="flex items-center justify-between gap-3 px-4 lg:px-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search memories..."
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
              />
            </div>
            {table.getColumn("category") && (
              <DataTableFacetedFilter column={table.getColumn("category")} title="Category" />
            )}
            {table.getColumn("source") && (
              <DataTableFacetedFilter column={table.getColumn("source")} title="Source" />
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
                  Add
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Memory Entry</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="mem-key">Key</Label>
                    <Input
                      id="mem-key"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      placeholder="memory_key"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mem-content">Content</Label>
                    <textarea
                      id="mem-content"
                      className="h-24 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      value={newContent}
                      onChange={(e) => setNewContent(e.target.value)}
                      placeholder="Memory content..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mem-category">Category (optional)</Label>
                    <Input
                      id="mem-category"
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      placeholder="general"
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleAdd}
                    disabled={adding || !newKey.trim() || !newContent.trim()}
                  >
                    {adding ? "Adding..." : "Add"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Table */}
          <div className="px-4 lg:px-6">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : error ? (
              <p className="text-sm text-muted-foreground">{error}</p>
            ) : entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Brain className="mb-4 size-12 text-muted-foreground" />
                <p className="text-muted-foreground">No memories found</p>
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
      {viewEntry && (
        <Dialog
          open={!!viewEntry}
          onOpenChange={(open) => {
            if (!open) setViewEntry(null);
          }}
        >
          <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
            <DialogHeader className="shrink-0">
              <DialogTitle className="font-mono text-sm break-all pr-8">
                {viewEntry.key}
              </DialogTitle>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {viewEntry.category && (
                  <Badge variant="secondary" className="gap-1">
                    <CategoryIcon category={viewEntry.category} />
                    {viewEntry.category}
                  </Badge>
                )}
                {viewEntry.source &&
                  (() => {
                    const Icon = sourceIcons[viewEntry.source.type] ?? Tag;
                    return (
                      <Badge variant="outline" className="gap-1">
                        <Icon className="size-3.5 shrink-0" />
                        {viewEntry.source.type}
                        {viewEntry.source.name ? `: ${viewEntry.source.name}` : ""}
                      </Badge>
                    );
                  })()}
                {viewEntry.timestamp && (
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {timeAgo(viewEntry.timestamp)}
                  </span>
                )}
              </div>
            </DialogHeader>
            <Separator className="shrink-0" />
            <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
              {viewEntry.content}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </SandboxOfflineGuard>
  );
}
