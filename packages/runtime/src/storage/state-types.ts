export interface StateStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface LockStore {
  /** Try to acquire a lock. Returns nonce if acquired, null if held. */
  tryAcquire(key: string, ttlMs: number): Promise<string | null>;
  /** Release a lock only if the nonce matches. */
  release(key: string, nonce: string): Promise<void>;
}
