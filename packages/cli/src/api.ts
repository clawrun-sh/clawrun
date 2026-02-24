interface ApiClient {
  post(path: string, opts?: { body?: unknown }): Promise<Response>;
  get(path: string): Promise<Response>;
}

export function createApiClient(baseUrl: string, secret: string): ApiClient {
  const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" };
  return {
    async post(path, opts) {
      return fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers,
        body: opts?.body ? JSON.stringify(opts.body) : undefined,
      });
    },
    async get(path) {
      return fetch(`${baseUrl}${path}`, { headers });
    },
  };
}
