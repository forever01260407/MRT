import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

const workerEnvironment = {
  ROOT_PASSWORD: "root",
  ROOT_OWNER_USER_ID: "test-site-owner",
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const executionContext = {
  waitUntil() {},
  passThroughOnException() {},
};

async function dispatch(worker, pathname, init = {}) {
  return worker.fetch(
    new Request(`http://localhost${pathname}`, init),
    workerEnvironment,
    executionContext,
  );
}

async function login(worker, username = "admin", password = username) {
  const response = await dispatch(worker, "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, "successful login should set a session cookie");
  return setCookie.split(";", 1)[0];
}

async function render(pathname = "/", username = "admin", password = username) {
  const worker = await loadWorker();
  const cookie = await login(worker, username, password);

  return dispatch(worker, pathname, {
    headers: { accept: "text/html", cookie },
  });
}

async function renderAnonymous(pathname = "/", init = {}) {
  const worker = await loadWorker();
  return dispatch(worker, pathname, init);
}

test("requires a signed-in session before showing the monitoring site", async () => {
  const response = await renderAnonymous("/");
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost/login");

  const loginPage = await renderAnonymous("/login", {
    headers: { accept: "text/html" },
  });
  assert.equal(loginPage.status, 200);
  const loginHtml = await loginPage.text();
  const loginSource = await readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8");
  assert.match(loginHtml, /登入監測中心/);
  assert.doesNotMatch(loginHtml, /本機初始帳號|點選即可帶入/);
  assert.doesNotMatch(loginSource, /localAccounts|local-account-panel|點選即可帶入/);
});

test("creates the local roles, reserves ROOT, and restricts admin area on the server", async () => {
  const worker = await loadWorker();
  for (const username of ["admin", "supervisor", "user"]) {
    const cookie = await login(worker, username, username);
    const sessionResponse = await dispatch(worker, "/api/auth/session", { headers: { cookie } });
    assert.equal(sessionResponse.status, 200);
    const sessionPayload = await sessionResponse.json();
    assert.equal(sessionPayload.user.username, username);
    assert.equal(sessionPayload.user.role, username);
  }

  const userCookie = await login(worker, "user", "user");
  const blockedResponse = await dispatch(worker, "/admin-area", {
    headers: { accept: "text/html", cookie: userCookie },
  });
  assert.equal(blockedResponse.status, 307);
  assert.equal(blockedResponse.headers.get("location"), "http://localhost/forbidden");

  const blockedMonitorResponse = await dispatch(worker, "/monitor", {
    headers: { accept: "text/html", cookie: userCookie },
  });
  assert.equal(blockedMonitorResponse.status, 307);
  assert.equal(blockedMonitorResponse.headers.get("location"), "http://localhost/forbidden");

  const blockedAxleWriteResponse = await dispatch(worker, "/api/device-axle-profiles", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: userCookie },
    body: JSON.stringify({}),
  });
  assert.equal(blockedAxleWriteResponse.status, 403);

  const supervisorCookie = await login(worker, "supervisor", "supervisor");
  const supervisorMonitorResponse = await dispatch(worker, "/monitor", {
    headers: { accept: "text/html", cookie: supervisorCookie },
  });
  assert.equal(supervisorMonitorResponse.status, 200);

  const adminCookie = await login(worker, "admin", "admin");
  const allowedResponse = await dispatch(worker, "/admin-area", {
    headers: { accept: "text/html", cookie: adminCookie },
  });
  assert.equal(allowedResponse.status, 200);

  const rootCookie = await login(worker, "root", "root");
  const rootSessionResponse = await dispatch(worker, "/api/auth/session", { headers: { cookie: rootCookie } });
  assert.equal(rootSessionResponse.status, 200);
  assert.equal((await rootSessionResponse.json()).user.role, "root");
  const rootAdminResponse = await dispatch(worker, "/admin-area", {
    headers: { accept: "text/html", cookie: rootCookie },
  });
  assert.equal(rootAdminResponse.status, 200);
});

test("rejects incorrect credentials and tampered session cookies", async () => {
  const badLogin = await renderAnonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "wrong" }),
  });
  assert.equal(badLogin.status, 401);

  const badRootLogin = await renderAnonymous("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "root", password: "wrong" }),
  });
  assert.equal(badRootLogin.status, 401);

  const protectedResponse = await renderAnonymous("/admin-area", {
    headers: { cookie: "mrt_monitor_session=forged.payload" },
  });
  assert.equal(protectedResponse.status, 307);
  assert.match(protectedResponse.headers.get("location") ?? "", /\/login\?next=%2Fadmin-area$/);
});

