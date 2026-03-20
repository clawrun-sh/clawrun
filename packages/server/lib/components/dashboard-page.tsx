"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@clawrun/ui/components/ui/card";
import { Badge } from "@clawrun/ui/components/ui/badge";
import { Skeleton } from "@clawrun/ui/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@clawrun/ui/components/ui/popover";
import type { AgentStatus, CostInfo } from "@clawrun/agent";
import { Server, Brain, Activity, Clock, TrendingUp, TrendingDown, Loader2 } from "lucide-react";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@clawrun/ui/components/ai-elements/prompt-input";
import { SpeechInput } from "@clawrun/ui/components/ai-elements/speech-input";
import type { PromptInputMessage } from "@clawrun/ui/components/ai-elements/prompt-input";
import { ProviderLogo } from "./provider-logo";
import { useDashboardData, type DashboardSnapshot } from "../hooks/use-dashboard-data";
import { useSandboxState } from "../hooks/use-sandbox-state";
import { useFocusOnKeydown } from "../hooks/use-focus-on-keydown";

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatCost(value?: number, short = false): string {
  if (value == null) return "\u2014";
  if (short) {
    if (value < 0.01) return "<$0.01";
    return `$${value.toFixed(2)}`;
  }
  return `$${value.toFixed(4)}`;
}

