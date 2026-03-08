import type { Metadata } from "next";

export const metadata: Metadata = { title: "Threads" };
export const dynamic = "force-dynamic";
export { default } from "@/lib/components/threads-page";
