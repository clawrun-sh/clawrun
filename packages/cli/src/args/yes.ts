import { flag } from "cmd-ts";

export const yes = flag({
  long: "yes",
  short: "y",
  description: "Skip confirmation prompts",
});
