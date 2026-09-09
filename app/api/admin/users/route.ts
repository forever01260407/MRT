import { getD1 } from "../../../../db";
import { getRequestAuthSession, isAdministratorRole } from "../../../lib/auth";
import type { AuthRole } from "../../../lib/auth";
import type { AuditContext } from "../../../lib/auditLog";
import { getRequestAuditContext } from "../../../lib/requestContext";
import {
  AccountProtectionError,
  createStoredUser,
  DuplicateUsernameError,
  listUsers,
  ReservedUsernameError,
  resetStoredUserPassword,
  updateStoredUserRole,
  updateStoredUserStatus,
  UserNotFoundError,
} from "../../../lib/userStore";

async function requireAdministrator(request: Request) {
  const session = await getRequestAuthSession(request);
  return isAdministratorRole(session?.role) ? session : null;
}

function getAdminAuditContext(request: Request, session: { username: string; role: AuthRole }): AuditContext {
  return {
    actorUsername: session.username,
    actorRole: session.role,
    ...getRequestAuditContext(request),
  };
}

export async function GET(request: Request) {
  try {
    if (!await requireAdministrator(request)) {
      return Response.json({ error: "只有 ADMIN 或 ROOT 可以管理人員帳號。" }, { status: 403 });
    }
    const users = await listUsers(await getD1());
    return Response.json({ users }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "無法讀取人員帳號。" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdministrator(request);
    if (!session) {
      return Response.json({ error: "只有 ADMIN 或 ROOT 可以建立人員帳號。" }, { status: 403 });
    }

    const payload = await request.json() as Record<string, unknown>;
    const username = String(payload.username ?? "").trim().toLowerCase();
    const password = String(payload.password ?? "");
    const role = String(payload.role ?? "user") as AuthRole;

    if (!username || username.length > 80 || !/^[a-z0-9._-]+$/.test(username)) {
      return Response.json({ error: "登入帳號只能使用英文字母、數字、句點、底線或連字號。" }, { status: 400 });
    }
    if (!password) {
      return Response.json({ error: "請設定登入密碼。" }, { status: 400 });
    }
    if (role !== "user" && role !== "userpro" && role !== "supervisor" && role !== "admin") {
      return Response.json({ error: "指定的角色無法使用。" }, { status: 400 });
    }

    const user = await createStoredUser(await getD1(), {
      username,
      role,
      password,
      createdBy: session.username,
      audit: getAdminAuditContext(request, session),
    });
    return Response.json({ user }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DuplicateUsernameError || error instanceof ReservedUsernameError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "帳號建立失敗。" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireAdministrator(request);
    if (!session) {
      return Response.json({ error: "只有 ADMIN 或 ROOT 可以管理人員帳號。" }, { status: 403 });
    }

    const payload = await request.json() as Record<string, unknown>;
    const userId = String(payload.userId ?? "").trim();
    const action = String(payload.action ?? "");
    if (!userId) {
      return Response.json({ error: "缺少要管理的帳號識別碼。" }, { status: 400 });
    }

    const database = await getD1();
    if (action === "reset_password") {
      const password = String(payload.password ?? "");
      if (!password) {
        return Response.json({ error: "請輸入新的登入密碼。" }, { status: 400 });
      }
      const user = await resetStoredUserPassword(database, {
        userId,
        password,
        actorUsername: session.username,
        actorRole: session.role,
        audit: getAdminAuditContext(request, session),
      });
      return Response.json({ user }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "set_status") {
      const status = String(payload.status ?? "");
      if (status !== "active" && status !== "disabled") {
        return Response.json({ error: "指定的帳號狀態無法使用。" }, { status: 400 });
      }
      const user = await updateStoredUserStatus(database, {
        userId,
        status,
        actorUsername: session.username,
        actorRole: session.role,
        audit: getAdminAuditContext(request, session),
      });
      return Response.json({ user }, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "set_role") {
      const role = String(payload.role ?? "") as AuthRole;
      if (role !== "user" && role !== "userpro" && role !== "supervisor" && role !== "admin") {
        return Response.json({ error: "指定的角色無法使用。" }, { status: 400 });
      }
      const user = await updateStoredUserRole(database, {
        userId,
        role,
        actorUsername: session.username,
        actorRole: session.role,
        audit: getAdminAuditContext(request, session),
      });
      return Response.json({ user }, { headers: { "Cache-Control": "no-store" } });
    }

    return Response.json({ error: "無法辨識這個帳號管理操作。" }, { status: 400 });
  } catch (error) {
    if (error instanceof UserNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof AccountProtectionError || error instanceof ReservedUsernameError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "帳號更新失敗。" },
      { status: 500 },
    );
  }
}
