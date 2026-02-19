import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { getDb } from "./neon";
import { sandboxState } from "./schema";
import type { StateStore } from "./state-types";

let tableInitialized = false;

export class PostgresStateStore implements StateStore {
  private async ensureTable(): Promise<void> {
    if (tableInitialized) return;
    const db = getDb();
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sandbox_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    tableInitialized = true;
  }

  async get(key: string): Promise<string | null> {
    await this.ensureTable();
    const db = getDb();
    const rows = await db
      .select({ value: sandboxState.value })
      .from(sandboxState)
      .where(eq(sandboxState.key, key));
    return rows[0]?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.ensureTable();
    const db = getDb();
    await db
      .insert(sandboxState)
      .values({ key, value })
      .onConflictDoUpdate({
        target: sandboxState.key,
        set: { value, updatedAt: new Date() },
      });
  }

  async delete(key: string): Promise<void> {
    await this.ensureTable();
    const db = getDb();
    await db.delete(sandboxState).where(eq(sandboxState.key, key));
  }
}
