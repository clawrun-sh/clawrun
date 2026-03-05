"use client";

import { useSidebar } from "fumadocs-ui/components/sidebar/base";
import { useCallback, useRef } from "react";

export function SidebarDragHandle() {
  const { collapsed, setCollapsed } = useSidebar();
  const startX = useRef(0);
  const dragging = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startX.current = e.clientX;
      dragging.current = true;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = startX.current - ev.clientX;
        if (!collapsed && delta > 60) {
          setCollapsed(true);
          dragging.current = false;
          cleanup();
        } else if (collapsed && delta < -60) {
          setCollapsed(false);
          dragging.current = false;
          cleanup();
        }
      };

      const onMouseUp = () => {
        dragging.current = false;
        cleanup();
      };

      const cleanup = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [collapsed, setCollapsed],
  );

  return (
    <div
      onMouseDown={onMouseDown}
      className="fixed top-0 bottom-0 z-50 hidden w-1 cursor-col-resize select-none md:block bg-transparent hover:bg-fd-muted-foreground/25 transition-colors"
      style={{ left: "var(--fd-sidebar-width)" }}
    />
  );
}
