import type { RedisClient } from "./redis-types";
import type { StateStore } from "./state-types";

export class RedisStateStore implements StateStore {
  constructor(
    private redis: RedisClient,
    private prefix: string,
  ) {}

  private key(k: string): string {
    return `${this.prefix}${k}`;
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(this.key(key));
  }

  async set(key: string, value: string): Promise<void> {
    await this.redis.set(this.key(key), value);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(this.key(key));
  }
}
