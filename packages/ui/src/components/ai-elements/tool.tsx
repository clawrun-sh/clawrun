"use client";

import type { ComponentProps, HTMLAttributes, ReactNode } from "react";

import { Badge } from "@clawrun/ui/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@clawrun/ui/components/ui/collapsible";
import { cn } from "@clawrun/ui/lib/utils";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  LoaderIcon,
  WrenchIcon,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export type ToolState =
  | "input-streaming"
  | "input-available"
  | "output-streaming"
  | "output-available"
  | "output-error"
  | "approval-requested"
  | "approval-responded"
  | "output-denied";

/* -------------------------------------------------------------------------- */
/*  Status badge                                                              */
/* -------------------------------------------------------------------------- */

export function getStatusBadge(state: ToolState) {
  switch (state) {
    case "input-streaming":
    case "output-streaming":
      return (
        <Badge variant="secondary" className="gap-1 rounded-full px-1.5 py-0 text-[10px]">
          <LoaderIcon className="size-3 animate-spin" />
          Running
        </Badge>
      );
    case "output-available":
      return (
        <Badge variant="secondary" className="gap-1 rounded-full px-1.5 py-0 text-[10px]">
          <CheckCircleIcon className="size-3" />
          Done
        </Badge>
      );
    case "output-error":
      return (
        <Badge variant="destructive" className="gap-1 rounded-full px-1.5 py-0 text-[10px]">
          <AlertCircleIcon className="size-3" />
          Error
        </Badge>
      );
    case "input-available":
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Tool (root)                                                               */
/* -------------------------------------------------------------------------- */

export type ToolProps = ComponentProps<typeof Collapsible>;

export function Tool({ className, ...props }: ToolProps) {
  return (
    <Collapsible
      className={cn("rounded-lg border bg-card text-card-foreground", className)}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  ToolHeader                                                                */
/* -------------------------------------------------------------------------- */

export interface ToolHeaderProps {
  toolName: string;
  state: ToolState;
  type?: string;
  className?: string;
}

export function ToolHeader({ toolName, state, className }: ToolHeaderProps) {
  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition-colors [&[data-state=open]>svg.chevron]:rotate-90",
        className,
      )}
    >
      <WrenchIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="font-medium">{toolName}</span>
      {getStatusBadge(state)}
      <ChevronRightIcon className="chevron ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200" />
    </CollapsibleTrigger>
  );
}

/* -------------------------------------------------------------------------- */
/*  ToolContent                                                               */
/* -------------------------------------------------------------------------- */

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export function ToolContent({ className, ...props }: ToolContentProps) {
  return <CollapsibleContent className={cn("border-t px-3 py-2", className)} {...props} />;
}

/* -------------------------------------------------------------------------- */
/*  ToolInput                                                                 */
/* -------------------------------------------------------------------------- */

export interface ToolInputProps extends HTMLAttributes<HTMLDivElement> {
  input?: unknown;
}

export function ToolInput({ input, className, ...props }: ToolInputProps) {
  if (
    !input ||
    (typeof input === "object" && Object.keys(input as Record<string, unknown>).length === 0)
  ) {
    return null;
  }

  return (
    <div className={cn("space-y-1", className)} {...props}>
      <p className="text-xs font-medium text-muted-foreground">Input</p>
      <pre className="rounded-md bg-muted/50 p-2 text-xs overflow-x-auto">
        {typeof input === "string" ? input : JSON.stringify(input, null, 2)}
      </pre>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  ToolOutput                                                                */
/* -------------------------------------------------------------------------- */

export interface ToolOutputProps extends HTMLAttributes<HTMLDivElement> {
  output?: unknown;
  errorText?: string;
  children?: ReactNode;
}

export function ToolOutput({ output, errorText, children, className, ...props }: ToolOutputProps) {
  if (!output && !errorText && !children) return null;

  return (
    <div className={cn("mt-2 space-y-1", className)} {...props}>
      <p className="text-xs font-medium text-muted-foreground">Output</p>
      {errorText ? (
        <p className="text-xs text-destructive">{errorText}</p>
      ) : children ? (
        children
      ) : (
        <pre className="rounded-md bg-muted/50 p-2 text-xs overflow-x-auto">
          {typeof output === "string" ? output : JSON.stringify(output, null, 2)}
        </pre>
      )}
    </div>
  );
}
