"use client";

import { usePathname } from "next/navigation";
import { Separator } from "@clawrun/ui/components/ui/separator";
import { SidebarTrigger } from "@clawrun/ui/components/ui/sidebar";
import { useHeaderActions } from "./header-actions";

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/chat": "Chat",
  "/threads": "Threads",
  "/tools": "Tools",
  "/config": "Config",
  "/memory": "Memory",
  "/cron": "Cron Jobs",
  "/logs": "Logs",
};

export function SiteHeader() {
  const pathname = usePathname();
  const { actions: pageActions } = useHeaderActions();

  const title =
    PAGE_TITLES[pathname] ??
    Object.entries(PAGE_TITLES).find(
      ([path]) => path !== "/" && pathname.startsWith(path),
    )?.[1] ??
    "ClawRun";

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">{title}</h1>
        {pageActions && (
          <div className="ml-auto flex items-center gap-2">
            {pageActions}
          </div>
        )}
      </div>
    </header>
  );
}
