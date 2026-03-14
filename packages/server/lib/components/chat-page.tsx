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
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@clawrun/ui/components/ai-elements/reasoning";
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
import { Button } from "@clawrun/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@clawrun/ui/components/ui/tooltip";
import { Shimmer } from "@clawrun/ui/components/ai-elements/shimmer";
import { Check, Clipboard, SquarePen, Loader2, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { defaultRehypePlugins } from "streamdown";
import { loadThreadId, saveThreadId, loadMessages, saveMessages, clearMessages } from "../chat-db";
import { useSetHeaderActions } from "./header-actions";
import { SandboxOfflineGuard } from "./sandbox-offline-guard";
import { useSandboxState } from "../hooks/use-sandbox-state";

const DATA_URI_IMAGE_RE = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[A-Za-z0-9+/=\s]+)\)/g;

// Override streamdown's default harden plugin to silently remove blocked images
// instead of showing "[Image blocked: ...]". Images from the agent are delivered
// as SDK file parts, so markdown image refs to local filenames are expected to
// be unresolvable and should be hidden.
const hardenEntry = defaultRehypePlugins.harden as [
  (...args: unknown[]) => void,
  Record<string, unknown>,
];
const rehypePlugins = Object.values({
  ...defaultRehypePlugins,
  harden: [hardenEntry[0], { ...hardenEntry[1], imageBlockPolicy: "remove" }],
}) as typeof defaultRehypePlugins extends Record<string, infer V> ? V[] : never;

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

function generateThreadId(): string {
  return crypto.randomUUID().replaceAll("-", "_");
}

const suggestions = ["What can you do?", "Tell me about yourself", "What tools do you have?"];

interface ChatPageProps {
  instanceName?: string;
  version?: string;
}

export default function ChatPage(_props: ChatPageProps) {
  const [text, setText] = useState("");
  const [threadId, setSessionId] = useState(generateThreadId);
  const [loaded, setLoaded] = useState(false);

  // Load persisted session ID from Dexie on mount
  useEffect(() => {
    loadThreadId()
      .then((stored) => {
        if (stored) setSessionId(stored);
        else saveThreadId(threadId).catch(() => {});
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
    // threadId is only needed for the initial save when no stored ID exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/v1/chat",
        credentials: "same-origin",
      }),
    [],
  );

  const { messages, setMessages, sendMessage, status, stop, error } = useChat({
    id: threadId,
    transport,
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [messagesLoaded, setMessagesLoaded] = useState(false);

  // Hydrate messages from Dexie on mount (after threadId loaded).
  // The loaded+threadId key ensures messagesLoaded resets on thread change
  // because the cleanup sets cancelled=true, preventing the stale finally from
  // setting messagesLoaded=true, and the new effect invocation starts fresh.
  useEffect(() => {
    if (!loaded) return;
    // Reset before async load — intentional sync setState to show loading state
    setMessagesLoaded(false);
    let cancelled = false;
    loadMessages(threadId)
      .then((stored) => {
        if (!cancelled && stored.length > 0) setMessages(stored);
      })
      .finally(() => {
        if (!cancelled) setMessagesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [loaded, threadId, setMessages]);

  // Persist messages to Dexie when response is complete
  useEffect(() => {
    if (status === "ready" && messages.length > 0) {
      saveMessages(threadId, messages).catch(() => {});
    }
  }, [status, messages, threadId]);

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
    clearMessages(threadId).catch(() => {});
    setMessages([]);
    const newId = generateThreadId();
    setSessionId(newId);
    saveThreadId(newId).catch(() => {});
  }, [threadId, setMessages]);

  const isLoading = !loaded || !messagesLoaded;
  const { state: sandboxState } = useSandboxState();

  const newConversationButton = useMemo(
    () =>
      sandboxState === "running" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon-sm" onClick={handleClearHistory}>
              <SquarePen className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New conversation</TooltipContent>
        </Tooltip>
      ) : null,
    [sandboxState, handleClearHistory],
  );
  useSetHeaderActions(newConversationButton);

  return (
    <SandboxOfflineGuard>
      <div className="absolute inset-0 flex flex-col overflow-hidden">
        {/* Conversation — scrollable middle */}
        <Conversation>
          {isLoading ? (
            <ConversationEmptyState
              className="absolute inset-0"
              icon={<Loader2 className="size-8 animate-spin" />}
              title="Loading conversation..."
            />
          ) : messages.length === 0 ? (
            <ConversationEmptyState
              className="absolute inset-0"
              icon={<MessageSquare className="size-8" />}
              title="How can I help you?"
              description="Ask me anything to get started."
            />
          ) : null}
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
                              <MessageResponse key={`${i}-${j}`} rehypePlugins={rehypePlugins}>
                                {seg.content}
                              </MessageResponse>
                            ) : (
                              // eslint-disable-next-line @next/next/no-img-element -- data URI images from agent can't use next/image
                              <img
                                key={`${i}-${j}`}
                                src={seg.src}
                                alt={seg.alt}
                                className="my-2 max-w-full rounded-md"
                              />
                            ),
                          );
                        }
                        if (part.type === "reasoning") {
                          return (
                            <Reasoning key={i} isStreaming={part.state === "streaming"}>
                              <ReasoningTrigger />
                              <ReasoningContent>{part.text}</ReasoningContent>
                            </Reasoning>
                          );
                        }
                        if (part.type === "dynamic-tool") {
                          return (
                            <Tool key={i} defaultOpen={false}>
                              <ToolHeader
                                type="dynamic-tool"
                                toolName={part.toolName}
                                state={part.state}
                              />
                              <ToolContent>
                                <ToolInput input={part.input} />
                                <ToolOutput output={part.output} errorText={part.errorText} />
                              </ToolContent>
                            </Tool>
                          );
                        }
                        if (part.type === "file" && part.mediaType.startsWith("image/")) {
                          return (
                            // eslint-disable-next-line @next/next/no-img-element -- dynamic agent file URLs can't use next/image
                            <img
                              key={i}
                              src={part.url}
                              alt={part.filename ?? "image"}
                              className="my-2 max-w-full rounded-md"
                            />
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
                        <Check className="size-4" />
                      ) : (
                        <Clipboard className="size-4" />
                      )}
                    </MessageAction>
                  </MessageActions>
                )}
              </Message>
            ))}
            {(status === "submitted" || status === "streaming") && (
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
          {!isLoading && messages.length === 0 && (
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
                  autoFocus
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
    </SandboxOfflineGuard>
  );
}
