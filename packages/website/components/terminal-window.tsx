import type { ReactNode } from "react";

export function TerminalWindow({
  title = "terminal",
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="region"
      aria-label={title}
      className={`border border-term-border bg-term-bg font-mono ${className ?? ""}`}
    >
      <div
        className="flex items-center gap-2 border-b border-term-border px-4 py-2"
        aria-hidden="true"
      >
        <div className="h-2.5 w-2.5 rounded-full bg-term-red" />
        <div className="h-2.5 w-2.5 rounded-full bg-term-yellow" />
        <div className="h-2.5 w-2.5 rounded-full bg-term-green" />
        <span className="ml-2 text-xs text-term-dim">{title}</span>
      </div>
      {children}
    </div>
  );
}
