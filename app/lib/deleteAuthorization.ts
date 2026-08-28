import { isLocalHostname } from "./turnstile";

type RateLimitResult = {
  success: boolean;
};

type RateLimiter = {
  limit(options: { key: string }): Promise<RateLimitResult>;
};

export type DeleteAuthorizationRuntimeEnv = {
  DELETE_PASSWORD?: string;
  DELETE_RATE_LIMITER?: RateLimiter;
};

export class DeleteAuthorizationError extends Error {
  constructor(
    message: string,
    public readonly status: 403 | 429 | 503,
  ) {
    super(message);
    this.name = "DeleteAuthorizationError";
  }
}

export async function getDeleteAuthorizationRuntimeEnv(): Promise<DeleteAuthorizationRuntimeEnv> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as DeleteAuthorizationRuntimeEnv;
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

export async function authorizeDeleteRequest(options: {
  request: Request;
  runtimeEnv: DeleteAuthorizationRuntimeEnv;
  password: string;
}) {
  const requestUrl = new URL(options.request.url);
  const limiter = options.runtimeEnv.DELETE_RATE_LIMITER;

  if (!limiter) {
    if (!isLocalHostname(requestUrl.hostname)) {
      throw new DeleteAuthorizationError("刪除功能的流量保護尚未完成設定，請聯絡管理員。", 503);
    }
  } else {
    const clientAddress = options.request.headers.get("CF-Connecting-IP")?.trim() || "unknown-client";
    const result = await limiter.limit({ key: `permanent-delete:${clientAddress}` });
    if (!result.success) {
      throw new DeleteAuthorizationError("刪除密碼嘗試過於頻繁，請一分鐘後再試。", 429);
    }
  }

  const expectedPassword = options.runtimeEnv.DELETE_PASSWORD?.trim();
  if (!expectedPassword) {
    throw new DeleteAuthorizationError("刪除密碼尚未完成設定，請聯絡管理員。", 503);
  }

  if (!timingSafeEqual(options.password, expectedPassword)) {
    throw new DeleteAuthorizationError("刪除密碼錯誤。", 403);
  }
}
