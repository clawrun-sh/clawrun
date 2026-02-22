/** Minimal sandbox info returned by list. */
export interface SandboxEntry {
  id: string;
  status: string;
}

/** Result of running a command in a sandbox. */
export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Client interface for interacting with sandboxes from the CLI.
 * Platform-specific details (Vercel, etc.) are behind implementations.
 */
export interface SandboxClient {
  /** List sandboxes (running ones by default). */
  list(): Promise<SandboxEntry[]>;

  /** Execute a command inside a running sandbox. */
  exec(
    sandboxId: string,
    cmd: string,
    args: string[],
    env?: Record<string, string>,
    options?: { timeoutMs?: number },
  ): Promise<ExecResult>;

  /** Open an interactive shell in a running sandbox. */
  connect(sandboxId: string): Promise<void>;
}
