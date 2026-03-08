export const dynamic = "force-dynamic";

import { handleDeleteCronJob } from "@/lib/handlers/agent-cron";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleDeleteCronJob(req, id);
}
