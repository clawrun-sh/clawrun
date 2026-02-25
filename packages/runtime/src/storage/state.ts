import type { StateStore, LockStore } from "./state-types.js";
import { RedisStateStore } from "./state-redis.js";
import { RedisLockStore } from "./lock-redis.js";
import { PostgresStateStore } from "./state-postgres.js";
import type { RedisClient } from "./redis-types.js";
import { createUpstashClient } from "./redis-upstash.js";
import { getRuntimeConfig } from "../config.js";

let _redisClient: RedisClient | null = null;

function getRedisClient(): RedisClient | null {
  if (_redisClient) return _redisClient;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  _redisClient = createUpstashClient();
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
  if (process.env.POSTGRES_URL || process.env.DATABASE_URL) return new PostgresStateStore();
  return null;
}

export function getLockStore(): LockStore | null {
  const redis = getRedisClient();
  if (redis) return new RedisLockStore(redis, getKeyPrefix());
  return null; // No atomic lock without Redis — callers degrade gracefully
}

export type { StateStore, LockStore } from "./state-types.js";
