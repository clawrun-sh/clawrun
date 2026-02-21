#!/usr/bin/env node

import { Command } from "commander";
import { deployCommand } from "./commands/deploy.js";
import { listCommand } from "./commands/list.js";
import { destroyCommand } from "./commands/destroy.js";
import { agentCommand } from "./commands/agent.js";

const program = new Command();

program
  .name("cloudclaw")
  .description("CLI for deploying CloudClaw AI agent hosting")
  .version("0.1.0");

program
  .command("deploy [name]")
  .description("Create or upgrade and deploy an instance")
  .option("-y, --yes", "Use defaults and skip prompts (CI mode)")
  .option("-p, --preset <preset>", "Preset to use (for new instances)")
  .action(deployCommand);

program
  .command("list")
  .description("List all instances")
  .action(listCommand);

program
  .command("destroy <name>")
  .description("Remove an instance")
  .option("-y, --yes", "Skip confirmation")
  .action(destroyCommand);

program
  .command("agent <instance>")
  .description("Chat with the agent running in an instance")
  .option("-m, --message <message>", "Send a single message (non-interactive)")
  .action(agentCommand);

program.parse();
