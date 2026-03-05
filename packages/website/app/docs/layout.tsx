import type { ReactNode } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";
import { SidebarDragHandle } from "@/components/docs/sidebar-drag-handle";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{ enabled: false }}
      sidebar={{ collapsible: false }}
      containerProps={{
        style: {
          "--fd-banner-height": "3.5rem",
          "--fd-layout-width": "100%",
        } as React.CSSProperties,
      }}
    >
      <SidebarDragHandle />
      {children}
    </DocsLayout>
  );
}
