import { getD1 } from "../../db";
import {
  createPasswordCredential,
  isRootUsername,
  ROOT_USER_ID,
  ROOT_USERNAME,
  verifyPassword,
} from "./auth";
import type { AuthRole, PasswordCredential } from "./auth";
import { ensureAuditEventsTable, prepareAuditEvent } from "./auditLog";
import type { AuditContext } from "./auditLog";

type UserStatus = "active" | "pending" | "locked" | "disabled";
type Database = Awaited<ReturnType<typeof getD1>>;

export type SignInOutcome = "success" | "invalid_credentials" | "account_not_found" | "account_disabled" | "account_locked" | "rate_limited";

export type SignInContext = {
  source: string;
  userAgent?: string;
  requestId?: string;
};

export type SignInEvent = {
  id: string;
  username: string;
  success: boolean;
  outcome: SignInOutcome;
  source: string;
  createdAt: string;
};

type StoredUserRow = {
  id: string;
  name: string;
  username: string;
  role: AuthRole;
  status: UserStatus;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
  session_version: number;
  force_password_change: number;
  last_login_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type StoredUser = {
  id: string;
  name: string;
  username: string;
  role: AuthRole;
  status: UserStatus;
  lastLoginAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

const USERS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  username TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  session_version INTEGER NOT NULL DEFAULT 1,
  force_password_change INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_role_valid CHECK(role IN ('user', 'userpro', 'supervisor', 'admin')),
  CONSTRAINT users_status_valid CHECK(status IN ('active', 'pending', 'locked', 'disabled')),
  CONSTRAINT users_force_password_change_valid CHECK(force_password_change IN (0, 1)),
  CONSTRAINT users_password_iterations_positive CHECK(password_iterations > 0)
)`;

const USERS_USERNAME_INDEX_SQL = "CREATE UNIQUE INDEX IF NOT EXISTS users_username_uidx ON users(username COLLATE NOCASE)";
const SIGN_IN_EVENTS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS sign_in_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT,
  username TEXT NOT NULL COLLATE NOCASE,
  success INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  source TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sign_in_events_success_valid CHECK(success IN (0, 1)),
  CONSTRAINT sign_in_events_outcome_valid CHECK(outcome IN ('success', 'invalid_credentials', 'account_not_found', 'account_disabled', 'account_locked', 'rate_limited')),
  FOREIGN KEY (user_id) REFERENCES users(id)
)`;
const SIGN_IN_EVENTS_USERNAME_INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_sign_in_events_username_created_at ON sign_in_events(username, created_at)";
const SIGN_IN_EVENTS_CREATED_AT_INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_sign_in_events_created_at ON sign_in_events(created_at)";

const initialAccounts: Array<{
  id: string;
  username: string;
  role: AuthRole;
  password: PasswordCredential;
}> = [
  {
    id: "USR-001",
    username: "admin",
    role: "admin",
    password: { salt: "TpjBMQsHOWemb9lFj2dPrA", hash: "6Cbja9i01yPn0_PfiXCr1xyIW63HGX_mZYFQj67gvyg", iterations: 120_000 },
  },
  {
    id: "USR-002",
    username: "supervisor",
    role: "supervisor",
    password: { salt: "X8I_SfTQ4IxR1Hx-YpIheA", hash: "0OjljRLm2i1CnaMD95MaxNEmvkDhMNXUcz_3CmxO5EU", iterations: 120_000 },
  },
  {
    id: "USR-003",
    username: "user",
    role: "user",
    password: { salt: "LVTgZ_ofzRIXU094T9nryA", hash: "Dr1YQmU_XIW2irnQfvaKozWJXRZiLGcynIp9HYRCMyI", iterations: 120_000 },
  },
];

let usersTableReady: Promise<void> | null = null;

function systemRootUser(lastLoginAt: string | null = null): StoredUser {
  return {
    id: ROOT_USER_ID,
    name: "ROOT",
    username: ROOT_USERNAME,
    role: "root",
    status: "active",
    lastLoginAt,
    createdBy: "system",
    createdAt: "系統保留",
    updatedAt: "系統保留",
  };
}

function publicUser(row: StoredUserRow): StoredUser {
  return {
    id: row.id,
    name: row.username,
    username: row.username,
    role: row.role,
    status: row.status,
    lastLoginAt: row.last_login_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class DuplicateUsernameError extends Error {
  constructor() {
    super("這個登入帳號已經存在。");
    this.name = "DuplicateUsernameError";
  }
}

export class ReservedUsernameError extends Error {
  constructor() {
    super("ROOT 是網站擁有者的系統保留帳號，不能從帳號管理介面建立。");
    this.name = "ReservedUsernameError";
  }
}

export class UserNotFoundError extends Error {
  constructor() {
    super("找不到這個人員帳號。");
    this.name = "UserNotFoundError";
  }
}

export class AccountProtectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountProtectionError";
  }
}

export class CurrentPasswordError extends Error {
  constructor() {
    super("目前密碼不正確。");
    this.name = "CurrentPasswordError";
  }
}

export class PasswordReuseError extends Error {
  constructor() {
    super("新密碼不能與目前密碼相同。");
    this.name = "PasswordReuseError";
  }
}

async function findUserById(database: Database, userId: string) {
  if (userId === ROOT_USER_ID) {
    throw new AccountProtectionError("ROOT 是系統唯一最高管理者，不能從帳號管理介面變更。");
  }
  const row = await database.prepare(
    `SELECT id, name, username, role, status, password_hash, password_salt,
      password_iterations, session_version, force_password_change, last_login_at, created_by, created_at, updated_at
    FROM users WHERE id = ? LIMIT 1`,
  ).bind(userId).first<StoredUserRow>();
  if (!row) throw new UserNotFoundError();
  return row;
}

function assertAccountRoleOrStatusCanBeChanged(
  row: StoredUserRow,
  actor: { username: string; role: AuthRole },
) {
  if (row.role === "admin" && actor.role !== "root") {
    throw new AccountProtectionError("ADMIN 彼此不能停用或變更角色；只有 ROOT 可以管理 ADMIN。");
  }
}

function assertPasswordCanBeReset(row: StoredUserRow, actor: { username: string; role: AuthRole }) {
  const isOwnAccount = row.username.toLowerCase() === actor.username.toLowerCase();
  if (row.role === "admin" && actor.role !== "root" && !isOwnAccount) {
    throw new AccountProtectionError("ADMIN 不能重設其他 ADMIN 的密碼；請由 ROOT 處理。");
  }
}

export async function ensureUsersTable(database: Database) {
  if (!usersTableReady) {
    usersTableReady = (async () => {
      await database.prepare(USERS_TABLE_SQL).run();
      await database.prepare(USERS_USERNAME_INDEX_SQL).run();
      await database.prepare(SIGN_IN_EVENTS_TABLE_SQL).run();
      await database.prepare(SIGN_IN_EVENTS_USERNAME_INDEX_SQL).run();
      await database.prepare(SIGN_IN_EVENTS_CREATED_AT_INDEX_SQL).run();
      await ensureAuditEventsTable(database);
      await database.batch(initialAccounts.map((account) => database.prepare(
        `INSERT OR IGNORE INTO users (
          id, name, username, role, status, password_hash, password_salt,
          password_iterations, force_password_change, created_by
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, 0, 'system')`,
      ).bind(
        account.id,
        account.username,
        account.username,
        account.role,
        account.password.hash,
        account.password.salt,
        account.password.iterations,
      )));
      await database.prepare(
        "UPDATE users SET name = username, force_password_change = 0 WHERE name != username OR force_password_change != 0",
      ).run();
      await database.prepare(
        "UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE status = 'pending'",
      ).run();
      await database.prepare("PRAGMA optimize").run();
    })().catch((error) => {
      usersTableReady = null;
      throw error;
    });
  }
  return usersTableReady;
}

async function insertSignInEvent(
  database: Database,
  options: {
    userId?: string | null;
    userRole?: AuthRole | null;
    username: string;
    outcome: SignInOutcome;
    context: SignInContext;
  },
) {
  const eventId = `AUTH-${crypto.randomUUID().toUpperCase()}`;
  const normalizedUsername = options.username.trim().toLowerCase().slice(0, 80) || "unknown";
  await database.batch([database.prepare(
    `INSERT INTO sign_in_events (id, user_id, username, success, outcome, source, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    eventId,
    options.userId ?? null,
    normalizedUsername,
    options.outcome === "success" ? 1 : 0,
    options.outcome,
    options.context.source.slice(0, 120) || "未知來源",
    options.context.userAgent?.slice(0, 500) || null,
  ), prepareAuditEvent(database, {
    actorUserId: options.userId ?? null,
    actorUsername: normalizedUsername,
    actorRole: options.userRole ?? "anonymous",
    sourceIp: options.context.source,
    userAgent: options.context.userAgent,
    requestId: options.context.requestId ?? crypto.randomUUID(),
    action: options.outcome === "success" ? "auth.login_success" : "auth.login_failure",
    resourceType: "authentication",
    resourceId: options.userId ?? null,
    resourceLabel: `@${normalizedUsername}`,
    after: { outcome: options.outcome },
    result: options.outcome === "success" ? "success" : "failure",
    errorCode: options.outcome === "success" ? null : options.outcome,
    originType: "sign_in_event",
    originId: eventId,
  })]);
}

export async function recordSignInEvent(database: Database, options: {
  username: string;
  outcome: SignInOutcome;
  context: SignInContext;
}) {
  await ensureUsersTable(database);
  const normalizedUsername = options.username.trim().toLowerCase().slice(0, 80) || "unknown";
  const rootAttempt = isRootUsername(normalizedUsername);
  const user = rootAttempt
    ? null
    : await database.prepare("SELECT id, role FROM users WHERE username = ? COLLATE NOCASE LIMIT 1")
      .bind(normalizedUsername)
      .first<{ id: string; role: AuthRole }>();
  await insertSignInEvent(database, {
    userId: user?.id,
    userRole: rootAttempt ? "root" : user?.role,
    username: normalizedUsername,
    outcome: options.outcome,
    context: options.context,
  });
}

async function unlockExpiredAccounts(database: Database) {
  await database.prepare(
    `UPDATE users
    SET status = 'active', updated_at = CURRENT_TIMESTAMP
    WHERE status = 'locked'
      AND NOT EXISTS (
        SELECT 1 FROM sign_in_events
        WHERE sign_in_events.username = users.username COLLATE NOCASE
          AND sign_in_events.outcome = 'invalid_credentials'
          AND sign_in_events.created_at >= datetime('now', '-15 minutes')
      )`,
  ).run();
}

export async function listUsers(database: Database) {
  await ensureUsersTable(database);
  await unlockExpiredAccounts(database);
  const [result, rootLastLogin] = await Promise.all([
    database.prepare(
      `SELECT id, name, username, role, status, password_hash, password_salt,
        password_iterations, session_version, force_password_change, last_login_at, created_by, created_at, updated_at
      FROM users
      WHERE username != ? COLLATE NOCASE
      ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'supervisor' THEN 2 WHEN 'userpro' THEN 3 ELSE 4 END, created_at ASC`,
    ).bind(ROOT_USERNAME).all<StoredUserRow>(),
    database.prepare(
      `SELECT created_at FROM sign_in_events
      WHERE username = ? COLLATE NOCASE AND success = 1
      ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    ).bind(ROOT_USERNAME).first<{ created_at: string }>(),
  ]);
  return [systemRootUser(rootLastLogin?.created_at ?? null), ...result.results.map(publicUser)];
}

export async function getStoredUserAccess(database: Database, username: string) {
  await ensureUsersTable(database);
  if (isRootUsername(username)) return { ...systemRootUser(), sessionVersion: 1 };
  const row = await database.prepare(
    `SELECT id, name, username, role, status, password_hash, password_salt,
      password_iterations, session_version, force_password_change, last_login_at, created_by, created_at, updated_at
    FROM users WHERE username = ? COLLATE NOCASE LIMIT 1`,
  ).bind(username.trim().toLowerCase()).first<StoredUserRow>();
  return row ? { ...publicUser(row), sessionVersion: row.session_version } : null;
}

export async function authenticateStoredUser(
  database: Database,
  username: string,
  password: string,
  context: SignInContext = { source: "未知來源" },
) {
  await ensureUsersTable(database);
  const normalizedUsername = username.trim().toLowerCase();
  if (isRootUsername(normalizedUsername)) return null;
  const row = await database.prepare(
    `SELECT id, name, username, role, status, password_hash, password_salt,
      password_iterations, session_version, force_password_change, last_login_at, created_by, created_at, updated_at
    FROM users WHERE username = ? COLLATE NOCASE LIMIT 1`,
  ).bind(normalizedUsername).first<StoredUserRow>();
  if (!row) {
    await insertSignInEvent(database, { username: normalizedUsername, outcome: "account_not_found", context });
    return null;
  }
  if (row.status === "disabled") {
    await insertSignInEvent(database, { userId: row.id, userRole: row.role, username: row.username, outcome: "account_disabled", context });
    return null;
  }
  if (row.status === "locked") {
    const activeLock = await database.prepare(
      `SELECT COUNT(*) AS count FROM sign_in_events
      WHERE username = ? COLLATE NOCASE
        AND outcome = 'invalid_credentials'
        AND created_at >= datetime('now', '-15 minutes')`,
    ).bind(row.username).first<{ count: number }>();
    if ((activeLock?.count ?? 0) > 0) {
      await insertSignInEvent(database, { userId: row.id, userRole: row.role, username: row.username, outcome: "account_locked", context });
      return null;
    }
    await database.prepare(
      "UPDATE users SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).bind(row.id).run();
  }
  const passwordMatches = await verifyPassword(password, {
    hash: row.password_hash,
    salt: row.password_salt,
    iterations: row.password_iterations,
  });
  if (!passwordMatches) {
    await insertSignInEvent(database, { userId: row.id, userRole: row.role, username: row.username, outcome: "invalid_credentials", context });
    const recentAttempts = await database.prepare(
      `SELECT success, outcome FROM sign_in_events
      WHERE username = ? COLLATE NOCASE
        AND created_at >= datetime('now', '-15 minutes')
      ORDER BY created_at DESC, rowid DESC
      LIMIT 5`,
    ).bind(row.username).all<{ success: number; outcome: SignInOutcome }>();
    const shouldLock = recentAttempts.results.length === 5
      && recentAttempts.results.every((attempt) => attempt.success === 0 && attempt.outcome === "invalid_credentials");
    if (shouldLock) {
      await database.prepare(
        "UPDATE users SET status = 'locked', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).bind(row.id).run();
    }
    return null;
  }

  await database.prepare(
    "UPDATE users SET status = 'active', last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(row.id).run();
  await insertSignInEvent(database, { userId: row.id, userRole: row.role, username: row.username, outcome: "success", context });
  return { username: row.username, name: row.username, role: row.role, sessionVersion: row.session_version };
}

export async function getSignInSecuritySnapshot(database: Database) {
  await ensureUsersTable(database);
  await unlockExpiredAccounts(database);
  const [eventsResult, failedResult, lockedResult] = await Promise.all([
    database.prepare(
      `SELECT id, username, success, outcome, source, created_at
      FROM sign_in_events
      WHERE created_at >= datetime('now', '-24 hours')
      ORDER BY created_at DESC, rowid DESC
      LIMIT 100`,
    ).all<{ id: string; username: string; success: number; outcome: SignInOutcome; source: string; created_at: string }>(),
    database.prepare(
      "SELECT COUNT(*) AS count FROM sign_in_events WHERE success = 0 AND created_at >= datetime('now', '-24 hours')",
    ).first<{ count: number }>(),
    database.prepare("SELECT COUNT(*) AS count FROM users WHERE status = 'locked'").first<{ count: number }>(),
  ]);
  const events: SignInEvent[] = eventsResult.results.map((event) => ({
    id: event.id,
    username: event.username,
    success: event.success === 1,
    outcome: event.outcome,
    source: event.source,
    createdAt: event.created_at,
  }));
  return {
    events,
    failedCount24h: failedResult?.count ?? 0,
    lockedCount: lockedResult?.count ?? 0,
  };
}

export async function createStoredUser(database: Database, options: {
  username: string;
  role: AuthRole;
  password: string;
  createdBy: string;
  audit: AuditContext;
}) {
  await ensureUsersTable(database);
  const normalizedUsername = options.username.trim().toLowerCase();
  if (isRootUsername(normalizedUsername) || options.role === "root") {
    throw new ReservedUsernameError();
  }
  const existing = await database.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE LIMIT 1")
    .bind(normalizedUsername)
    .first<{ id: string }>();
  if (existing) throw new DuplicateUsernameError();

  const credential = await createPasswordCredential(options.password);
  const id = `USR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  try {
    await database.batch([database.prepare(
      `INSERT INTO users (
        id, name, username, role, status, password_hash, password_salt,
        password_iterations, force_password_change, created_by
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      normalizedUsername,
      normalizedUsername,
      options.role,
      credential.hash,
      credential.salt,
      credential.iterations,
      0,
      options.createdBy,
    ), prepareAuditEvent(database, {
      ...options.audit,
      action: "user.created",
      resourceType: "user",
      resourceId: id,
      resourceLabel: `@${normalizedUsername}`,
      after: { username: normalizedUsername, role: options.role, status: "active" },
      originType: "user",
      originId: id,
    })]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed|users_username_uidx/i.test(error.message)) {
      throw new DuplicateUsernameError();
    }
    throw error;
  }

  const row = await database.prepare(
    `SELECT id, name, username, role, status, password_hash, password_salt,
      password_iterations, session_version, force_password_change, last_login_at, created_by, created_at, updated_at
    FROM users WHERE id = ? LIMIT 1`,
  ).bind(id).first<StoredUserRow>();
  if (!row) throw new Error("帳號已建立，但無法讀取建立結果。");
  return publicUser(row);
}

export async function resetStoredUserPassword(database: Database, options: {
  userId: string;
  password: string;
  actorUsername: string;
  actorRole: AuthRole;
  audit: AuditContext;
}) {
  await ensureUsersTable(database);
  const row = await findUserById(database, options.userId);
  assertPasswordCanBeReset(row, { username: options.actorUsername, role: options.actorRole });
  const credential = await createPasswordCredential(options.password);
  await database.batch([database.prepare(
    `UPDATE users
    SET password_hash = ?, password_salt = ?, password_iterations = ?,
      session_version = session_version + 1, force_password_change = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
  ).bind(credential.hash, credential.salt, credential.iterations, options.userId), prepareAuditEvent(database, {
    ...options.audit,
    action: "user.password_reset",
    resourceType: "user",
    resourceId: row.id,
    resourceLabel: `@${row.username}`,
    before: { password: "受保護，不記錄" },
    after: { password: "已重設（內容不記錄）" },
  })]);
  return publicUser(await findUserById(database, options.userId));
}

export async function changeStoredUserPassword(database: Database, options: {
  username: string;
  currentPassword: string;
  newPassword: string;
  audit: AuditContext;
}) {
  await ensureUsersTable(database);
  if (isRootUsername(options.username)) {
    throw new AccountProtectionError("最高管理者密碼由網站擁有者的部署設定管理。");
  }

  const row = await database.prepare(
    `SELECT id, name, username, role, status, password_hash, password_salt,
      password_iterations, session_version, force_password_change, last_login_at, created_by, created_at, updated_at
    FROM users WHERE username = ? COLLATE NOCASE LIMIT 1`,
  ).bind(options.username.trim().toLowerCase()).first<StoredUserRow>();
  if (!row) throw new UserNotFoundError();

  const credential = {
    hash: row.password_hash,
    salt: row.password_salt,
    iterations: row.password_iterations,
  };
  if (!await verifyPassword(options.currentPassword, credential)) {
    await prepareAuditEvent(database, {
      ...options.audit,
      actorUserId: row.id,
      action: "user.password_changed",
      resourceType: "user",
      resourceId: row.id,
      resourceLabel: `@${row.username}`,
      after: { password: "未變更（內容不記錄）" },
      result: "failure",
      errorCode: "current_password_invalid",
    }).run();
    throw new CurrentPasswordError();
  }

  if (await verifyPassword(options.newPassword, credential)) {
    await prepareAuditEvent(database, {
      ...options.audit,
      actorUserId: row.id,
      action: "user.password_changed",
      resourceType: "user",
      resourceId: row.id,
      resourceLabel: `@${row.username}`,
      after: { password: "未變更（內容不記錄）" },
      result: "failure",
      errorCode: "password_reuse",
    }).run();
    throw new PasswordReuseError();
  }

  const nextCredential = await createPasswordCredential(options.newPassword);
  await database.batch([database.prepare(
    `UPDATE users
    SET password_hash = ?, password_salt = ?, password_iterations = ?,
      session_version = session_version + 1, force_password_change = 0, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`,
  ).bind(nextCredential.hash, nextCredential.salt, nextCredential.iterations, row.id), prepareAuditEvent(database, {
    ...options.audit,
    actorUserId: row.id,
    action: "user.password_changed",
    resourceType: "user",
    resourceId: row.id,
    resourceLabel: `@${row.username}`,
    before: { password: "受保護，不記錄" },
    after: { password: "已由本人更換（內容不記錄）" },
    reason: "使用者自行更換密碼",
  })]);
}

export async function updateStoredUserStatus(database: Database, options: {
  userId: string;
  status: "active" | "disabled";
  actorUsername: string;
  actorRole: AuthRole;
  audit: AuditContext;
}) {
  await ensureUsersTable(database);
  const row = await findUserById(database, options.userId);
  assertAccountRoleOrStatusCanBeChanged(row, { username: options.actorUsername, role: options.actorRole });
  await database.batch([database.prepare(
    "UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(options.status, options.userId), prepareAuditEvent(database, {
    ...options.audit,
    action: "user.status_changed",
    resourceType: "user",
    resourceId: row.id,
    resourceLabel: `@${row.username}`,
    before: { status: row.status },
    after: { status: options.status },
    reason: options.status === "disabled" ? "管理員停用帳號" : "管理員啟用帳號",
  })]);
  return publicUser(await findUserById(database, options.userId));
}

export async function updateStoredUserRole(database: Database, options: {
  userId: string;
  role: AuthRole;
  actorUsername: string;
  actorRole: AuthRole;
  audit: AuditContext;
}) {
  await ensureUsersTable(database);
  const row = await findUserById(database, options.userId);
  if (options.role === "root") throw new ReservedUsernameError();
  assertAccountRoleOrStatusCanBeChanged(row, { username: options.actorUsername, role: options.actorRole });
  await database.batch([database.prepare(
    "UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).bind(options.role, options.userId), prepareAuditEvent(database, {
    ...options.audit,
    action: "user.role_changed",
    resourceType: "user",
    resourceId: row.id,
    resourceLabel: `@${row.username}`,
    before: { role: row.role },
    after: { role: options.role },
  })]);
  return publicUser(await findUserById(database, options.userId));
}
