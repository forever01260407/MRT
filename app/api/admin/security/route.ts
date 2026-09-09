import { getD1 } from "../../../../db";
import { getRequestAuthSession, isAdministratorRole } from "../../../lib/auth";
import { getSignInSecuritySnapshot } from "../../../lib/userStore";

export async function GET(request: Request) {
  try {
    const session = await getRequestAuthSession(request);
    if (!isAdministratorRole(session?.role)) {
      return Response.json({ error: "只有 ADMIN 或 ROOT 可以查看登入安全紀錄。" }, { status: 403 });
    }

    const snapshot = await getSignInSecuritySnapshot(await getD1());
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "無法讀取登入安全紀錄。" },
      { status: 500 },
    );
  }
}