test("server-renders the rail lubrication monitoring dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(html, /<title>環狀線軌道狀態監測系統<\/title>/i);
  assert.match(page, /submission\.status === "已失效" \? "請洽 POWER USER 還原" : "請洽 AD USER 更正"/);
  assert.match(page, /匯入潤滑設備 Excel/);
  assert.match(html, /現場登記/);
  assert.match(html, /登記現場量測/);
  assert.match(page, /Monitor Area/);
  assert.match(page, /階軸設定/);
  assert.match(page, /const canImportExcel/);
  assert.match(page, /const canConfigureAxle/);
  assert.match(page, /const canOpenMonitor/);
  assert.match(page, /signedInUser\?\.role === "userpro"/);
  assert.match(page, /signedInUser\?\.role === "supervisor"/);
  assert.match(page, /signedInUser\?\.role === "admin"/);
  assert.match(page, /signedInUser\?\.role === "root"/);
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
  const profileRoute = await readFile(new URL("../app/api/device-axle-profiles/route.ts", import.meta.url), "utf8");
  const profileStore = await readFile(new URL("../app/lib/deviceAxleProfile.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0002_peaceful_norrin_radd.sql", import.meta.url), "utf8");
  const historyMigration = await readFile(new URL("../drizzle/0006_last_the_spike.sql", import.meta.url), "utf8");

  assert.match(schema, /deviceAxleProfiles/);
  assert.match(schema, /sqliteTable\("device_axle_profiles"/);
  assert.match(schema, /deviceId: text\("device_id"\)\.primaryKey\(\)/);
  assert.match(schema, /effectiveDate: text\("effective_date"\)/);
  assert.match(schema, /stageCount: integer\("stage_count"\)/);
  assert.match(schema, /axleCount: integer\("axle_count"\)/);
  assert.match(schema, /device_axle_profiles_stage_count_positive/);
  assert.match(schema, /device_axle_profiles_axle_count_positive/);
  assert.match(schema, /sqliteTable\("device_axle_profile_events"/);

  assert.match(profileStore, /CREATE TABLE IF NOT EXISTS device_axle_profiles/);
  assert.match(route, /listDeviceAxleProfiles/);
  assert.match(route, /deviceAxleProfiles,/);
  assert.match(profileRoute, /listDeviceAxleProfileEvents/);
  assert.match(migration, /CREATE TABLE `device_axle_profiles`/);
  assert.doesNotMatch(migration, /INSERT INTO `device_axle_profiles`/);
  assert.match(historyMigration, /CREATE TABLE `device_axle_profile_events`/);
  assert.match(historyMigration, /`previous_axle_count` integer/);
  assert.match(historyMigration, /`changed_by` text NOT NULL/);

  assert.match(page, /setDeviceAxleProfiles\(payload\.deviceAxleProfiles \?\? \[\]\)/);
  assert.match(page, /profile\.deviceId === selectedDeviceId/);
  assert.match(page, /selectedAxleProfile\.stageCount/);
  assert.match(page, /selectedAxleProfile\.axleCount/);
});

test("securely creates and overwrites one axle profile per lubrication device", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/device-axle-profiles/route.ts", import.meta.url), "utf8");
  const profileStore = await readFile(new URL("../app/lib/deviceAxleProfile.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0002_peaceful_norrin_radd.sql", import.meta.url), "utf8");
  const actorMigration = await readFile(new URL("../drizzle/0004_pink_layla_miller.sql", import.meta.url), "utf8");

  assert.match(page, /className="mini-axle-settings-button"/);
  assert.match(page, /潤滑站點/);
  assert.match(page, /更新日期/);
  assert.match(page, /確認覆蓋目前設定/);
  assert.match(page, /method: "PUT"/);
  assert.doesNotMatch(page, /axleSettings\.password|輸入目前的管理密碼/);
  assert.match(page, /更動人 @\$\{payload\.profile\.updatedBy\}/);
  assert.match(route, /export async function PUT/);
  assert.doesNotMatch(route, /export async function DELETE/);
  assert.match(route, /getActiveRequestUser/);
  assert.match(route, /actor\.role === "user"/);
  assert.match(route, /updatedBy: actor\.username/);
  assert.match(route, /normalizeDeviceId/);
  assert.match(profileStore, /ON CONFLICT\(device_id\) DO UPDATE SET/);
  assert.match(profileStore, /updated_by = excluded\.updated_by/);
  assert.match(profileStore, /INSERT INTO device_axle_profile_events/);
  assert.match(profileStore, /existing\?\.axle_count \?\? null/);
  assert.match(profileStore, /await d1\.batch\(\[upsert, appendEvent, appendAudit\]\)/);
  assert.match(actorMigration, /ADD `updated_by` text DEFAULT 'system' NOT NULL/);

  const sqlStart = profileStore.indexOf("`INSERT INTO device_axle_profiles");
  const sqlEnd = profileStore.indexOf("`)", sqlStart);
  assert.ok(sqlStart >= 0 && sqlEnd > sqlStart, "upsert SQL should be present");
  const upsertSql = profileStore.slice(sqlStart + 1, sqlEnd);
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(migration);
    database.exec(actorMigration);
    const upsert = database.prepare(upsertSql);
    upsert.run("LB1", "2026-05-01", 3, 12, "supervisor");
    upsert.run("LB1", "2026-05-14", 3, 4, "user2");
    const rows = database.prepare("SELECT device_id, effective_date, stage_count, axle_count, updated_by FROM device_axle_profiles").all();
    assert.deepEqual(rows.map((row) => ({ ...row })), [{ device_id: "LB1", effective_date: "2026-05-14", stage_count: 3, axle_count: 4, updated_by: "user2" }]);
  } finally {
    database.close();
  }
});

test("server-renders the complete append-only record monitor", async () => {
  const response = await render("/monitor");
  assert.equal(response.status, 200);
  const html = await response.text();
  const page = await readFile(new URL("../app/monitor/page.tsx", import.meta.url), "utf8");

  assert.match(html, /完整紀錄 Monitor/);
  assert.match(html, /異動會保留原始資料/);
  assert.match(html, /全部量測與補油紀錄/);
  assert.match(html, /設備設定紀錄/);
  assert.match(html, /垃圾桶（已刪除）/);
  assert.match(page, /更動軸數/);
  assert.match(html, /更正會新增版本/);
  assert.match(page, /刪除者、伺服器時間、IP 與原因/);
  assert.match(page, /還原後會重新納入量測紀錄、總覽、圖表與統計/);
  assert.match(html, /切換為 LB1 到 MOK10 的設備順序/);
});

