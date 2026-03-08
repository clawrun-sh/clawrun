"use client";

import { useCallback, useMemo, useState } from "react";
import { useApi, apiPost, apiDelete } from "../hooks/use-api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@clawrun/ui/components/ui/table";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@clawrun/ui/components/ui/tooltip";
import { Label } from "@clawrun/ui/components/ui/label";
import type { MemoryEntryInfo } from "@clawrun/agent";
import {
  IconBrain,
  IconPlus,
  IconSearch,
  IconTrash,
  IconArrowUp,
  IconArrowDown,
  IconArrowsSort,
} from "@tabler/icons-react";

type SortColumn = "timestamp";
type SortDirection = "asc" | "desc";

function SortIcon({ column, current, direction }: { column: SortColumn; current: SortColumn | null; direction: SortDirection }) {
  if (current !== column) return <IconArrowsSort className="ml-1 inline size-3.5 text-muted-foreground/50" />;
  return direction === "asc"
    ? <IconArrowUp className="ml-1 inline size-3.5" />
    : <IconArrowDown className="ml-1 inline size-3.5" />;
}

export default function MemoryPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const params = new URLSearchParams();
  if (searchQuery) params.set("query", searchQuery);
  if (categoryFilter) params.set("category", categoryFilter);
  const qs = params.toString();

  const { data, loading, error, refetch } = useApi<{ entries: MemoryEntryInfo[] }>(
    `/api/v1/memory${qs ? `?${qs}` : ""}`,
  );

  const entries = data?.entries ?? [];
  const categories = [...new Set(entries.map((e) => e.category).filter(Boolean))] as string[];

  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sorted = useMemo(() => {
    if (!sortColumn) return entries;
    return Array.from(entries).sort((a, b) => {
      const cmp = new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime();
      return sortDirection === "asc" ? cmp : -cmp;
    });
  }, [entries, sortColumn, sortDirection]);

  const toggleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDirection("desc");
    }
  };

  const [addOpen, setAddOpen] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = useCallback(async () => {
    if (!newKey.trim() || !newContent.trim()) return;
    setAdding(true);
    try {
      await apiPost("/api/v1/memory", {
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
  }, [newKey, newContent, newCategory, refetch]);

  const handleDelete = useCallback(
    async (key: string) => {
      try {
        await apiDelete(`/api/v1/memory/${encodeURIComponent(key)}`);
        refetch();
      } catch {}
    },
    [refetch],
  );

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        {/* Controls */}
        <div className="flex items-center justify-between gap-3 px-4 lg:px-6">
          <div className="relative flex-1">
            <IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search memories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {categories.length > 0 && (
            <div className="flex gap-1">
              <Button
                variant={!categoryFilter ? "default" : "outline"}
                size="sm"
                onClick={() => setCategoryFilter("")}
              >
                All
              </Button>
              {categories.map((cat) => (
                <Button
                  key={cat}
                  variant={categoryFilter === cat ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCategoryFilter(cat === categoryFilter ? "" : cat)}
                >
                  {cat}
                </Button>
              ))}
            </div>
          )}
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <IconPlus className="mr-1 size-4" />
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
                  <Input id="mem-key" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="memory_key" />
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
                  <Input id="mem-category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="general" />
                </div>
                <Button className="w-full" onClick={handleAdd} disabled={adding || !newKey.trim() || !newContent.trim()}>
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
              <IconBrain className="mb-4 size-12 text-muted-foreground" />
              <p className="text-muted-foreground">No memories found</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead className="w-full">Content</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => toggleSort("timestamp")}
                    >
                      Timestamp
                      <SortIcon column="timestamp" current={sortColumn} direction={sortDirection} />
                    </TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((entry) => (
                    <TableRow key={entry.key}>
                      <TableCell className="max-w-48 truncate font-mono text-xs">
                        {entry.key}
                      </TableCell>
                      <TableCell className="max-w-96">
                        <p className="line-clamp-2 text-sm">{entry.content}</p>
                      </TableCell>
                      <TableCell>
                        {entry.category && <Badge variant="secondary">{entry.category}</Badge>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {entry.timestamp ? new Date(entry.timestamp).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        <AlertDialog>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <IconTrash className="size-4" />
                                </Button>
                              </AlertDialogTrigger>
                            </TooltipTrigger>
                            <TooltipContent>Delete memory</TooltipContent>
                          </Tooltip>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete memory entry?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete &ldquo;{entry.key}&rdquo;. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(entry.key)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
