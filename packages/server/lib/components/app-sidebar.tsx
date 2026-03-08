"use client";

import * as React from "react";
import {
  IconDashboard,
  IconMessage,
  IconMessages,
  IconTool,
  IconSettings,
  IconBrain,
  IconClock,
  IconFileText,
  IconHelp,
} from "@tabler/icons-react";
import { Logo } from "./logo";

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@clawrun/ui/components/ui/sidebar";
import { NavMain } from "./nav-main";
import { NavSecondary } from "./nav-secondary";

const data = {
  navMain: [
    { title: "Dashboard", url: "/", icon: IconDashboard },
    { title: "Chat", url: "/chat", icon: IconMessage },
    { title: "Threads", url: "/threads", icon: IconMessages },
    { title: "Tools", url: "/tools", icon: IconTool },
    { title: "Config", url: "/config", icon: IconSettings },
    { title: "Memory", url: "/memory", icon: IconBrain },
    { title: "Cron", url: "/cron", icon: IconClock },
    { title: "Logs", url: "/logs", icon: IconFileText },
  ],
  navSecondary: [
    { title: "Get Help", url: "https://clawrun.sh/docs", icon: IconHelp },
  ],
};

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  instanceName?: string;
  /** @deprecated kept for backward-compat with older deployed layouts */
  version?: string;
}

export function AppSidebar({ instanceName, version: _, ...props }: AppSidebarProps) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <a href="/">
                <Logo size={20} className="shrink-0 text-primary" />
                <span className="text-base font-semibold font-mono">
                  {instanceName || "ClawRun"}
                </span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
    </Sidebar>
  );
}
