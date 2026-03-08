"use client";

import { useApi } from "../hooks/use-api";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@clawrun/ui/components/ui/card";
import { Badge } from "@clawrun/ui/components/ui/badge";
import { Skeleton } from "@clawrun/ui/components/ui/skeleton";
import type { AgentStatus, CostInfo } from "@clawrun/agent";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@clawrun/ui/components/ui/tooltip";
import {
  IconServer,
  IconBolt,
  IconActivity,
  IconTrendingUp,
  IconTrendingDown,
} from "@tabler/icons-react";
import { ProviderLogo } from "./provider-logo";

interface HealthData {
  status: string;
  agent: string;
  provider: string;
  sandbox: { running: boolean; status?: string };
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatCost(value?: number): string {
  if (value == null) return "—";
  return `$${value.toFixed(4)}`;
}

function SectionCards({
  health,
  status,
  cost,
}: {
  health: { data: HealthData | null; loading: boolean };
  status: { data: AgentStatus | null; loading: boolean; error: string | null };
  cost: { data: CostInfo | null; loading: boolean; error: string | null };
}) {
  const isOnline = health.data?.sandbox?.running ?? false;

  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      {/* Sandbox status */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Sandbox</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {health.loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              isOnline ? "Online" : "Offline"
            )}
          </CardTitle>
          <CardAction>
            <Badge variant="outline" className="capitalize bg-muted/60 dark:bg-muted">
              <IconServer className="size-3" />
              {health.data?.sandbox?.status ?? (isOnline ? "running" : "stopped")}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            {health.data?.provider && (
              <ProviderLogo provider={health.data.provider} size={14} className="shrink-0" />
            )}
            {health.data?.provider
              ? health.data.provider.charAt(0).toUpperCase() + health.data.provider.slice(1)
              : "—"}
            <span>&middot;</span>
            Agent: {health.data?.agent ?? "—"}
          </div>
        </CardFooter>
      </Card>

      {/* Provider / Model */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Provider / Model</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {status.loading ? (
              <Skeleton className="h-8 w-32" />
            ) : status.error ? (
              <span className="text-lg text-muted-foreground">—</span>
            ) : (
              <div className="flex flex-col gap-0.5">
                <span className="text-lg truncate">
                  {status.data?.provider ?? "—"}
                </span>
                {status.data?.model && (
                  <span className="text-sm font-medium text-muted-foreground truncate">
                    {status.data.model}
                  </span>
                )}
              </div>
            )}
          </CardTitle>
          <CardAction>
            <Badge variant="outline" className="capitalize bg-muted/60 dark:bg-muted">
              <IconBolt className="size-3" />
              AI
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {status.data?.memoryBackend
              ? `Memory: ${status.data.memoryBackend}`
              : "Memory backend unknown"}
          </div>
        </CardFooter>
      </Card>

      {/* Uptime */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Uptime</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {status.loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              status.data?.uptime != null
                ? formatUptime(status.data.uptime)
                : "—"
            )}
          </CardTitle>
          <CardAction>
            {status.data?.uptime != null ? (
              <Badge variant="outline" className="capitalize bg-muted/60 dark:bg-muted">
                <IconTrendingUp className="size-3" />
                Live
              </Badge>
            ) : (
              <Badge variant="outline" className="capitalize bg-muted/60 dark:bg-muted">
                <IconTrendingDown className="size-3" />
                Idle
              </Badge>
            )}
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          {status.data?.channels && status.data.channels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {status.data.channels.map((ch) => (
                <Badge key={ch} variant="outline" className="capitalize bg-muted/60 text-xs dark:bg-muted">
                  {ch}
                </Badge>
              ))}
            </div>
          )}
          {(!status.data?.channels || status.data.channels.length === 0) && (
            <div className="text-muted-foreground">No active channels</div>
          )}
        </CardFooter>
      </Card>

      {/* Cost */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Cost</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {cost.loading ? (
              <Skeleton className="h-8 w-20" />
            ) : cost.error ? (
              <span className="text-lg text-muted-foreground">—</span>
            ) : (
              <>
                {formatCost(cost.data?.dailyCost)}
                <span className="text-sm font-medium text-muted-foreground">
                  /day
                </span>
              </>
            )}
          </CardTitle>
          <CardAction>
            <Badge variant="outline" className="capitalize bg-muted/60 dark:bg-muted">
              <IconActivity className="size-3" />
              Usage
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Session: {formatCost(cost.data?.sessionCost)} &middot; Monthly:{" "}
            {formatCost(cost.data?.monthlyCost)}
          </div>
          {cost.data?.totalTokens != null && (
            <div className="text-muted-foreground">
              {cost.data.totalTokens.toLocaleString()} tokens &middot;{" "}
              {cost.data.requestCount?.toLocaleString() ?? 0} requests
            </div>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

export default function DashboardPage() {
  const health = useApi<HealthData>("/api/v1/health");
  const status = useApi<AgentStatus>("/api/v1/status");
  const cost = useApi<CostInfo>("/api/v1/cost");

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <SectionCards health={health} status={status} cost={cost} />

        {/* Health grid */}
        <div className="px-4 lg:px-6">
          <Card>
            <CardHeader>
              <CardTitle>Health</CardTitle>
              <CardDescription>Agent process health status</CardDescription>
            </CardHeader>
            <CardContent>
              {status.loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : status.error ? (
                <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-4">
                  <IconServer className="size-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Sandbox is offline — health data unavailable
                  </p>
                </div>
              ) : !status.data?.health?.length ? (
                <p className="text-sm text-muted-foreground">
                  No health data available
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {status.data.health.map((h) => (
                    <Tooltip key={h.name}>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`size-2 shrink-0 rounded-full ${
                              h.status === "ok"
                                ? "bg-emerald-500"
                                : h.status === "warning"
                                  ? "bg-amber-500"
                                  : "bg-red-500"
                            }`}
                          />
                          <span className="text-sm text-muted-foreground">{h.name}</span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <span className="capitalize">{h.status}</span>
                        {h.restarts != null && h.restarts > 0 && (
                          <span> &middot; {h.restarts} restart{h.restarts !== 1 ? "s" : ""}</span>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
