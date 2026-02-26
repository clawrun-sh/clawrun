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
  cmds: { deploy, list, destroy, agent: agentCommand, connect, start, stop, logs, pull },
  examples: [
    { description: "Deploy a new instance", command: "clawrun deploy" },
    { description: "Chat with the agent", command: "clawrun agent my-instance" },
    { description: "Pull agent state from sandbox", command: "clawrun pull my-instance" },
    { description: "Open a shell in the sandbox", command: "clawrun connect my-instance" },
  ],
});
