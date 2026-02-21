import { positional, string } from "cmd-ts";
import type { Type } from "cmd-ts";
import chalk from "chalk";
import { instanceExists } from "../instance/index.js";

const instanceType: Type<string, string> = {
  ...string,
  displayName: "instance",
  description: "Instance name",
  async from(name) {
    if (!instanceExists(name)) {
      throw new Error(
        [
          `Instance "${name}" not found.`,
          `${chalk.bold("hint:")} Use ${chalk.cyan("cloudclaw list")} to see available instances.`,
        ].join("\n"),
      );
    }
    return name;
  },
};

export const instance = positional({
  type: instanceType,
  displayName: "instance",
  description: "The instance name",
});
