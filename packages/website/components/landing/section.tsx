import type { ReactNode, ComponentType } from "react";
import { cn } from "@/lib/utils";

export function Section({
  children,
  label,
  icon: Icon,
  id,
  alt,
}: {
  children: ReactNode;
  label?: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  id?: string;
  alt?: boolean;
}) {
  return (
    <section id={id} className={cn(alt ? "bg-secondary" : "bg-background")}>
      <div className="mx-auto max-w-5xl">
        <div className="border-l border-r border-border">
          {label && (
            <div className="flex items-center gap-2.5 border-b border-t border-border px-6 py-3">
              {Icon ? (
                <Icon size={14} className="text-primary" aria-hidden="true" />
              ) : (
                <div className="h-1.5 w-1.5 bg-primary" aria-hidden="true" />
              )}
              <h2 className="text-xs font-normal uppercase tracking-[0.2em] text-dim">{label}</h2>
            </div>
          )}
          {children}
        </div>
      </div>
    </section>
  );
}
