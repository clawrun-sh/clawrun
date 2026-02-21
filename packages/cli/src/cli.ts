#!/usr/bin/env node
import { run, setDefaultHelpFormatter } from "cmd-ts";
// cmd-ts lacks `exports` in package.json, so the batteries/ subpath
// doesn't resolve under Node ESM. Import from the explicit dist path.
import { createVercelFormatter } from "cmd-ts/dist/esm/batteries/vercel-formatter.js";
import { app } from "./app.js";
import { StyledError } from "./error.js";

setDefaultHelpFormatter(
  createVercelFormatter({ cliName: "CloudClaw", logo: "\u25B8" }),
);

async function main() {
  try {
    await run(app, process.argv.slice(2));
  } catch (e) {
    if (e instanceof StyledError) {
      console.error("\n" + e.message);
      process.exit(1);
    }
    console.error(e);
    process.exit(1);
  }
}

main();
