import { isLocalHostname } from "./turnstile";

type RateLimitResult = {
  success: boolean;
};

type RateLimiter = {
  limit(options: { key: string }): Promise<RateLimitResult>;
};

export type AdminWriteAuthorizationRuntimeEnv = {
  ADMIN_PASSWORD?: string;
  DELETE_PASSWORD?: string;
  ADMIN_WRITE_RATE_LIMITER?: RateLimiter;
};

export class AdminWriteAuthorizationError extends Error {
  constructor(
    message: string,
    public readonly status: 403 | 429 | 503,
  ) {
    super(message);
    this.name = "AdminWriteAuthorizationError";
  }
}

export async function getAdminWriteAuthorizationRuntimeEnv(): Promise<AdminWriteAuthorizationRuntimeEnv> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as AdminWriteAuthorizationRuntimeEnv;
}

function timingSafeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

export async function authorizeAdminWriteRequest(options: {
  request: Request;
  runtimeEnv: AdminWriteAuthorizationRuntimeEnv;
  password: string;
}) {
  const requestUrl = new URL(options.request.url);
  const limiter = options.runtimeEnv.ADMIN_WRITE_RATE_LIMITER;

  if (!limiter) {
    if (!isLocalHostname(requestUrl.hostname)) {
      throw new AdminWriteAuthorizationError("管理操作的流量保護尚未完成設定，請聯絡管理員。", 503);
    }
  } else {
    const clientAddress = options.request.headers.get("CF-Connecting-IP")?.trim() || "unknown-client";
    const result = await limiter.limit({ key: `admin-write:${clientAddress}` });
    if (!result.success) {
      throw new AdminWriteAuthorizationError("管理密碼嘗試過於頻繁，請一分鐘後再試。", 429);
    }
  }

  const expectedPassword = options.runtimeEnv.ADMIN_PASSWORD?.trim()
    || options.runtimeEnv.DELETE_PASSWORD?.trim();
  if (!expectedPassword) {
    throw new AdminWriteAuthorizationError("網站管理密碼尚未完成設定，請聯絡管理員。", 503);
  }

  if (!timingSafeEqual(options.password, expectedPassword)) {
    throw new AdminWriteAuthorizationError("網站管理密碼錯誤。", 403);
  }
}
