import {
  provision as zeroclawProvision,
  installTools as zeroclawInstallTools,
  parseOutput,
  parseCronListOutput,
  buildAgentCommand,
  buildDaemonCommand,
  buildCronListCommand,
  readParsedConfig,
  configDefaults,
  HOUSEKEEPING_FILES,
} from "zeroclaw";
import type { ZeroClawConfig } from "zeroclaw";
import * as TOML from "@iarna/toml";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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
  ProviderInfo,
  ProviderSetup,
  CuratedModel,
  ChannelInfo,
  AgentSetupData,
} from "./types.js";
import { agentSetupDataSchema } from "./schemas.js";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Coerce a string value to the appropriate JS type for TOML serialization.
 * @iarna/toml serializes JS types correctly: number → TOML integer,
 * boolean → TOML boolean, string → TOML string. ZeroClaw's Rust structs
 * expect matching TOML types (bool, u16, etc.), not strings.
 */
function coerceTomlValue(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value) && value.length < 10) return parseInt(value, 10);
  return value;
}

/**
 * Autonomy overrides for daemon mode — intentionally differ from ZeroClaw's
 * interactive defaults for unattended sandbox operation.
 *
 * Schema defaults (interactive): level=supervised, 20 actions/hr, $5/day,
 *   13 allowed commands, forbidden_paths=[/etc, /root, ...],
 *   block_high_risk=true, require_approval=true, non_cli_excluded_tools=[21 tools]
 *
 * Daemon overrides: full autonomy, expanded commands, relaxed limits,
 *   no tool exclusions — the sandbox is isolated and the operator is absent.
 */
