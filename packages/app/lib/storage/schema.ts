import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    chatId: text("chat_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("messages_chat_id_created_at_idx").on(table.chatId, table.createdAt),
  ],
);
