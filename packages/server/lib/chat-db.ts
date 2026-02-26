"use client";

import Dexie from "dexie";
import type { UIMessage } from "ai";

class ChatDatabase extends Dexie {
  history!: Dexie.Table<{ id: string; messages: UIMessage[] }, string>;

  constructor() {
    super("clawrun-chat");
    this.version(1).stores({
      history: "id",
    });
  }
}

export const db = new ChatDatabase();

const CHAT_KEY = "default";

export async function loadMessages(): Promise<UIMessage[]> {
  const row = await db.history.get(CHAT_KEY);
  if (!Array.isArray(row?.messages)) return [];
  return row.messages;
}

export async function saveMessages(messages: UIMessage[]): Promise<void> {
  await db.history.put({ id: CHAT_KEY, messages });
}

export async function clearMessages(): Promise<void> {
  await db.history.delete(CHAT_KEY);
}
