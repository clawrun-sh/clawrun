"use client";

import { IconLoader2, IconPlayerPlay, IconServer } from "@tabler/icons-react";
import { Button } from "@clawrun/ui/components/ui/button";
import { SidebarMenuItem, SidebarMenuButton } from "@clawrun/ui/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@clawrun/ui/components/ui/tooltip";
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
import { useSandboxState } from "../hooks/use-sandbox-state";

export function SandboxStatus() {
  const { state, transitionLabel, start, stop } = useSandboxState();

  // Offline — primary action button
  if (state === "offline") {
    return (
      <SidebarMenuItem>
        <Button variant="default" size="sm" className="w-full justify-start gap-2" onClick={start}>
          <IconPlayerPlay className="size-4" />
          Start Sandbox
        </Button>
      </SidebarMenuItem>
    );
  }

  // Running — clickable with tooltip + confirmation to stop
  if (state === "running") {
    return (
      <SidebarMenuItem>
        <AlertDialog>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertDialogTrigger asChild>
                <SidebarMenuButton className="cursor-pointer">
                  <IconServer />
                  <span>Sandbox</span>
                  <span className="ml-auto size-2 shrink-0 rounded-full bg-emerald-500" />
                </SidebarMenuButton>
              </AlertDialogTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">Stop Sandbox</TooltipContent>
          </Tooltip>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Stop Sandbox?</AlertDialogTitle>
              <AlertDialogDescription>
                The sandbox will be snapshotted and stopped. It will automatically wake on the next
                incoming message or you can start it again manually.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={stop}
              >
                Stop Sandbox
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SidebarMenuItem>
    );
  }

  // Loading / transitioning — non-interactive with status dot
  const dotColor =
    state === "transitioning" ? "bg-amber-500 animate-pulse" : "bg-muted-foreground/40";

  return (
    <SidebarMenuItem>
      <SidebarMenuButton className="pointer-events-none">
        <IconLoader2 className="animate-spin" />
        <span>Sandbox</span>
        <span className={`ml-auto size-2 shrink-0 rounded-full ${dotColor}`} />
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
