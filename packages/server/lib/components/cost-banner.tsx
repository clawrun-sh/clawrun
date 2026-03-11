"use client";

import type { CostInfo } from "@clawrun/agent";
import { AlertTriangle, XCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@clawrun/ui/components/ui/alert";
import { SidebarMenuItem } from "@clawrun/ui/components/ui/sidebar";
import { useApiClient, useQuery } from "../hooks/use-api-client";
import { useSandboxState } from "../hooks/use-sandbox-state";

function formatCost(value?: number): string {
  if (value == null) return "—";
  return `$${value.toFixed(4)}`;
}

function CostBannerInner({ costData }: { costData: CostInfo }) {
  const checks: { pct: number; label: string; current: number; limit: number }[] = [];

  if (costData.dailyCost != null && costData.dailyLimitUsd != null && costData.dailyLimitUsd > 0) {
    checks.push({
      pct: (costData.dailyCost / costData.dailyLimitUsd) * 100,
      label: "daily",
      current: costData.dailyCost,
      limit: costData.dailyLimitUsd,
    });
  }
  if (
    costData.monthlyCost != null &&
    costData.monthlyLimitUsd != null &&
    costData.monthlyLimitUsd > 0
  ) {
    checks.push({
      pct: (costData.monthlyCost / costData.monthlyLimitUsd) * 100,
      label: "monthly",
      current: costData.monthlyCost,
      limit: costData.monthlyLimitUsd,
    });
  }

  if (checks.length === 0) return null;

  const worst = checks.reduce((a, b) => (b.pct > a.pct ? b : a));
  if (worst.pct < 50) return null;

  const exceeded = worst.pct >= 100;
  const critical = worst.pct >= 80;

  const title = exceeded
    ? `${worst.label.charAt(0).toUpperCase() + worst.label.slice(1)} limit reached`
    : `${Math.round(worst.pct)}% of ${worst.label} limit`;

  const detail = `${formatCost(worst.current)} / ${formatCost(worst.limit)} ${worst.label}${exceeded ? " — agent may be blocked" : ""}`;

  return (
    <SidebarMenuItem>
      {exceeded || critical ? (
        <Alert variant="destructive" className="px-2 py-1.5 text-xs">
          {exceeded ? <XCircle /> : <AlertTriangle />}
          <AlertTitle className="text-xs">{title}</AlertTitle>
          <AlertDescription className="text-xs">{detail}</AlertDescription>
        </Alert>
      ) : (
        <Alert className="border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-600 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-400">
          <AlertTriangle />
          <AlertTitle className="text-xs">{title}</AlertTitle>
          <AlertDescription className="text-xs text-amber-600/90 dark:text-amber-400/90">
            {detail}
          </AlertDescription>
        </Alert>
      )}
    </SidebarMenuItem>
  );
}

export function CostBanner() {
  const client = useApiClient();
  const { state } = useSandboxState();

  const isOnline = state === "running";
  const { data } = useQuery<CostInfo>((s) => client.getCost(s), [client], {
    pollInterval: 15_000,
    enabled: isOnline,
  });

  if (!isOnline || !data) return null;

  return <CostBannerInner costData={data} />;
}
