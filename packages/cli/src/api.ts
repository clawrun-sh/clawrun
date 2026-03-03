import { signAdminToken } from "@clawrun/auth";

interface ApiClient {
  post(path: string, opts?: { body?: unknown; signal?: AbortSignal }): Promise<Response>;
  get(path: string, opts?: { signal?: AbortSignal }): Promise<Response>;
}

/** Create an API client that signs a fresh admin JWT for each request. */
export function createApiClient(baseUrl: string, jwtSecret: string): ApiClient {
  async function authHeaders(): Promise<Record<string, string>> {
    const jwt = await signAdminToken(jwtSecret);
    return { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };
  }

  return {
    async post(path, opts) {
      return fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: await authHeaders(),
        body: opts?.body ? JSON.stringify(opts.body) : undefined,
        signal: opts?.signal,
      });
    },
    async get(path, opts) {
      return fetch(`${baseUrl}${path}`, {
        headers: await authHeaders(),
        signal: opts?.signal,
      });
    },
  };
}
