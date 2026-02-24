/** Minimal Redis client contract — provider-agnostic. */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    opts?: { ex?: number; nx?: boolean },
  ): Promise<string | "OK" | null>;
  del(...keys: string[]): Promise<number>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
}
