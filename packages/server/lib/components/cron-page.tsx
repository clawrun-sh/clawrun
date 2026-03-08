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
import type { CronJob } from "@clawrun/agent";
import {
  IconClock,
  IconPlus,
  IconTrash,
  IconArrowUp,
  IconArrowDown,
  IconArrowsSort,
} from "@tabler/icons-react";

function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type SortColumn = "nextRun" | "lastRun";
type SortDirection = "asc" | "desc";

function SortIcon({ column, current, direction }: { column: SortColumn; current: SortColumn | null; direction: SortDirection }) {
  if (current !== column) return <IconArrowsSort className="ml-1 inline size-3.5 text-muted-foreground/50" />;
  return direction === "asc"
    ? <IconArrowUp className="ml-1 inline size-3.5" />
    : <IconArrowDown className="ml-1 inline size-3.5" />;
}

export default function CronPage() {
  const { data, loading, error, refetch } = useApi<{ jobs: CronJob[] }>("/api/v1/cron");
  const jobs = data?.jobs ?? [];

  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sorted = useMemo(() => {
    if (!sortColumn) return jobs;
    return Array.from(jobs).sort((a, b) => {
      const aVal = sortColumn === "nextRun" ? a.nextRun : a.lastRun;
      const bVal = sortColumn === "nextRun" ? b.nextRun : b.lastRun;
      const cmp = new Date(aVal || 0).getTime() - new Date(bVal || 0).getTime();
      return sortDirection === "asc" ? cmp : -cmp;
    });
  }, [jobs, sortColumn, sortDirection]);

  const toggleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDirection("desc");
    }
  };

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSchedule, setNewSchedule] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = useCallback(async () => {
    if (!newSchedule.trim() || !newCommand.trim()) return;
    setAdding(true);
    try {
      await apiPost("/api/v1/cron", {
        name: newName.trim() || undefined,
        schedule: newSchedule.trim(),
        command: newCommand.trim(),
      });
      setAddOpen(false);
      setNewName("");
      setNewSchedule("");
      setNewCommand("");
      refetch();
    } catch {}
    setAdding(false);
  }, [newName, newSchedule, newCommand, refetch]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await apiDelete(`/api/v1/cron/${encodeURIComponent(id)}`);
        refetch();
      } catch {}
    },
    [refetch],
  );

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="flex items-center justify-end px-4 lg:px-6">
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <IconPlus className="mr-1 size-4" />
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
                  <Input id="cron-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="my-job" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cron-schedule">Schedule</Label>
                  <Input id="cron-schedule" value={newSchedule} onChange={(e) => setNewSchedule(e.target.value)} placeholder="*/5 * * * *" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cron-command">Command</Label>
                  <Input id="cron-command" value={newCommand} onChange={(e) => setNewCommand(e.target.value)} placeholder="echo hello" />
                </div>
                <Button className="w-full" onClick={handleAdd} disabled={adding || !newSchedule.trim() || !newCommand.trim()}>
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
            <p className="text-sm text-muted-foreground">{error}</p>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <IconClock className="mb-4 size-12 text-muted-foreground" />
              <p className="text-muted-foreground">No cron jobs configured</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-full">Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => toggleSort("nextRun")}
                    >
                      Next Run
                      <SortIcon column="nextRun" current={sortColumn} direction={sortDirection} />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => toggleSort("lastRun")}
                    >
                      Last Run
                      <SortIcon column="lastRun" current={sortColumn} direction={sortDirection} />
                    </TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="font-medium">{job.name ?? job.id}</TableCell>
                      <TableCell>
                        {job.enabled === false ? (
                          <Badge variant="secondary" className="capitalize">Disabled</Badge>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-block size-2 rounded-full bg-emerald-500" />
                            </TooltipTrigger>
                            <TooltipContent>Active</TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(job.nextRun)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(job.lastRun)}</TableCell>
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
                            <TooltipContent>Delete cron job</TooltipContent>
                          </Tooltip>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete cron job?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete &ldquo;{job.name ?? job.id}&rdquo;. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => handleDelete(job.id)}>Delete</AlertDialogAction>
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
