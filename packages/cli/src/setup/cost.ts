import * as clack from "@clack/prompts";
import chalk from "chalk";
import { fetchPricingData, lookupModelPricingSync, type ModelPricingInfo } from "./pricing.js";

export interface CostSetup {
  enabled: boolean;
  inputPerMillion: number;
  outputPerMillion: number;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
}

/**
 * Prompt the user to configure cost tracking after model selection.
 *
 * Flow:
 * 1. Fetch model pricing from LiteLLM (spinner)
 * 2. Show pricing if found, then ask to enable cost management
 * 3. If yes: confirm/edit pricing, set daily + monthly limits
 *
 * Returns `{ enabled: false }` if user declines.
 */
export async function promptCost(
  provider: string,
  model: string,
  existing?: Partial<CostSetup>,
): Promise<CostSetup> {
  const disabled: CostSetup = {
    enabled: false,
    inputPerMillion: 0,
    outputPerMillion: 0,
    dailyLimitUsd: 0,
    monthlyLimitUsd: 0,
  };

  // Fetch pricing data
  const s = clack.spinner();
  s.start("Looking up model pricing...");

  let pricing: ModelPricingInfo | null = null;
  try {
    const data = await fetchPricingData();
    if (data) {
      pricing = lookupModelPricingSync(data, provider, model);
    }
  } catch {
    // Network failure — continue without
  }

  let inputPerMillion: number;
  let outputPerMillion: number;

  if (pricing) {
    inputPerMillion = pricing.inputPerMillion;
    outputPerMillion = pricing.outputPerMillion;
    s.stop("Found model pricing");

    clack.note(
      [
        `Input:  ${chalk.green(`$${inputPerMillion}`)} per 1M tokens`,
        `Output: ${chalk.green(`$${outputPerMillion}`)} per 1M tokens`,
      ].join("\n"),
      "Model Pricing",
    );
  } else if (existing?.inputPerMillion != null && existing.inputPerMillion > 0) {
    // Use saved pricing only when the caller confirms the model hasn't changed.
    // Callers must NOT pass existing pricing when the model changed.
    inputPerMillion = existing.inputPerMillion;
    outputPerMillion = existing.outputPerMillion ?? 0;
    s.stop("Using saved pricing");

    clack.note(
      [
        `Input:  ${chalk.green(`$${inputPerMillion}`)} per 1M tokens`,
        `Output: ${chalk.green(`$${outputPerMillion}`)} per 1M tokens`,
      ].join("\n"),
      "Saved Pricing",
    );
  } else {
    inputPerMillion = 0;
    outputPerMillion = 0;

    s.stop("Could not find pricing for this model");
  }

  // Ask to enable cost management
  clack.log.info(chalk.dim("Tracks token usage and enforces daily/monthly spending limits."));
  const enableCost = await clack.confirm({
    message: "Enable spending limits?",
    initialValue: existing?.enabled ?? true,
  });

  if (clack.isCancel(enableCost)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  if (!enableCost) return disabled;

  // Confirm or edit pricing
  if (inputPerMillion > 0 || outputPerMillion > 0) {
    const editPricing = await clack.confirm({
      message: `Verify pricing — $${inputPerMillion} in / $${outputPerMillion} out per 1M tokens. Edit?`,
      initialValue: false,
    });

    if (clack.isCancel(editPricing)) {
      clack.cancel("Setup cancelled.");
      process.exit(0);
    }

    if (editPricing) {
      clack.log.info(
        chalk.dim(
          "Pricing is fetched automatically and may not reflect your provider's actual rates. Adjust if needed for accurate tracking.",
        ),
      );
      const edited = await promptPricingValues(inputPerMillion, outputPerMillion);
      inputPerMillion = edited.input;
      outputPerMillion = edited.output;
    }
  } else {
    clack.log.info(
      chalk.dim(
        "Pricing is needed for accurate cost tracking. Check your provider's pricing page for per-token rates.",
      ),
    );
    const entered = await promptPricingValues(0, 0);
    inputPerMillion = entered.input;
    outputPerMillion = entered.output;
  }

  // Daily limit
  const dailyDefault = existing?.dailyLimitUsd ?? 10;
  const dailyInput = await clack.text({
    message: "Daily spending limit (USD)",
    defaultValue: String(dailyDefault),
    validate: (v) => {
      if (!v) return "Enter a positive number";
      const n = parseFloat(v);
      if (isNaN(n) || n <= 0) return "Enter a positive number";
      return undefined;
    },
  });

  if (clack.isCancel(dailyInput)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  const dailyLimitUsd = parseFloat(dailyInput as string);

  // Monthly limit — default to ~daily * 31
  const monthlyDefault = existing?.monthlyLimitUsd ?? Math.round(dailyLimitUsd * 31);
  const monthlyInput = await clack.text({
    message: "Monthly spending limit (USD)",
    defaultValue: String(monthlyDefault),
    validate: (v) => {
      if (!v) return "Enter a positive number";
      const n = parseFloat(v);
      if (isNaN(n) || n <= 0) return "Enter a positive number";
      return undefined;
    },
  });

  if (clack.isCancel(monthlyInput)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  const monthlyLimitUsd = parseFloat(monthlyInput as string);

  clack.log.success(
    `Cost management: ${chalk.green(`$${dailyLimitUsd}/day`)} · ${chalk.green(`$${monthlyLimitUsd}/month`)}`,
  );

  return {
    enabled: true,
    inputPerMillion,
    outputPerMillion,
    dailyLimitUsd,
    monthlyLimitUsd,
  };
}

async function promptPricingValues(
  defaultInput: number,
  defaultOutput: number,
): Promise<{ input: number; output: number }> {
  const inputVal = await clack.text({
    message: "Input cost per 1M tokens (USD)",
    defaultValue: String(defaultInput),
    validate: (v) => {
      if (!v) return "Enter a non-negative number";
      const n = parseFloat(v);
      if (isNaN(n) || n < 0) return "Enter a non-negative number";
      return undefined;
    },
  });

  if (clack.isCancel(inputVal)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  const outputVal = await clack.text({
    message: "Output cost per 1M tokens (USD)",
    defaultValue: String(defaultOutput),
    validate: (v) => {
      if (!v) return "Enter a non-negative number";
      const n = parseFloat(v);
      if (isNaN(n) || n < 0) return "Enter a non-negative number";
      return undefined;
    },
  });

  if (clack.isCancel(outputVal)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  return {
    input: parseFloat(inputVal as string),
    output: parseFloat(outputVal as string),
  };
}
