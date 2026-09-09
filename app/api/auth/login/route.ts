import { getD1 } from "../../../../db";
import {
  AuthConfigurationError,
  AuthRateLimitError,
  createSessionToken,
  enforceLoginRateLimit,
  getAuthRuntimeEnv,
  isRootUsername,
  resolveAuthSecret,
  serializeSessionCookie,
  validateDevelopmentCredentials,
  validateRootCredentials,
} from "../../../lib/auth";
import { authenticateStoredUser, recordSignInEvent } from "../../../lib/userStore";
import { getRequestAuditContext } from "../../../lib/requestContext";

function getSignInContext(request: Request) {
  const auditContext = getRequestAuditContext(request);
  return {
    source: auditContext.sourceIp,
    userAgent: auditContext.userAgent ?? undefined,
    requestId: auditContext.requestId,
  };
}

export async function POST(request: Request) {
  let database: Awaited<ReturnType<typeof getD1>> | null = null;
  let attemptedUsername = "unknown";
  const signInContext = getSignInContext(request);
  try {
    const payload = await request.json() as Record<string, unknown>;
    const username = String(payload.username ?? "").trim();
    const password = String(payload.password ?? "");
    attemptedUsername = username;
    if (!username || !password || username.length > 80) {
      return Response.json({ error: "請輸入有效的帳號與密碼。" }, { status: 400 });
    }

    const requestUrl = new URL(request.url);
    const runtimeEnv = await getAuthRuntimeEnv();
    database = runtimeEnv.DB ? await getD1() : null;
    await enforceLoginRateLimit({ request, runtimeEnv, username });
    const rootAttempt = isRootUsername(username);
    const account = rootAttempt
      ? await validateRootCredentials({ request, runtimeEnv, username, password })
      : database
        ? await authenticateStoredUser(database, username, password, signInContext)
        : await validateDevelopmentCredentials({ url: requestUrl, username, password });
    if (rootAttempt && database) {
      await recordSignInEvent(database, {
        username,
        outcome: account ? "success" : "invalid_credentials",
        context: signInContext,
      });
    }
    if (!account) {
      return Response.json({ error: "帳號或密碼錯誤。" }, { status: 401 });
    }

    const secret = resolveAuthSecret(requestUrl, runtimeEnv);
    const token = await createSessionToken({ account, secret });
    return Response.json(
      { authenticated: true, user: account },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": serializeSessionCookie(token, requestUrl.protocol === "https:"),
        },
      },
    );
  } catch (error) {
    if (error instanceof AuthRateLimitError) {
      if (database) {
        try {
          await recordSignInEvent(database, {
            username: attemptedUsername,
            outcome: "rate_limited",
            context: signInContext,
          });
        } catch {
          // The rate-limit response must still be returned if audit persistence is unavailable.
        }
      }
      return Response.json({ error: error.message }, { status: 429 });
    }
    if (error instanceof AuthConfigurationError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    return Response.json({ error: "登入服務暫時無法使用。" }, { status: 500 });
  }
}
