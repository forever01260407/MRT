import { getD1 } from "../../../../db";
import { serializeExpiredSessionCookie } from "../../../lib/auth";
import { recordAuditEvent } from "../../../lib/auditLog";
import { getActiveRequestUser } from "../../../lib/authorizedUser";
import { getRequestAuditContext } from "../../../lib/requestContext";
import {
  AccountProtectionError,
  changeStoredUserPassword,
  CurrentPasswordError,
  PasswordReuseError,
  UserNotFoundError,
} from "../../../lib/userStore";

async function recordRejectedChange(request: Request, username: string, role: string, errorCode: string) {
  await recordAuditEvent(await getD1(), {
    actorUsername: username,
    actorRole: role,
    ...getRequestAuditContext(request),
    action: "user.password_changed",
    resourceType: "user",
    resourceLabel: `@${username}`,
    after: { password: "未變更（內容不記錄）" },
    result: "failure",
    errorCode,
  });
}

export async function POST(request: Request) {
  const actor = await getActiveRequestUser(request);
  if (!actor) {
    return Response.json({ error: "登入狀態已失效，請重新登入。" }, { status: 401 });
  }

  try {
    const payload = await request.json() as Record<string, unknown>;
    const currentPassword = String(payload.currentPassword ?? "");
    const newPassword = String(payload.newPassword ?? "");
    const confirmPassword = String(payload.confirmPassword ?? "");

    if (!currentPassword || !newPassword) {
      await recordRejectedChange(request, actor.username, actor.role, "password_missing");
      return Response.json({ error: "請輸入目前密碼及新密碼。" }, { status: 400 });
    }
    if (newPassword !== confirmPassword) {
      await recordRejectedChange(request, actor.username, actor.role, "password_confirmation_mismatch");
      return Response.json({ error: "兩次輸入的新密碼不一致。" }, { status: 400 });
    }

    await changeStoredUserPassword(await getD1(), {
      username: actor.username,
      currentPassword,
      newPassword,
      audit: {
        actorUsername: actor.username,
        actorRole: actor.role,
        ...getRequestAuditContext(request),
      },
    });

    const requestUrl = new URL(request.url);
    return Response.json(
      { changed: true, message: "密碼已更新，請使用新密碼重新登入。" },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": serializeExpiredSessionCookie(requestUrl.protocol === "https:"),
        },
      },
    );
  } catch (error) {
    if (error instanceof CurrentPasswordError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof PasswordReuseError || error instanceof AccountProtectionError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof UserNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return Response.json({ error: "密碼更新失敗，請稍後再試。" }, { status: 500 });
  }
}
