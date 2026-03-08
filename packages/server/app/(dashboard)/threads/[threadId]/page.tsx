import type { Metadata } from "next";
import ThreadDetailPage from "@/lib/components/thread-detail-page";

export const metadata: Metadata = { title: "Thread" };
export const dynamic = "force-dynamic";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  return <ThreadDetailPage threadId={threadId} />;
}
