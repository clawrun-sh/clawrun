export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

export interface MessageStore {
  saveMessage(
    chatId: string,
    role: "user" | "assistant",
    content: string,
  ): Promise<void>;
  getRecentMessages(chatId: string, limit?: number): Promise<ChatMessage[]>;
}
