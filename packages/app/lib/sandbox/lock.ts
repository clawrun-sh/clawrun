import { getLockStore } from "../storage/state";

const LOCK_KEY = "sandbox_create";
const STALE_TIMEOUT_MS = 60_000;

export async function tryAcquireCreationLock(): Promise<string | null> {
  const lock = getLockStore();
  if (!lock) return crypto.randomUUID(); // No lock store — proceed without lock
  return lock.tryAcquire(LOCK_KEY, STALE_TIMEOUT_MS);
}

export async function releaseCreationLock(nonce: string): Promise<void> {
  try {
    const lock = getLockStore();
    if (!lock) return;
    await lock.release(LOCK_KEY, nonce);
  } catch {
    // Best-effort — lock will expire via TTL
  }
}
