"use client";

import type { PromptInputMessage } from "@clawrun/ui/components/ai-elements/prompt-input";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@clawrun/ui/components/ai-elements/conversation";
import {
  Message,
  MessageActions,
  MessageAction,
  MessageContent,
  MessageResponse,
} from "@clawrun/ui/components/ai-elements/message";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@clawrun/ui/components/ai-elements/tool";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@clawrun/ui/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@clawrun/ui/components/ai-elements/suggestion";
import { SpeechInput } from "@clawrun/ui/components/ai-elements/speech-input";
import { ThemeToggle } from "@clawrun/ui/components/theme-toggle";
import { Button } from "@clawrun/ui/components/ui/button";
import { Shimmer } from "@clawrun/ui/components/ai-elements/shimmer";
import { CheckIcon, ClipboardIcon, MessageCircleIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useChatHistory } from "../hooks/use-chat-history";

const DATA_URI_IMAGE_RE = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[A-Za-z0-9+/=\s]+)\)/g;

type ContentPart = { type: "text"; content: string } | { type: "image"; alt: string; src: string };

function splitContentParts(text: string): ContentPart[] {
  const parts: ContentPart[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(DATA_URI_IMAGE_RE)) {
    const idx = match.index!;
    if (idx > lastIndex) {
      parts.push({ type: "text", content: text.slice(lastIndex, idx) });
    }
    parts.push({ type: "image", alt: match[1], src: match[2] });
    lastIndex = idx + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.slice(lastIndex) });
  }
  return parts.length > 0 ? parts : [{ type: "text", content: text }];
}

const transport = new DefaultChatTransport({
  api: "/api/v1/chat",
  credentials: "same-origin",
});

const suggestions = ["What can you do?", "Tell me about yourself", "What tools do you have?"];

interface ChatPageProps {
  instanceName?: string;
  version?: string;
}

export default function ChatPage({ instanceName = "", version = "" }: ChatPageProps) {
  const [text, setText] = useState("");
  const { initialMessages, loaded, saveMessages, clearMessages } = useChatHistory();
  const { messages, setMessages, sendMessage, status, stop, error } = useChat({ transport });
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Hydrate chat from Dexie once loaded
  useEffect(() => {
    if (loaded && initialMessages.length > 0) {
      setMessages(initialMessages);
    }
  }, [loaded, initialMessages, setMessages]);

  // Persist messages to Dexie — debounced during streaming, immediate on completion
  useEffect(() => {
    if (!loaded || messages.length === 0) return;
    if (status === "ready" || status === "error") {
      saveMessages(messages).catch(() => {});
      return;
    }
    const timer = setTimeout(() => saveMessages(messages).catch(() => {}), 500);
    return () => clearTimeout(timer);
  }, [messages, loaded, status, saveMessages]);

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      if (!message.text.trim()) return;
      sendMessage({ text: message.text });
      setText("");
    },
    [sendMessage],
  );

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      sendMessage({ text: suggestion });
    },
    [sendMessage],
  );

  const handleTranscriptionChange = useCallback((transcript: string) => {
    setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
  }, []);

  const handleTextChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(event.target.value);
  }, []);

  const handleCopy = useCallback((messageId: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(messageId);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleClearHistory = useCallback(() => {
    setMessages([]);
    clearMessages();
  }, [setMessages, clearMessages]);

  if (!loaded) return null;

  return (
    <div className="relative flex size-full flex-col overflow-hidden">
      {/* Header — pinned top */}
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <a
            href="https://clawrun.sh"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-sm"
          >
            ClawRun
          </a>
          {version && <span className="text-muted-foreground text-xs">v{version}</span>}
          {instanceName && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs">
              {instanceName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {messages.length > 0 && (
            <Button variant="ghost" size="icon-sm" onClick={handleClearHistory}>
              <Trash2Icon className="size-4" />
              <span className="sr-only">Clear history</span>
            </Button>
          )}
        </div>
      </header>

      {/* Conversation — scrollable middle */}
      <Conversation>
        {messages.length === 0 && (
          <ConversationEmptyState
            className="absolute inset-0"
            icon={<MessageCircleIcon className="size-8" />}
            title="How can I help you?"
            description="Ask me anything to get started."
          />
        )}
        <ConversationContent>
          {messages.map((m) => (
            <Message key={m.id} from={m.role}>
              <MessageContent>
                {m.role === "assistant"
                  ? m.parts.map((part, i) => {
                      if (part.type === "text") {
                        const segments = splitContentParts(part.text);
                        return segments.map((seg, j) =>
                          seg.type === "text" ? (
                            <MessageResponse key={`${i}-${j}`}>{seg.content}</MessageResponse>
                          ) : (
                            <img
                              key={`${i}-${j}`}
                              src={seg.src}
                              alt={seg.alt}
                              className="my-2 max-w-full rounded-md"
                            />
                          ),
                        );
                      }
                      if (part.type === "dynamic-tool") {
                        return (
                          <Tool key={i} defaultOpen={false}>
                            <ToolHeader toolName={part.toolName} state={part.state} />
                            <ToolContent>
                              <ToolInput input={part.input} />
                              <ToolOutput output={part.output} />
                            </ToolContent>
                          </Tool>
                        );
                      }
                      return null;
                    })
                  : m.parts.map((part, i) => {
                      if (part.type === "text") return <span key={i}>{part.text}</span>;
                      return null;
                    })}
              </MessageContent>
              {m.role === "assistant" && (
                <MessageActions>
                  <MessageAction
                    tooltip="Copy"
                    onClick={() =>
                      handleCopy(
                        m.id,
                        m.parts
                          .filter((p) => p.type === "text")
                          .map((p) => p.text)
                          .join(""),
                      )
                    }
                  >
                    {copiedId === m.id ? (
                      <CheckIcon className="size-4" />
                    ) : (
                      <ClipboardIcon className="size-4" />
                    )}
                  </MessageAction>
                </MessageActions>
              )}
            </Message>
          ))}
          {status === "submitted" && (
            <Message from="assistant">
              <MessageContent>
                <Shimmer className="text-sm" duration={1.5}>
                  Thinking...
                </Shimmer>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {error && (
        <div className="shrink-0 px-4 py-2 text-center text-destructive text-sm">
          {error.message || "Something went wrong"}
        </div>
      )}

      {/* Footer — pinned bottom */}
      <div className="grid shrink-0 gap-4 pt-4">
        {messages.length === 0 && (
          <Suggestions className="px-4">
            {suggestions.map((s) => (
              <Suggestion key={s} onClick={handleSuggestionClick} suggestion={s} />
            ))}
          </Suggestions>
        )}
        <div className="w-full px-4 pb-4">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputBody>
              <PromptInputTextarea
                onChange={handleTextChange}
                placeholder="Type a message..."
                value={text}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <SpeechInput
                  className="shrink-0"
                  onTranscriptionChange={handleTranscriptionChange}
                  size="icon-sm"
                  variant="ghost"
                />
              </PromptInputTools>
              <PromptInputSubmit status={status} onStop={stop} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
