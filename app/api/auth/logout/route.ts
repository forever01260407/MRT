import { getD1 } from "../../../../db";
import { getActiveRequestUser } from "../../../lib/authorizedUser";
import { serializeExpiredSessionCookie } from "../../../lib/auth";
import { recordAuditEvent } from "../../../lib/auditLog";
import { getRequestAuditContext } from "../../../lib/requestContext";

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  try {
    const actor = await getActiveRequestUser(request);
    if (actor) {
      await recordAuditEvent(await getD1(), {
        actorUsername: actor.username,
        actorRole: actor.role,
        ...getRequestAuditContext(request),
        action: "auth.logout",
        resourceType: "authentication",
        resourceLabel: `@${actor.username}`,
      });
    }
  } catch {
    // Clearing an invalid or expired session must remain possible if audit persistence is unavailable.
  }
  return Response.json(
    { authenticated: false },
    {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": serializeExpiredSessionCookie(requestUrl.protocol === "https:"),
      },
    },
  );
}
