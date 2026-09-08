import { getD1 } from "../../../../db";
import { listUnifiedAuditEvents } from "../../../lib/auditLog";
import { getActiveRequestUser } from "../../../lib/authorizedUser";

export async function GET(request: Request) {
  try {
    const actor = await getActiveRequestUser(request);
    if (!actor || actor.role !== "admin") {
      return Response.json({ error: "只有 ADMIN 可以查看完整操作紀錄。" }, { status: 403 });
    }
    const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 1000);
    const events = await listUnifiedAuditEvents(await getD1(), Number.isFinite(requestedLimit) ? requestedLimit : 1000);
    return Response.json({ events, count: events.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "無法讀取完整操作紀錄。" },
      { status: 500 },
    );
  }
}
