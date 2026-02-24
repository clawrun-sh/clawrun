export interface CommandResult {
  exitCode: number;
  stdout(): Promise<string>;
  stderr(): Promise<string>;
}

export interface ZeroclawSandbox {
  runCommand(cmd: string, args?: string[]): Promise<CommandResult>;
  runCommand(opts: {
    cmd: string;
    args?: string[];
    env?: Record<string, string>;
  }): Promise<CommandResult>;
  writeFiles(files: Array<{ path: string; content: Buffer }>): Promise<void>;
  readFile(path: string): Promise<Buffer | null>;
}
