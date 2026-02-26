import { useState, useEffect } from "react";
import type { UIMessage } from "ai";
import { loadMessages, saveMessages, clearMessages } from "../chat-db";

export function useChatHistory() {
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadMessages()
      .then((msgs) => setInitialMessages(msgs))
      .catch(() => {}) // IndexedDB unavailable — start fresh
      .finally(() => setLoaded(true));
  }, []);

  return { initialMessages, loaded, saveMessages, clearMessages };
}
