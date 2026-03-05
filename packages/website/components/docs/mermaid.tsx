"use client";

import { useEffect, useRef, useId, useState } from "react";
import mermaid from "mermaid";
import { useTheme } from "next-themes";

const themeConfig = {
  dark: {
    theme: "dark" as const,
    themeVariables: {
      primaryColor: "#2563eb",
      primaryTextColor: "#ffffff",
      primaryBorderColor: "#3b82f6",
      lineColor: "#3e3e44",
      secondaryColor: "#151518",
      tertiaryColor: "#09090b",
      background: "#09090b",
      mainBkg: "#151518",
      nodeBorder: "#333338",
      clusterBkg: "#111114",
      clusterBorder: "#333338",
      titleColor: "#d4d4d4",
      edgeLabelBackground: "#09090b",
      textColor: "#d4d4d4",
      fontSize: "14px",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    },
  },
  light: {
    theme: "default" as const,
    themeVariables: {
      primaryColor: "#2563eb",
      primaryTextColor: "#ffffff",
      primaryBorderColor: "#3b82f6",
      lineColor: "#d4d4d4",
      secondaryColor: "#f5f5f5",
      tertiaryColor: "#ffffff",
      background: "#ffffff",
      mainBkg: "#f5f5f5",
      nodeBorder: "#e5e5e5",
      clusterBkg: "#fafafa",
      clusterBorder: "#e5e5e5",
      titleColor: "#262626",
      edgeLabelBackground: "#ffffff",
      textColor: "#262626",
      fontSize: "14px",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    },
  },
};

export function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, "m");
  const renderCount = useRef(0);
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!ref.current || !mounted) return;

    const config = resolvedTheme === "light" ? themeConfig.light : themeConfig.dark;

    mermaid.initialize({
      startOnLoad: false,
      ...config,
    });

    const renderId = `${id}${renderCount.current++}`;

    mermaid.render(renderId, chart).then(({ svg }) => {
      if (ref.current) ref.current.innerHTML = svg;
    });
  }, [chart, id, resolvedTheme, mounted]);

  // Reserve space before mount to prevent layout shift
  if (!mounted) {
    return <div className="my-6 flex justify-center" style={{ minHeight: 300 }} />;
  }

  return <div ref={ref} className="my-6 flex justify-center [&_svg]:max-w-full" />;
}