function HealthDots({ health }: { health?: AgentStatus["health"] }) {
  if (!health?.length) return <span className="text-muted-foreground text-xs">No health data</span>;

  return (
    <div className="flex flex-col gap-1.5 p-1">
      {health.map((h) => (
        <div key={h.name} className="flex items-center gap-2">
          <span
            className={`size-2 shrink-0 rounded-full ${
              h.status === "ok"
                ? "bg-emerald-500"
                : h.status === "warning"
                  ? "bg-amber-500"
                  : "bg-red-500"
            }`}
          />
          <span className="text-sm">{h.name}</span>
          <span className="text-xs text-muted-foreground capitalize">{h.status}</span>
          {h.restarts != null && h.restarts > 0 && (
            <span className="text-xs text-muted-foreground">
              ({h.restarts} restart{h.restarts !== 1 ? "s" : ""})
            </span>
          )}
        </div>
      ))}
    </div>
  );
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
  const statusData = isOnline ? status : null;
  const costData = isOnline ? cost : null;

  return (
    <div className="grid grid-cols-2 gap-3 px-4 @md/main:gap-4 @5xl/main:grid-cols-4 lg:px-6 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs dark:*:data-[slot=card]:bg-card">
      {/* Sandbox status */}
      <Card className="@container/card overflow-hidden">
        <CardHeader>
          <CardDescription>
            <Server className="size-3.5 inline @3xs/card:hidden" />
            <span className="hidden @3xs/card:inline">Sandbox</span>
          </CardDescription>
          <CardTitle className="text-xl font-semibold tabular-nums @sm/card:text-3xl">
            {loading ? <Skeleton className="h-8 w-20" /> : isOnline ? "Online" : "Offline"}
          </CardTitle>
          <CardAction className="hidden @3xs/card:block">
            <Badge variant="outline" className="capitalize bg-muted/60 dark:bg-muted">
              <Server className="size-3" />
              {health?.sandbox?.status ?? (isOnline ? "running" : "stopped")}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="hidden @3xs/card:flex flex-col items-start gap-1.5 text-sm">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
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
      <Card className="@container/card overflow-hidden">
        <CardHeader>
          <CardDescription>
            <Brain className="size-3.5 inline @3xs/card:hidden" />
            <span className="hidden @3xs/card:inline">Provider / Model</span>
          </CardDescription>
          <CardTitle className="text-xl font-semibold tabular-nums @sm/card:text-3xl">
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
          <CardAction className="hidden @3xs/card:block">
            <Badge variant="outline" className="capitalize bg-muted/60 dark:bg-muted">
              <Brain className="size-3" />
              Agent
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="hidden @3xs/card:flex flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 text-xs text-muted-foreground">
            {statusData?.memoryBackend
              ? `Memory: ${statusData.memoryBackend}`
              : "Memory backend unknown"}
          </div>
        </CardFooter>
      </Card>

      {/* Uptime + Health */}
      <Card className="@container/card overflow-hidden">
        <CardHeader>
          <CardDescription>
            <Clock className="size-3.5 inline @3xs/card:hidden" />
            <span className="hidden @3xs/card:inline">Uptime</span>
          </CardDescription>
          <CardTitle className="text-xl font-semibold tabular-nums @sm/card:text-3xl">
            {loading && isOnline ? (
              <Skeleton className="h-8 w-16" />
            ) : statusData?.uptime != null ? (
              formatUptime(statusData.uptime)
            ) : (
              "\u2014"
            )}
          </CardTitle>
          <CardAction className="hidden @3xs/card:block">
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
        <CardFooter className="hidden @3xs/card:flex flex-col items-start gap-1.5 text-sm">
          {isOnline && statusData?.health?.length ? (
            <Popover>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                  {statusData.health.map((h) => (
                    <span
                      key={h.name}
                      className={`size-2 rounded-full ${
                        h.status === "ok"
                          ? "bg-emerald-500"
                          : h.status === "warning"
                            ? "bg-amber-500"
                            : "bg-red-500"
                      }`}
                    />
                  ))}
                  <span className="ml-1">Health</span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto" align="start">
                <HealthDots health={statusData.health} />
              </PopoverContent>
            </Popover>
          ) : (
            <div className="flex flex-wrap gap-1">
              {statusData?.channels && statusData.channels.length > 0 ? (
                statusData.channels.map((ch) => (
                  <Badge
                    key={ch}
                    variant="outline"
                    className="capitalize bg-muted/60 text-xs dark:bg-muted"
                  >
                    {ch}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">No active channels</span>
              )}
            </div>
          )}
        </CardFooter>
      </Card>

      {/* Cost */}
      <Card className="@container/card overflow-hidden">
        <CardHeader>
          <CardDescription>
            <Activity className="size-3.5 inline @3xs/card:hidden" />
            <span className="hidden @3xs/card:inline">Cost</span>
          </CardDescription>
          <CardTitle className="text-xl font-semibold tabular-nums @sm/card:text-3xl">
            {loading && isOnline ? (
              <Skeleton className="h-8 w-20" />
            ) : !isOnline ? (
              <span className="text-lg text-muted-foreground">&mdash;</span>
            ) : (
              <>
                {formatCost(costData?.dailyCost, true)}
                <span className="text-sm font-medium text-muted-foreground">/day</span>
              </>
            )}
          </CardTitle>
          <CardAction className="hidden @3xs/card:block">
            <Badge variant="outline" className="capitalize bg-muted/60 dark:bg-muted">
              <Activity className="size-3" />
              Usage
            </Badge>
          </CardAction>
        </CardHeader>
        <CardFooter className="hidden @3xs/card:flex flex-col items-start gap-1.5 text-sm">
          <div className="line-clamp-1 flex gap-2 text-xs text-muted-foreground">
            Session: {formatCost(costData?.sessionCost)} &middot; Monthly:{" "}
            {formatCost(costData?.monthlyCost)}
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}

function ChatEntry() {
  const [text, setText] = useState("");
  const [starting, setStarting] = useState(false);
  const { state, start } = useSandboxState();
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useFocusOnKeydown(textareaRef);

  const isOffline = state === "offline";
  const isTransitioning = state === "transitioning" || starting;

  const handleSubmit = async (message: PromptInputMessage) => {
    const text = message.text.trim();
    if (!text) return;

    if (isOffline) {
      setStarting(true);
      await start();
      await new Promise((r) => setTimeout(r, 1000));
      setStarting(false);
    }

    router.push(`/chat?prompt=${encodeURIComponent(text)}`);
  };

  return (
    <div className="flex flex-col items-center gap-6 px-4 py-8 md:flex-1 md:justify-center md:py-0 lg:px-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
          What can I help you with?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {isOffline
            ? "Your agent is sleeping. Send a message to wake it up."
            : "Ask your agent anything to get started."}
        </p>
      </div>

      <PromptInput onSubmit={handleSubmit} className="w-full max-w-xl">
        <PromptInputBody>
          <PromptInputTextarea
            ref={textareaRef}
            placeholder={isOffline ? "Type to wake your agent..." : "Ask anything..."}
            disabled={isTransitioning}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <SpeechInput
              className="shrink-0"
              onTranscriptionChange={(t) => setText((prev) => (prev ? `${prev} ${t}` : t))}
              size="icon-sm"
              variant="ghost"
            />
          </PromptInputTools>
          <PromptInputSubmit disabled={isTransitioning || !text.trim()}>
            {isTransitioning ? <Loader2 className="size-4 animate-spin" /> : undefined}
          </PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

export default function DashboardPage() {
  const { data, error } = useDashboardData();
  const loading = !data && !error;

  const health = data?.health;
  const statusData = data?.status ?? null;
  const costData = data?.cost ?? null;

  return (
    <div className="@container/main flex flex-1 flex-col">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <SectionCards health={health} status={statusData} cost={costData} loading={loading} />
      </div>
      <ChatEntry />
    </div>
  );
}
