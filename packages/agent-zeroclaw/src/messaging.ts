import { parseOutput, buildAgentCommand, DAEMON_PORT } from "zeroclaw";
import WebSocket from "ws";
import type { SandboxHandle, AgentResponse, ToolCallInfo } from "@clawrun/agent";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract `<tool_call>` XML blocks from agent output, returning the cleaned
 * text and structured tool call info.
 *
 * Handles multiple attribute variants emitted by different ZeroClaw versions:
 *   - `<tool_call name="...">JSON</tool_call>`   (current stable)
 *   - `<tool_call type="...">JSON</tool_call>`   (newer builds)
 *
 * Also strips `<tool_result ... />` self-closing tags and
 * `<tool_result ...>...</tool_result>` content-bearing tags.
 */
export function extractToolCalls(text: string): {
  cleanText: string;
  toolCalls: ToolCallInfo[];
} {
  const toolCalls: ToolCallInfo[] = [];
  const CALL_RE = /<tool_call\s+(?:name|type)="([^"]+)">\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
  const RESULT_SELF_RE = /<tool_result\s+[^>]*\/>/g;
  const RESULT_BLOCK_RE = /<tool_result\s+[^>]*>[\s\S]*?<\/tool_result>/g;

  const cleanText = text
    .replace(CALL_RE, (_, name, json) => {
      try {
        const parsed = JSON.parse(json);
        toolCalls.push({
          name,
          arguments: typeof parsed === "object" && parsed !== null ? parsed : {},
        });
      } catch {}
      return "";
    })
    .replace(RESULT_BLOCK_RE, "")
    .replace(RESULT_SELF_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleanText, toolCalls };
}

// --- Image embedding ---

const ATTACHMENT_RE = /!\[([^\]]*)\]\(attachment:([\w][\w.-]*)\)/g;
const IMAGE_MARKER_RE = /\[IMAGE:(\/[^\]]+)\]/g;
const BARE_IMAGE_RE = /\b([\w][\w.-]*\.(?:png|jpe?g|gif|webp|bmp))\b/gi;

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
};

function mimeFromPath(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? MIME_TYPES[ext] : undefined;
}

/**
 * Resolve attachment references in agent response text to inline data URIs.
 *
 * Handles three formats:
 *   1. `![alt](attachment:filename)` — markdown image with attachment: scheme
 *   2. `[IMAGE:/path/to/file]`       — ZeroClaw native marker
 *   3. bare filenames (e.g. hn.png)  — validated by reading from sandbox
 */
export async function embedImages(
  sandbox: SandboxHandle,
  root: string,
  text: string,
): Promise<string> {
  const agentDir = `${root}/agent`;

  // 1. Handle ![alt](attachment:filename)
  const attachmentMatches = [...text.matchAll(ATTACHMENT_RE)];
  for (const m of attachmentMatches) {
    const [fullMatch, alt, filename] = m;
    const mime = mimeFromPath(filename);
    if (!mime) continue;

    const buf = await sandbox.readFile(`${agentDir}/${filename}`);
    if (!buf) continue;

    const b64 = buf.toString("base64");
    text = text.replace(fullMatch, `![${alt}](data:${mime};base64,${b64})`);
  }

  // 2. Handle [IMAGE:/absolute/path]
  const markerMatches = [...text.matchAll(IMAGE_MARKER_RE)];
  for (const m of markerMatches) {
    const [fullMatch, filePath] = m;
    const mime = mimeFromPath(filePath);
    if (!mime) continue;

    const buf = await sandbox.readFile(filePath);
    if (!buf) continue;

    const b64 = buf.toString("base64");
    const alt = filePath.split("/").pop() ?? "image";
    text = text.replace(fullMatch, `![${alt}](data:${mime};base64,${b64})`);
  }

  // 3. Fallback: bare image filenames — validate by reading from sandbox
  const seen = new Set<string>();
  const bareMatches = [...text.matchAll(BARE_IMAGE_RE)];
  for (const m of bareMatches) {
    const filename = m[1];
    if (seen.has(filename)) continue;
    seen.add(filename);

    const mime = mimeFromPath(filename);
    if (!mime) continue;

    const buf =
      (await sandbox.readFile(`${agentDir}/${filename}`)) ??
      (await sandbox.readFile(`${agentDir}/workspace/${filename}`));
    if (!buf) continue;

    const b64 = buf.toString("base64");
    text = text.replace(
      new RegExp(
        `(?:[-*]\\s+|File:\\s*)?` + `\`?${escapeRegExp(filename)}\`?` + `(?:\\s*\\(attached\\))?`,
      ),
      `![${filename}](data:${mime};base64,${b64})`,
    );
  }

  return text;
}

