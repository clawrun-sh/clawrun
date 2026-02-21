import { subcommands } from "cmd-ts";
import { deploy } from "./commands/deploy.js";
import { list } from "./commands/list.js";
import { destroy } from "./commands/destroy.js";
import { agent } from "./commands/agent.js";
import { connect } from "./commands/connect.js";

export const app = subcommands({
  name: "cloudclaw",
  description: "AI agent hosting, simplified.",
  version: "0.1.0",
  cmds: { deploy, list, destroy, agent, connect },
});
