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
import type {
  Agent,
  SandboxHandle,
  AgentResponse,
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

    // Embed any image files referenced in the response as data URIs
    const enriched = await this.embedImages(sandbox, root, parsed.message);

    return { success: parsed.success, message: enriched, error: parsed.error };
  }

  // Markdown image with attachment: URI — ![alt](attachment:filename.png)
  private static readonly ATTACHMENT_RE =
    /!\[([^\]]*)\]\(attachment:([\w][\w.-]*)\)/g;

  // ZeroClaw native marker — [IMAGE:/path/to/file.png]
  private static readonly IMAGE_MARKER_RE = /\[IMAGE:(\/[^\]]+)\]/g;

  // Bare image filename — catches filenames regardless of LLM formatting
  // (backticks, "File:", list items, "(attached)", etc.)
  // Validated by actually reading the file from the sandbox.
  private static readonly BARE_IMAGE_RE =
    /\b([\w][\w.-]*\.(?:png|jpe?g|gif|webp|bmp))\b/gi;

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
  private async embedImages(
    sandbox: SandboxHandle,
    root: string,
    text: string,
  ): Promise<string> {
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
          `(?:[-*]\\s+|File:\\s*)?` +           // optional list marker or "File:"
          `\`?${escapeRegExp(filename)}\`?` +    // filename, optionally backtick-wrapped
          `(?:\\s*\\(attached\\))?`,              // optional "(attached)"
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
