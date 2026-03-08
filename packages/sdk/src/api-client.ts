import { signUserToken } from "@clawrun/auth";
import { ApiError, NetworkError } from "./errors.js";

export interface ApiClientOptions {
  /** Custom fetch implementation. */
  fetch?: typeof fetch;
}

/**
 * Low-level HTTP client for a deployed ClawRun instance.
 * Signs a fresh user JWT for each request.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly jwtSecret: string;
  private readonly _fetch: typeof fetch;

  constructor(baseUrl: string, jwtSecret: string, options?: ApiClientOptions) {
    // Strip trailing slash
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.jwtSecret = jwtSecret;
    this._fetch = options?.fetch ?? globalThis.fetch;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const jwt = await signUserToken(this.jwtSecret);
    return { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };
  }

  /** POST with JSON body. Returns parsed JSON. Throws ApiError on non-2xx. */
  async post<T = unknown>(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const res = await this.rawPost(path, body, signal);
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  /** GET with parsed JSON response. Throws ApiError on non-2xx. */
  async get<T = unknown>(path: string, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await this._fetch(`${this.baseUrl}${path}`, {
        headers: await this.authHeaders(),
        signal,
      });
    } catch (err) {
      throw new NetworkError(
        `GET ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ApiError(res.status, body);
    }

    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  /**
   * POST returning the raw Response (for streaming).
   * Throws ApiError on non-2xx, NetworkError on fetch failure.
   */
  async rawPost(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    let res: Response;
    try {
      res = await this._fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: await this.authHeaders(),
        body: body != null ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (err) {
      throw new NetworkError(
        `POST ${path} failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(res.status, text);
    }

    return res;
  }

  /** The base URL of the instance. */
  get url(): string {
    return this.baseUrl;
  }
}
