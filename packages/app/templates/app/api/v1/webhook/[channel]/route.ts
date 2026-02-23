export { dynamic, fetchCache } from "@cloudclaw/app/api/webhook-wake";
import { handleWakeWebhook } from "@cloudclaw/app/api/webhook-wake";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ channel: string }> },
) {
  const { channel } = await params;
  return handleWakeWebhook(req, channel);
}
