import type { Metadata } from "next";

export const metadata: Metadata = { title: "Logs" };
export const dynamic = "force-dynamic";
export { default } from "@/lib/components/logs-page";
