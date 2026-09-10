export const AUTH_COOKIE_NAME = "mrt_monitor_session";
export const AUTH_SESSION_SECONDS = 8 * 60 * 60;

export type AuthRole = "user" | "userpro" | "supervisor" | "admin" | "root";

export const ROOT_USERNAME = "root";
export const ROOT_USER_ID = "SYSTEM-ROOT";

export type AuthSession = {
  username: string;
  name: string;
  role: AuthRole;
  sessionVersion: number;
  expiresAt: number;
};

type StoredSession = AuthSession & {
  version: 2;
};

type RateLimitResult = {
  success: boolean;
};

type RateLimiter = {
  limit(options: { key: string }): Promise<RateLimitResult>;
};

export type AuthRuntimeEnv = {
  AUTH_SECRET?: string;
  ROOT_PASSWORD?: string;
  ROOT_OWNER_USER_ID?: string;
  DELETE_PASSWORD?: string;
  AUTH_RATE_LIMITER?: RateLimiter;
  DB?: unknown;
};

type DevelopmentAccount = {
  username: string;
  name: string;
  role: AuthRole;
  passwordHash: string;
};

const developmentAccounts: DevelopmentAccount[] = [
  {
    username: "admin",
    name: "admin",
    role: "admin",
    passwordHash: "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918",
  },
  {
    username: "supervisor",
    name: "supervisor",
    role: "supervisor",
    passwordHash: "0834c2d60725ac5902257b3b78dd161ad26d1c0290dbf1e47cc14add5b8c8142",
  },
  {
    username: "user",
    name: "user",
    role: "user",
    passwordHash: "04f8996da763b7a969b1028ee3007569eaf3a635486ddab211d512c85b9df8fb",
  },
];

const localDevelopmentSecret = "mrt-monitor-local-only-session-signing-secret-v1";
const textEncoder = new TextEncoder();
const passwordHashIterations = 120_000;

export type PasswordCredential = {
  hash: string;
  salt: string;
  iterations: number;
};

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

export class AuthRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthRateLimitError";
  }
}

export async function getAuthRuntimeEnv(): Promise<AuthRuntimeEnv> {
  try {
    const { env } = await import("cloudflare:workers");
    return env as unknown as AuthRuntimeEnv;
  } catch {
    return {};
  }
}

