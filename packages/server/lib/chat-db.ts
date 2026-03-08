"use client";

import type { UIMessage } from "ai";
import Dexie from "dexie";

class ChatDatabase extends Dexie {
  sessions!: Dexie.Table<{ id: string; threadId: string }, string>;
  messages!: Dexie.Table<{ threadId: string; messages: UIMessage[] }, string>;

  constructor() {
    super("clawrun-chat");
    this.version(3).stores({ sessions: "id", messages: "threadId" });
    this.version(2).stores({ sessions: "id", history: null });
    this.version(1).stores({ history: "id" });
  }
}

const db = new ChatDatabase();

const SESSION_KEY = "default";

export async function loadThreadId(): Promise<string | null> {
  try {
    const row = await db.sessions.get(SESSION_KEY);
    return row?.threadId ?? null;
  } catch {
    return null;
  }
}

export async function saveThreadId(threadId: string): Promise<void> {
  await db.sessions.put({ id: SESSION_KEY, threadId });
}

export async function loadMessages(threadId: string): Promise<UIMessage[]> {
  try {
    const row = await db.messages.get(threadId);
    return row?.messages ?? [];
  } catch {
    return [];
  }
}

export async function saveMessages(threadId: string, messages: UIMessage[]): Promise<void> {
  await db.messages.put({ threadId, messages });
}

export async function clearMessages(threadId: string): Promise<void> {
  try {
    await db.messages.delete(threadId);
  } catch {}
}
