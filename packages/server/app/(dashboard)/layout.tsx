import type { Metadata } from "next";
import { cookies } from "next/headers";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  SidebarInset,
  SidebarProvider,
} from "@clawrun/ui/components/ui/sidebar";
import { AppSidebar } from "@/lib/components/app-sidebar";
import { SiteHeader } from "@/lib/components/site-header";
import { HeaderActionsProvider } from "@/lib/components/header-actions";

import "@/lib/components/theme.css";

function readInstanceName(): string {
  const configPath = join(process.cwd(), "clawrun.json");
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      return config.instance?.name ?? "";
    } catch {}
  }
  return "";
}

const instanceName = readInstanceName();

export const metadata: Metadata = {
  title: {
    template: `%s | ${instanceName || "ClawRun"}`,
    default: instanceName || "ClawRun",
  },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" instanceName={instanceName} />
      <SidebarInset>
        <HeaderActionsProvider>
          <SiteHeader />
          <div className="relative flex flex-1 flex-col">{children}</div>
        </HeaderActionsProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
