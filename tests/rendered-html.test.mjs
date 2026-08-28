import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the rail lubrication monitoring dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>環狀線鋼軌狀態監測中心<\/title>/i);
  assert.match(html, /匯入潤滑設備 Excel/);
  assert.match(html, /現場登記/);
  assert.match(html, /登記現場量測/);
  assert.match(html, /Monitor Area/);
  assert.doesNotMatch(html, /class="nav-item"[^>]*>Monitor 完整紀錄/);
  assert.match(html, /固定潤滑設備/);
  assert.match(html, /MOK 10 · LB 10/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("server-renders the complete append-only record monitor", async () => {
  const response = await render("/monitor");
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /完整紀錄 Monitor/);
  assert.match(html, /更正會保留原始資料/);
  assert.match(html, /全部量測與補油紀錄/);
  assert.match(html, /更正會新增版本/);
  assert.match(html, /切換為 LB1 到 MOK10 的設備順序/);
});

test("requires a rate-limited runtime secret before permanently deleting a record", async () => {
  const route = await readFile(new URL("../app/api/lubrication/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/monitor/page.tsx", import.meta.url), "utf8");
  const authorization = await readFile(new URL("../app/lib/deleteAuthorization.ts", import.meta.url), "utf8");
  const viteConfig = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  const deleteHandler = route.slice(route.indexOf("export async function DELETE"));

  assert.match(route, /export async function DELETE/);
  assert.match(deleteHandler, /authorizeDeleteRequest/);
  assert.doesNotMatch(deleteHandler, /getChatGPTUser/);
  assert.doesNotMatch(route, /const DELETE_PASSWORD\s*=/);
  assert.match(authorization, /DELETE_PASSWORD\?: string/);
  assert.match(authorization, /DELETE_RATE_LIMITER/);
  assert.match(authorization, /timingSafeEqual/);
  assert.match(authorization, /permanent-delete:/);
  assert.match(viteConfig, /name: "DELETE_RATE_LIMITER"/);
  assert.match(viteConfig, /namespace_id: "1002"/);
  assert.ok(route.indexOf("DELETE FROM measurement_revisions") < route.indexOf("DELETE FROM measurements"));
  assert.match(page, /method: "DELETE"/);
  assert.match(page, /type="password"/);
  assert.doesNotMatch(page, /inputMode="numeric"/);
  assert.match(page, /確認永久刪除/);
});

test("sorts monitor records by natural device order on demand", async () => {
  const page = await readFile(new URL("../app/monitor/page.tsx", import.meta.url), "utf8");

  assert.match(page, /Intl\.Collator\("en", \{ numeric: true/);
  assert.match(page, /deviceCollator\.compare/);
  assert.match(page, /setSortByDevice/);
  assert.match(page, /LB → MOK/);
});

test("stores corrections as immutable measurement revisions", async () => {
  const route = await readFile(new URL("../app/api/lubrication/route.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");

  assert.match(route, /export async function PATCH/);
  assert.match(route, /INSERT INTO measurement_revisions/);
  assert.match(route, /correctionReason/);
  assert.doesNotMatch(route, /UPDATE measurements SET/);
  assert.match(schema, /measurementRevisions/);
  assert.match(schema, /revisionNo/);
});

test("provides Turnstile-protected anonymous manual registration backed by D1", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/lubrication/route.ts", import.meta.url), "utf8");
  const turnstile = await readFile(new URL("../app/lib/turnstile.ts", import.meta.url), "utf8");
  const viteConfig = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");

  assert.match(page, /手動登記現場量測值/);
  assert.match(page, /inspector:\s*manualEntry\.inspector\.trim\(\) \|\| "未指定"/);
  assert.match(page, /recordType:\s*manualEntry\.recordType/);
  assert.match(page, /fetch\("\/api\/lubrication"/);
  assert.match(page, /submissionType:\s*"manual"/);
  assert.match(page, /turnstileToken:\s*manualTurnstileToken/);
  assert.match(page, /TurnstileWidget/);
  assert.match(page, /確認登錄並即時同步/);

  assert.match(route, /isManualEntryPayload/);
  assert.match(route, /enforceManualEntryRateLimit/);
  assert.match(route, /verifyTurnstileToken/);
  assert.match(route, /records:\s*\[record\]/);
  assert.match(route, /submittedCount:\s*1/);
  assert.match(route, /anonymous-pov/);
  assert.match(route, /!isManualEntry && !user/);

  assert.match(turnstile, /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify/);
  assert.match(turnstile, /result\.action !== MANUAL_ENTRY_TURNSTILE_ACTION/);
  assert.match(turnstile, /result\.hostname !== requestUrl\.hostname/);
  assert.match(turnstile, /AbortSignal\.timeout\(10_000\)/);
  assert.match(viteConfig, /MANUAL_ENTRY_RATE_LIMITER/);
  assert.match(viteConfig, /simple:\s*\{ limit: 5, period: 60/);
  assert.match(viteConfig, /command === "serve"/);
  assert.match(viteConfig, /keep_vars:\s*true/);
});

test("keeps complete imported history and enables chart navigation", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /history:\s*sortedRecords\.map/);
  assert.match(page, /historyDates:\s*sortedRecords\.map/);
  assert.doesNotMatch(page, /sortedRecords\.slice\(-7\)/);
  assert.match(page, /type:\s*"inside"/);
  assert.match(page, /type:\s*"slider"/);
  assert.match(page, /zoomOnMouseWheel:\s*"ctrl"/);
  assert.match(page, /moveOnMouseMove:\s*true/);
  assert.match(page, /connectNulls:\s*true/);
  assert.match(page, /typeof value === "number"/);
  assert.match(page, /拖曳圖表左右移動/);
  assert.match(page, /下方滑桿調整範圍/);
});
