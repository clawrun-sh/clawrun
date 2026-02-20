import { Redis } from "@upstash/redis";
import type { RedisClient } from "./redis-types";

export function createUpstashClient(): RedisClient {
  const redis = Redis.fromEnv(); // reads KV_REST_API_URL + KV_REST_API_TOKEN
  return {
    get: (key) => redis.get<string>(key),
    set: (key, value, opts) => {
      if (opts?.ex && opts?.nx) {
        return redis.set(key, value, { ex: opts.ex, nx: true }) as Promise<
          string | "OK" | null
        >;
      }
      if (opts?.ex) {
        return redis.set(key, value, { ex: opts.ex }) as Promise<
          string | "OK" | null
        >;
      }
      if (opts?.nx) {
        return redis.set(key, value, { nx: true }) as Promise<
          string | "OK" | null
        >;
      }
      return redis.set(key, value) as Promise<string | "OK" | null>;
    },
    del: (...keys) => redis.del(...keys),
    eval: (script, keys, args) => redis.eval(script, keys, args),
  };
}
