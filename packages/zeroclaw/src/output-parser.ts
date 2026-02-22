interface ParsedOutput {
  success: boolean;
  message: string;
  error?: string;
  exitCode: number;
}

export function parseOutput(
  stdout: string,
  stderr: string,
  exitCode: number,
): ParsedOutput {
  if (exitCode !== 0) {
    return {
      success: false,
      message: "The agent encountered an error.",
      error: stderr.trim() || stdout.trim() || "Unknown error",
      exitCode,
    };
  }

  const text = stdout.trim();

  if (!text) {
    return {
      success: true,
      message: "The agent completed but produced no output.",
      exitCode,
    };
  }

  return {
    success: true,
    message: text,
    exitCode,
  };
}
