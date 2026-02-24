interface ParsedOutput {
  success: boolean;
  message: string;
  error?: string;
  exitCode: number;
}

export function parseOutput(stdout: string, stderr: string, exitCode: number): ParsedOutput {
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

export function parseCronListOutput(stdout: string): { jobs: Array<{ nextRunAt: string }> } {
  const matches = [...stdout.matchAll(/next=([\d-]+T[\d:.+Z]+)/g)];
  const now = Date.now();
  const jobs = matches
    .map((m) => {
      const t = new Date(m[1]);
      return { nextRunAt: t.toISOString(), _ms: t.getTime() };
    })
    .filter((j) => !isNaN(j._ms) && j._ms > now)
    .map(({ nextRunAt }) => ({ nextRunAt }));
  return { jobs };
}
