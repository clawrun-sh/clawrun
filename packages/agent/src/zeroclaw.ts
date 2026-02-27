import {
  provision as zeroclawProvision,
  installTools as zeroclawInstallTools,
  parseOutput,
  parseCronListOutput,
  buildAgentCommand,
  buildDaemonCommand,
  buildCronListCommand,
  HOUSEKEEPING_FILES,
} from "zeroclaw";
import WebSocket from "ws";
import type {
  Agent,
  SandboxHandle,
  AgentResponse,
  ToolCallInfo,
  CronInfo,
  DaemonCommand,
  MonitorConfig,
  ProvisionOpts,
} from "./types.js";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class ZeroclawAgent implements Agent {
  readonly id = "zeroclaw";
  readonly name = "ZeroClaw";
  readonly channelsConfigKey = "channels_config";

  private env(root: string): Record<string, string> {
    return {
      ZEROCLAW_WORKSPACE: `${root}/agent`,
      ZEROCLAW_CONFIG_DIR: `${root}/agent`,
    };
  }

  async provision(sandbox: SandboxHandle, root: string, opts: ProvisionOpts): Promise<void> {
    await zeroclawProvision(sandbox, {
      binPath: `${root}/bin/zeroclaw`,
      agentDir: `${root}/agent`,
      localAgentDir: opts.localAgentDir,
      secretKey: opts.secretKey,
      fromSnapshot: opts.fromSnapshot,
    });
  }

  async installTools(sandbox: SandboxHandle, root: string, _opts: ProvisionOpts): Promise<void> {
    await zeroclawInstallTools(sandbox, { agentDir: `${root}/agent` });
  }

  async sendMessage(
    sandbox: SandboxHandle,
    root: string,
    message: string,
    opts?: {
      env?: Record<string, string>;
      signal?: AbortSignal;
    },
  ): Promise<AgentResponse> {
    // Try daemon WebSocket first (if domain() is available)
    if (typeof sandbox.domain === "function") {
      try {
        return await this.sendMessageViaDaemon(sandbox, root, message, opts);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Don't log abort errors as warnings — they're intentional
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          console.warn("Daemon WS failed, falling back to CLI:", msg);
        } else {
          throw err;
        }
      }
    }

    // Fallback: CLI one-shot
    const cmd = buildAgentCommand(`${root}/bin/zeroclaw`, message, this.env(root));
    const result = await sandbox.runCommand({
      cmd: cmd.cmd,
      args: cmd.args,
      env: { ...cmd.env, ...opts?.env },
      signal: opts?.signal,
    });
    const stdout = await result.stdout();
    const stderr = await result.stderr();
    const parsed = parseOutput(stdout, stderr, result.exitCode);
    const { cleanText, toolCalls } = ZeroclawAgent.extractToolCalls(parsed.message);

    // Embed any image files referenced in the response as data URIs
    const enriched = await this.embedImages(sandbox, root, cleanText);

    return {
      success: parsed.success,
      message: enriched,
      error: parsed.error,
      toolCalls,
    };
  }

  private async sendMessageViaDaemon(
    sandbox: SandboxHandle,
    root: string,
    message: string,
    opts?: {
      env?: Record<string, string>;
      signal?: AbortSignal;
    },
  ): Promise<AgentResponse> {
    const daemonUrl = sandbox.domain!(3000);
    const wsUrl = daemonUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:") + "/ws/chat";

    // Accumulate tool calls from intermediate WS messages.
    // The daemon sends interleaved: chunk* → tool_call → tool_result → … → done
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

      // Buffer for streaming text chunks (same pattern as ZeroClaw's web UI)
      let pendingContent = "";

      ws.on("message", (data: Buffer) => {
        // WsMessage shape — matches ZeroClaw web/src/types/api.ts
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
          return; // ignore malformed frames
        }

        switch (msg.type) {
          case "chunk": {
            // Streaming text delta — accumulate in buffer
            pendingContent += msg.content ?? "";
            break;
          }
          case "tool_call": {
            // Daemon is invoking a tool — capture name + arguments
            toolCalls.push({
              name: msg.name ?? "unknown",
              arguments: msg.args ?? {},
            });
            break;
          }
          case "tool_result": {
            // Tool finished — attach output to the most recent tool call
            if (toolCalls.length > 0) {
              toolCalls[toolCalls.length - 1].output = msg.output ?? "";
            }
            break;
          }
          case "message":
          case "done": {
            // Final response — use full_response, content, or accumulated chunks
            const raw = (msg.full_response ?? msg.content ?? pendingContent).trim();
            const finalContent =
              raw || "Tool execution completed, but no final response text was returned.";
            const { cleanText, toolCalls: extractedTools } =
              ZeroclawAgent.extractToolCalls(finalContent);
            // Prefer WS-streamed tool calls; fall back to XML extraction
            // (for older daemon versions that embed XML in full_response)
            const finalTools = toolCalls.length > 0 ? toolCalls : extractedTools;
            pendingContent = "";
            cleanup();
            // Embed images then resolve
            this.embedImages(sandbox, root, cleanText).then(
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
        // Normal close (1000) after we've already resolved is fine
        if (code !== 1000) {
          settle(() => reject(new Error(`WebSocket closed with code ${code}`)));
        }
      });
    });
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
  private static extractToolCalls(text: string): {
    cleanText: string;
    toolCalls: ToolCallInfo[];
  } {
    const toolCalls: ToolCallInfo[] = [];
    // Match name="..." or type="..." attribute — capture whichever is present
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

  // Markdown image with attachment: URI — ![alt](attachment:filename.png)
  private static readonly ATTACHMENT_RE = /!\[([^\]]*)\]\(attachment:([\w][\w.-]*)\)/g;

  // ZeroClaw native marker — [IMAGE:/path/to/file.png]
  private static readonly IMAGE_MARKER_RE = /\[IMAGE:(\/[^\]]+)\]/g;

  // Bare image filename — catches filenames regardless of LLM formatting
  // (backticks, "File:", list items, "(attached)", etc.)
  // Validated by actually reading the file from the sandbox.
  private static readonly BARE_IMAGE_RE = /\b([\w][\w.-]*\.(?:png|jpe?g|gif|webp|bmp))\b/gi;

  private static readonly MIME_TYPES: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
  };

  private static mimeFromPath(path: string): string | undefined {
    const ext = path.split(".").pop()?.toLowerCase();
    return ext ? ZeroclawAgent.MIME_TYPES[ext] : undefined;
  }

  /**
   * Resolve attachment references in the agent response to inline data URIs.
   *
   * Handles two formats:
   *   1. ![alt](attachment:filename)  — markdown image with attachment: scheme
   *   2. [IMAGE:/path/to/file]        — zeroclaw native marker (used by channels)
   *   3. bare filenames (e.g. hn.png) — validated by reading from sandbox
   *
   * Reads the referenced file from the sandbox and replaces with:
   *   ![alt](data:image/png;base64,…)
   */
  private async embedImages(sandbox: SandboxHandle, root: string, text: string): Promise<string> {
    const agentDir = `${root}/agent`;

    // 1. Handle ![alt](attachment:filename)
    const attachmentMatches = [...text.matchAll(ZeroclawAgent.ATTACHMENT_RE)];
    for (const m of attachmentMatches) {
      const [fullMatch, alt, filename] = m;
      const mime = ZeroclawAgent.mimeFromPath(filename);
      if (!mime) continue;

      // Try workspace dir first, then absolute
      const buf = await sandbox.readFile(`${agentDir}/${filename}`);
      if (!buf) continue;

      const b64 = buf.toString("base64");
      text = text.replace(fullMatch, `![${alt}](data:${mime};base64,${b64})`);
    }

    // 2. Handle [IMAGE:/absolute/path]
    const markerMatches = [...text.matchAll(ZeroclawAgent.IMAGE_MARKER_RE)];
    for (const m of markerMatches) {
      const [fullMatch, filePath] = m;
      const mime = ZeroclawAgent.mimeFromPath(filePath);
      if (!mime) continue;

      const buf = await sandbox.readFile(filePath);
      if (!buf) continue;

      const b64 = buf.toString("base64");
      const alt = filePath.split("/").pop() ?? "image";
      text = text.replace(fullMatch, `![${alt}](data:${mime};base64,${b64})`);
    }

    // 3. Fallback: bare image filenames — validate by reading from sandbox
    const seen = new Set<string>();
    const bareMatches = [...text.matchAll(ZeroclawAgent.BARE_IMAGE_RE)];
    for (const m of bareMatches) {
      const filename = m[1];
      if (seen.has(filename)) continue;
      seen.add(filename);

      const mime = ZeroclawAgent.mimeFromPath(filename);
      if (!mime) continue;

      // Try workspace root first, then workspace/ subdirectory
      const buf =
        (await sandbox.readFile(`${agentDir}/${filename}`)) ??
        (await sandbox.readFile(`${agentDir}/workspace/${filename}`));
      if (!buf) continue;

      const b64 = buf.toString("base64");
      // Replace the first occurrence (with surrounding formatting) with data URI
      text = text.replace(
        new RegExp(
          `(?:[-*]\\s+|File:\\s*)?` + // optional list marker or "File:"
            `\`?${escapeRegExp(filename)}\`?` + // filename, optionally backtick-wrapped
            `(?:\\s*\\(attached\\))?`, // optional "(attached)"
        ),
        `![${filename}](data:${mime};base64,${b64})`,
      );
    }

    return text;
  }

  getDaemonCommand(
    root: string,
    opts?: {
      port?: number;
      host?: string;
      env?: Record<string, string>;
    },
  ): DaemonCommand {
    const cmd = buildDaemonCommand(`${root}/bin/zeroclaw`, this.env(root), opts);
    return {
      cmd: cmd.cmd,
      args: cmd.args,
      env: { ...cmd.env, ...opts?.env },
    };
  }

  async getCrons(sandbox: SandboxHandle, root: string): Promise<CronInfo> {
    const cmd = buildCronListCommand(`${root}/bin/zeroclaw`, {
      ZEROCLAW_WORKSPACE: `${root}/agent`,
    });
    const result = await sandbox.runCommand({
      cmd: cmd.cmd,
      args: cmd.args,
      env: cmd.env,
    });
    const stdout = await result.stdout();
    return parseCronListOutput(stdout);
  }

  getMonitorConfig(root: string): MonitorConfig {
    return {
      dir: `${root}/agent`,
      ignoreFiles: HOUSEKEEPING_FILES,
    };
  }
}
