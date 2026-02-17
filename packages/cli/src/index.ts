#!/usr/bin/env node

import { Command } from "commander";
import { deployCommand } from "./commands/deploy.js";

const program = new Command();

program
  .name("cloudclaw")
  .description("CLI for deploying CloudClaw AI agent hosting")
  .version("0.1.0");

program
  .command("deploy <preset>")
  .description("Deploy an agent using a preset configuration")
  .option("-y, --yes", "Use defaults and skip prompts (CI mode)")
  .option("-d, --dir <directory>", "Target directory for the scaffolded app")
  .action(deployCommand);

program.parse();
