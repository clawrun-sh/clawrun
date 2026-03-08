import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cron Jobs" };
export const dynamic = "force-dynamic";
export { default } from "@/lib/components/cron-page";
