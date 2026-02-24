export { dynamic, fetchCache } from "@cloudclaw/server/api/webhook-wake";
import { handleWakeWebhook } from "@cloudclaw/server/api/webhook-wake";

export async function POST(req: Request, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  return handleWakeWebhook(req, channel);
}
