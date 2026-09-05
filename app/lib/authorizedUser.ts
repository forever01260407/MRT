import { getD1 } from "../../db";
import { getAuthRuntimeEnv, getRequestAuthSession } from "./auth";
import { getStoredUserAccess } from "./userStore";

export async function getActiveRequestUser(request: Request) {
  const session = await getRequestAuthSession(request);
  if (!session) return null;

  const runtimeEnv = await getAuthRuntimeEnv();
  if (!runtimeEnv.DB) return session;

  const storedUser = await getStoredUserAccess(await getD1(), session.username);
  if (!storedUser || storedUser.status !== "active") return null;
  return {
    username: storedUser.username,
    name: storedUser.name,
    role: storedUser.role,
    expiresAt: session.expiresAt,
  };
}
