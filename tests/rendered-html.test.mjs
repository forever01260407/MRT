import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
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
  assert.match(html, /固定潤滑設備/);
  assert.match(html, /MOK 10 · LB 10/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("provides authenticated manual field registration backed by D1", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /手動登記現場量測值/);
  assert.match(page, /inspector:\s*manualEntry\.inspector\.trim\(\) \|\| "未指定"/);
  assert.match(page, /recordType:\s*manualEntry\.recordType/);
  assert.match(page, /fetch\("\/api\/lubrication"/);
  assert.match(page, /確認登錄並即時同步/);
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
