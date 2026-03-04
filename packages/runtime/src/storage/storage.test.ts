import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedisStateStore } from "./state-redis.js";
import { RedisLockStore } from "./lock-redis.js";
import type { RedisClient } from "./redis-types.js";

function mockRedis(): RedisClient {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1),
    eval: vi.fn(async () => 1),
  } as unknown as RedisClient;
}

describe("RedisStateStore", () => {
  let redis: RedisClient;
  let store: RedisStateStore;

  beforeEach(() => {
    redis = mockRedis();
    store = new RedisStateStore(redis, "clawrun:mybot:");
  });

  it("get prefixes key", async () => {
    await store.get("next_wake_at");
    expect(redis.get).toHaveBeenCalledWith("clawrun:mybot:next_wake_at");
  });

  it("set prefixes key", async () => {
    await store.set("next_wake_at", "2025-01-01T00:00:00Z");
    expect(redis.set).toHaveBeenCalledWith("clawrun:mybot:next_wake_at", "2025-01-01T00:00:00Z");
  });

  it("delete prefixes key and calls del", async () => {
    await store.delete("next_wake_at");
    expect(redis.del).toHaveBeenCalledWith("clawrun:mybot:next_wake_at");
  });
});

describe("RedisLockStore", () => {
  let redis: RedisClient;
  let store: RedisLockStore;

  beforeEach(() => {
    redis = mockRedis();
    store = new RedisLockStore(redis, "clawrun:mybot:");
  });

  it("tryAcquire calls SET NX with TTL and returns nonce on success", async () => {
    vi.mocked(redis.set).mockResolvedValue("OK" as string | null);

    const nonce = await store.tryAcquire("creation_lock", 30000);

    expect(nonce).toBeTruthy();
    expect(typeof nonce).toBe("string");
    expect(redis.set).toHaveBeenCalledWith("clawrun:mybot:creation_lock", nonce, {
      ex: 30,
      nx: true,
    });
  });

  it("tryAcquire returns null when lock already held", async () => {
    vi.mocked(redis.set).mockResolvedValue(null as string | null);

    const nonce = await store.tryAcquire("creation_lock", 10000);
    expect(nonce).toBeNull();
  });

  it("release calls eval with Lua CAS script", async () => {
    const nonce = "test-nonce-uuid";
    await store.release("creation_lock", nonce);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call"),
      ["clawrun:mybot:creation_lock"],
      [nonce],
    );
  });

  it("tryAcquire rounds TTL up to next second", async () => {
    vi.mocked(redis.set).mockResolvedValue("OK" as string | null);

    await store.tryAcquire("lock", 1500); // 1.5s → 2s

    expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      ex: 2,
      nx: true,
    });
  });
});
