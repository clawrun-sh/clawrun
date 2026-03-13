"use client";

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
import { Tooltip, TooltipContent, TooltipTrigger } from "@clawrun/ui/components/ui/tooltip";
import { Server, Zap, Activity, TrendingUp, TrendingDown } from "lucide-react";
import { ProviderLogo } from "./provider-logo";
import { useDashboardData, type DashboardSnapshot } from "../hooks/use-dashboard-data";

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatCost(value?: number): string {
  if (value == null) return "\u2014";
  return `$${value.toFixed(4)}`;
}

function SectionCards({
  health,
  status,
  cost,
  loading,
}: {
  health: DashboardSnapshot["health"] | undefined;
  status: AgentStatus | null | undefined;
  cost: CostInfo | null | undefined;
  loading: boolean;
}) {
  const isOnline = health?.sandbox?.running ?? false;

  // When sandbox is offline, treat status/cost data as unavailable
  const statusData = isOnline ? status : null;
  const costData = isOnline ? cost : null;

  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      {/* Sandbox status */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Sandbox</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {loading ? <Skeleton className="h-8 w-20" /> : isOnline ? "Online" : "Offline"}
          </CardTitle>
          <CardAction>
            <Badge variant="outline" className="capitalize bg-muted/60 dark:bg-muted">
              <Server className="size-3" />
              {health?.sandbox?.status ?? (isOnline ? "running" : "stopped")}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            {health?.provider && (
              <ProviderLogo provider={health.provider} size={14} className="shrink-0" />
            )}
            {health?.provider
              ? health.provider.charAt(0).toUpperCase() + health.provider.slice(1)
              : "\u2014"}
            <span>&middot;</span>
            Agent: {health?.agent ?? "\u2014"}
          </div>
        </CardFooter>
      </Card>

      {/* Provider / Model */}
      <Card className="@container/card">
        <CardHeader>
          <CardDescription>Provider / Model</CardDescription>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {loading && isOnline ? (
              <Skeleton className="h-8 w-32" />
            ) : !isOnline ? (
              <span className="text-lg text-muted-foreground">&mdash;</span>
            ) : (
              <div className="flex flex-col gap-0.5">
                <span className="text-lg truncate">{statusData?.provider ?? "\u2014"}</span>
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
            {loading && isOnline ? (
              <Skeleton className="h-8 w-16" />
            ) : statusData?.uptime != null ? (
              formatUptime(statusData.uptime)
            ) : (
              "\u2014"
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
            {loading && isOnline ? (
              <Skeleton className="h-8 w-20" />
            ) : !isOnline ? (
              <span className="text-lg text-muted-foreground">&mdash;</span>
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
  const { data, error } = useDashboardData();
  const loading = !data && !error;

  const health = data?.health;
  const statusData = data?.status ?? null;
  const costData = data?.cost ?? null;

  const isOnline = health?.sandbox?.running ?? false;
  const displayStatus = isOnline ? statusData : null;

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <SectionCards health={health} status={statusData} cost={costData} loading={loading} />

        {/* Health grid */}
        <div className="px-4 lg:px-6">
          <Card>
            <CardHeader>
              <CardTitle>Health</CardTitle>
              <CardDescription>Agent process health status</CardDescription>
            </CardHeader>
            <CardContent>
              {loading && isOnline ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : !isOnline ? (
                <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-4">
                  <Server className="size-4 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Sandbox is offline — health data unavailable
                  </p>
                </div>
              ) : !displayStatus?.health?.length ? (
                <p className="text-sm text-muted-foreground">No health data available</p>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {displayStatus.health.map((h) => (
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
