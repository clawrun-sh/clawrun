import type { Metadata } from "next";

export const metadata: Metadata = { title: "Memory" };
export const dynamic = "force-dynamic";
export { default } from "@/lib/components/memory-page";
