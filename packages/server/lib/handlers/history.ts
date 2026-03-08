import { handleGetThread } from "./threads";

/**
 * Legacy history endpoint — delegates to the threads handler.
 * @deprecated Use GET /api/v1/threads/:threadId instead.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const threadId = url.searchParams.get("threadId")?.trim() ?? "";
  return handleGetThread(req, threadId);
}
