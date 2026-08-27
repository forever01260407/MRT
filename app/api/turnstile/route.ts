import {
  getTurnstileRuntimeEnv,
  MANUAL_ENTRY_TURNSTILE_ACTION,
} from "../../lib/turnstile";

export async function GET() {
  const runtimeEnv = await getTurnstileRuntimeEnv();
  const siteKey = runtimeEnv.TURNSTILE_SITE_KEY?.trim();
  if (!siteKey) {
    return Response.json(
      { error: "安全驗證服務尚未完成設定。" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  return Response.json(
    { siteKey, action: MANUAL_ENTRY_TURNSTILE_ACTION },
    { headers: { "cache-control": "no-store" } },
  );
}
