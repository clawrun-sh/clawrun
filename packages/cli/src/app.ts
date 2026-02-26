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
  name: "clawrun",
  description: "AI agent hosting, simplified.",
  version,
  cmds: { deploy, list, destroy, agent: agentCommand, tui: agentCommand, connect, start, stop, logs, pull },
  examples: [
    { description: "Deploy a new instance", command: "clawrun deploy" },
    {
      description: "Deploy with a specific preset",
      command: "clawrun deploy --preset starter",
    },
    { description: "List all instances", command: "clawrun list" },
    { description: "Chat with an agent", command: 'clawrun agent my-instance -m "Hello"' },
    { description: "Chat TUI", command: "clawrun tui my-instance" },
    { description: "Open a shell in the sandbox", command: "clawrun connect my-instance" },
    { description: "Start sandbox if not running", command: "clawrun start my-instance" },
    { description: "Stop a running sandbox", command: "clawrun stop my-instance" },
    { description: "View instance logs", command: "clawrun logs my-instance" },
    { description: "Follow live logs", command: "clawrun logs my-instance -f" },
    { description: "Pull agent state from sandbox", command: "clawrun pull my-instance" },
    { description: "Remove an instance", command: "clawrun destroy my-instance" },
  ],
});
