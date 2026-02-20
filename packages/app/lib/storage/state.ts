import type { StateStore, LockStore } from "./state-types";
import { RedisStateStore } from "./state-redis";
import { RedisLockStore } from "./lock-redis";
import { PostgresStateStore } from "./state-postgres";
import type { RedisClient } from "./redis-types";

let _redisClient: RedisClient | null = null;

function getRedisClient(): RedisClient | null {
  if (_redisClient) return _redisClient;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN)
    return null;
  // Dynamic require to avoid importing @upstash/redis when not configured
  const { createUpstashClient } =
    require("./redis-upstash") as typeof import("./redis-upstash");
  _redisClient = createUpstashClient();
  return _redisClient;
}

/** Key prefix for multi-instance isolation: "cloudclaw:{instance}:" */
function getKeyPrefix(): string {
  const instance = process.env.CLOUDCLAW_INSTANCE_NAME ?? "default";
  return `cloudclaw:${instance}:`;
}

export function getStateStore(): StateStore | null {
  const redis = getRedisClient();
  if (redis) return new RedisStateStore(redis, getKeyPrefix());
  if (process.env.POSTGRES_URL || process.env.DATABASE_URL)
    return new PostgresStateStore();
  return null;
}

export function getLockStore(): LockStore | null {
  const redis = getRedisClient();
  if (redis) return new RedisLockStore(redis, getKeyPrefix());
  return null; // No atomic lock without Redis — callers degrade gracefully
}

export type { StateStore, LockStore } from "./state-types";
