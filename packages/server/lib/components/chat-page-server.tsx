import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import ChatPage from "./chat-page";

function readClawRunConfig(): { instanceName: string; version: string } {
  let instanceName = "";
  let version = "";

  const configPath = join(process.cwd(), "clawrun.json");
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      instanceName = config.instance?.name ?? "";
    } catch {}
  }

  // Read version from the instance's package.json (stamped by CLI during deploy)
  const pkgPath = join(process.cwd(), "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      version = pkg.version ?? "";
    } catch {}
  }

  return { instanceName, version };
}

export default function ChatPageServer() {
  const { instanceName, version } = readClawRunConfig();
  return <ChatPage instanceName={instanceName} version={version} />;
}
