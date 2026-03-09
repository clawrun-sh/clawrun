"use client";

import { useApiClient } from "../hooks/use-api-client";
import { useSandboxQuery } from "../hooks/use-sandbox-query";
import { Skeleton } from "@clawrun/ui/components/ui/skeleton";
import { Button } from "@clawrun/ui/components/ui/button";
import {
  Message,
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
import type { ThreadResult } from "@clawrun/agent";
import type { UIMessage } from "ai";
import { ArrowLeft } from "lucide-react";
import { SandboxOfflineGuard } from "./sandbox-offline-guard";

interface ThreadDetailPageProps {
  threadId: string;
}

export default function ThreadDetailPage({ threadId }: ThreadDetailPageProps) {
  const client = useApiClient();
  const { data, loading, error } = useSandboxQuery(
    (s) => client.getThread(threadId, s),
    [client, threadId],
  );

  const messages = data?.messages ?? [];

  return (
    <div className="@container/main flex flex-1 flex-col gap-2">
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="flex items-center gap-3 px-4 lg:px-6">
          <Button variant="ghost" size="icon" asChild>
            <a href="/threads">
              <ArrowLeft className="size-4" />
            </a>
          </Button>
          <div>
            <h2 className="text-sm font-medium">Thread</h2>
            <span className="font-mono text-xs text-muted-foreground">{threadId}</span>
          </div>
        </div>

        <SandboxOfflineGuard>
          <div className="px-4 lg:px-6">
            {loading ? (
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : error ? (
              <p className="text-sm text-muted-foreground">{error}</p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No messages in this thread.</p>
            ) : (
              <div className="space-y-4">
                {messages.map((m) => (
                  <Message key={m.id} from={m.role}>
                    <MessageContent>
                      {m.role === "assistant"
                        ? m.parts.map((part, i) => {
                            if (part.type === "text") {
                              return <MessageResponse key={i}>{part.text}</MessageResponse>;
                            }
                            if (part.type === "reasoning") {
                              return (
                                <Reasoning key={i}>
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
                            return null;
                          })
                        : m.parts.map((part, i) => {
                            if (part.type === "text") return <span key={i}>{part.text}</span>;
                            return null;
                          })}
                    </MessageContent>
                  </Message>
                ))}
              </div>
            )}
          </div>
        </SandboxOfflineGuard>
      </div>
    </div>
  );
}
