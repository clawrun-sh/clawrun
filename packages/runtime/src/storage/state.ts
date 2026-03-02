import type { StateStore, LockStore } from "./state-types.js";
import { RedisStateStore } from "./state-redis.js";
import { RedisLockStore } from "./lock-redis.js";
import type { RedisClient } from "./redis-types.js";
import { createRedisClient } from "./redis-client.js";
import { getRuntimeConfig } from "../config.js";

let _redisClient: RedisClient | null = null;

function getRedisClient(): RedisClient | null {
  if (_redisClient) return _redisClient;
  const url = process.env.REDIS_URL ?? process.env.KV_URL;
  if (!url) return null;
  _redisClient = createRedisClient(url);
  return _redisClient;
}

/** Key prefix for multi-instance isolation: "clawrun:{instance}:" */
function getKeyPrefix(): string {
  const instance = getRuntimeConfig().instance.name;
  return `clawrun:${instance}:`;
}

export function getStateStore(): StateStore | null {
  const redis = getRedisClient();
  if (redis) return new RedisStateStore(redis, getKeyPrefix());
  return null;
}

export function getLockStore(): LockStore | null {
  const redis = getRedisClient();
  if (redis) return new RedisLockStore(redis, getKeyPrefix());
  return null; // No atomic lock without Redis — callers degrade gracefully
}

export type { StateStore, LockStore } from "./state-types.js";
