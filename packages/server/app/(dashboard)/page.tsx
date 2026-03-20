import type { Metadata } from "next";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";
export { default } from "@/lib/components/dashboard-page";
