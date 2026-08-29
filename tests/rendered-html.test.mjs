import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
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
  assert.match(html, /階軸設定/);
  assert.doesNotMatch(html, /class="nav-item"[^>]*>Monitor 完整紀錄/);
  assert.match(html, /固定潤滑設備/);
  assert.match(html, /MOK 10 · LB 10/);
  assert.match(html, /目前選取設備/);
  assert.match(html, /當前流量/);
  assert.match(html, /軸數尚未設定/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("keeps the lubrication map summary synchronized with the selected device", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /renderSelectedDeviceMapCard/);
  assert.match(page, /selectedDevice\.direction === "up" \? "上行" : "下行"/);
  assert.match(page, /目前選取設備/);
  assert.match(page, /<dt>當前流量<\/dt>/);
  assert.match(page, /<dt>軸數<\/dt>/);
  assert.match(page, /"軸數尚未設定"/);
  assert.match(page, /renderSelectedDeviceMapCard\(true\)/);
});

test("links a separate empty axle-profile category to lubrication devices", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/lubrication/route.ts", import.meta.url), "utf8");
  const profileStore = await readFile(new URL("../app/lib/deviceAxleProfile.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0002_peaceful_norrin_radd.sql", import.meta.url), "utf8");

  assert.match(schema, /deviceAxleProfiles/);
  assert.match(schema, /sqliteTable\("device_axle_profiles"/);
  assert.match(schema, /deviceId: text\("device_id"\)\.primaryKey\(\)/);
  assert.match(schema, /effectiveDate: text\("effective_date"\)/);
  assert.match(schema, /stageCount: integer\("stage_count"\)/);
  assert.match(schema, /axleCount: integer\("axle_count"\)/);
  assert.match(schema, /device_axle_profiles_stage_count_positive/);
  assert.match(schema, /device_axle_profiles_axle_count_positive/);

  assert.match(profileStore, /CREATE TABLE IF NOT EXISTS device_axle_profiles/);
  assert.match(route, /listDeviceAxleProfiles/);
  assert.match(route, /deviceAxleProfiles,/);
  assert.match(migration, /CREATE TABLE `device_axle_profiles`/);
  assert.doesNotMatch(migration, /INSERT INTO `device_axle_profiles`/);

  assert.match(page, /setDeviceAxleProfiles\(payload\.deviceAxleProfiles \?\? \[\]\)/);
  assert.match(page, /profile\.deviceId === selectedDeviceId/);
  assert.match(page, /selectedAxleProfile\.stageCount/);
  assert.match(page, /selectedAxleProfile\.axleCount/);
});

test("securely creates and overwrites one axle profile per lubrication device", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/device-axle-profiles/route.ts", import.meta.url), "utf8");
  const profileStore = await readFile(new URL("../app/lib/deviceAxleProfile.ts", import.meta.url), "utf8");
  const authorization = await readFile(new URL("../app/lib/deviceAxleProfileAuthorization.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0002_peaceful_norrin_radd.sql", import.meta.url), "utf8");
  const viteConfig = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");

  assert.match(page, /className="mini-axle-settings-button"/);
  assert.match(page, /潤滑站點/);
  assert.match(page, /更新日期/);
  assert.match(page, /確認覆蓋目前設定/);
  assert.match(page, /method: "PUT"/);
  assert.match(page, /type="password"/);
  assert.match(route, /export async function PUT/);
  assert.doesNotMatch(route, /export async function DELETE/);
  assert.match(route, /authorizeDeviceAxleProfileWrite/);
  assert.match(route, /normalizeDeviceId/);
  assert.match(profileStore, /ON CONFLICT\(device_id\) DO UPDATE SET/);
  assert.match(authorization, /DELETE_PASSWORD\?: string/);
  assert.match(authorization, /DEVICE_AXLE_PROFILE_RATE_LIMITER/);
  assert.match(authorization, /timingSafeEqual/);
  assert.match(authorization, /device-axle-profile:/);
  assert.match(viteConfig, /name: "DEVICE_AXLE_PROFILE_RATE_LIMITER"/);
  assert.match(viteConfig, /namespace_id: "1003"/);

  const sqlStart = profileStore.indexOf("`INSERT INTO device_axle_profiles");
  const sqlEnd = profileStore.indexOf("`)", sqlStart);
  assert.ok(sqlStart >= 0 && sqlEnd > sqlStart, "upsert SQL should be present");
  const upsertSql = profileStore.slice(sqlStart + 1, sqlEnd);
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(migration);
    const upsert = database.prepare(upsertSql);
    upsert.run("LB1", "2026-05-01", 3, 12);
    upsert.run("LB1", "2026-05-14", 3, 4);
    const rows = database.prepare("SELECT device_id, effective_date, stage_count, axle_count FROM device_axle_profiles").all();
    assert.deepEqual(rows.map((row) => ({ ...row })), [{ device_id: "LB1", effective_date: "2026-05-14", stage_count: 3, axle_count: 4 }]);
  } finally {
    database.close();
  }
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

test("server-renders a Cloudflare-synchronized current tread-wear estimate", async () => {
  const response = await render("/wear");
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /當下磨耗狀況推估/);
  assert.match(html, /穩健磨耗率/);
  assert.match(html, /當下預估/);
  assert.match(html, /距最近量測/);
  assert.match(html, /當下判定/);
  assert.match(html, /正在向 Cloudflare 同步/);
  assert.match(html, /預估量測/);
  assert.match(html, /同步中…/);
  assert.doesNotMatch(html, /90 日後預估/);
  assert.doesNotMatch(html, /約 2038\/|約 2040\//);

  const sideResponse = await render("/side-wear");
  assert.equal(sideResponse.status, 200);
  assert.doesNotMatch(await sideResponse.text(), /預估量測/);
});

test("returns the current Cloudflare time as uncached UTC with Taipei metadata", async () => {
  const response = await render("/api/time");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const payload = await response.json();

  assert.equal(payload.timeZone, "Asia/Taipei");
  assert.equal(payload.utcOffset, "+08:00");
  assert.ok(Number.isFinite(Date.parse(payload.now)));
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
