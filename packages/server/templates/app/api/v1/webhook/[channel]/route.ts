export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
import { handleWakeWebhook } from "@cloudclaw/server/api/webhook-wake";

export async function POST(req: Request, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  return handleWakeWebhook(req, channel);
}
