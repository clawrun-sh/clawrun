import { getLockStore } from "../storage/state";

const LOCK_KEY = "sandbox_create";
const STALE_TIMEOUT_MS = 60_000;

function requireLockStore() {
  const lock = getLockStore();
  if (!lock) throw new Error("Lock store unavailable — KV is required");
  return lock;
}

export async function tryAcquireCreationLock(): Promise<string | null> {
  return requireLockStore().tryAcquire(LOCK_KEY, STALE_TIMEOUT_MS);
}

export async function releaseCreationLock(nonce: string): Promise<void> {
  try {
    await requireLockStore().release(LOCK_KEY, nonce);
  } catch {
    // Best-effort — lock will expire via TTL
  }
}