export function isLocalAuthHostname(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function resolveAuthSecret(url: URL, runtimeEnv: AuthRuntimeEnv) {
  const configuredSecret = runtimeEnv.AUTH_SECRET?.trim();
  if (configuredSecret && configuredSecret.length >= 32) return configuredSecret;
  if (isLocalAuthHostname(url.hostname)) return localDevelopmentSecret;
  throw new AuthConfigurationError("登入服務尚未完成正式環境設定，請聯絡 ADMIN。");
}

export function isAdministratorRole(role: string | null | undefined): role is "admin" | "root" {
  return role === "admin" || role === "root";
}

export function isRootUsername(username: string) {
  return username.trim().toLowerCase() === ROOT_USERNAME;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stringToBase64Url(value: string) {
  return bytesToBase64Url(textEncoder.encode(value));
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64UrlToString(value: string) {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number) {
  const sourceKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    sourceKey,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

export async function createPasswordCredential(password: string): Promise<PasswordCredential> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  return {
    hash: await derivePasswordHash(password, saltBytes, passwordHashIterations),
    salt: bytesToBase64Url(saltBytes),
    iterations: passwordHashIterations,
  };
}

export async function verifyPassword(password: string, credential: PasswordCredential) {
  if (!credential.hash || !credential.salt || credential.iterations < 1) return false;
  const submittedHash = await derivePasswordHash(password, base64UrlToBytes(credential.salt), credential.iterations);
  return timingSafeEqual(submittedHash, credential.hash);
}

async function importSigningKey(secret: string, usage: KeyUsage[]) {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage,
  );
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string) {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<StoredSession>;
  return session.version === 2
    && typeof session.username === "string"
    && typeof session.name === "string"
    && (session.role === "user" || session.role === "userpro" || session.role === "supervisor" || session.role === "admin" || session.role === "root")
    && typeof session.sessionVersion === "number"
    && Number.isInteger(session.sessionVersion)
    && session.sessionVersion > 0
    && typeof session.expiresAt === "number";
}

export async function validateRootCredentials(options: {
  request: Request;
  runtimeEnv: AuthRuntimeEnv;
  username: string;
  password: string;
}) {
  if (!isRootUsername(options.username)) return null;

  const requestUrl = new URL(options.request.url);
  const isLocal = isLocalAuthHostname(requestUrl.hostname);
  const configuredPassword = options.runtimeEnv.ROOT_PASSWORD?.trim()
    || (isLocal ? options.runtimeEnv.DELETE_PASSWORD?.trim() || ROOT_USERNAME : "");
  if (!configuredPassword) {
    throw new AuthConfigurationError("ROOT 登入尚未完成安全設定，請由網站擁有者處理。");
  }

  if (!isLocal) {
    const configuredOwnerId = options.runtimeEnv.ROOT_OWNER_USER_ID?.trim();
    const authenticatedOwnerId = options.request.headers.get("oai-authenticated-user-id")?.trim();
    if (!configuredOwnerId) {
      throw new AuthConfigurationError("ROOT 尚未綁定網站擁有者，請先完成部署端設定。");
    }
    if (!authenticatedOwnerId || !timingSafeEqual(authenticatedOwnerId, configuredOwnerId)) return null;
  }

  const [submittedHash, expectedHash] = await Promise.all([
    sha256Hex(options.password),
    sha256Hex(configuredPassword),
  ]);
  if (!timingSafeEqual(submittedHash, expectedHash)) return null;
  return { username: ROOT_USERNAME, name: "ROOT", role: "root" as const, sessionVersion: 1 };
}

export async function validateDevelopmentCredentials(options: {
  url: URL;
  username: string;
  password: string;
}) {
  if (!isLocalAuthHostname(options.url.hostname)) return null;
  const username = options.username.trim().toLowerCase();
  const account = developmentAccounts.find((candidate) => candidate.username === username);
  const submittedHash = await sha256Hex(options.password);
  const expectedHash = account?.passwordHash ?? developmentAccounts[0].passwordHash;
  if (!account || !timingSafeEqual(submittedHash, expectedHash)) return null;
  return { username: account.username, name: account.name, role: account.role, sessionVersion: 1 };
}

export async function enforceLoginRateLimit(options: {
  request: Request;
  runtimeEnv: AuthRuntimeEnv;
  username: string;
}) {
  const requestUrl = new URL(options.request.url);
  const limiter = options.runtimeEnv.AUTH_RATE_LIMITER;
  if (!limiter) {
    if (!isLocalAuthHostname(requestUrl.hostname)) {
      throw new AuthConfigurationError("登入流量保護尚未完成設定，請聯絡 ADMIN。");
    }
    return;
  }

  const clientAddress = options.request.headers.get("CF-Connecting-IP")?.trim() || "local-client";
  const normalizedUsername = options.username.trim().toLowerCase().slice(0, 80) || "empty";
  const result = await limiter.limit({ key: `sign-in:${clientAddress}:${normalizedUsername}` });
  if (!result.success) throw new AuthRateLimitError("登入嘗試過於頻繁，請一分鐘後再試。");
}

export async function createSessionToken(options: {
  account: Pick<AuthSession, "username" | "name" | "role" | "sessionVersion">;
  secret: string;
  now?: number;
}) {
  const now = options.now ?? Date.now();
  const payload: StoredSession = {
    version: 2,
    ...options.account,
    expiresAt: now + AUTH_SESSION_SECONDS * 1000,
  };
  const encodedPayload = stringToBase64Url(JSON.stringify(payload));
  const key = await importSigningKey(options.secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(encodedPayload));
  return `${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token: string, secret: string, now = Date.now()): Promise<AuthSession | null> {
  try {
    const [encodedPayload, encodedSignature, extra] = token.split(".");
    if (!encodedPayload || !encodedSignature || extra) return null;
    const key = await importSigningKey(secret, ["verify"]);
    const validSignature = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(encodedSignature),
      textEncoder.encode(encodedPayload),
    );
    if (!validSignature) return null;
    const payload: unknown = JSON.parse(base64UrlToString(encodedPayload));
    if (!isStoredSession(payload) || payload.expiresAt <= now) return null;
    return {
      username: payload.username,
      name: payload.name,
      role: payload.role,
      sessionVersion: payload.sessionVersion,
      expiresAt: payload.expiresAt,
    };
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [cookieName, ...cookieValue] = part.trim().split("=");
    if (cookieName === name) return decodeURIComponent(cookieValue.join("="));
  }
  return null;
}

export async function getRequestAuthSession(request: Request) {
  const token = readCookie(request, AUTH_COOKIE_NAME);
  if (!token) return null;
  const runtimeEnv = await getAuthRuntimeEnv();
  const secret = resolveAuthSecret(new URL(request.url), runtimeEnv);
  return verifySessionToken(token, secret);
}

export function serializeSessionCookie(token: string, secure: boolean) {
  return [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${AUTH_SESSION_SECONDS}`,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

export function serializeExpiredSessionCookie(secure: boolean) {
  return [
    `${AUTH_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}
