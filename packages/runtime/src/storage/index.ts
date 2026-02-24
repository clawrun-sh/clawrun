import type { MessageStore } from "./types.js";
import { NeonMessageStore } from "./neon.js";

export function getMessageStore(): MessageStore | null {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    return null;
  }
  return new NeonMessageStore();
}

export type { ChatMessage, MessageStore } from "./types.js";
