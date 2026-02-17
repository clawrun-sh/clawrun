import type { ZeroClawResult } from "./types.js";

export function parseOutput(
  stdout: string,
  stderr: string,
  exitCode: number,
): ZeroClawResult {
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
