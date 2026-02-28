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

  // Read @clawrun/server version from node_modules (deployed instance)
  const serverPkgPath = join(process.cwd(), "node_modules", "@clawrun", "server", "package.json");
  if (existsSync(serverPkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(serverPkgPath, "utf-8"));
      version = pkg.version ?? "";
    } catch {}
  }

  return { instanceName, version };
}

export default function ChatPageServer() {
  const { instanceName, version } = readClawRunConfig();
  return <ChatPage instanceName={instanceName} version={version} />;
}
