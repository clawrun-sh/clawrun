export const dynamic = "force-dynamic";

import { handleDeleteMemory } from "@/lib/handlers/agent-memory";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  return handleDeleteMemory(req, key);
}