// --- Send via CLI one-shot ---

export async function sendMessageViaCli(
  sandbox: SandboxHandle,
  root: string,
  message: string,
  env: Record<string, string>,
  opts?: {
    env?: Record<string, string>;
    signal?: AbortSignal;
  },
): Promise<AgentResponse> {
  const cmd = buildAgentCommand(`${root}/bin/zeroclaw`, message, env);
  const result = await sandbox.runCommand({
    cmd: cmd.cmd,
    args: cmd.args,
    env: { ...cmd.env, ...opts?.env },
    signal: opts?.signal,
  });
  const stdout = await result.stdout();
  const stderr = await result.stderr();
  const parsed = parseOutput(stdout, stderr, result.exitCode);
  const { cleanText, toolCalls } = extractToolCalls(parsed.message);

  const enriched = await embedImages(sandbox, root, cleanText);

  return {
    success: parsed.success,
    message: enriched,
    error: parsed.error,
    toolCalls,
  };
}

// --- Send via daemon WebSocket ---

export async function sendMessageViaDaemon(
  sandbox: SandboxHandle,
  root: string,
  message: string,
  opts?: {
    env?: Record<string, string>;
    signal?: AbortSignal;
  },
): Promise<AgentResponse> {
  const daemonUrl = sandbox.domain!(DAEMON_PORT);
  const wsUrl = daemonUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:") + "/ws/chat";

  const toolCalls: ToolCallInfo[] = [];

  return new Promise<AgentResponse>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const signal = opts?.signal;
    let settled = false;

    const cleanup = () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          cleanup();
          settle(() => reject(new DOMException("Aborted", "AbortError")));
        },
        { once: true },
      );
    }

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "message", content: message }));
    });

    let pendingContent = "";

    ws.on("message", (data: Buffer) => {
      let msg: {
        type?: "message" | "chunk" | "tool_call" | "tool_result" | "done" | "error";
        content?: string;
        full_response?: string;
        name?: string;
        args?: Record<string, unknown>;
        output?: string;
        message?: string;
      };
      try {
        msg = JSON.parse(data.toString()) as typeof msg;
      } catch {
        return;
      }

      switch (msg.type) {
        case "chunk": {
          pendingContent += msg.content ?? "";
          break;
        }
        case "tool_call": {
          toolCalls.push({
            name: msg.name ?? "unknown",
            arguments: msg.args ?? {},
          });
          break;
        }
        case "tool_result": {
          if (toolCalls.length > 0) {
            toolCalls[toolCalls.length - 1].output = msg.output ?? "";
          }
          break;
        }
        case "message":
        case "done": {
          const raw = (msg.full_response ?? msg.content ?? pendingContent).trim();
          const finalContent =
            raw || "Tool execution completed, but no final response text was returned.";
          const { cleanText, toolCalls: extractedTools } = extractToolCalls(finalContent);
          const finalTools = toolCalls.length > 0 ? toolCalls : extractedTools;
          pendingContent = "";
          cleanup();
          embedImages(sandbox, root, cleanText).then(
            (enriched) =>
              settle(() =>
                resolve({
                  success: true,
                  message: enriched,
                  toolCalls: finalTools,
                }),
              ),
            (err) => settle(() => reject(err)),
          );
          break;
        }
        case "error": {
          pendingContent = "";
          cleanup();
          settle(() =>
            resolve({
              success: false,
              message: "",
              error: msg.message ?? "Unknown error",
            }),
          );
          break;
        }
      }
    });

    ws.on("error", (err: Error) => {
      cleanup();
      settle(() => reject(err));
    });

    ws.on("close", (code: number) => {
      if (code !== 1000) {
        settle(() => reject(new Error(`WebSocket closed with code ${code}`)));
      }
    });
  });
}
