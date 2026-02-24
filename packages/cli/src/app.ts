import { subcommands } from "cmd-ts";
import { deploy } from "./commands/deploy.js";
import { list } from "./commands/list.js";
import { destroy } from "./commands/destroy.js";
import { agentCommand } from "./commands/agent.js";
import { connect } from "./commands/connect.js";
import { start } from "./commands/start.js";
import { stop } from "./commands/stop.js";
import { logs } from "./commands/logs.js";
import { pull } from "./commands/pull.js";
import { version } from "./pkg.js";

export const app = subcommands({
  name: "cloudclaw",
  description: "AI agent hosting, simplified.",
  version,
  cmds: { deploy, list, destroy, agent: agentCommand, connect, start, stop, logs, pull },
  examples: [
    { description: "Deploy a new instance", command: "cloudclaw deploy" },
    { description: "Deploy with a specific preset", command: "cloudclaw deploy --preset zeroclaw-basic" },
    { description: "List all instances", command: "cloudclaw list" },
    { description: "Chat with an agent", command: "cloudclaw agent my-instance -m \"Hello\"" },
    { description: "Open a shell in the sandbox", command: "cloudclaw connect my-instance" },
    { description: "Start sandbox if not running", command: "cloudclaw start my-instance" },
    { description: "Stop a running sandbox", command: "cloudclaw stop my-instance" },
    { description: "View instance logs", command: "cloudclaw logs my-instance" },
    { description: "Follow live logs", command: "cloudclaw logs my-instance -f" },
    { description: "Pull agent state from sandbox", command: "cloudclaw pull my-instance" },
    { description: "Remove an instance", command: "cloudclaw destroy my-instance" },
  ],
});
