import { subcommands } from "cmd-ts";
import { deploy } from "./commands/deploy.js";
import { list } from "./commands/list.js";
import { destroy } from "./commands/destroy.js";
import { agent } from "./commands/agent.js";
import { connect } from "./commands/connect.js";
import { version } from "./pkg.js";

export const app = subcommands({
  name: "cloudclaw",
  description: "AI agent hosting, simplified.",
  version,
  cmds: { deploy, list, destroy, agent, connect },
  examples: [
    { description: "Deploy a new instance", command: "cloudclaw deploy" },
    { description: "Deploy with a specific preset", command: "cloudclaw deploy --preset zeroclaw-basic" },
    { description: "List all instances", command: "cloudclaw list" },
    { description: "Chat with an agent", command: "cloudclaw agent my-instance -m \"Hello\"" },
    { description: "Open a shell in the sandbox", command: "cloudclaw connect my-instance" },
    { description: "Remove an instance", command: "cloudclaw destroy my-instance" },
  ],
});
