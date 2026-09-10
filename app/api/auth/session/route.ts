import { getD1 } from "../../../../db";
import {
  AuthConfigurationError,
  getAuthRuntimeEnv,
  getRequestAuthSession,
  serializeExpiredSessionCookie,
} from "../../../lib/auth";
import { getStoredUserAccess } from "../../../lib/userStore";

export async function GET(request: Request) {
  try {
    const session = await getRequestAuthSession(request);
    if (!session) {
      return Response.json({ authenticated: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const runtimeEnv = await getAuthRuntimeEnv();
    const storedUser = runtimeEnv.DB
      ? await getStoredUserAccess(await getD1(), session.username)
      : null;
    if (runtimeEnv.DB && (!storedUser || storedUser.status !== "active" || storedUser.sessionVersion !== session.sessionVersion)) {
      const requestUrl = new URL(request.url);
      return Response.json(
        { authenticated: false, error: "帳號已停用或登入狀態已失效。" },
        {
          status: 401,
          headers: {
            "Cache-Control": "no-store",
            "Set-Cookie": serializeExpiredSessionCookie(requestUrl.protocol === "https:"),
          },
        },
      );
    }
    return Response.json(
      {
        authenticated: true,
        user: storedUser
          ? { ...session, username: storedUser.username, name: storedUser.name, role: storedUser.role }
          : session,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      return Response.json({ authenticated: false, error: error.message }, { status: 503 });
    }
    throw error;
  }
}
