export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 150;
import { handleWakeWebhook, handleWakeWebhookGet } from "@clawrun/server/api/webhook-wake";

export async function POST(req: Request, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  return handleWakeWebhook(req, channel);
}

export async function GET(req: Request, { params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  return handleWakeWebhookGet(req, channel);
}
