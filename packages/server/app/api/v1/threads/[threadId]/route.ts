export const dynamic = "force-dynamic";
import { handleGetThread } from "@/lib/handlers/threads";

export async function GET(req: Request, { params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  return handleGetThread(req, threadId);
}