const DAEMON_AUTONOMY_OVERRIDES: ZeroClawConfig["autonomy"] = {
  level: "full",
  workspace_only: true,
  allowed_commands: [
    // Read-only inspection
    "ls",
    "cat",
    "head",
    "tail",
    "wc",
    "grep",
    "find",
    "echo",
    "pwd",
    "date",
    "which",
    "file",
    // Text processing / stream filters
    "jq",
    "sort",
    "uniq",
    "cut",
    "tr",
    "sed",
    "awk",
    "diff",
    "patch",
    "tee",
    "xargs",
    // Path utilities
    "basename",
    "dirname",
    "realpath",
    "env",
    "printenv",
    // Version control
    "git",
    // Package managers
    "npm",
    "npx",
    "pnpm",
    "yarn",
    "pip",
    "pip3",
    "cargo",
    // Runtimes
    "node",
    "python",
    "python3",
    // File operations (no permission changes)
    "mkdir",
    "cp",
    "mv",
    "rm",
    "touch",
    "ln",
    // Archive
    "tar",
    "gzip",
    "gunzip",
    "zip",
    "unzip",
    // Build
    "make",
  ],
  forbidden_paths: [],
  max_actions_per_hour: 500,
  max_cost_per_day_cents: 5000,
  require_approval_for_medium_risk: false,
  block_high_risk_commands: false,
  non_cli_excluded_tools: [],
};

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

  getProviders(): ProviderInfo[] {
    return [
      // Recommended
      { name: "openrouter", displayName: "OpenRouter", tier: "recommended" },
      { name: "venice", displayName: "Venice AI", tier: "recommended" },
      { name: "anthropic", displayName: "Anthropic", tier: "recommended" },
      { name: "openai", displayName: "OpenAI", tier: "recommended" },
      { name: "openai-codex", displayName: "OpenAI Codex (ChatGPT OAuth)", tier: "recommended" },
      { name: "deepseek", displayName: "DeepSeek", tier: "recommended" },
      { name: "mistral", displayName: "Mistral", tier: "recommended" },
      { name: "xai", displayName: "xAI (Grok)", tier: "recommended" },
      { name: "perplexity", displayName: "Perplexity", tier: "recommended" },
      { name: "gemini", displayName: "Google Gemini", tier: "recommended" },
      // Fast inference
      { name: "groq", displayName: "Groq", tier: "fast" },
      { name: "fireworks", displayName: "Fireworks AI", tier: "fast" },
      { name: "novita", displayName: "Novita AI", tier: "fast" },
      { name: "together-ai", displayName: "Together AI", tier: "fast" },
      { name: "nvidia", displayName: "NVIDIA NIM", tier: "fast" },
      // Gateway / proxy
      { name: "vercel", displayName: "Vercel AI Gateway", tier: "gateway" },
      { name: "cloudflare", displayName: "Cloudflare AI Gateway", tier: "gateway" },
      { name: "astrai", displayName: "Astrai", tier: "gateway" },
      { name: "bedrock", displayName: "Amazon Bedrock", tier: "gateway" },
      // Specialized
      { name: "kimi-code", displayName: "Kimi Code", tier: "specialized" },
      { name: "qwen-code", displayName: "Qwen Code (OAuth)", tier: "specialized" },
      { name: "moonshot", displayName: "Moonshot (China)", tier: "specialized" },
      { name: "moonshot-intl", displayName: "Moonshot (International)", tier: "specialized" },
      { name: "glm", displayName: "GLM / Zhipu (International)", tier: "specialized" },
      { name: "glm-cn", displayName: "GLM / Zhipu (China)", tier: "specialized" },
      { name: "minimax", displayName: "MiniMax (International)", tier: "specialized" },
      { name: "minimax-cn", displayName: "MiniMax (China)", tier: "specialized" },
      { name: "qwen", displayName: "Qwen / DashScope (China)", tier: "specialized" },
      { name: "qwen-coding-plan", displayName: "Qwen Coding Plan", tier: "specialized" },
      { name: "qwen-intl", displayName: "Qwen (International)", tier: "specialized" },
      { name: "qwen-us", displayName: "Qwen (US)", tier: "specialized" },
      { name: "hunyuan", displayName: "Hunyuan (Tencent)", tier: "specialized" },
      { name: "qianfan", displayName: "Qianfan (Baidu)", tier: "specialized" },
      { name: "zai", displayName: "Z.AI (Global)", tier: "specialized" },
      { name: "zai-cn", displayName: "Z.AI (China)", tier: "specialized" },
      { name: "synthetic", displayName: "Synthetic", tier: "specialized" },
      { name: "opencode", displayName: "OpenCode Zen", tier: "specialized" },
      { name: "cohere", displayName: "Cohere", tier: "specialized" },
      // Local / private
      { name: "ollama", displayName: "Ollama", tier: "local" },
      { name: "lmstudio", displayName: "LM Studio", tier: "local" },
      { name: "llamacpp", displayName: "llama.cpp", tier: "local" },
      { name: "sglang", displayName: "SGLang", tier: "local" },
      { name: "vllm", displayName: "vLLM", tier: "local" },
      { name: "osaurus", displayName: "Osaurus", tier: "local" },
    ];
  }

  getDefaultModel(provider: string): string {
    const defaults: Record<string, string> = {
      openrouter: "anthropic/claude-sonnet-4.6",
      anthropic: "claude-sonnet-4-5-20250929",
      openai: "gpt-5.2",
      "openai-codex": "gpt-5-codex",
      gemini: "gemini-2.5-pro",
      deepseek: "deepseek-chat",
      xai: "grok-4-1-fast-reasoning",
      venice: "zai-org-glm-5",
      groq: "llama-3.3-70b-versatile",
      mistral: "mistral-large-latest",
      perplexity: "sonar-pro",
      fireworks: "accounts/fireworks/models/llama-v3p3-70b-instruct",
      "together-ai": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      novita: "minimax/minimax-m2.5",
      cohere: "command-a-03-2025",
      moonshot: "kimi-k2.5",
      "moonshot-intl": "kimi-k2.5",
      "kimi-code": "kimi-for-coding",
      "qwen-code": "qwen3-coder-plus",
      glm: "glm-5",
      "glm-cn": "glm-5",
      zai: "glm-5",
      "zai-cn": "glm-5",
      minimax: "MiniMax-M2.5",
      "minimax-cn": "MiniMax-M2.5",
      qwen: "qwen-plus",
      "qwen-intl": "qwen-plus",
      "qwen-us": "qwen-plus",
      "qwen-coding-plan": "qwen3-coder-plus",
      hunyuan: "hunyuan-t1-latest",
      bedrock: "anthropic.claude-sonnet-4-5-20250929-v1:0",
      nvidia: "meta/llama-3.3-70b-instruct",
      astrai: "anthropic/claude-sonnet-4.6",
      ollama: "llama3.2",
      llamacpp: "ggml-org/gpt-oss-20b-GGUF",
      sglang: "meta-llama/Llama-3.1-8B-Instruct",
      vllm: "meta-llama/Llama-3.1-8B-Instruct",
      osaurus: "qwen3-30b-a3b-8bit",
    };
    return defaults[provider] ?? "anthropic/claude-sonnet-4.6";
  }

  getCuratedModels(provider: string): CuratedModel[] {
    const curated: Record<string, CuratedModel[]> = {
      openrouter: [
        { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6 (balanced, recommended)" },
        { id: "openai/gpt-5.2", label: "GPT-5.2 (latest flagship)" },
        { id: "openai/gpt-5-mini", label: "GPT-5 mini (fast, cost-efficient)" },
        { id: "google/gemini-3-pro-preview", label: "Gemini 3 Pro Preview (frontier reasoning)" },
        { id: "x-ai/grok-4.1-fast", label: "Grok 4.1 Fast (reasoning + speed)" },
        { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2 (agentic + affordable)" },
        { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick (open model)" },
      ],
      anthropic: [
        { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5 (balanced, recommended)" },
        { id: "claude-opus-4-6", label: "Claude Opus 4.6 (best quality)" },
        { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fastest, cheapest)" },
      ],
      openai: [
        { id: "gpt-5.2", label: "GPT-5.2 (latest coding/agentic flagship)" },
        { id: "gpt-5-mini", label: "GPT-5 mini (faster, cheaper)" },
        { id: "gpt-5-nano", label: "GPT-5 nano (lowest latency/cost)" },
        { id: "gpt-5.2-codex", label: "GPT-5.2 Codex (agentic coding)" },
      ],
      "openai-codex": [
        { id: "gpt-5-codex", label: "GPT-5 Codex (recommended)" },
        { id: "gpt-5.2-codex", label: "GPT-5.2 Codex (agentic coding)" },
        { id: "o4-mini", label: "o4-mini (fallback)" },
      ],
      gemini: [
        { id: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview (latest frontier reasoning)" },
        { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro (stable reasoning)" },
        { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash (best price/performance)" },
        { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite (lowest cost)" },
      ],
      deepseek: [
        { id: "deepseek-chat", label: "DeepSeek Chat (V3.2 non-thinking)" },
        { id: "deepseek-reasoner", label: "DeepSeek Reasoner (V3.2 thinking)" },
      ],
      xai: [
        { id: "grok-4-1-fast-reasoning", label: "Grok 4.1 Fast Reasoning (recommended)" },
        { id: "grok-4-1-fast-non-reasoning", label: "Grok 4.1 Fast Non-Reasoning (low latency)" },
        { id: "grok-code-fast-1", label: "Grok Code Fast 1 (coding specialist)" },
        { id: "grok-4", label: "Grok 4 (max quality)" },
      ],
      venice: [
        { id: "zai-org-glm-5", label: "GLM-5 via Venice (agentic flagship)" },
        { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 via Venice (best quality)" },
        { id: "deepseek-v3.2", label: "DeepSeek V3.2 via Venice (strong value)" },
        { id: "grok-41-fast", label: "Grok 4.1 Fast via Venice (low latency)" },
      ],
      groq: [
        { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (fast, recommended)" },
        { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B (strong open-weight)" },
        { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B (cost-efficient open-weight)" },
      ],
      mistral: [
        { id: "mistral-large-latest", label: "Mistral Large (latest flagship)" },
        { id: "mistral-medium-latest", label: "Mistral Medium (balanced)" },
        { id: "codestral-latest", label: "Codestral (code-focused)" },
        { id: "devstral-latest", label: "Devstral (software engineering specialist)" },
      ],
      perplexity: [
        { id: "sonar-pro", label: "Sonar Pro (flagship web-grounded)" },
        { id: "sonar-reasoning-pro", label: "Sonar Reasoning Pro (multi-step reasoning)" },
        { id: "sonar-deep-research", label: "Sonar Deep Research (long-form research)" },
        { id: "sonar", label: "Sonar (search, fast)" },
      ],
      fireworks: [
        { id: "accounts/fireworks/models/llama-v3p3-70b-instruct", label: "Llama 3.3 70B" },
        { id: "accounts/fireworks/models/mixtral-8x22b-instruct", label: "Mixtral 8x22B" },
      ],
      "together-ai": [
        {
          id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
          label: "Llama 3.3 70B Instruct Turbo (recommended)",
        },
        { id: "moonshotai/Kimi-K2.5", label: "Kimi K2.5 (reasoning + coding)" },
        { id: "deepseek-ai/DeepSeek-V3.1", label: "DeepSeek V3.1 (strong value)" },
      ],
      novita: [{ id: "minimax/minimax-m2.5", label: "MiniMax M2.5" }],
      cohere: [
        { id: "command-a-03-2025", label: "Command A (flagship enterprise)" },
        { id: "command-a-reasoning-08-2025", label: "Command A Reasoning (agentic reasoning)" },
        { id: "command-r-08-2024", label: "Command R (stable fast baseline)" },
      ],
      "kimi-code": [
        { id: "kimi-for-coding", label: "Kimi for Coding (official coding-agent model)" },
        { id: "kimi-k2.5", label: "Kimi K2.5 (general coding endpoint model)" },
      ],
      "qwen-code": [
        { id: "qwen3-coder-plus", label: "Qwen3 Coder Plus (recommended for coding)" },
        { id: "qwen3.5-plus", label: "Qwen3.5 Plus (reasoning + coding)" },
        { id: "qwen3-max-2026-01-23", label: "Qwen3 Max (high-capability coding model)" },
      ],
      moonshot: [
        { id: "kimi-k2.5", label: "Kimi K2.5 (latest flagship, recommended)" },
        { id: "kimi-k2-thinking", label: "Kimi K2 Thinking (deep reasoning + tool use)" },
        { id: "kimi-k2-0905-preview", label: "Kimi K2 0905 Preview (strong coding)" },
      ],
      "moonshot-intl": [
        { id: "kimi-k2.5", label: "Kimi K2.5 (latest flagship, recommended)" },
        { id: "kimi-k2-thinking", label: "Kimi K2 Thinking (deep reasoning + tool use)" },
        { id: "kimi-k2-0905-preview", label: "Kimi K2 0905 Preview (strong coding)" },
      ],
      glm: [
        { id: "glm-5", label: "GLM-5 (high reasoning)" },
        { id: "glm-4.7", label: "GLM-4.7 (strong general-purpose)" },
        { id: "glm-4.5-air", label: "GLM-4.5 Air (lower latency)" },
      ],
      "glm-cn": [
        { id: "glm-5", label: "GLM-5 (high reasoning)" },
        { id: "glm-4.7", label: "GLM-4.7 (strong general-purpose)" },
        { id: "glm-4.5-air", label: "GLM-4.5 Air (lower latency)" },
      ],
      zai: [
        { id: "glm-5", label: "GLM-5 (high reasoning)" },
        { id: "glm-4.7", label: "GLM-4.7 (strong general-purpose)" },
        { id: "glm-4.5-air", label: "GLM-4.5 Air (lower latency)" },
      ],
      "zai-cn": [
        { id: "glm-5", label: "GLM-5 (high reasoning)" },
        { id: "glm-4.7", label: "GLM-4.7 (strong general-purpose)" },
        { id: "glm-4.5-air", label: "GLM-4.5 Air (lower latency)" },
      ],
      minimax: [
        { id: "MiniMax-M2.5", label: "MiniMax M2.5 (latest flagship)" },
        { id: "MiniMax-M2.5-highspeed", label: "MiniMax M2.5 High-Speed (fast)" },
        { id: "MiniMax-M2.1", label: "MiniMax M2.1 (strong coding/reasoning)" },
      ],
      "minimax-cn": [
        { id: "MiniMax-M2.5", label: "MiniMax M2.5 (latest flagship)" },
        { id: "MiniMax-M2.5-highspeed", label: "MiniMax M2.5 High-Speed (fast)" },
        { id: "MiniMax-M2.1", label: "MiniMax M2.1 (strong coding/reasoning)" },
      ],
      qwen: [
        { id: "qwen-max", label: "Qwen Max (highest quality)" },
        { id: "qwen-plus", label: "Qwen Plus (balanced default)" },
        { id: "qwen-turbo", label: "Qwen Turbo (fast and cost-efficient)" },
      ],
      "qwen-intl": [
        { id: "qwen-max", label: "Qwen Max (highest quality)" },
        { id: "qwen-plus", label: "Qwen Plus (balanced default)" },
        { id: "qwen-turbo", label: "Qwen Turbo (fast and cost-efficient)" },
      ],
      "qwen-us": [
        { id: "qwen-max", label: "Qwen Max (highest quality)" },
        { id: "qwen-plus", label: "Qwen Plus (balanced default)" },
        { id: "qwen-turbo", label: "Qwen Turbo (fast and cost-efficient)" },
      ],
      "qwen-coding-plan": [
        { id: "qwen3-coder-plus", label: "Qwen3 Coder Plus (recommended for coding)" },
        { id: "qwen3.5-plus", label: "Qwen3.5 Plus (reasoning + coding)" },
        { id: "qwen3-max-2026-01-23", label: "Qwen3 Max (high-capability coding model)" },
      ],
      hunyuan: [
        { id: "hunyuan-t1-latest", label: "Hunyuan T1 (deep reasoning, latest)" },
        { id: "hunyuan-turbo-latest", label: "Hunyuan Turbo (fast, general purpose)" },
        { id: "hunyuan-pro", label: "Hunyuan Pro (high quality)" },
      ],
      bedrock: [
        { id: "anthropic.claude-sonnet-4-6", label: "Claude Sonnet 4.6 (latest, recommended)" },
        { id: "anthropic.claude-opus-4-6-v1", label: "Claude Opus 4.6 (strongest)" },
        {
          id: "anthropic.claude-haiku-4-5-20251001-v1:0",
          label: "Claude Haiku 4.5 (fastest, cheapest)",
        },
        { id: "anthropic.claude-sonnet-4-5-20250929-v1:0", label: "Claude Sonnet 4.5" },
      ],
      nvidia: [
        { id: "meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B Instruct (balanced default)" },
        { id: "deepseek-ai/deepseek-v3.2", label: "DeepSeek V3.2 (advanced reasoning + coding)" },
        {
          id: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
          label: "Llama 3.3 Nemotron Super 49B v1.5",
        },
        {
          id: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
          label: "Llama 3.1 Nemotron Ultra 253B v1",
        },
      ],
      astrai: [
        { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6 (balanced default)" },
        { id: "openai/gpt-5.2", label: "GPT-5.2 (latest flagship)" },
        { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2 (agentic + affordable)" },
        { id: "z-ai/glm-5", label: "GLM-5 (high reasoning)" },
      ],
      ollama: [
        { id: "llama3.2", label: "Llama 3.2 (recommended local)" },
        { id: "mistral", label: "Mistral 7B" },
        { id: "codellama", label: "Code Llama" },
        { id: "phi3", label: "Phi-3 (small, fast)" },
      ],
      llamacpp: [
        { id: "ggml-org/gpt-oss-20b-GGUF", label: "GPT-OSS 20B GGUF (llama.cpp example)" },
        { id: "bartowski/Llama-3.3-70B-Instruct-GGUF", label: "Llama 3.3 70B GGUF (high quality)" },
        {
          id: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
          label: "Qwen2.5 Coder 7B GGUF (coding-focused)",
        },
      ],
      sglang: [
        { id: "meta-llama/Llama-3.1-8B-Instruct", label: "Llama 3.1 8B Instruct (popular, fast)" },
        { id: "meta-llama/Llama-3.1-70B-Instruct", label: "Llama 3.1 70B Instruct (high quality)" },
        {
          id: "Qwen/Qwen2.5-Coder-7B-Instruct",
          label: "Qwen2.5 Coder 7B Instruct (coding-focused)",
        },
      ],
      vllm: [
        { id: "meta-llama/Llama-3.1-8B-Instruct", label: "Llama 3.1 8B Instruct (popular, fast)" },
        { id: "meta-llama/Llama-3.1-70B-Instruct", label: "Llama 3.1 70B Instruct (high quality)" },
        {
          id: "Qwen/Qwen2.5-Coder-7B-Instruct",
          label: "Qwen2.5 Coder 7B Instruct (coding-focused)",
        },
      ],
      osaurus: [
        { id: "qwen3-30b-a3b-8bit", label: "Qwen3 30B A3B (local, balanced)" },
        { id: "gemma-3n-e4b-it-lm-4bit", label: "Gemma 3N E4B (local, efficient)" },
        {
          id: "phi-4-mini-reasoning-mlx-4bit",
          label: "Phi-4 Mini Reasoning (local, fast reasoning)",
        },
      ],
    };
    return curated[provider] ?? [];
  }

  getModelsFetchEndpoint(
    provider: string,
    apiUrl?: string,
  ): { url: string; authHeader: (key: string) => Record<string, string> } | null {
    const bearerAuth = (key: string): Record<string, string> => ({
      Authorization: `Bearer ${key}`,
    });

    // OpenAI-compatible providers
    const openaiCompatible: Record<string, string> = {
      openai: "https://api.openai.com/v1/models",
      openrouter: "https://openrouter.ai/api/v1/models",
      groq: "https://api.groq.com/openai/v1/models",
      mistral: "https://api.mistral.ai/v1/models",
      deepseek: "https://api.deepseek.com/v1/models",
      xai: "https://api.x.ai/v1/models",
      "together-ai": "https://api.together.xyz/v1/models",
      fireworks: "https://api.fireworks.ai/inference/v1/models",
      venice: "https://api.venice.ai/api/v1/models",
      novita: "https://api.novita.ai/openai/v1/models",
      perplexity: "https://api.perplexity.ai/models",
      cohere: "https://api.cohere.com/compatibility/v1/models",
      moonshot: "https://api.moonshot.cn/v1/models",
      "moonshot-intl": "https://api.moonshot.ai/v1/models",
      "kimi-code": "https://api.kimi.com/coding/v1/models",
      nvidia: "https://integrate.api.nvidia.com/v1/models",
      vercel: "https://ai-gateway.vercel.sh/v1/models",
      astrai: "https://as-trai.com/v1/models",
      glm: "https://api.z.ai/api/paas/v4/models",
      "glm-cn": "https://open.bigmodel.cn/api/paas/v4/models",
      minimax: "https://api.minimax.io/v1/models",
      "minimax-cn": "https://api.minimaxi.com/v1/models",
      qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
      "qwen-intl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
      "qwen-us": "https://dashscope-us.aliyuncs.com/compatible-mode/v1/models",
      "qwen-coding-plan": "https://coding.dashscope.aliyuncs.com/v1/models",
      hunyuan: "https://api.hunyuan.cloud.tencent.com/v1/models",
      zai: "https://api.z.ai/api/coding/paas/v4/models",
      "zai-cn": "https://open.bigmodel.cn/api/coding/paas/v4/models",
    };

    if (openaiCompatible[provider]) {
      return { url: openaiCompatible[provider], authHeader: bearerAuth };
    }

    if (provider === "anthropic") {
      return {
        url: "https://api.anthropic.com/v1/models",
        authHeader: (key) => ({
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        }),
      };
    }

    if (provider === "gemini") {
      return {
        url: "https://generativelanguage.googleapis.com/v1beta/models",
        authHeader: () => ({}), // key goes as query param
      };
    }

    if (provider === "ollama") {
      const base = apiUrl ?? "http://127.0.0.1:11434";
      return { url: `${base}/api/tags`, authHeader: () => ({}) };
    }

    // Local servers with OpenAI-compatible /v1/models
    const localDefaults: Record<string, string> = {
      lmstudio: "http://localhost:1234/v1/models",
      llamacpp: "http://localhost:8080/v1/models",
      sglang: "http://localhost:30000/v1/models",
      vllm: "http://localhost:8000/v1/models",
      osaurus: "http://localhost:1337/v1/models",
    };
    if (localDefaults[provider]) {
      const url = apiUrl ? `${apiUrl.replace(/\/+$/, "")}/v1/models` : localDefaults[provider];
      return { url, authHeader: () => ({}) };
    }

    // Unknown provider with custom API URL — try OpenAI-compatible
    if (apiUrl) {
      const base = apiUrl.replace(/\/+$/, "");
      return { url: `${base}/v1/models`, authHeader: bearerAuth };
    }

    return null;
  }

  getSupportedChannels(): ChannelInfo[] {
    return [
      {
        id: "telegram",
        name: "Telegram",
        setupFields: [
          {
            name: "bot_token",
            label: "Bot token (from @BotFather)",
            type: "password",
            required: true,
          },
          {
            name: "allowed_users",
            label: "Allowed Telegram identities (comma-separated, * for all)",
            type: "list",
            required: true,
            description: "username (no @) or numeric user ID",
            guidance: [
              "Allowlist your own Telegram identity first (recommended for secure setup).",
              "Use your @username without '@' (e.g. johndoe), or your numeric Telegram user ID.",
              "Use '*' only for temporary open testing.",
            ],
          },
        ],
      },
      {
        id: "discord",
        name: "Discord",
        setupFields: [
          {
            name: "bot_token",
            label: "Bot token (from Discord Developer Portal)",
            type: "password",
            required: true,
          },
          {
            name: "guild_id",
            label: "Guild (server) ID",
            type: "text",
            required: false,
            description: "Restrict to one server, or leave empty for all",
          },
          {
            name: "allowed_users",
            label: "Allowed Discord user IDs (comma-separated, * for all)",
            type: "list",
            required: true,
            description: "recommended: your own user ID",
            guidance: [
              "Allowlist your own Discord user ID first (recommended).",
              "Get it in Discord: Settings \u2192 Advanced \u2192 Developer Mode (ON), then right-click your profile \u2192 Copy User ID.",
              "Use '*' only for temporary open testing.",
            ],
          },
        ],
      },
      {
        id: "slack",
        name: "Slack",
        setupFields: [
          { name: "bot_token", label: "Bot token (xoxb-...)", type: "password", required: true },
          {
            name: "app_token",
            label: "App-level token (xapp-...)",
            type: "password",
            required: false,
            description: "Enables Socket Mode (real-time)",
          },
          {
            name: "channel_id",
            label: "Default channel ID",
            type: "text",
            required: false,
            description: "Restrict to one channel, or leave empty for all",
          },
          {
            name: "allowed_users",
            label: "Allowed Slack user IDs (comma-separated, * for all)",
            type: "list",
            required: true,
            description: "recommended: your own member ID",
            guidance: [
              "Allowlist your own Slack member ID first (recommended).",
              "Member IDs start with 'U' \u2014 open your Slack profile \u2192 More \u2192 Copy member ID.",
              "Use '*' only for temporary open testing.",
            ],
          },
        ],
      },
      {
        id: "imessage",
        name: "iMessage",
        setupFields: [
          {
            name: "allowed_contacts",
            label: "Allowed contacts (comma-separated phone/email, * for all)",
            type: "list",
            required: false,
            default: "*",
            description: "macOS only — uses Messages.app",
          },
        ],
      },
      {
        id: "matrix",
        name: "Matrix",
        setupFields: [
          {
            name: "homeserver",
            label: "Homeserver URL (e.g. https://matrix.org)",
            type: "text",
            required: true,
          },
          { name: "access_token", label: "Access token", type: "password", required: true },
          {
            name: "room_id",
            label: "Room ID (e.g. !abc123:matrix.org)",
            type: "text",
            required: true,
          },
          {
            name: "allowed_users",
            label: "Allowed users (comma-separated @user:server, * for all)",
            type: "list",
            required: false,
            default: "*",
          },
        ],
      },
      {
        id: "signal",
        name: "Signal",
        setupFields: [
          {
            name: "http_url",
            label: "signal-cli HTTP URL",
            type: "text",
            required: false,
            default: "http://127.0.0.1:8686",
          },
          {
            name: "account",
            label: "Account number (E.164, e.g. +1234567890)",
            type: "text",
            required: true,
          },
          {
            name: "group_id",
            label: "Group ID (leave empty for all messages, 'dm' for DM only)",
            type: "text",
            required: false,
          },
          {
            name: "allowed_from",
            label: "Allowed sender numbers (comma-separated, * for all)",
            type: "list",
            required: false,
            default: "*",
          },
        ],
      },
      {
        id: "whatsapp",
        name: "WhatsApp (Cloud API)",
        setupFields: [
          {
            name: "access_token",
            label: "Access token (from Meta Developers)",
            type: "password",
            required: true,
          },
          {
            name: "phone_number_id",
            label: "Phone number ID (from WhatsApp app settings)",
            type: "text",
            required: true,
          },
          {
            name: "verify_token",
            label: "Webhook verify token",
            type: "text",
            required: false,
            default: "zeroclaw-whatsapp-verify",
          },
          {
            name: "allowed_numbers",
            label: "Allowed phone numbers (comma-separated, * for all)",
            type: "list",
            required: false,
            default: "*",
          },
        ],
      },
      {
        id: "linq",
        name: "Linq",
        setupFields: [
          {
            name: "api_token",
            label: "API token (Linq Partner API)",
            type: "password",
            required: true,
          },
          {
            name: "from_phone",
            label: "From phone number (E.164, e.g. +12223334444)",
            type: "text",
            required: true,
          },
          {
            name: "signing_secret",
            label: "Webhook signing secret",
            type: "password",
            required: false,
          },
          {
            name: "allowed_senders",
            label: "Allowed sender numbers (comma-separated, * for all)",
            type: "list",
            required: false,
            default: "*",
          },
        ],
      },
      {
        id: "irc",
        name: "IRC",
        setupFields: [
          { name: "server", label: "IRC server (hostname)", type: "text", required: true },
          { name: "port", label: "Port", type: "text", required: false, default: "6697" },
          { name: "nickname", label: "Bot nickname", type: "text", required: true },
          {
            name: "channels",
            label: "Channels to join (comma-separated, e.g. #channel1,#channel2)",
            type: "list",
            required: false,
          },
          {
            name: "allowed_users",
            label: "Allowed nicknames (comma-separated, * for all)",
            type: "list",
            required: true,
            description: "case-insensitive",
          },
          {
            name: "server_password",
            label: "Server password (for bouncers like ZNC)",
            type: "password",
            required: false,
          },
          {
            name: "nickserv_password",
            label: "NickServ password",
            type: "password",
            required: false,
          },
          {
            name: "sasl_password",
            label: "SASL PLAIN password",
            type: "password",
            required: false,
          },
        ],
      },
      {
        id: "webhook",
        name: "Webhook",
        setupFields: [
          { name: "port", label: "Port", type: "text", required: false, default: "8080" },
          {
            name: "secret",
            label: "Secret (for signature verification)",
            type: "password",
            required: false,
          },
        ],
      },
      {
        id: "nextcloud_talk",
        name: "Nextcloud Talk",
        setupFields: [
          {
            name: "base_url",
            label: "Nextcloud base URL (e.g. https://cloud.example.com)",
            type: "text",
            required: true,
          },
          {
            name: "app_token",
            label: "App token (Talk bot token)",
            type: "password",
            required: true,
          },
          { name: "webhook_secret", label: "Webhook secret", type: "password", required: false },
          {
            name: "allowed_users",
            label: "Allowed actor IDs (comma-separated, * for all)",
            type: "list",
            required: false,
            default: "*",
          },
        ],
      },
      {
        id: "dingtalk",
        name: "DingTalk",
        setupFields: [
          { name: "client_id", label: "Client ID (AppKey)", type: "text", required: true },
          {
            name: "client_secret",
            label: "Client Secret (AppSecret)",
            type: "password",
            required: true,
          },
          {
            name: "allowed_users",
            label: "Allowed staff IDs (comma-separated, * for all)",
            type: "list",
            required: true,
          },
        ],
      },
      {
        id: "qq",
        name: "QQ Official",
        setupFields: [
          { name: "app_id", label: "App ID", type: "text", required: true },
          { name: "app_secret", label: "App Secret", type: "password", required: true },
          {
            name: "allowed_users",
            label: "Allowed user IDs (comma-separated, * for all)",
            type: "list",
            required: true,
          },
          {
            name: "receive_mode",
            label: "Receive mode",
            type: "text",
            required: false,
            default: "webhook",
            description: "webhook or websocket",
          },
          {
            name: "environment",
            label: "API environment",
            type: "text",
            required: false,
            default: "production",
            description: "production or sandbox",
          },
        ],
      },
      {
        id: "lark",
        name: "Lark / Feishu",
        setupFields: [
          { name: "app_id", label: "App ID", type: "text", required: true },
          { name: "app_secret", label: "App Secret", type: "password", required: true },
          {
            name: "use_feishu",
            label: "Region",
            type: "text",
            required: false,
            default: "false",
            description: "false = Lark (international), true = Feishu (China)",
          },
          {
            name: "receive_mode",
            label: "Receive mode",
            type: "text",
            required: false,
            default: "websocket",
            description: "websocket or webhook",
          },
          {
            name: "verification_token",
            label: "Verification token (for webhook mode)",
            type: "password",
            required: false,
          },
          {
            name: "allowed_users",
            label: "Allowed user Open IDs (comma-separated, * for all)",
            type: "list",
            required: true,
          },
        ],
      },
      {
        id: "nostr",
        name: "Nostr",
        setupFields: [
          {
            name: "private_key",
            label: "Private key (hex or nsec1...)",
            type: "password",
            required: true,
          },
          {
            name: "relays",
            label: "Relay URLs (comma-separated)",
            type: "list",
            required: false,
            default:
              "wss://relay.damus.io, wss://nos.lol, wss://relay.primal.net, wss://relay.snort.social",
          },
          {
            name: "allowed_pubkeys",
            label: "Allowed pubkeys (comma-separated, * for all)",
            type: "list",
            required: true,
            description: "hex or npub",
          },
        ],
      },
    ];
  }

  writeSetupConfig(agentDir: string, data: AgentSetupData): void {
    agentSetupDataSchema.parse(data);

    const configPath = join(agentDir, "config.toml");

    // Preserve existing config fields (personality, autonomy, etc.)
    let existing: Partial<ZeroClawConfig> = {};
    try {
      existing = TOML.parse(
        readFileSync(configPath, "utf-8"),
      ) as unknown as Partial<ZeroClawConfig>;
    } catch {
      // No existing config — start fresh
    }

    const config: Partial<ZeroClawConfig> = {
      // Schema defaults as foundation — every section gets all required fields.
      // Null values are harmlessly dropped by TOML.stringify.
      ...configDefaults,
      // User's existing config overrides whole sections.
      ...existing,

      // Wizard outputs (always written)
      api_key: data.provider.apiKey,
      default_provider: data.provider.provider,
      default_model: data.provider.model,
      ...(data.provider.apiUrl ? { api_url: data.provider.apiUrl } : {}),

      // Daemon-mode autonomy overrides. These intentionally differ from
      // ZeroClaw's interactive defaults (supervised, 20 actions/hr, etc.)
      // for unattended sandbox operation. User existing values take precedence.
      autonomy: {
        ...(configDefaults.autonomy ?? {}),
        ...DAEMON_AUTONOMY_OVERRIDES,
        ...(existing.autonomy ?? {}),
      },

      // Daemon-mode security: disable OTP (no interactive operator to enter codes).
      security: {
        ...(configDefaults.security ?? {}),
        ...(existing.security ?? {}),
        otp: {
          ...(configDefaults.security?.otp ?? {}),
          ...(existing.security?.otp ?? {}),
          enabled: false,
        },
      },

      // Memory — wizard backend choice takes final precedence.
      memory: {
        ...(configDefaults.memory ?? {}),
        ...(existing.memory ?? {}),
        backend: data.memory.backend,
      },

      // Browser — wizard choices take final precedence.
      browser: {
        ...(configDefaults.browser ?? {}),
        ...(existing.browser ?? {}),
        enabled: data.browser.enabled,
        backend: data.browser.backend,
        allowed_domains: data.browser.allowedDomains,
      },
    };

    // Merge channels into channels_config.
    // cli is required (no #[serde(default)]) when the section exists.
    if (Object.keys(data.channels).length > 0) {
      const cc: Record<string, unknown> = {
        ...(existing.channels_config ?? {}),
      };
      if (cc.cli === undefined) cc.cli = true;
      for (const [channelId, fields] of Object.entries(data.channels)) {
        const section: Record<string, unknown> = {
          ...((cc[channelId] as Record<string, unknown>) ?? {}),
        };
        const channelInfo = this.getSupportedChannels().find((c) => c.id === channelId);
        for (const [key, value] of Object.entries(fields)) {
          const fieldDef = channelInfo?.setupFields.find((f) => f.name === key);

          if (fieldDef?.type === "list") {
            // Always write list fields — ZeroClaw's Vec<T> fields may lack
            // #[serde(default)] and serde errors on missing fields.
            section[key] = value
              ? String(value)
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean)
              : [];
          } else if (!value && !fieldDef?.required) {
            // Write the field's default value rather than omitting — the Rust
            // struct may require this field even though our setup marks it optional
            // (e.g. Signal http_url, Webhook port).
            if (fieldDef?.default !== undefined) {
              section[key] = coerceTomlValue(fieldDef.default);
            }
            continue;
          } else {
            // Coerce strings to proper TOML types: "true"/"false" → boolean,
            // pure digits → integer. Prevents type mismatches with Rust structs
            // (e.g. Lark use_feishu: bool, Webhook port: u16).
            section[key] = coerceTomlValue(value);
          }
        }
        cc[channelId] = section;
      }
      config.channels_config = cc as ZeroClawConfig["channels_config"];
    }

    writeFileSync(configPath, TOML.stringify(config as TOML.JsonMap));
  }

  readSetup(agentDir: string): {
    provider?: Partial<ProviderSetup>;
    channels?: Record<string, Record<string, string>>;
  } | null {
    if (!existsSync(join(agentDir, "config.toml"))) return null;

    try {
      const parsed = readParsedConfig(agentDir);

      const provider: Partial<ProviderSetup> = {};
      if (parsed.default_provider) provider.provider = parsed.default_provider;
      if (parsed.api_key) provider.apiKey = parsed.api_key;
      if (parsed.default_model) provider.model = parsed.default_model;
      if (parsed.api_url) provider.apiUrl = parsed.api_url;

      const channels: Record<string, Record<string, string>> = {};
      const cc = parsed.channels_config;
      if (cc) {
        for (const [channelId, section] of Object.entries(cc)) {
          // Skip non-channel keys (cli: boolean, message_timeout_secs: number)
          if (channelId === "cli" || !section || typeof section !== "object") continue;
          const fields: Record<string, string> = {};
          for (const [key, value] of Object.entries(section as Record<string, unknown>)) {
            if (Array.isArray(value)) {
              // Convert arrays back to comma-separated for re-display
              fields[key] = value.map(String).join(", ");
            } else if (value != null) {
              fields[key] = String(value);
            }
          }
          channels[channelId] = fields;
        }
      }

      return { provider, channels };
    } catch {
      return null;
    }
  }
}
