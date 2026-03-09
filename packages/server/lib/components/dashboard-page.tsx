"use client";

import { useApiClient, useQuery } from "../hooks/use-api-client";
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
import type { AgentStatus, CostInfo, HealthResult } from "@clawrun/agent";
import { Tooltip, TooltipContent, TooltipTrigger } from "@clawrun/ui/components/ui/tooltip";
import { Server, Zap, Activity, TrendingUp, TrendingDown } from "lucide-react";
import { ProviderLogo } from "./provider-logo";

interface HealthData extends HealthResult {
  provider: string;
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

  // When sandbox is offline, treat status/cost data as unavailable
  // (useQuery retains stale data on error, so we gate on health instead)
  const statusData = isOnline ? status.data : null;
  const costData = isOnline ? cost.data : null;

  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      {/* Sandbox status */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Sandbox</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {health.loading ? <Skeleton className="h-8 w-20" /> : isOnline ? "Online" : "Offline"}
          </CardTitle>
          <CardAction>
            <Badge variant="outline" className="capitalize bg-muted/60 dark:bg-muted">
              <Server className="size-3" />
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
            {status.loading && isOnline ? (
              <Skeleton className="h-8 w-32" />
            ) : !isOnline || status.error ? (
              <span className="text-lg text-muted-foreground">—</span>
            ) : (
              <div className="flex flex-col gap-0.5">
                <span className="text-lg truncate">{statusData?.provider ?? "—"}</span>
                {statusData?.model && (
                  <span className="text-sm font-medium text-muted-foreground truncate">
                    {statusData.model}
                  </span>
                )}
              </div>
            )}
          </CardTitle>
          <CardAction>
            <Badge variant="outline" className="capitalize bg-muted/60 dark:bg-muted">
              <Zap className="size-3" />
              AI
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            {statusData?.memoryBackend
              ? `Memory: ${statusData.memoryBackend}`
              : "Memory backend unknown"}
          </div>
        </CardFooter>
      </Card>

      {/* Uptime */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Uptime</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {status.loading && isOnline ? (
              <Skeleton className="h-8 w-16" />
            ) : statusData?.uptime != null ? (
              formatUptime(statusData.uptime)
            ) : (
              "—"
            )}
          </CardTitle>
          <CardAction>
            {statusData?.uptime != null ? (
              <Badge variant="outline" className="capitalize bg-muted/60 dark:bg-muted">
                <TrendingUp className="size-3" />
                Live
              </Badge>
            ) : (
              <Badge variant="outline" className="capitalize bg-muted/60 dark:bg-muted">
                <TrendingDown className="size-3" />
                Idle
              </Badge>
            )}
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          {statusData?.channels && statusData.channels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {statusData.channels.map((ch) => (
                <Badge
                  key={ch}
                  variant="outline"
                  className="capitalize bg-muted/60 text-xs dark:bg-muted"
                >
                  {ch}
                </Badge>
              ))}
            </div>
          )}
          {(!statusData?.channels || statusData.channels.length === 0) && (
            <div className="text-muted-foreground">No active channels</div>
          )}
        </CardFooter>
      </Card>

      {/* Cost */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Cost</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {cost.loading && isOnline ? (
              <Skeleton className="h-8 w-20" />
            ) : !isOnline || cost.error ? (
              <span className="text-lg text-muted-foreground">—</span>
            ) : (
              <>
                {formatCost(costData?.dailyCost)}
                <span className="text-sm font-medium text-muted-foreground">/day</span>
              </>
            )}
          </CardTitle>
          <CardAction>
            <Badge variant="outline" className="capitalize bg-muted/60 dark:bg-muted">
              <Activity className="size-3" />
              Usage
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 font-medium">
            Session: {formatCost(costData?.sessionCost)} &middot; Monthly:{" "}
            {formatCost(costData?.monthlyCost)}
          </div>
          {costData?.totalTokens != null && (
            <div className="text-muted-foreground">
              {costData.totalTokens.toLocaleString()} tokens &middot;{" "}
              {costData.requestCount?.toLocaleString() ?? 0} requests
            </div>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

export default function DashboardPage() {
  const client = useApiClient();
  const poll = { pollInterval: 15_000 };
  const health = useQuery<HealthData>(
    (s) => client.health(s) as Promise<HealthData>,
    [client],
    poll,
  );
  const status = useQuery((s) => client.getStatus(s), [client], poll);
  const cost = useQuery((s) => client.getCost(s), [client], poll);

  const isOnline = health.data?.sandbox?.running ?? false;
  const statusData = isOnline ? status.data : null;

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
              {status.loading && isOnline ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : !isOnline || status.error ? (
                <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-4">
                  <Server className="size-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Sandbox is offline — health data unavailable
                  </p>
                </div>
              ) : !statusData?.health?.length ? (
                <p className="text-sm text-muted-foreground">No health data available</p>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {statusData.health.map((h) => (
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
                          <span>
                            {" "}
                            &middot; {h.restarts} restart{h.restarts !== 1 ? "s" : ""}
                          </span>
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
