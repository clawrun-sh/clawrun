import { Redis } from "ioredis";
import type { RedisClient } from "./redis-types.js";

export function createRedisClient(url: string): RedisClient {
  const redis = new Redis(url, { lazyConnect: true });
  return {
    get: (key) => redis.get(key),
    set: (key, value, opts) => {
      const args: (string | number)[] = [key, value];
      if (opts?.ex) args.push("EX", opts.ex);
      if (opts?.nx) args.push("NX");
      return redis.call("SET", ...args) as Promise<string | "OK" | null>;
    },
    del: (...keys) => redis.del(...keys),
    eval: (script, keys, args) => redis.eval(script, keys.length, ...keys, ...args),
  };
}
