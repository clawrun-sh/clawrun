import type { ChannelValidator } from "../types.js";

// POST {base}/auth/v3/tenant_access_token/internal
export const validator: ChannelValidator = {
  channelId: "lark",

  async validate(fields) {
    const appId = fields.app_id;
    const appSecret = fields.app_secret;
    if (!appId || !appSecret) return { ok: false, message: "App ID and Secret are required" };

    const useFeishu = fields.use_feishu === "true";
    const baseUrl = useFeishu
      ? "https://open.feishu.cn/open-apis"
      : "https://open.larksuite.com/open-apis";

    const resp = await fetch(`${baseUrl}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!resp.ok) {
      return { ok: false, message: "Connection failed — check your credentials" };
    }

    const data = await resp.json();
    const hasToken =
      typeof data?.tenant_access_token === "string" && data.tenant_access_token.trim() !== "";

    if (!hasToken) {
      const detail = data?.msg ?? data?.message ?? "unknown error";
      return { ok: false, message: `Auth rejected: ${detail}` };
    }

    return { ok: true, message: "Lark/Feishu credentials verified" };
  },
};
