import type { ReactNode } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{ enabled: false }}
      containerProps={{
        style: {
          "--fd-banner-height": "3.5rem",
          "--fd-layout-width": "100%",
        } as React.CSSProperties,
      }}
    >
      {children}
    </DocsLayout>
  );
}
