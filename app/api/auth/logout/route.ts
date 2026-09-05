import { serializeExpiredSessionCookie } from "../../../lib/auth";

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
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
