import type { MessageStore } from "./types";
import { NeonMessageStore } from "./neon";

export function getMessageStore(): MessageStore | null {
  if (!process.env.POSTGRES_URL) {
    return null;
  }
  return new NeonMessageStore();
}

export type { ChatMessage, MessageStore } from "./types";
