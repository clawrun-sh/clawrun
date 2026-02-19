import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql, desc, eq } from "drizzle-orm";
import { messages } from "./schema";
import type { ChatMessage, MessageStore } from "./types";

let _db: ReturnType<typeof drizzle> | null = null;
let tableInitialized = false;

/** Shared Drizzle db instance. Reused by NeonMessageStore and PostgresStateStore. */
export function getDb(): ReturnType<typeof drizzle> {
  if (_db) return _db;
  const url = process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("POSTGRES_URL environment variable is required");
  }
  _db = drizzle(neon(url));
  return _db;
}

export class NeonMessageStore implements MessageStore {
  private async ensureTable(): Promise<void> {
    if (tableInitialized) return;
    const db = getDb();
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        chat_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS messages_chat_id_created_at_idx
      ON messages (chat_id, created_at)
    `);
    tableInitialized = true;
  }

  async saveMessage(
    chatId: string,
    role: "user" | "assistant",
    content: string,
  ): Promise<void> {
    await this.ensureTable();
    await getDb().insert(messages).values({ chatId, role, content });
  }

  async getRecentMessages(
    chatId: string,
    limit = 20,
  ): Promise<ChatMessage[]> {
    await this.ensureTable();
    const rows = await getDb()
      .select({
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);

    // Reverse to chronological order
    return rows.reverse().map((row) => ({
      role: row.role as "user" | "assistant",
      content: row.content,
      createdAt: row.createdAt,
    }));
  }
}
