import { execFile } from "node:child_process";

/** Open a URL in the default browser (cross-platform). */
export function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  execFile(cmd, [url]);
}
