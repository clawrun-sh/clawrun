import type { ChannelValidator, ChannelValidationResult } from "./types.js";
import { validator as telegram } from "./telegram/validator.js";
import { validator as discord } from "./discord/validator.js";
import { validator as slack } from "./slack/validator.js";
import { validator as matrix } from "./matrix/validator.js";
import { validator as whatsapp } from "./whatsapp/validator.js";
import { validator as linq } from "./linq/validator.js";
import { validator as dingtalk } from "./dingtalk/validator.js";
import { validator as qq } from "./qq/validator.js";
import { validator as lark } from "./lark/validator.js";

const validators: Map<string, ChannelValidator> = new Map();

function register(v: ChannelValidator): void {
  validators.set(v.channelId, v);
}

register(telegram);
register(discord);
register(slack);
register(matrix);
register(whatsapp);
register(linq);
register(dingtalk);
register(qq);
register(lark);
// iMessage, Signal, IRC, Webhook, Nextcloud Talk, Nostr — no remote validation

/** Get a validator by channel ID. Returns undefined if not registered. */
export function getValidator(channelId: string): ChannelValidator | undefined {
  return validators.get(channelId);
}

/** Get all registered validators. */
export function getAllValidators(): ChannelValidator[] {
  return [...validators.values()];
}

/**
 * Check whether a channel has a credential validator.
 */
export function hasValidator(channelId: string): boolean {
  return validators.has(channelId);
}

/**
 * Validate channel credentials using the same HTTP calls ZeroClaw's wizard uses.
 * Returns null if the channel has no validator (always passes).
 */
export async function validateChannel(
  channelId: string,
  fields: Record<string, string>,
): Promise<ChannelValidationResult | null> {
  const validator = validators.get(channelId);
  if (!validator) return null;

  try {
    return await validator.validate(fields);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, message: `Validation failed: ${msg}` };
  }
}
