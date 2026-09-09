import { NextRequest, NextResponse } from "next/server";
import { getD1 } from "./db";
import {
  AuthConfigurationError,
  getAuthRuntimeEnv,
  getRequestAuthSession,
  serializeExpiredSessionCookie,
} from "./app/lib/auth";
import { getStoredUserAccess } from "./app/lib/userStore";

const publicPaths = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/session",
]);

function isPublicAsset(pathname: string) {
  return pathname.startsWith("/_next/")
    || pathname === "/favicon.svg"
    || pathname === "/robots.txt"
    || pathname === "/sitemap.xml";
}

function loginRedirect(request: NextRequest) {
  const loginUrl = new URL("/login", request.url);
  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (returnTo !== "/") loginUrl.searchParams.set("next", returnTo);
  return NextResponse.redirect(loginUrl);
}

function expiredSessionResponse(request: NextRequest) {
  const response = request.nextUrl.pathname.startsWith("/api/")
    ? NextResponse.json({ error: "帳號已停用或登入狀態已失效。" }, { status: 401 })
    : loginRedirect(request);
  response.headers.append(
    "Set-Cookie",
    serializeExpiredSessionCookie(request.nextUrl.protocol === "https:"),
  );
  return response;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (isPublicAsset(pathname) || publicPaths.has(pathname)) {
    return NextResponse.next();
  }

  try {
    const session = await getRequestAuthSession(request);
    if (!session) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "請先登入後再繼續。" }, { status: 401 });
      }
      return loginRedirect(request);
    }

    const runtimeEnv = await getAuthRuntimeEnv();
    const storedUser = runtimeEnv.DB
      ? await getStoredUserAccess(await getD1(), session.username)
      : null;
    if (runtimeEnv.DB && (!storedUser || storedUser.status !== "active")) {
      return expiredSessionResponse(request);
    }
    const effectiveSession = storedUser
      ? { ...session, username: storedUser.username, name: storedUser.name, role: storedUser.role }
      : session;

    if ((pathname === "/admin-area" || pathname.startsWith("/admin-area/")) && effectiveSession.role !== "admin") {
      return NextResponse.redirect(new URL("/forbidden", request.url));
    }

    if ((pathname === "/api/admin" || pathname.startsWith("/api/admin/")) && effectiveSession.role !== "admin") {
      return NextResponse.json({ error: "只有 ADMIN 可以使用帳號管理功能。" }, { status: 403 });
    }

    if ((pathname === "/monitor" || pathname.startsWith("/monitor/")) && effectiveSession.role === "user") {
      return NextResponse.redirect(new URL("/forbidden", request.url));
    }

    if (pathname === "/api/device-axle-profiles" && request.method === "PUT"
      && (effectiveSession.role === "user" || effectiveSession.role === "userpro")) {
      return NextResponse.json({ error: "目前角色沒有修改階軸設定的權限。" }, { status: 403 });
    }

    if (pathname === "/api/lubrication" && request.method === "DELETE" && effectiveSession.role === "user") {
      return NextResponse.json({ error: "只有 AD USER、POWER USER 或 ADMIN 可以刪除紀錄。" }, { status: 403 });
    }

    if (pathname === "/api/lubrication" && request.method === "PUT"
      && (effectiveSession.role === "user" || effectiveSession.role === "userpro")) {
      return NextResponse.json({ error: "只有 POWER USER 或 ADMIN 可以從垃圾桶還原紀錄。" }, { status: 403 });
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-mrt-username", effectiveSession.username);
    requestHeaders.set("x-mrt-role", effectiveSession.role);
    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