test("server-renders the operational admin area framework", async () => {
  const response = await render("/admin-area");
  assert.equal(response.status, 200);
  const html = await response.text();
  const page = await readFile(new URL("../app/admin-area/page.tsx", import.meta.url), "utf8");
  const authChrome = await readFile(new URL("../app/components/AuthSessionProvider.tsx", import.meta.url), "utf8");
  const rolePresentation = await readFile(new URL("../app/lib/rolePresentation.ts", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(html, /管理總覽/);
  assert.match(html, /帳號安全提醒/);
  assert.match(html, /最近系統操作/);
  assert.match(html, /新增帳號/);
  assert.match(page, /<AdminNavItem active \/>/);
  assert.match(authChrome, /user\?\.role !== "admin" && user\?\.role !== "root"/);
  assert.match(authChrome, /data-requires-role="admin-or-root"/);
  assert.match(page, /人員帳號/);
  assert.match(page, /角色與權限/);
  assert.match(page, /操作紀錄/);
  assert.match(page, /登入與安全/);
  assert.match(page, /登入有效時間/);
  assert.match(page, /8 小時後重新登入/);
  assert.match(page, /AD USER－匯入、更正與軟刪除/);
  assert.match(page, /功能權限矩陣/);
  assert.match(page, /label: "查看完整資料紀錄", group: "監測", user: false, userpro: true, supervisor: true, admin: true/);
  assert.match(page, /label: "修改自己 30 分鐘內的提交", group: "資料", user: true, userpro: true, supervisor: true, admin: true/);
  assert.match(page, /label: "軟刪除紀錄", group: "高風險", user: false, userpro: true, supervisor: true, admin: true/);
  assert.match(page, /label: "從垃圾桶還原紀錄", group: "高風險", user: false, userpro: false, supervisor: true, admin: true/);
  assert.doesNotMatch(page.slice(page.indexOf("const permissions"), page.indexOf("const signInOutcomeLabels")), /管理 ADMIN 帳號/);
  assert.match(rolePresentation, /user: "USER"/);
  assert.match(rolePresentation, /userpro: "AD USER"/);
  assert.match(rolePresentation, /supervisor: "POWER USER"/);
  assert.match(rolePresentation, /admin: "ADMIN"/);
  assert.match(rolePresentation, /root: "ROOT"/);
  assert.match(authChrome, /getRoleDisplayLabel\(user\.role\)/);
  assert.match(page, /getRoleDisplayLabel\(user\.role\)/);
  assert.match(page, /getRoleDisplayLabel\(role\)/);
  assert.match(styles, /\.role-display-badge\.user \{[^}]*#667085/);
  assert.match(styles, /\.role-display-badge\.userpro \{[^}]*#2563eb/);
  assert.match(styles, /\.role-display-badge\.supervisor \{[^}]*#c2410c/);
  assert.match(styles, /\.role-display-badge\.admin \{[^}]*#c62845/);
  assert.match(styles, /\.role-display-badge\.root \{[^}]*#f2c66d/);
  assert.doesNotMatch(page, /首次登入時要求更換密碼|強制更換暫時密碼|forcePasswordChange/);
  assert.match(page, /登入帳號／顯示名稱/);
  assert.match(page, /完整操作事件/);
  assert.match(page, /系統時間/);
  assert.match(page, /placeholder="由 ADMIN 自行設定"/);
  assert.doesNotMatch(page, /minLength=|至少 8 個字元/);
});

test("persists admin-created accounts in D1 and uses them for login", async () => {
  const page = await readFile(new URL("../app/admin-area/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/admin/users/route.ts", import.meta.url), "utf8");
  const auth = await readFile(new URL("../app/lib/auth.ts", import.meta.url), "utf8");
  const loginRoute = await readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8");
  const userStore = await readFile(new URL("../app/lib/userStore.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0003_marvelous_maverick.sql", import.meta.url), "utf8");
  const proxy = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");

  assert.match(page, /fetch\("\/api\/admin\/users", \{ cache: "no-store"/);
  assert.match(page, /method: "POST"/);
  assert.match(page, /重新整理後仍會保留/);
  assert.match(route, /createStoredUser/);
  assert.match(route, /listUsers/);
  assert.doesNotMatch(route, /forcePasswordChange|const name =/);
  assert.match(loginRoute, /authenticateStoredUser/);
  assert.match(userStore, /PBKDF2|createPasswordCredential/);
  assert.match(auth, /const passwordHashIterations = 100_000/);
  assert.match(userStore, /INSERT INTO users/);
  assert.match(userStore, /INSERT OR IGNORE INTO users/);
  assert.match(userStore, /name: row\.username/);
  assert.match(userStore, /return \{ username: row\.username, name: row\.username/);
  assert.match(userStore, /UPDATE users SET name = username, force_password_change = 0/);
  assert.match(schema, /sqliteTable\("users"/);
  assert.match(migration, /CREATE TABLE `users`/);
  assert.match(migration, /`password_hash` text NOT NULL/);
  assert.match(migration, /`password_salt` text NOT NULL/);
  assert.match(migration, /CREATE UNIQUE INDEX `users_username_uidx`/);
  assert.match(proxy, /pathname\.startsWith\("\/api\/admin\/"\)/);

  const database = new DatabaseSync(":memory:");
  try {
    database.exec(migration.replaceAll("--> statement-breakpoint", ""));
    database.prepare(
      `INSERT INTO users (id, name, username, role, status, password_hash, password_salt, password_iterations, force_password_change, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("USR-TEST", "user2", "user2", "user", "pending", "stored-hash", "stored-salt", 120000, 0, "admin");
    const stored = database.prepare("SELECT name, username, role, status, force_password_change, created_by FROM users WHERE username = ?").get("user2");
    assert.deepEqual({ ...stored }, { name: "user2", username: "user2", role: "user", status: "pending", force_password_change: 0, created_by: "admin" });
    assert.throws(() => database.prepare(
      `INSERT INTO users (id, name, username, role, status, password_hash, password_salt, password_iterations, force_password_change, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("USR-DUP", "重複", "user2", "user", "pending", "hash", "salt", 120000, 1, "admin"));
  } finally {
    database.close();
  }
});

test("reserves one owner-bound ROOT and prevents ADMIN accounts from controlling peers", async () => {
  const auth = await readFile(new URL("../app/lib/auth.ts", import.meta.url), "utf8");
  const loginRoute = await readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8");
  const adminRoute = await readFile(new URL("../app/api/admin/users/route.ts", import.meta.url), "utf8");
  const userStore = await readFile(new URL("../app/lib/userStore.ts", import.meta.url), "utf8");
  const adminPage = await readFile(new URL("../app/admin-area/page.tsx", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0009_glorious_maggott.sql", import.meta.url), "utf8");
  const createAccountMarkup = adminPage.slice(
    adminPage.indexOf('id="create-account-title"'),
    adminPage.indexOf("{selectedUser ?"),
  );

  assert.match(auth, /export const ROOT_USERNAME = "root"/);
  assert.match(auth, /export const ROOT_USER_ID = "SYSTEM-ROOT"/);
  assert.match(auth, /oai-authenticated-user-id/);
  assert.match(auth, /ROOT_OWNER_USER_ID/);
  assert.match(auth, /ROOT_PASSWORD/);
  assert.match(loginRoute, /validateRootCredentials/);
  assert.match(userStore, /function systemRootUser/);
  assert.match(userStore, /ROOT 是網站擁有者的系統保留帳號/);
  assert.match(userStore, /ADMIN 彼此不能停用或變更角色；只有 ROOT 可以管理 ADMIN/);
  assert.match(userStore, /ADMIN 不能重設其他 ADMIN 的密碼；請由 ROOT 處理/);
  assert.match(userStore, /row\.role === "admin" && actor\.role !== "root"/);
  assert.match(adminRoute, /isAdministratorRole/);
  assert.match(adminPage, /ROOT 是唯一系統保留帳號，不會出現在可建立角色中/);
  assert.match(adminPage, /const permissionRoles = \["user", "userpro", "supervisor", "admin"\]/);
  assert.doesNotMatch(adminPage.slice(adminPage.indexOf("const permissions"), adminPage.indexOf("const signInOutcomeLabels")), /管理 ADMIN 帳號|root:/);
  assert.doesNotMatch(createAccountMarkup, /option value="root"/);
  assert.doesNotMatch(migration, /'root'/);
});

test("persists password resets, role changes, and account disabling without exposing delete", async () => {
  const page = await readFile(new URL("../app/admin-area/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/admin/users/route.ts", import.meta.url), "utf8");
  const userStore = await readFile(new URL("../app/lib/userStore.ts", import.meta.url), "utf8");
  const proxy = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");

  assert.match(route, /export async function PATCH/);
  assert.match(route, /resetStoredUserPassword/);
  assert.match(route, /updateStoredUserStatus/);
  assert.match(route, /updateStoredUserRole/);
  assert.doesNotMatch(route, /export async function DELETE/);
  assert.match(userStore, /SET password_hash = \?, password_salt = \?, password_iterations = \?/);
  assert.match(userStore, /UPDATE users SET status = \?/);
  assert.match(userStore, /UPDATE users SET role = \?/);
  assert.match(proxy, /storedUser\.status !== "active"/);
  assert.match(page, /method: "PATCH"/);
  assert.match(page, /舊密碼立即失效/);
  assert.doesNotMatch(page, /強制登出/);
});

test("lets every signed-in non-root account change its own password without a length rule", async () => {
  const route = await readFile(new URL("../app/api/account/password/route.ts", import.meta.url), "utf8");
  const sessionMenu = await readFile(new URL("../app/components/AuthSessionProvider.tsx", import.meta.url), "utf8");
  const loginPage = await readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8");
  const auth = await readFile(new URL("../app/lib/auth.ts", import.meta.url), "utf8");
  const userStore = await readFile(new URL("../app/lib/userStore.ts", import.meta.url), "utf8");
  const proxy = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  const userMigration = await readFile(new URL("../drizzle/0003_marvelous_maverick.sql", import.meta.url), "utf8");
  const sessionMigration = await readFile(new URL("../drizzle/0010_flat_frog_thor.sql", import.meta.url), "utf8");

  assert.match(route, /export async function POST/);
  assert.match(route, /changeStoredUserPassword/);
  assert.match(route, /newPassword !== confirmPassword/);
  assert.match(route, /serializeExpiredSessionCookie/);
  assert.match(sessionMenu, /更換自己的密碼/);
  assert.match(sessionMenu, /user\.role !== "root"/);
  assert.match(sessionMenu, /密碼不限制長度或字元組合，但不能與目前密碼相同/);
  assert.doesNotMatch(`${route}\n${sessionMenu}`, /minLength=|至少 8 個字元/);
  assert.match(loginPage, /密碼已更新，請使用新密碼重新登入/);
  assert.match(auth, /sessionVersion/);
  assert.match(userStore, /verifyPassword\(options\.currentPassword/);
  assert.match(userStore, /verifyPassword\(options\.newPassword/);
  assert.match(userStore, /session_version = session_version \+ 1/);
  assert.match(userStore, /action: "user\.password_changed"/);
  assert.doesNotMatch(userStore, /after: \{ password: options\.newPassword/);
  assert.match(proxy, /storedUser\.sessionVersion !== session\.sessionVersion/);
  assert.match(sessionMigration, /ALTER TABLE `users` ADD `session_version` integer DEFAULT 1 NOT NULL/);

  const database = new DatabaseSync(":memory:");
  try {
    database.exec(userMigration.replaceAll("--> statement-breakpoint", ""));
    database.exec(sessionMigration.replaceAll("--> statement-breakpoint", ""));
    const initial = database.prepare("SELECT session_version FROM users LIMIT 1").get();
    assert.equal(initial, undefined);
    database.prepare(
      `INSERT INTO users (id, name, username, role, status, password_hash, password_salt, password_iterations, force_password_change, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("USR-SELF", "self", "self", "user", "active", "hash", "salt", 120000, 0, "system");
    assert.equal(database.prepare("SELECT session_version FROM users WHERE id = ?").get("USR-SELF").session_version, 1);
    database.prepare("UPDATE users SET session_version = session_version + 1 WHERE id = ?").run("USR-SELF");
    assert.equal(database.prepare("SELECT session_version FROM users WHERE id = ?").get("USR-SELF").session_version, 2);
  } finally {
    database.close();
  }
});

test("records and displays a unified audit trail with IP and before-after details", async () => {
  const auditStore = await readFile(new URL("../app/lib/auditLog.ts", import.meta.url), "utf8");
  const auditRoute = await readFile(new URL("../app/api/admin/audit/route.ts", import.meta.url), "utf8");
  const adminRoute = await readFile(new URL("../app/api/admin/users/route.ts", import.meta.url), "utf8");
  const userStore = await readFile(new URL("../app/lib/userStore.ts", import.meta.url), "utf8");
  const lubricationRoute = await readFile(new URL("../app/api/lubrication/route.ts", import.meta.url), "utf8");
  const axleStore = await readFile(new URL("../app/lib/deviceAxleProfile.ts", import.meta.url), "utf8");
  const loginRoute = await readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8");
  const logoutRoute = await readFile(new URL("../app/api/auth/logout/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/admin-area/page.tsx", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const userMigration = await readFile(new URL("../drizzle/0003_marvelous_maverick.sql", import.meta.url), "utf8");
  const auditMigration = await readFile(new URL("../drizzle/0008_lying_slayback.sql", import.meta.url), "utf8");

  assert.match(schema, /sqliteTable\("audit_events"/);
  assert.match(auditMigration, /`source_ip` text NOT NULL/);
  assert.match(auditMigration, /`before_json` text/);
  assert.match(auditMigration, /`after_json` text/);
  assert.match(auditMigration, /CREATE INDEX `idx_audit_events_action_occurred_at`/);
  assert.match(auditStore, /listUnifiedAuditEvents/);
  assert.match(auditStore, /歷史未提供/);
  assert.match(auditRoute, /!isAdministratorRole\(actor\.role\)/);
  assert.match(adminRoute, /getAdminAuditContext/);
  assert.match(userStore, /action: "user\.role_changed"/);
  assert.match(userStore, /action: "user\.status_changed"/);
  assert.match(userStore, /action: "user\.password_reset"/);
  assert.doesNotMatch(userStore, /after: \{ password: options\.password/);
  assert.match(lubricationRoute, /action: "lubrication\.measurement_corrected"/);
  assert.match(lubricationRoute, /action: "lubrication\.measurement_soft_deleted"/);
  assert.match(lubricationRoute, /action: "lubrication\.measurement_restored"/);
  assert.match(axleStore, /action: existing \? "device_axle\.updated" : "device_axle\.created"/);
  assert.match(loginRoute, /getRequestAuditContext/);
  assert.match(logoutRoute, /action: "auth\.logout"/);
  assert.match(page, /帳號、IP、動作或操作對象/);
  assert.match(page, /修改前/);
  assert.match(page, /修改後/);
  assert.match(page, /密碼、密碼雜湊與 Session 憑證不寫入 LOG/);

  const database = new DatabaseSync(":memory:");
  try {
    database.exec(userMigration.replaceAll("--> statement-breakpoint", ""));
    database.exec(auditMigration.replaceAll("--> statement-breakpoint", ""));
    database.prepare(
      `INSERT INTO users (id, name, username, role, status, password_hash, password_salt, password_iterations, force_password_change, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("USR-AUDIT", "admin", "admin", "admin", "active", "secret-hash", "secret-salt", 120000, 0, "system");
    database.prepare(
      `INSERT INTO audit_events (id, occurred_at, actor_user_id, actor_username, actor_role, source_ip, request_id,
        action, resource_type, resource_id, before_json, after_json, result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "AUDIT-1",
      "2026-09-09T01:02:03.000Z",
      "USR-AUDIT",
      "admin",
      "admin",
      "203.0.113.10",
      "REQ-1",
      "user.role_changed",
      "user",
      "USR-TARGET",
      JSON.stringify({ role: "user" }),
      JSON.stringify({ role: "supervisor" }),
      "success",
    );
    const stored = database.prepare("SELECT actor_username, actor_role, source_ip, action, before_json, after_json, result FROM audit_events WHERE id = ?").get("AUDIT-1");
    assert.deepEqual({ ...stored }, {
      actor_username: "admin",
      actor_role: "admin",
      source_ip: "203.0.113.10",
      action: "user.role_changed",
      before_json: '{"role":"user"}',
      after_json: '{"role":"supervisor"}',
      result: "success",
    });
  } finally {
    database.close();
  }
});

test("server-renders Cloudflare-synchronized current tread and side-wear estimates", async () => {
  const response = await render("/wear");
  assert.equal(response.status, 200);
  const html = await response.text();
  const page = await readFile(new URL("../app/wear/page.tsx", import.meta.url), "utf8");

  assert.match(html, /當下磨耗狀況推估/);
  assert.doesNotMatch(page, /上／下行 · \{config\.measurement\} · 門檻已設定/);
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
  const sideHtml = await sideResponse.text();
  assert.match(sideHtml, /側面軌道總覽/);
  assert.match(sideHtml, /側向磨耗（側邊）/);
  assert.match(sideHtml, /預估量測/);
  assert.match(sideHtml, /當下磨耗狀況推估/);
  assert.match(sideHtml, /管理值 (?:<!-- -->)?6.5(?:<!-- -->)? mm/);
  assert.match(sideHtml, /維修值 (?:<!-- -->)?8(?:\.0)?(?:<!-- -->)? mm/);
});

test("labels built-in rail baselines as historical data instead of demo data", async () => {
  const page = await readFile(new URL("../app/wear/page.tsx", import.meta.url), "utf8");

  assert.match(page, /dataState: "historical" \| "stored"/);
  assert.match(page, /以下內容為歷史趨勢資料/);
  assert.match(page, /"實際登記資料" : "歷史資料"/);
  assert.doesNotMatch(page, /示範資料|dataState: "demo"/);
});

test("colors current rail status surfaces from the projected value", async () => {
  const page = await readFile(new URL("../app/wear/page.tsx", import.meta.url), "utf8");

  assert.match(page, /const currentRailEstimates = useMemo/);
  assert.match(page, /const selectedStatus = currentEstimatedStatus/);
  assert.match(page, /className={`device-track \${estimate\.status}/);
  assert.match(page, /criticalCount = currentRails\.filter\(\(\{ estimate \}\) => estimate\.status/);
  assert.match(page, /estimate: getCurrentRailEstimate\(point, side\)/);
  assert.match(page, /selectedDisplayCode} 當下預估程度/);
  assert.match(page, /const pointStatus = getWearStatus\(point\.wear\)/);
  assert.doesNotMatch(page, /className=\{getWearStatus\(point\.readings\[side\]\.wear\)\}/);
});

test("stores editable rail-wear measurements and explicit replacement events", async () => {
  const response = await render("/wear");
  assert.equal(response.status, 200);
  const html = await response.text();
  const page = await readFile(new URL("../app/wear/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/rail-wear/route.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0011_cultured_stick.sql", import.meta.url), "utf8");
  const lifecycleMigration = await readFile(new URL("../drizzle/0012_secret_beast.sql", import.meta.url), "utf8");
  const proxy = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");

  assert.match(html, /登記磨耗/);
  assert.match(html, /登記換軌/);
  assert.match(page, /fetch\(`\/api\/rail-wear\?mode=\$\{mode\}`/);
  assert.match(page, /method: editingRecordId \? "PATCH" : "POST"/);
  assert.match(page, /predictionHistory = history\.slice\(lastReplacementIndex/);
  assert.match(page, /後續預測只使用新軌資料/);
  assert.match(page, /更正磨耗紀錄/);
  assert.match(route, /INSERT INTO rail_wear_records/);
  assert.match(route, /INSERT INTO rail_wear_revisions/);
  assert.match(route, /rail_wear\.rail_replaced/);
  assert.match(route, /USER_SELF_EDIT_WINDOW_MS = 30 \* 60 \* 1000/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /export async function PUT/);
  assert.match(route, /SET deleted_at = \?, deleted_by = \?, deleted_ip = \?, delete_reason = \?/);
  assert.match(route, /SET deleted_at = NULL, deleted_by = NULL, deleted_ip = NULL, delete_reason = NULL/);
  assert.match(route, /rail_wear\.record_soft_deleted/);
  assert.match(route, /rail_wear\.record_restored/);
  assert.doesNotMatch(route, /DELETE FROM rail_wear_records/);
  assert.match(page, /method: recordAction\.kind === "delete" \? "DELETE" : "PUT"/);
  assert.match(page, /失效紀錄（不參與預測）/);
  assert.match(page, /確定移至垃圾桶/);
  assert.match(page, /確認還原紀錄/);
  assert.match(page, /const canDelete = signedInUser\?\.role === "userpro"/);
  assert.match(page, /const canRestore = signedInUser\?\.role === "supervisor"/);
  assert.match(schema, /sqliteTable\("rail_wear_records"/);
  assert.match(schema, /sqliteTable\("rail_wear_revisions"/);
  assert.match(schema, /sqliteTable\("rail_wear_lifecycle_events"/);
  assert.match(lifecycleMigration, /ALTER TABLE `rail_wear_records` ADD `deleted_at` text/);
  assert.match(lifecycleMigration, /CREATE TABLE `rail_wear_lifecycle_events`/);
  assert.match(proxy, /pathname === "\/api\/rail-wear" && request\.method === "DELETE"/);
  assert.match(proxy, /pathname === "\/api\/rail-wear" && request\.method === "PUT"/);

  const database = new DatabaseSync(":memory:");
  try {
    database.exec(migration.replaceAll("--> statement-breakpoint", ""));
    database.exec(lifecycleMigration.replaceAll("--> statement-breakpoint", ""));
    database.prepare(`INSERT INTO rail_wear_records
      (id, mode, direction, point_number, rail_side, measured_at, wear, inspector, method, record_type, note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("WEAR-1", "side", "up", 5, "left", "2026-10-01", 6.8, "tester", "手工工具量測", "measurement", null, "admin");
    database.prepare(`INSERT INTO rail_wear_revisions
      (id, record_id, revision_no, mode, direction, point_number, rail_side, measured_at, wear, inspector, method, record_type, note, correction_reason, corrected_by, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("WEAR-REV-1", "WEAR-1", 1, "side", "up", 5, "left", "2026-10-01", 6.7, "tester", "手工工具量測", "measurement", null, "誤植修正", "admin", "admin");
    database.prepare(`INSERT INTO rail_wear_records
      (id, mode, direction, point_number, rail_side, measured_at, wear, inspector, method, record_type, note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("WEAR-2", "side", "up", 5, "left", "2026-10-06", 0.1, "tester", "換軌後初始量測", "replacement", "工單 WR-001", "admin");

    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM rail_wear_records").get().count, 2);
    assert.equal(database.prepare("SELECT wear FROM rail_wear_revisions WHERE record_id = ?").get("WEAR-1").wear, 6.7);
    assert.equal(database.prepare("SELECT record_type FROM rail_wear_records WHERE id = ?").get("WEAR-2").record_type, "replacement");
    assert.throws(() => database.prepare(`INSERT INTO rail_wear_records
      (id, mode, direction, point_number, rail_side, measured_at, wear, inspector, method, record_type, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("WEAR-DUP", "side", "up", 5, "left", "2026-10-06", 0.2, "tester", "手工工具量測", "measurement", "admin"));
    database.prepare("UPDATE rail_wear_records SET deleted_at = ?, deleted_by = ?, deleted_ip = ?, delete_reason = ? WHERE id = ?")
      .run("2026-10-14T09:00:00.000Z", "supervisor", "2001:db8::1", "誤登換軌", "WEAR-2");
    database.prepare("INSERT INTO rail_wear_lifecycle_events (id, record_id, action, reason, actor, source_ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("WEAR-LIFE-1", "WEAR-2", "deleted", "誤登換軌", "supervisor", "2001:db8::1", "2026-10-14T09:00:00.000Z");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM rail_wear_records WHERE deleted_at IS NULL").get().count, 1);
    assert.equal(database.prepare("SELECT action FROM rail_wear_lifecycle_events WHERE record_id = ?").get("WEAR-2").action, "deleted");
  } finally {
    database.close();
  }
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

test("lets POWER USER, ADMIN, and ROOT move records to Trash and restore them", async () => {
  const route = await readFile(new URL("../app/api/lubrication/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/monitor/page.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0007_flowery_triton.sql", import.meta.url), "utf8");
  const proxy = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  const deleteHandler = route.slice(route.indexOf("export async function DELETE"));
  const restoreHandler = route.slice(route.indexOf("export async function PUT"));

  assert.match(route, /export async function DELETE/);
  assert.match(route, /export async function PUT/);
  assert.match(deleteHandler, /getActiveRequestUser/);
  assert.match(deleteHandler, /actor\.role === "user"/);
  assert.match(deleteHandler, /SET deleted_at = \?, deleted_by = \?, deleted_ip = \?, delete_reason = \?/);
  assert.match(deleteHandler, /INSERT INTO measurement_lifecycle_events/);
  assert.doesNotMatch(deleteHandler, /DELETE FROM measurements/);
  assert.match(restoreHandler, /actor\.role === "user"/);
  assert.match(restoreHandler, /只有 POWER USER、ADMIN 或 ROOT 可以從垃圾桶還原紀錄/);
  assert.match(restoreHandler, /SET deleted_at = NULL, deleted_by = NULL, deleted_ip = NULL, delete_reason = NULL/);
  assert.match(restoreHandler, /'restored'/);
  assert.match(page, /method: "DELETE"/);
  assert.match(page, /method: "PUT"/);
  assert.match(page, /🗑 垃圾桶（已刪除）/);
  assert.match(page, /const canDelete = signedInUser\?\.role === "userpro" \|\| signedInUser\?\.role === "supervisor" \|\| signedInUser\?\.role === "admin" \|\| signedInUser\?\.role === "root"/);
  assert.match(page, /const canRestore = signedInUser\?\.role === "supervisor" \|\| signedInUser\?\.role === "admin" \|\| signedInUser\?\.role === "root"/);
  assert.match(page, /已標註失效，並從總覽、圖表與統計中排除/);
  assert.doesNotMatch(page, /刪除密碼|deletePassword/);
  assert.match(page, /刪除原因/);
  assert.match(page, /確定移至垃圾桶/);
  assert.match(page, /確認還原紀錄/);
  assert.doesNotMatch(styles, /button\.deleted-tab \{ margin-left: auto/);
  assert.match(route, /\.filter\(\(item\) => !item\.deletion\)/);
  assert.match(route, /status: deletion \? "已失效"/);
  assert.match(schema, /sqliteTable\("measurement_lifecycle_events"/);
  assert.match(migration, /ALTER TABLE `measurements` ADD `deleted_at` text/);
  assert.match(migration, /ALTER TABLE `measurements` ADD `deleted_ip` text/);
  assert.match(migration, /ALTER TABLE `measurement_revisions` ADD `source_ip`/);
  assert.match(migration, /ALTER TABLE `device_axle_profile_events` ADD `source_ip`/);
  assert.match(proxy, /pathname === "\/api\/lubrication" && request\.method === "DELETE"/);
  assert.match(proxy, /pathname === "\/api\/lubrication" && request\.method === "PUT"/);
  assert.match(proxy, /effectiveSession\.role === "user" \|\| effectiveSession\.role === "userpro"/);

  const worker = await loadWorker();
  const userCookie = await login(worker, "user", "user");
  const userRestoreResponse = await dispatch(worker, "/api/lubrication", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: userCookie },
    body: JSON.stringify({ measurementId: "MEASUREMENT-TEST", restoreReason: "權限測試" }),
  });
  assert.equal(userRestoreResponse.status, 403);
});

test("adds soft-delete audit storage without losing existing measurement rows", async () => {
  const migrationNames = [
    "0000_sharp_sharon_ventura.sql",
    "0001_rapid_venus.sql",
    "0002_peaceful_norrin_radd.sql",
    "0003_marvelous_maverick.sql",
    "0004_pink_layla_miller.sql",
    "0005_gray_penance.sql",
    "0006_last_the_spike.sql",
    "0007_flowery_triton.sql",
  ];
  const migrations = await Promise.all(migrationNames.map((name) => readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8")));
  const database = new DatabaseSync(":memory:");
  try {
    migrations.slice(0, -1).forEach((migration) => database.exec(migration.replaceAll("--> statement-breakpoint", "")));
    database.exec(`
      INSERT INTO import_batches (id, file_name, file_hash, submitted_count, inserted_count, duplicate_count, uploaded_by)
      VALUES ('BATCH-OLD', 'existing.xlsx', 'existing-hash', 1, 1, 0, 'admin');
      INSERT INTO measurements (id, device_id, measured_at, oil_level, inspector, record_type, refill_amount, import_batch_id, created_by)
      VALUES ('MEASUREMENT-OLD', 'LB1', '2026-05-01', 12, 'tester', '量測', NULL, 'BATCH-OLD', 'admin');
    `);
    database.exec(migrations.at(-1).replaceAll("--> statement-breakpoint", ""));

    const migrated = database.prepare("SELECT id, created_ip, deleted_at, deleted_by, deleted_ip, delete_reason FROM measurements WHERE id = ?").get("MEASUREMENT-OLD");
    assert.deepEqual({ ...migrated }, {
      id: "MEASUREMENT-OLD",
      created_ip: "未知",
      deleted_at: null,
      deleted_by: null,
      deleted_ip: null,
      delete_reason: null,
    });

    database.prepare("UPDATE measurements SET deleted_at = ?, deleted_by = ?, deleted_ip = ?, delete_reason = ? WHERE id = ?")
      .run("2026-09-06T01:02:03.000Z", "supervisor", "203.0.113.8", "重複資料", "MEASUREMENT-OLD");
    database.prepare("INSERT INTO measurement_lifecycle_events (id, measurement_id, action, reason, actor, source_ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("LIFE-1", "MEASUREMENT-OLD", "deleted", "重複資料", "supervisor", "203.0.113.8", "2026-09-06T01:02:03.000Z");

    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM measurements WHERE id = ?").get("MEASUREMENT-OLD").count, 1);
    assert.equal(database.prepare("SELECT action FROM measurement_lifecycle_events WHERE measurement_id = ?").get("MEASUREMENT-OLD").action, "deleted");
  } finally {
    database.close();
  }
});

test("repairs legacy lubrication columns before creating dependent indexes", async () => {
  const route = await readFile(new URL("../app/api/lubrication/route.ts", import.meta.url), "utf8");
  const deletedAtRepair = route.indexOf("ALTER TABLE measurements ADD COLUMN deleted_at TEXT");
  const deletedAtIndex = route.indexOf("CREATE INDEX IF NOT EXISTS idx_measurements_deleted_at");

  assert.match(route, /PRAGMA table_info\(measurements\)/);
  assert.match(route, /PRAGMA table_info\(measurement_revisions\)/);
  assert.match(route, /ALTER TABLE measurements ADD COLUMN created_ip TEXT NOT NULL DEFAULT '未知'/);
  assert.match(route, /ALTER TABLE measurement_revisions ADD COLUMN source_ip TEXT NOT NULL DEFAULT '未知'/);
  assert.ok(deletedAtRepair >= 0 && deletedAtIndex > deletedAtRepair);
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
  const page = await readFile(new URL("../app/monitor/page.tsx", import.meta.url), "utf8");

  assert.match(route, /export async function PATCH/);
  assert.match(route, /INSERT INTO measurement_revisions/);
  assert.match(route, /correctionReason/);
  assert.doesNotMatch(route, /UPDATE measurements SET/);
  assert.match(route, /getActiveRequestUser/);
  assert.match(route, /actor\.name/);
  assert.match(route, /actor\.username/);
  assert.doesNotMatch(page, /網站管理密碼|correction\.password/);
  assert.match(page, /更正人（登入身分）/);
  assert.match(schema, /measurementRevisions/);
  assert.match(schema, /revisionNo/);
});

test("protects Excel imports with the signed-in AD USER, POWER USER, or ADMIN role", async () => {
  const route = await readFile(new URL("../app/api/lubrication/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const postHandler = route.slice(route.indexOf("export async function POST"), route.indexOf("export async function PATCH"));

  assert.match(postHandler, /getActiveRequestUser/);
  assert.match(postHandler, /!isManualEntry && actor\.role === "user"/);
  assert.doesNotMatch(page, /Excel 匯入網站管理密碼|excelImportPassword/);
});

test("enables AD USER with the agreed data permissions while reserving axle and restore operations", async () => {
  const auth = await readFile(new URL("../app/lib/auth.ts", import.meta.url), "utf8");
  const adminPage = await readFile(new URL("../app/admin-area/page.tsx", import.meta.url), "utf8");
  const adminRoute = await readFile(new URL("../app/api/admin/users/route.ts", import.meta.url), "utf8");
  const lubricationRoute = await readFile(new URL("../app/api/lubrication/route.ts", import.meta.url), "utf8");
  const axleRoute = await readFile(new URL("../app/api/device-axle-profiles/route.ts", import.meta.url), "utf8");
  const proxy = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  const userMigration = await readFile(new URL("../drizzle/0003_marvelous_maverick.sql", import.meta.url), "utf8");
  const signInMigration = await readFile(new URL("../drizzle/0005_gray_penance.sql", import.meta.url), "utf8");
  const auditMigration = await readFile(new URL("../drizzle/0008_lying_slayback.sql", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0009_glorious_maggott.sql", import.meta.url), "utf8");

  assert.match(auth, /export type AuthRole = "user" \| "userpro" \| "supervisor" \| "admin" \| "root"/);
  assert.match(adminRoute, /role !== "userpro"/);
  assert.doesNotMatch(adminPage, /userpro" disabled|AD USER（未啟用）|暫不開放指派/);
  assert.match(lubricationRoute, /只有 AD USER、POWER USER、ADMIN 或 ROOT 可以匯入 Excel/);
  assert.match(lubricationRoute, /只有 AD USER、POWER USER、ADMIN 或 ROOT 可以刪除紀錄/);
  assert.match(axleRoute, /actor\.role === "user" \|\| actor\.role === "userpro"/);
  assert.match(proxy, /effectiveSession\.role === "user" \|\| effectiveSession\.role === "userpro"/);
  assert.match(migration, /IN \('user', 'userpro', 'supervisor', 'admin'\)/);

  const database = new DatabaseSync(":memory:");
  try {
    database.exec(userMigration.replaceAll("--> statement-breakpoint", ""));
    database.exec(signInMigration.replaceAll("--> statement-breakpoint", ""));
    database.exec(auditMigration.replaceAll("--> statement-breakpoint", ""));
    database.prepare(
      `INSERT INTO users (id, name, username, role, status, password_hash, password_salt, password_iterations, force_password_change, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("USR-OLD", "既有帳號", "existing", "user", "active", "hash", "salt", 120000, 0, "admin");
    database.prepare(
      "INSERT INTO sign_in_events (id, user_id, username, success, outcome, source) VALUES (?, ?, ?, 1, 'success', '127.0.0.1')",
    ).run("SIGNIN-OLD", "USR-OLD", "existing");
    database.prepare(
      `INSERT INTO audit_events (id, actor_user_id, actor_username, actor_role, source_ip, request_id, action, resource_type, result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("AUDIT-OLD", "USR-OLD", "existing", "user", "127.0.0.1", "REQ-OLD", "auth.login_success", "authentication", "success");
    database.exec(migration.replaceAll("--> statement-breakpoint", ""));
    assert.equal(database.prepare("SELECT username FROM users WHERE id = ?").get("USR-OLD").username, "existing");
    assert.equal(database.prepare("SELECT user_id FROM sign_in_events WHERE id = ?").get("SIGNIN-OLD").user_id, "USR-OLD");
    assert.equal(database.prepare("SELECT actor_user_id FROM audit_events WHERE id = ?").get("AUDIT-OLD").actor_user_id, "USR-OLD");
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    database.prepare(
      `INSERT INTO users (id, name, username, role, status, password_hash, password_salt, password_iterations, force_password_change, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("USR-AD", "進階使用者", "advanced", "userpro", "active", "hash", "salt", 120000, 0, "admin");
    assert.equal(database.prepare("SELECT role FROM users WHERE id = ?").get("USR-AD").role, "userpro");
  } finally {
    database.close();
  }
});

test("shows each signed-in person's recent submissions and enforces the 30-minute self-edit window", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/lubrication/route.ts", import.meta.url), "utf8");

  assert.match(page, /我的近期提交/);
  assert.match(page, /最近 8 小時的現場登記/);
  assert.match(page, /送出後 30 分鐘內可自行修改/);
  assert.match(page, /view=my-submissions/);
  assert.match(page, /method: editingSubmission \? "PATCH" : "POST"/);
  assert.match(page, /提交後 30 分鐘內由建立者自行修正/);
  assert.match(page, /請洽 AD USER/);
  assert.match(route, /USER_SELF_EDIT_WINDOW_MS = 30 \* 60 \* 1000/);
  assert.match(route, /MY_SUBMISSIONS_VISIBLE_WINDOW_MS = 8 \* 60 \* 60 \* 1000/);
  assert.match(route, /item\.createdBy\.trim\(\)\.toLowerCase\(\) === normalizedUsername/);
  assert.match(route, /target\.createdBy\.trim\(\)\.toLowerCase\(\) === actor\.username\.trim\(\)\.toLowerCase\(\)/);
  assert.match(route, /Date\.now\(\) > createdAt \+ USER_SELF_EDIT_WINDOW_MS/);
  assert.match(route, /這筆紀錄已超過 30 分鐘修改期限，請聯絡 AD USER 協助更正/);
  assert.match(route, /action: "lubrication\.measurement_corrected"/);
});

test("attributes manual registration to the authenticated user", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/lubrication/route.ts", import.meta.url), "utf8");

  assert.match(page, /手動登記現場量測值/);
  assert.match(page, /inspector:\s*signedInUser\?\.name \|\| signedInUser\?\.username/);
  assert.match(page, /量測巡檢人員（登入身分）/);
  assert.match(page, /aria-readonly="true"/);
  assert.match(page, /recordType:\s*manualEntry\.recordType/);
  assert.match(page, /fetch\("\/api\/lubrication"/);
  assert.match(page, /submissionType:\s*"manual"/);
  assert.doesNotMatch(page, /manualTurnstileToken|TurnstileWidget/);
  assert.match(page, /確認登錄並即時同步/);

  assert.match(route, /isManualEntryPayload/);
  assert.match(route, /parseManualEntryPayload\(requestBody, actor\.name\)/);
  assert.match(route, /createdBy = actor\.username/);
  assert.match(route, /records:\s*\[record\]/);
  assert.match(route, /submittedCount:\s*1/);
  assert.doesNotMatch(route, /anonymous-pov|verifyTurnstileToken/);
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
