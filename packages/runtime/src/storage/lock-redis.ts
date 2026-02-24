import { randomUUID } from "node:crypto";
import type { RedisClient } from "./redis-types.js";
import type { LockStore } from "./state-types.js";

export class RedisLockStore implements LockStore {
  constructor(
    private redis: RedisClient,
    private prefix: string,
  ) {}

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  async tryAcquire(key: string, ttlMs: number): Promise<string | null> {
    const nonce = randomUUID();
    const ttlSeconds = Math.ceil(ttlMs / 1000);
    const result = await this.redis.set(this.key(key), nonce, {
      ex: ttlSeconds,
      nx: true,
    });
    return result ? nonce : null;
  }

  async release(key: string, nonce: string): Promise<void> {
    const fullKey = this.key(key);
    const script = `if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`;
    await this.redis.eval(script, [fullKey], [nonce]);
  }
}
