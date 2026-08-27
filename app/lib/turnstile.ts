export const MANUAL_ENTRY_TURNSTILE_ACTION = "manual_measurement";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";
const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

type RateLimitResult = {
  success: boolean;
};

type RateLimiter = {
  limit(options: { key: string }): Promise<RateLimitResult>;
};

export type TurnstileRuntimeEnv = {
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  MANUAL_ENTRY_RATE_LIMITER?: RateLimiter;
};

type SiteverifyResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

export class TurnstileRequestError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 429 | 503,
  ) {
    super(message);
    this.name = "TurnstileRequestError";
  }
}

export async function getTurnstileRuntimeEnv(): Promise<TurnstileRuntimeEnv> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as TurnstileRuntimeEnv;
}

export function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export async function enforceManualEntryRateLimit(
  request: Request,
  runtimeEnv: TurnstileRuntimeEnv,
) {
  const hostname = new URL(request.url).hostname;
  const limiter = runtimeEnv.MANUAL_ENTRY_RATE_LIMITER;
  if (!limiter) {
    if (isLocalHostname(hostname)) return;
    throw new TurnstileRequestError("現場登記的流量保護尚未完成設定，請稍後再試。", 503);
  }

  const clientAddress = request.headers.get("CF-Connecting-IP")?.trim() || "unknown-client";
  const result = await limiter.limit({ key: `manual-entry:${clientAddress}` });
  if (!result.success) {
    throw new TurnstileRequestError("登記次數過於頻繁，請一分鐘後再試。", 429);
  }
}

export async function verifyTurnstileToken(options: {
  request: Request;
  runtimeEnv: TurnstileRuntimeEnv;
  token: unknown;
  fetchImpl?: typeof fetch;
}) {
  const token = typeof options.token === "string" ? options.token.trim() : "";
  if (!token) {
    throw new TurnstileRequestError("請先完成安全驗證。", 400);
  }

  const secret = options.runtimeEnv.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) {
    throw new TurnstileRequestError("安全驗證服務尚未完成設定，請稍後再試。", 503);
  }

  const requestUrl = new URL(options.request.url);
  if (
    isLocalHostname(requestUrl.hostname)
    && secret === TURNSTILE_TEST_SECRET_KEY
    && token === TURNSTILE_DUMMY_TOKEN
  ) {
    return;
  }

  const verificationBody = new FormData();
  verificationBody.set("secret", secret);
  verificationBody.set("response", token);
  verificationBody.set("idempotency_key", crypto.randomUUID());
  const clientAddress = options.request.headers.get("CF-Connecting-IP")?.trim();
  if (clientAddress) verificationBody.set("remoteip", clientAddress);

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(SITEVERIFY_URL, {
      method: "POST",
      body: verificationBody,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new TurnstileRequestError("安全驗證服務暫時無法連線，請稍後再試。", 503);
  }

  if (!response.ok) {
    throw new TurnstileRequestError("安全驗證服務暫時無法使用，請稍後再試。", 503);
  }

  const result = await response.json() as SiteverifyResponse;
  if (!result.success) {
    const expired = result["error-codes"]?.includes("timeout-or-duplicate");
    throw new TurnstileRequestError(
      expired ? "安全驗證已逾時，請重新驗證後送出。" : "安全驗證未通過，請重新嘗試。",
      400,
    );
  }

  if (result.action !== MANUAL_ENTRY_TURNSTILE_ACTION) {
    throw new TurnstileRequestError("安全驗證用途不符，請重新整理頁面後再試。", 400);
  }

  if (
    !isLocalHostname(requestUrl.hostname)
    && result.hostname !== requestUrl.hostname
  ) {
    throw new TurnstileRequestError("安全驗證來源不符，請重新整理頁面後再試。", 400);
  }
}
