/**
 * Postgres-based creation lock to prevent concurrent sandbox creation.
 *
 * Uses a single-row table with an atomic INSERT ... ON CONFLICT pattern.
 * The lock auto-expires after STALE_TIMEOUT_MS so a crashed invocation
 * doesn't permanently block creation.
 *
 * Falls back to "always proceed" if POSTGRES_URL is not configured.
 */
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

const LOCK_KEY = "sandbox_create";
const STALE_TIMEOUT_MS = 60_000; // 60s — generous for sandbox creation

let tableInitialized = false;

function getSql(): NeonQueryFunction<false, false> | null {
  const url = process.env.POSTGRES_URL;
  if (!url) return null;
  return neon(url);
}

async function ensureTable(
  sql: NeonQueryFunction<false, false>,
): Promise<void> {
  if (tableInitialized) return;
  await sql`
    CREATE TABLE IF NOT EXISTS sandbox_lock (
      key TEXT PRIMARY KEY,
      acquired_at BIGINT NOT NULL,
      nonce TEXT NOT NULL
    )
  `;
  tableInitialized = true;
}

/**
 * Try to acquire the creation lock.
 * Returns a nonce string if acquired, null if another invocation holds it.
 * If no database is configured, always returns a nonce (no locking).
 */
export async function tryAcquireCreationLock(): Promise<string | null> {
  const sql = getSql();
  if (!sql) return crypto.randomUUID(); // No DB — proceed without lock

  await ensureTable(sql);
  const nonce = crypto.randomUUID();
  const nowMs = Date.now();
  const staleThreshold = nowMs - STALE_TIMEOUT_MS;

  // Atomic: insert if no lock exists, or replace if existing lock is stale.
  // If the lock exists and is fresh, the WHERE clause prevents the update
  // and RETURNING yields no rows.
  const result = await sql`
    INSERT INTO sandbox_lock (key, acquired_at, nonce)
    VALUES (${LOCK_KEY}, ${nowMs}, ${nonce})
    ON CONFLICT (key) DO UPDATE
      SET acquired_at = ${nowMs}, nonce = ${nonce}
      WHERE sandbox_lock.acquired_at < ${staleThreshold}
    RETURNING nonce
  `;

  if (result.length > 0 && result[0].nonce === nonce) {
    return nonce;
  }
  return null;
}

/**
 * Release the creation lock. Only deletes if the nonce matches (our lock).
 */
export async function releaseCreationLock(nonce: string): Promise<void> {
  try {
    const sql = getSql();
    if (!sql) return;
    await sql`
      DELETE FROM sandbox_lock
      WHERE key = ${LOCK_KEY} AND nonce = ${nonce}
    `;
  } catch {
    // Best-effort — lock will expire via stale timeout
  }
}
