"use client";

import * as React from "react";
import { SunMoon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@clawrun/ui/components/ui/sidebar";
import { Skeleton } from "@clawrun/ui/components/ui/skeleton";
import { Switch } from "@clawrun/ui/components/ui/switch";
import { SandboxStatus } from "./sandbox-status";

export function NavSecondary({
  items,
  ...props
}: {
  items: {
    title: string;
    url: string;
    icon: LucideIcon;
  }[];
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          <SandboxStatus />
          <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
            <SidebarMenuButton asChild>
              <label>
                <SunMoon />
                <span>Dark Mode</span>
                {mounted ? (
                  <Switch
                    className="ml-auto"
                    checked={resolvedTheme !== "light"}
                    onCheckedChange={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                  />
                ) : (
                  <Skeleton className="ml-auto h-4 w-8 rounded-full" />
                )}
              </label>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {items.map((item) => {
            const isExternal = item.url.startsWith("http");
            // Logout and other action routes must use plain <a> to avoid
            // Next.js <Link> prefetching triggering the action on page load.
            const useAnchor = isExternal || item.url.startsWith("/auth/");
            const Comp = useAnchor ? "a" : Link;
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild>
                  <Comp
                    href={item.url}
                    {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </Comp>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
